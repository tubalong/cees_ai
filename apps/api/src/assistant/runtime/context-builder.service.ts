import { Injectable } from '@nestjs/common';
import { ConversationMessageRole, type Prisma } from '@prisma/client';
import type { ChatMessage, ChatMode, ChatRequest, ToolTurnMessage } from '@cees/ai-service-client';
import { PrismaService } from '../../database/prisma.service';
import { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import type { PublicTurnMode } from '../assistant.types';

/** 历史消息达到该数量时触发自动压缩，压缩后上下文为摘要 + 最近 RETAIN_RECENT_COUNT 条。 */
const COMPACTION_THRESHOLD = 80;
const RETAIN_RECENT_COUNT = 20;

export interface BuildChatRequestInput {
  conversation: { id: string; tenantId: string };
  turnId: string;
  membershipId: string;
  userId: string;
  requestId: string;
  mode: PublicTurnMode;
}

/** 压缩与组装共用的历史消息视图（含工具轮次所需的字段）。 */
interface HistoryMessage {
  id: string;
  role: ConversationMessageRole;
  content: string;
  turnId: string | null;
  toolCallId: string | null;
}

/**
 * 服务端上下文组装：加载会话历史与摘要，消息量超阈值时自动压缩，
 * 最终组装交给 ai-service 的 ChatRequest 或 ToolTurnRequest。客户端只提交
 * 本轮 user 消息，不参与历史加载与压缩。
 */
@Injectable()
export class ContextBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiServiceGateway,
  ) {}

  /** 纯文本轮次：过滤 TOOL 消息，组装普通 ChatRequest。 */
  async buildChatRequest(input: BuildChatRequestInput): Promise<ChatRequest> {
    const { conversation, userId, requestId } = input;
    const { summary, history } = await this.loadHistoryWithCompaction(input, false);

    return {
      request_id: requestId,
      tenant_id: conversation.tenantId,
      user_id: userId,
      conversation_id: conversation.id,
      mode: (input.mode === 'ultra' ? 'ultra' : 'standard') satisfies ChatMode,
      conversation_summary: summary,
      messages: history.map(toChatMessage),
    };
  }

  /**
   * 工具轮次：保留 TOOL 消息并重建其 assistant(tool_calls) 前缀。持久化的
   * TOOL 消息记录的是公开 toolCallId（NestJS uuid），而 ai-service 校验
   * tool 消息必须引用此前 assistant 消息 tool_calls 中的上游调用 ID，
   * 这里通过 ToolCall 表把公开 ID 映射回上游 ID。
   */
  async buildToolTurnMessages(input: BuildChatRequestInput): Promise<{
    summary: string | null;
    items: ToolTurnMessage[];
  }> {
    const { conversation } = input;
    const { summary, history } = await this.loadHistoryWithCompaction(input, true);

    const retainedToolCallIds = history
      .map((message) => message.toolCallId)
      .filter((id): id is string => id !== null);
    const toolCalls =
      retainedToolCallIds.length > 0
        ? await this.prisma.toolCall.findMany({
            where: { tenantId: conversation.tenantId, id: { in: retainedToolCallIds } },
            orderBy: [{ turnId: 'asc' }, { seq: 'asc' }],
            select: { id: true, turnId: true, upstreamCallId: true, name: true, arguments: true },
          })
        : [];
    const upstreamCallIdById = new Map(toolCalls.map((call) => [call.id, call.upstreamCallId]));
    const nameById = new Map(toolCalls.map((call) => [call.id, call.name]));
    const callsByTurn = new Map<string, NonNullable<ToolTurnMessage['tool_calls']>>();
    for (const call of toolCalls) {
      const bucket = callsByTurn.get(call.turnId) ?? [];
      bucket.push({
        id: call.upstreamCallId,
        name: call.name,
        arguments: toJsonArguments(call.arguments),
      });
      callsByTurn.set(call.turnId, bucket);
    }

    const items: ToolTurnMessage[] = [];
    const synthesizedTurns = new Set<string>();
    for (const message of history) {
      if (message.role === ConversationMessageRole.TOOL) {
        const { toolCallId } = message;
        if (!toolCallId) continue;
        const upstreamCallId = upstreamCallIdById.get(toolCallId);
        if (!upstreamCallId) continue;
        const turnKey = message.turnId ?? '';
        if (!synthesizedTurns.has(turnKey)) {
          synthesizedTurns.add(turnKey);
          const calls = callsByTurn.get(turnKey) ?? [];
          if (calls.length > 0) {
            items.push({ role: 'assistant', content: null, tool_calls: calls });
          }
        }
        items.push({
          role: 'tool',
          content: message.content,
          tool_call_id: upstreamCallId,
          name: nameById.get(toolCallId) ?? null,
        });
        continue;
      }
      if (message.role === ConversationMessageRole.USER) {
        items.push({ role: 'user', content: message.content });
        continue;
      }
      items.push({ role: 'assistant', content: message.content });
    }

    return { summary, items };
  }

  /**
   * 加载历史与摘要，文本消息超阈值时压缩并持久化摘要（两种轮次的唯一策略源）。
   * includeToolMessages 决定保留区间是否含 TOOL 消息：工具轮次需要完整保留
   * TOOL 消息，且截断点对齐轮次边界，避免同一轮次的 tool 消息被拆散。
   */
  private async loadHistoryWithCompaction(
    input: BuildChatRequestInput,
    includeToolMessages: boolean,
  ): Promise<{ summary: string | null; history: HistoryMessage[] }> {
    const { conversation, turnId, membershipId, userId, requestId } = input;

    const history = await this.prisma.conversationMessage.findMany({
      where: { tenantId: conversation.tenantId, conversationId: conversation.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, role: true, content: true, turnId: true, toolCallId: true },
    });
    const textHistory = history.filter((message) => message.role !== ConversationMessageRole.TOOL);

    const latestSummary = await this.prisma.conversationSummary.findFirst({
      where: { tenantId: conversation.tenantId, conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      select: { summary: true },
    });

    let summary = latestSummary?.summary ?? null;
    if (textHistory.length <= COMPACTION_THRESHOLD) {
      return { summary, history: includeToolMessages ? history : textHistory };
    }

    const compactCount = textHistory.length - RETAIN_RECENT_COUNT;
    const toCompact = textHistory.slice(0, compactCount);
    const compacted = await this.gateway.compactChat(
      {
        request_id: requestId,
        tenant_id: conversation.tenantId,
        user_id: userId,
        conversation_id: conversation.id,
        previous_summary: summary,
        messages: toCompact.map(toChatMessage),
      },
      { membershipId, turnId },
    );
    summary = compacted.summary;
    await this.prisma.conversationSummary.create({
      data: {
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        summary: compacted.summary,
        summarizedThroughMessageId:
          compacted.summarized_through_message_id ?? toCompact[toCompact.length - 1]?.id ?? null,
      },
    });

    if (!includeToolMessages) {
      return { summary, history: textHistory.slice(compactCount) };
    }
    // 工具轮次：截断点对齐轮次边界，丢弃被截断轮次的剩余消息。
    const boundary = toCompact[toCompact.length - 1];
    let startIndex = history.findIndex((message) => message.id === boundary.id) + 1;
    if (boundary.turnId) {
      while (startIndex < history.length && history[startIndex].turnId === boundary.turnId) {
        startIndex++;
      }
    }
    return { summary, history: history.slice(startIndex) };
  }
}

function toChatMessage(message: HistoryMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role === ConversationMessageRole.USER ? 'user' : 'assistant',
    content: message.content,
  };
}

function toJsonArguments(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
