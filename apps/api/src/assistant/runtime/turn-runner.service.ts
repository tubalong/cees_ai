import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AssistantEventType, AssistantTurnStatus, Prisma, ToolCallStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ChatStreamEvent,
  ToolCall as UpstreamToolCall,
  ToolTurnMessage,
  ToolTurnRequest,
  ToolTurnStreamEvent,
} from '@cees/ai-service-client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import {
  AiServiceGateway,
} from '../../ai-orchestration/ai-service-gateway.service';
import { describeAssistantError } from '../assistant.errors';
import {
  isTerminalTurnStatus,
  PublicTurn,
  PublicTurnMode,
  PublicTurnStreamEvent,
} from '../assistant.types';
import { ConversationService } from '../conversation/conversation.service';
import { EventService } from '../conversation/event.service';
import { ToolPolicyError, ToolPolicyService } from '../tools/tool-policy.service';
import { ToolRegistryService } from '../tools/tool-registry';
import { ContextBuilderService } from './context-builder.service';

/** 单轮硬上限：最多模型调用次数与工具步数，超出任一上限终止 Turn（设计 7.4）。 */
const MAX_TOOL_TURNS = 5;
const MAX_TOOL_STEPS = 10;

export interface StartTurnResult {
  turnId: string;
}

/**
 * 唯一 Tool Loop 运行器：一轮 Turn 的创建、幂等、上下文组装、上游调用、
 * 事件持久化与状态机都由本服务编排。纯文本轮次调用 ai-service /chat/stream；
 * 工具轮次在后续阶段接入 /chat/tool-turn/stream，不在任何其他模块复制编排逻辑。
 */
@Injectable()
export class TurnRunnerService {
  private readonly logger = new Logger(TurnRunnerService.name);
  private readonly activeExecutions = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly conversationService: ConversationService,
    private readonly eventService: EventService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly gateway: AiServiceGateway,
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolPolicy: ToolPolicyService,
  ) {}

  /**
   * 发起一轮对话。幂等键命中时返回原 Turn 的事件流；同键不同内容返回 409。
   * 返回的事件流由订阅端消费，后台执行不依赖订阅端存活（断线不取消）。
   */
  async startTurn(input: {
    conversationId: string;
    idempotencyKey: string;
    content: string;
    mode: PublicTurnMode;
  }): Promise<StartTurnResult> {
    const conversation = await this.conversationService.requireMemberConversation(input.conversationId);
    const context = this.tenantContext.require();
    const requestHash = hashTurnRequest(input.conversationId, input.mode, input.content);

    const existing = await this.prisma.assistantTurn.findUnique({
      where: {
        conversationId_idempotencyKey: {
          conversationId: input.conversationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) return this.resolveExistingTurn(existing, requestHash);

    const turn = await this.createTurnWithUniqueSeq({
      conversationId: input.conversationId,
      tenantId: conversation.tenantId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      mode: input.mode,
    });
    if (!turn) {
      const existing = await this.prisma.assistantTurn.findUniqueOrThrow({
        where: {
          conversationId_idempotencyKey: {
            conversationId: input.conversationId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      return this.resolveExistingTurn(existing, requestHash);
    }

    try {
      await this.conversationService.appendUserMessage({
        conversation,
        turnId: turn.id,
        content: input.content,
      });
      await this.conversationService.touchLastTurnAt(input.conversationId);
    } catch (error) {
      // Turn 已创建但执行从未启动：立即终态化，避免客户端重试命中幂等后订阅端无限等待。
      await this.failTurn(turn.id, {
        code: 'TURN_STARTUP_FAILED',
        message: '轮次启动失败，请重试',
        retryable: true,
      }).catch((failError) => {
        this.logger.error(`failed to finalize turn ${turn.id} after startup failure: ${String(failError)}`);
      });
      throw error;
    }

    const abortController = new AbortController();
    this.activeExecutions.set(turn.id, abortController);
    void this.executeInBackground({
      turnId: turn.id,
      conversation,
      userId: context.userId,
      membershipId: context.membershipId,
      requestId: context.requestId,
      mode: input.mode,
      permissions: context.permissions,
      signal: abortController.signal,
    });

    return {
      turnId: turn.id,
    };
  }

  /** 校验轮次归属后订阅事件流；重放接口与幂等重复提交共用。signal 仅中断订阅，不取消执行。 */
  async subscribeTurn(input: {
    conversationId: string;
    turnId: string;
    afterSeq: number;
  }, signal?: AbortSignal): Promise<AsyncGenerator<PublicTurnStreamEvent>> {
    await this.requireConversationTurn(input.conversationId, input.turnId);
    return this.eventService.poll(input.turnId, input.afterSeq, signal);
  }

  /**
   * 取消正在执行的轮次。先抢状态（仅 RUNNING 可取消），成功者写入终止事件
   * 并中止后台上游调用；竞争失败或已终态返回 400。
   */
  async cancelTurn(conversationId: string, turnId: string): Promise<PublicTurn> {
    const { tenantId } = await this.requireConversationTurn(conversationId, turnId);
    const updated = await this.prisma.assistantTurn.updateMany({
      where: { id: turnId, status: AssistantTurnStatus.RUNNING },
      data: { status: AssistantTurnStatus.CANCELLED, completedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new BadRequestException({
        code: 'TURN_NOT_CANCELLABLE',
        message: '轮次已结束，无法取消',
      });
    }

    await this.eventService.append(turnId, tenantId, AssistantEventType.ERROR, {
      type: 'error',
      error: {
        code: 'TURN_CANCELLED',
        message: '轮次已被取消',
        retryable: false,
      },
    });
    this.activeExecutions.get(turnId)?.abort();

    const turn = await this.prisma.assistantTurn.findUniqueOrThrow({ where: { id: turnId } });
    return toPublicTurn(turn);
  }

  /** 幂等命中：同键同内容返回原事件流，同键不同内容 409。 */
  private resolveExistingTurn(
    existing: { id: string; requestHash: string },
    requestHash: string,
  ): StartTurnResult {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: '同一幂等键对应不同的请求内容',
      });
    }
    return { turnId: existing.id };
  }

  /** 会话内轮次序号从 1 递增；seq 唯一冲突时重试，幂等键冲突时返回 undefined 由调用方转幂等分支。 */
  private async createTurnWithUniqueSeq(input: {
    conversationId: string;
    tenantId: string;
    idempotencyKey: string;
    requestHash: string;
    mode: PublicTurnMode;
  }): Promise<{ id: string } | undefined> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const count = await tx.assistantTurn.count({ where: { conversationId: input.conversationId } });
          return tx.assistantTurn.create({
            data: {
              tenantId: input.tenantId,
              conversationId: input.conversationId,
              seq: count + 1,
              idempotencyKey: input.idempotencyKey,
              requestHash: input.requestHash,
              status: AssistantTurnStatus.RUNNING,
              mode: input.mode,
            },
            select: { id: true },
          });
        });
      } catch (error) {
        const target = uniqueConstraintTarget(error);
        if (target?.includes('idempotency_key')) return undefined;
        if (target?.includes('seq') && attempt < 4) continue;
        throw error;
      }
    }
    throw new Error(`failed to allocate turn seq for conversation ${input.conversationId}`);
  }

  /** 后台执行：组装上下文 → 上游流 → 事件持久化 → 状态机收尾。 */
  private async executeInBackground(input: {
    turnId: string;
    conversation: { id: string; tenantId: string };
    userId: string;
    membershipId: string;
    requestId: string;
    mode: PublicTurnMode;
    permissions: string[];
    signal: AbortSignal;
  }): Promise<void> {
    const { turnId, conversation } = input;
    try {
      const allowedTools = this.toolRegistry.listAllowed(input.permissions);
      if (allowedTools.length === 0) {
        await this.runPlainTurn({
          turnId,
          conversation,
          membershipId: input.membershipId,
          userId: input.userId,
          requestId: input.requestId,
          mode: input.mode,
          signal: input.signal,
        });
        return;
      }
      await this.runToolTurn({
        turnId,
        conversation,
        userId: input.userId,
        membershipId: input.membershipId,
        requestId: input.requestId,
        mode: input.mode,
        permissions: input.permissions,
        allowedTools,
        signal: input.signal,
      });
    } catch (error) {
      await this.failTurn(turnId, describeAssistantError(error));
    } finally {
      this.activeExecutions.delete(turnId);
    }
  }

  /** 纯文本轮次：无可用工具时走 /chat/stream，行为与阶段 3 一致。 */
  private async runPlainTurn(input: {
    turnId: string;
    conversation: { id: string; tenantId: string };
    userId: string;
    membershipId: string;
    requestId: string;
    mode: PublicTurnMode;
    signal: AbortSignal;
  }): Promise<void> {
    const { turnId, conversation } = input;
    const chatRequest = await this.contextBuilder.buildChatRequest({
      conversation,
      turnId,
      membershipId: input.membershipId,
      userId: input.userId,
      requestId: input.requestId,
      mode: input.mode,
    });
    if (input.signal.aborted) return;

    const upstream = await this.gateway.streamChat(
      chatRequest,
      { membershipId: input.membershipId, turnId },
      input.signal,
    );

    let content = '';
    for await (const event of upstream) {
      if (input.signal.aborted) break;
      const publicEvent = this.mapUpstreamEvent(event, conversation.id, turnId, input.requestId);
      await this.eventService.append(
        turnId,
        conversation.tenantId,
        toAssistantEventType(publicEvent.type),
        publicEvent,
      );
      if (publicEvent.type === 'content_delta') content += publicEvent.text;
      if (publicEvent.type === 'completed') {
        await this.completeTurn(turnId, conversation, content);
        return;
      }
      if (publicEvent.type === 'error') {
        await this.failTurn(turnId, publicEvent.error);
        return;
      }
    }
    await this.finishAfterStreamEnd(turnId);
  }

  /**
   * 工具轮次：循环调用 /chat/tool-turn/stream，收到 tool_calls 建议后经
   * 程序化批准执行工具，回填 TOOL 消息再次调用，直到 final_answer 或达到硬上限。
   */
  private async runToolTurn(input: {
    turnId: string;
    conversation: { id: string; tenantId: string };
    userId: string;
    membershipId: string;
    requestId: string;
    mode: PublicTurnMode;
    permissions: string[];
    allowedTools: ReturnType<ToolRegistryService['listAllowed']>;
    signal: AbortSignal;
  }): Promise<void> {
    const { turnId, conversation } = input;
    const messages = await this.contextBuilder.buildToolTurnMessages({
      conversation,
      turnId,
      membershipId: input.membershipId,
      userId: input.userId,
      requestId: input.requestId,
      mode: input.mode,
    });
    if (input.signal.aborted) return;

    let content = '';
    let executedSteps = 0;
    for (let modelCall = 0; modelCall < MAX_TOOL_TURNS; modelCall++) {
      if (input.signal.aborted) return;

      const request: ToolTurnRequest = {
        request_id: input.requestId,
        tenant_id: conversation.tenantId,
        user_id: input.userId,
        conversation_id: conversation.id,
        mode: input.mode === 'ultra' ? 'ultra' : 'standard',
        conversation_summary: messages.summary ?? null,
        messages: messages.items,
        tools: input.allowedTools,
      };
      const upstream = await this.gateway.streamToolTurn(
        request,
        { membershipId: input.membershipId, turnId },
        input.signal,
      );

      let suggestedCalls: UpstreamToolCall[] = [];
      let terminal: 'completed' | 'error' | null = null;
      let terminalError: { code: string; message: string; retryable: boolean } | null = null;
      for await (const event of upstream) {
        if (input.signal.aborted) break;
        const publicEvent = this.mapToolTurnUpstreamEvent(event, conversation.id, turnId, input.requestId);
        if (publicEvent) {
          await this.eventService.append(
            turnId,
            conversation.tenantId,
            toAssistantEventType(publicEvent.type),
            publicEvent,
          );
          if (publicEvent.type === 'content_delta') content += publicEvent.text;
        }
        if (event.type === 'tool_calls') suggestedCalls = event.tool_calls;
        if (event.type === 'completed') terminal = 'completed';
        if (event.type === 'error') {
          terminal = 'error';
          if (publicEvent && publicEvent.type === 'error') terminalError = publicEvent.error;
        }
        if (terminal) break;
      }

      if (input.signal.aborted) return;
      if (terminal === 'completed') {
        await this.completeTurn(turnId, conversation, content);
        return;
      }
      if (terminal === 'error') {
        await this.failTurn(turnId, terminalError ?? {
          code: 'AI_SERVICE_TOOL_TURN_ERROR',
          message: 'AI 服务工具轮次返回错误',
          retryable: false,
        });
        return;
      }
      if (suggestedCalls.length === 0) {
        await this.finishAfterStreamEnd(turnId);
        return;
      }

      const results = await this.executeToolCalls({
        turnId,
        conversation,
        userId: input.userId,
        membershipId: input.membershipId,
        requestId: input.requestId,
        permissions: input.permissions,
        calls: suggestedCalls,
      });
      executedSteps += results.length;
      if (executedSteps > MAX_TOOL_STEPS) {
        await this.failTurn(turnId, {
          code: 'TOOL_LOOP_LIMIT_EXCEEDED',
          message: '工具步数超过单轮上限',
          retryable: false,
        });
        return;
      }

      // 回填：assistant(tool_calls) + 每个工具的 TOOL 结果消息。
      messages.items.push({
        role: 'assistant',
        content: null,
        tool_calls: suggestedCalls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
      });
      for (const result of results) {
        messages.items.push({
          role: 'tool',
          content: result.content,
          tool_call_id: result.upstreamCallId,
          name: result.name,
        });
      }
    }

    await this.failTurn(turnId, {
      code: 'TOOL_LOOP_LIMIT_EXCEEDED',
      message: '模型调用次数超过单轮上限',
      retryable: false,
    });
  }

  /**
   * 执行一批模型建议的工具调用：每个调用先落 TOOL_CALL 事件，再经统一程序化
   * 批准（存在性/权限/参数），批准通过才执行；结果落 TOOL_RESULT 事件与 TOOL 消息。
   * 失败或拒绝同样回喂模型，由模型生成解释；硬上限在 runToolTurn 兜底。
   */
  private async executeToolCalls(input: {
    turnId: string;
    conversation: { id: string; tenantId: string };
    userId: string;
    membershipId: string;
    requestId: string;
    permissions: string[];
    calls: UpstreamToolCall[];
  }): Promise<Array<{ upstreamCallId: string; name: string; content: string }>> {
    const results: Array<{ upstreamCallId: string; name: string; content: string }> = [];
    for (const call of input.calls) {
      const toolCallId = randomUUID();
      const { turnId, conversation } = input;
      const record = await this.createToolCallRecord({
        turnId,
        conversation,
        seq: await this.nextToolCallSeq(turnId, conversation.tenantId),
        upstreamCallId: call.id,
        name: call.name,
        arguments: call.arguments as Prisma.InputJsonValue,
      });

      await this.eventService.append(turnId, conversation.tenantId, AssistantEventType.TOOL_CALL, {
        type: 'tool_call',
        toolCallId,
        name: call.name,
        arguments: call.arguments,
      });

      let content: string;
      let recordStatus: ToolCallStatus;
      try {
        const approval = this.toolPolicy.approve({
          name: call.name,
          arguments: call.arguments,
          permissions: input.permissions,
        });
        await this.updateToolCallRecord(record.id, ToolCallStatus.EXECUTING);
        const result = await approval.definition.execute(
          {
            tenantId: conversation.tenantId,
            userId: input.userId,
            membershipId: input.membershipId,
            requestId: input.requestId,
            conversationId: conversation.id,
            turnId,
            toolCallId,
            permissions: input.permissions,
          },
          approval.parsedArguments,
        );
        content = result.summary;
        recordStatus = ToolCallStatus.COMPLETED;
        await this.updateToolCallRecord(record.id, recordStatus, {
          result: {
            resourceType: result.resourceType,
            resourceId: result.resourceId,
            resourceUrl: result.resourceUrl,
          },
          executedResourceType: result.resourceType,
          executedResourceId: result.resourceId,
        });
        await this.conversationService.appendToolMessage({
          conversation,
          turnId,
          toolCallId,
          content,
        });
        await this.eventService.append(turnId, conversation.tenantId, AssistantEventType.TOOL_RESULT, {
          type: 'tool_result',
          toolCallId,
          status: 'completed',
          resourceId: result.resourceId,
          resourceUrl: result.resourceUrl,
          error: null,
        });
      } catch (error) {
        const rejection = toToolRejection(error);
        content = rejection.summary;
        recordStatus = rejection.status;
        await this.updateToolCallRecord(record.id, recordStatus, {
          result: { error: rejection.summary },
          errorCode: rejection.code,
          errorMessage: rejection.summary,
        });
        await this.conversationService.appendToolMessage({
          conversation,
          turnId,
          toolCallId,
          content,
        });
        await this.eventService.append(turnId, conversation.tenantId, AssistantEventType.TOOL_RESULT, {
          type: 'tool_result',
          toolCallId,
          status: rejection.eventStatus,
          resourceId: null,
          resourceUrl: null,
          error: { code: rejection.code, message: rejection.summary },
        });
      }

      results.push({ upstreamCallId: call.id, name: call.name, content });
    }
    return results;
  }

  private async createToolCallRecord(input: {
    turnId: string;
    conversation: { id: string; tenantId: string };
    seq: number;
    upstreamCallId: string;
    name: string;
    arguments: Prisma.InputJsonValue;
  }): Promise<{ id: string }> {
    return this.prisma.toolCall.create({
      data: {
        tenantId: input.conversation.tenantId,
        conversationId: input.conversation.id,
        turnId: input.turnId,
        seq: input.seq,
        upstreamCallId: input.upstreamCallId,
        name: input.name,
        arguments: input.arguments,
        status: ToolCallStatus.APPROVED,
      },
      select: { id: true },
    });
  }

  private async updateToolCallRecord(
    id: string,
    status: ToolCallStatus,
    data?: {
      result?: Prisma.InputJsonValue;
      errorCode?: string;
      errorMessage?: string;
      executedResourceType?: string;
      executedResourceId?: string;
    },
  ): Promise<void> {
    await this.prisma.toolCall.update({
      where: { id },
      data: {
        status,
        ...(data?.result !== undefined ? { result: data.result } : {}),
        ...(data?.errorCode !== undefined ? { errorCode: data.errorCode } : {}),
        ...(data?.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
        ...(data?.executedResourceType !== undefined ? { executedResourceType: data.executedResourceType } : {}),
        ...(data?.executedResourceId !== undefined ? { executedResourceId: data.executedResourceId } : {}),
      },
    });
  }

  private async nextToolCallSeq(turnId: string, tenantId: string): Promise<number> {
    const count = await this.prisma.toolCall.count({ where: { turnId, tenantId } });
    return count + 1;
  }

  /**
   * 上游流结束但没有终止事件：取消路径由 cancelTurn 已写入事件并置 CANCELLED；
   * 其他来源（如网关对异常流的保护性结束）按失败处理。
   */
  private async finishAfterStreamEnd(turnId: string): Promise<void> {
    const turn = await this.prisma.assistantTurn.findUniqueOrThrow({ where: { id: turnId } });
    if (isTerminalTurnStatus(turn.status)) return;
    await this.failTurn(turnId, {
      code: 'AI_SERVICE_INVALID_RESPONSE',
      message: 'AI 服务流在终态事件前意外结束',
      retryable: false,
    });
  }

  /** 事件先行、状态随后：订阅端先看到事件，再以终态结束重放。 */
  private async completeTurn(
    turnId: string,
    conversation: { id: string; tenantId: string },
    content: string,
  ): Promise<void> {
    const updated = await this.prisma.assistantTurn.updateMany({
      where: { id: turnId, status: AssistantTurnStatus.RUNNING },
      data: { status: AssistantTurnStatus.COMPLETED, completedAt: new Date() },
    });
    if (updated.count === 0) return;
    if (content) {
      await this.conversationService.appendAssistantMessage({ conversation, turnId, content });
    }
    await this.conversationService.setTitleFromFirstUserMessage(conversation.id);
  }

  private async failTurn(
    turnId: string,
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void> {
    const turn = await this.prisma.assistantTurn.findUnique({
      where: { id: turnId },
      select: { tenantId: true, status: true },
    });
    if (!turn || turn.status === AssistantTurnStatus.CANCELLED) return;
    if (turn.status === AssistantTurnStatus.FAILED) return;

    try {
      await this.eventService.append(turnId, turn.tenantId, AssistantEventType.ERROR, {
        type: 'error',
        error,
      });
    } catch (appendError) {
      this.logger.error(
        `failed to append error event for turn ${turnId}: ${String(appendError)}`,
      );
    }
    await this.prisma.assistantTurn.update({
      where: { id: turnId },
      data: {
        status: AssistantTurnStatus.FAILED,
        completedAt: new Date(),
        error: { ...error },
      },
    });
  }

  private mapUpstreamEvent(
    event: ChatStreamEvent,
    conversationId: string,
    turnId: string,
    requestId: string,
  ): DistributiveOmit<PublicTurnStreamEvent, 'seq'> {
    switch (event.type) {
      case 'started':
        return {
          type: 'started',
          requestId,
          conversationId,
          turnId,
          mode: event.mode,
          contextUsage: {
            strategy: event.context_usage.strategy,
            receivedMessageCount: event.context_usage.received_message_count,
            includedMessageCount: event.context_usage.included_message_count,
            historyTruncated: event.context_usage.history_truncated,
            estimatedInputTokens: event.context_usage.estimated_input_tokens,
          },
        };
      case 'status':
        return { type: 'status', phase: event.phase };
      case 'content_delta':
        return { type: 'content_delta', text: event.text };
      case 'usage':
        return {
          type: 'usage',
          tokenUsage: {
            inputTokens: event.token_usage.input_tokens,
            outputTokens: event.token_usage.output_tokens,
            totalTokens: event.token_usage.total_tokens,
          },
        };
      case 'completed':
        return {
          type: 'completed',
          latencyMs: event.latency_ms,
          finishReason: event.finish_reason ?? null,
        };
      case 'error':
        return {
          type: 'error',
          error: {
            code: event.error.code,
            message: event.error.message,
            retryable: event.error.retryable,
          },
        };
    }
  }

  /**
   * 工具轮次上游事件映射：tool_calls 是模型建议，由 runToolTurn 消费执行，
   * 不直接产出公开事件；其余事件与纯文本流结构一致，复用同一映射。
   */
  private mapToolTurnUpstreamEvent(
    event: ToolTurnStreamEvent,
    conversationId: string,
    turnId: string,
    requestId: string,
  ): DistributiveOmit<PublicTurnStreamEvent, 'seq'> | null {
    if (event.type === 'tool_calls') return null;
    return this.mapUpstreamEvent(event, conversationId, turnId, requestId);
  }

  private async requireConversationTurn(
    conversationId: string,
    turnId: string,
  ): Promise<{ tenantId: string }> {
    await this.conversationService.requireMemberConversation(conversationId);
    const turn = await this.prisma.assistantTurn.findFirst({
      where: { id: turnId, conversationId },
      select: { tenantId: true },
    });
    if (!turn) {
      throw new NotFoundException({
        code: 'TURN_NOT_FOUND',
        message: '轮次不存在或不属于该会话',
      });
    }
    return turn;
  }
}

function toPublicTurn(turn: {
  id: string;
  conversationId: string;
  status: AssistantTurnStatus;
  mode: string;
  error: Prisma.JsonValue | null;
  createdAt: Date;
  completedAt: Date | null;
}): PublicTurn {
  return {
    id: turn.id,
    conversationId: turn.conversationId,
    status: turn.status,
    mode: turn.mode === 'ultra' ? 'ultra' : 'standard',
    error: toPublicError(turn.error),
    createdAt: turn.createdAt,
    completedAt: turn.completedAt,
  };
}

function toPublicError(error: Prisma.JsonValue | null): PublicTurn['error'] {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const detail = error as Record<string, unknown>;
  if (
    typeof detail.code !== 'string'
    || typeof detail.message !== 'string'
    || typeof detail.retryable !== 'boolean'
  ) {
    return null;
  }
  return {
    code: detail.code,
    message: detail.message,
    retryable: detail.retryable,
  };
}

function toAssistantEventType(type: PublicTurnStreamEvent['type']): AssistantEventType {
  switch (type) {
    case 'started': return AssistantEventType.STARTED;
    case 'status': return AssistantEventType.STATUS;
    case 'content_delta': return AssistantEventType.CONTENT_DELTA;
    case 'tool_call': return AssistantEventType.TOOL_CALL;
    case 'tool_result': return AssistantEventType.TOOL_RESULT;
    case 'usage': return AssistantEventType.USAGE;
    case 'completed': return AssistantEventType.COMPLETED;
    case 'error': return AssistantEventType.ERROR;
  }
}

function hashTurnRequest(conversationId: string, mode: string, content: string): string {
  return createHash('sha256')
    .update(`${conversationId}\n${mode}\n${content}`)
    .digest('hex');
}

function uniqueConstraintTarget(error: unknown): string[] | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return undefined;
  return error.meta?.target as string[] | undefined;
}

/**
 * 工具执行失败分类：程序化批准拒绝（未知工具/无权限/参数非法）与执行期异常
 * 分别映射为 REJECTED / FAILED，公开事件对应 rejected / failed。
 */
function toToolRejection(error: unknown): {
  summary: string;
  status: ToolCallStatus;
  code: string;
  eventStatus: 'rejected' | 'failed';
} {
  if (error instanceof ToolPolicyError) {
    return {
      summary: error.message,
      status: ToolCallStatus.REJECTED,
      code: error.code,
      eventStatus: 'rejected',
    };
  }
  const message = error instanceof Error ? error.message : '工具执行失败';
  return {
    summary: message,
    status: ToolCallStatus.FAILED,
    code: 'TOOL_EXECUTION_FAILED',
    eventStatus: 'failed',
  };
}

/** Omit 对联合类型会退化为公共属性；分配式 Omit 保留每个成员的结构。 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
