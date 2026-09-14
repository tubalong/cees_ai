import { Injectable } from '@nestjs/common';
import { ConversationMessageRole, type Prisma } from '@prisma/client';
import type { ChatMessage, ChatMode, ChatRequest, ToolTurnMessage } from '@cees/ai-service-client';
import { PrismaService } from '../../database/prisma.service';
import { AiServiceGateway, type ChatContextBudgets } from '../../ai-orchestration/ai-service-gateway.service';
import type { PublicTurnMode } from '../assistant.types';

/** 历史消息达到该数量时触发自动压缩，压缩后上下文为摘要 + 最近 RETAIN_RECENT_COUNT 条。 */
const COMPACTION_THRESHOLD = 80;
const RETAIN_RECENT_COUNT = 20;

/**
 * 各模式输入 Token 预算的兜底默认值（Standard 64K / Ultra 128K）。
 * 权威值来自 ai-service `/ready` 的 `chat_context_budgets`（运行时拉取）；
 * 仅在 ai-service 未就绪、字段缺失或调用失败时回退到该值。
 */
const DEFAULT_CONTEXT_BUDGET_TOKENS: Record<PublicTurnMode, number> = {
  standard: 65536,
  ultra: 131072,
};

/**
 * 触发压缩的预算占比：估算输入超过预算的该比例即压缩，留出 system prompt、
 * instructions 与输出 token 的余量，避免逼近模型上下文窗口才压缩。
 */
const COMPACTION_TOKEN_RATIO = 0.8;

/** 每条消息固定开销 Token，与 ai-service `app/chat/context.py` 的 MESSAGE_OVERHEAD_TOKENS 一致。 */
const MESSAGE_OVERHEAD_TOKENS = 4;

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

    const budgets = await this.gateway.fetchChatContextBudgets();
    const compactCount = this.resolveCompactionCount(input.mode, textHistory, summary, budgets);
    if (compactCount <= 0) {
      return { summary, history: includeToolMessages ? history : textHistory };
    }

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

  /**
   * 计算需要压缩的最老消息条数，返回 0 表示不压缩。
   *
   * 触发条件：文本消息数超过阈值，或「摘要 + 文本历史」的估算 Token 超过预算的
   * 安全比例。压缩量取条数约束与 Token 约束中「保留更少、压缩更多」的一方，保证
   * 压缩后上下文回到预算内，避免 ai-service 在模型调用前静默丢弃历史。
   */
  private resolveCompactionCount(
    mode: PublicTurnMode,
    textHistory: HistoryMessage[],
    summary: string | null,
    budgets: ChatContextBudgets | null,
  ): number {
    // 条数约束：超过阈值则至少压到剩最近 RETAIN_RECENT_COUNT 条。
    const countKeepFrom =
      textHistory.length > COMPACTION_THRESHOLD ? textHistory.length - RETAIN_RECENT_COUNT : 0;

    // Token 约束：从最新往最老累计，保留不超过预算安全比例的最近消息。
    const budget = budgets?.[mode] ?? DEFAULT_CONTEXT_BUDGET_TOKENS[mode];
    const tokenLimit = Math.floor(budget * COMPACTION_TOKEN_RATIO);
    const summaryTokens = summary ? MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(summary) : 0;

    let accumulated = summaryTokens;
    let tokenKeepFrom = textHistory.length;
    for (let index = textHistory.length - 1; index >= 0; index--) {
      const tokens = estimateMessageTokens(textHistory[index]);
      if (accumulated + tokens > tokenLimit) break;
      accumulated += tokens;
      tokenKeepFrom = index;
    }
    if (tokenKeepFrom === textHistory.length) {
      // 连最后一条都无法放入预算时仍保留最后一条，避免上下文为空。
      tokenKeepFrom = Math.max(0, textHistory.length - 1);
    }

    return Math.max(countKeepFrom, tokenKeepFrom);
  }
}

/** 复用 ai-service `app/chat/context.py` 的估算口径：UTF-8 字节数 / 4 上取整。 */
function estimateTextTokens(value: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(value, 'utf8') / 4));
}

function estimateMessageTokens(message: HistoryMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
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
