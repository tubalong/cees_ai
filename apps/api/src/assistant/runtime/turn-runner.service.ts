import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  AssistantEventType,
  AssistantTurnStage,
  AssistantTurnStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ChatStreamEvent,
  ToolCall as UpstreamToolCall,
  ToolTurnRequest,
  ToolTurnStreamEvent,
} from '@cees/ai-service-client';
import { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
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
import { AssistantMessageContentService } from './message-content.service';
import {
  ASSISTANT_HEARTBEAT_INTERVAL_MS,
  nextTurnLease,
} from './turn-execution.config';
import { TurnStateService } from './turn-state.service';
import {
  isActiveMembership,
  resolveMembershipAuthorization,
} from '../../rbac/authorization-resolver';

/** 单轮硬上限：最多模型调用次数与工具调用提案数。 */
const MAX_TOOL_TURNS = 5;
const MAX_TOOL_STEPS = 10;

export interface StartTurnResult {
  turnId: string;
}

/**
 * 唯一 Tool Loop 运行器。它只负责决定下一步；关键状态、消息与事件的原子写入
 * 统一委托 TurnStateService，图片和文档执行器只通过 ToolRegistry 接入。
 */
@Injectable()
export class TurnRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger(TurnRunnerService.name);
  private readonly activeExecutions = new Map<string, AbortController>();
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();
  private readonly activeStages = new Map<string, AssistantTurnStage>();
  private readonly executionOwner = `${process.env.INSTANCE_ID ?? 'api'}:${process.pid}:${randomUUID()}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly conversationService: ConversationService,
    private readonly eventService: EventService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly gateway: AiServiceGateway,
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolPolicy: ToolPolicyService,
    private readonly state: TurnStateService,
    private readonly messageContent: AssistantMessageContentService,
  ) {}

  onModuleDestroy(): void {
    for (const controller of this.activeExecutions.values()) controller.abort();
    for (const timer of this.heartbeatTimers.values()) clearInterval(timer);
    this.activeExecutions.clear();
    this.heartbeatTimers.clear();
    this.activeStages.clear();
  }

  /** 发起一轮对话；Turn、用户消息、轮次序号和租约在同一事务中创建。 */
  async startTurn(input: {
    conversationId: string;
    idempotencyKey: string;
    content?: string | null;
    imageFileIds?: string[];
    mode: PublicTurnMode;
  }): Promise<StartTurnResult> {
    const conversation = await this.conversationService.requireMemberConversation(input.conversationId);
    const context = this.tenantContext.require();
    if (!(await isActiveMembership(this.prisma, conversation.tenantId, context.membershipId))) {
      throw new ForbiddenException({
        code: 'MEMBERSHIP_UNAVAILABLE',
        message: '当前租户成员身份已失效，无法使用 AI 助手',
      });
    }
    const imageFileIds = await this.messageContent.validateImageFileIds(input.imageFileIds, {
      tenantId: conversation.tenantId,
      userId: context.userId,
      membershipId: context.membershipId,
    });
    if (!input.content?.trim() && imageFileIds.length === 0) {
      throw new BadRequestException({
        code: 'MESSAGE_CONTENT_EMPTY',
        message: '消息至少需要包含文本或一张图片',
      });
    }
    const requestHash = hashTurnRequest(
      input.conversationId,
      input.mode,
      input.content ?? '',
      imageFileIds,
    );

    const existing = await this.prisma.assistantTurn.findUnique({
      where: {
        conversationId_idempotencyKey: {
          conversationId: input.conversationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) return this.resolveExistingTurn(existing, requestHash);

    const turn = await this.state.createTurn({
      conversationId: input.conversationId,
      tenantId: conversation.tenantId,
      userId: context.userId,
      membershipId: context.membershipId,
      requestId: context.requestId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      content: input.content,
      imageFileIds,
      mode: input.mode,
      executionOwner: this.executionOwner,
      leaseExpiresAt: nextTurnLease(),
    });
    if (!turn) {
      const replay = await this.prisma.assistantTurn.findUniqueOrThrow({
        where: {
          conversationId_idempotencyKey: {
            conversationId: input.conversationId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      return this.resolveExistingTurn(replay, requestHash);
    }

    const abortController = new AbortController();
    this.activeExecutions.set(turn.id, abortController);
    this.activeStages.set(turn.id, AssistantTurnStage.QUEUED);
    this.startHeartbeat(turn.id, abortController);
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

    return { turnId: turn.id };
  }

  /** 校验轮次归属后订阅事件；signal 只终止订阅，不取消后台执行。 */
  async subscribeTurn(input: {
    conversationId: string;
    turnId: string;
    afterSeq: number;
  }, signal?: AbortSignal): Promise<AsyncGenerator<PublicTurnStreamEvent>> {
    assertAfterSeq(input.afterSeq);
    await this.requireConversationTurn(input.conversationId, input.turnId);
    return this.eventService.poll(input.turnId, input.afterSeq, signal);
  }

  /** 取消仅允许 RUNNING → CANCELLED；终态冲突按公开契约返回 409。 */
  async cancelTurn(conversationId: string, turnId: string): Promise<PublicTurn> {
    const { tenantId } = await this.requireConversationTurn(conversationId, turnId);
    const cancelled = await this.state.cancelTurn(turnId, tenantId);
    if (!cancelled) {
      throw new ConflictException({
        code: 'TURN_NOT_CANCELLABLE',
        message: '轮次已结束，无法取消',
      });
    }
    this.activeExecutions.get(turnId)?.abort();
    const turn = await this.prisma.assistantTurn.findUniqueOrThrow({ where: { id: turnId } });
    return toPublicTurn(turn);
  }

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
    try {
      if (!(await this.moveToStage(input.turnId, AssistantTurnStage.MODEL_CALL))) return;
      if (!(await isActiveMembership(
        this.prisma,
        input.conversation.tenantId,
        input.membershipId,
      ))) {
        await this.state.failTurn(input.turnId, {
          code: 'MEMBERSHIP_UNAVAILABLE',
          message: '租户成员身份已失效，轮次已停止执行',
          retryable: false,
        }, this.executionOwner);
        return;
      }
      // The JWT is only an initial snapshot. Resolve the current assignments
      // before exposing tools to the model; execution performs the same check
      // again immediately before the side effect.
      const currentAuthorization = await resolveMembershipAuthorization(
        this.prisma,
        input.conversation.tenantId,
        input.membershipId,
      );
      const allowedTools = this.toolRegistry.listAllowed(currentAuthorization.permissions);
      if (allowedTools.length === 0) {
        await this.runPlainTurn(input);
        return;
      }
      await this.runToolTurn({
        ...input,
        permissions: currentAuthorization.permissions,
        allowedTools,
      });
    } catch (error) {
      await this.state.failTurn(
        input.turnId,
        describeAssistantError(error),
        this.executionOwner,
      );
    } finally {
      this.stopHeartbeat(input.turnId);
      this.activeExecutions.delete(input.turnId);
      this.activeStages.delete(input.turnId);
    }
  }

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
      if (input.signal.aborted) return;
      if (event.type === 'completed') {
        await this.completeTurn(turnId, conversation, content, {
          latencyMs: event.latency_ms,
          finishReason: event.finish_reason ?? null,
        });
        return;
      }
      if (event.type === 'error') {
        await this.state.failTurn(turnId, {
          code: event.error.code,
          message: event.error.message,
          retryable: event.error.retryable,
        }, this.executionOwner);
        return;
      }
      const publicEvent = this.mapUpstreamEvent(event, conversation.id, turnId, input.requestId);
      await this.appendPublicEvent(turnId, conversation.tenantId, publicEvent);
      if (publicEvent.type === 'content_delta') content += publicEvent.text;
    }
    await this.finishAfterStreamEnd(turnId);
  }

  /**
   * completed 在 ai-service 中表示“一次模型调用完成”，不是整个 AssistantTurn 完成。
   * 只有该模型调用没有 tool_calls 时，NestJS 才发布公开 completed 并结束 Turn。
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
    let messages: Awaited<ReturnType<ContextBuilderService['buildToolTurnMessages']>>;

    let processedSteps = 0;
    for (let modelCall = 0; modelCall < MAX_TOOL_TURNS; modelCall++) {
      if (input.signal.aborted) return;
      if (!(await this.moveToStage(turnId, AssistantTurnStage.MODEL_CALL))) return;
      // Rebuild before every model call. Besides picking up the newly
      // persisted tool messages, this re-resolves image references into fresh
      // short-lived URLs so a long-running loop never reuses an expired URL.
      messages = await this.contextBuilder.buildToolTurnMessages({
        conversation,
        turnId,
        membershipId: input.membershipId,
        userId: input.userId,
        requestId: input.requestId,
        mode: input.mode,
      });
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

      const suggestedCalls: UpstreamToolCall[] = [];
      const seenUpstreamCallIds = new Map<string, UpstreamToolCall>();
      let modelContent = '';
      let completion: { latencyMs: number; finishReason: string | null } | null = null;
      let terminalError: { code: string; message: string; retryable: boolean } | null = null;

      streamEvents: for await (const event of upstream) {
        if (input.signal.aborted) return;
        switch (event.type) {
          case 'tool_calls':
            for (const call of event.tool_calls) {
              const previous = seenUpstreamCallIds.get(call.id);
              if (previous) {
                if (
                  previous.name !== call.name
                  || canonicalJson(previous.arguments) !== canonicalJson(call.arguments)
                ) {
                  throw new Error(`AI service returned conflicting tool call ${call.id}`);
                }
                continue;
              }
              seenUpstreamCallIds.set(call.id, call);
              suggestedCalls.push(call);
            }
            break;
          case 'completed':
            completion = {
              latencyMs: event.latency_ms,
              finishReason: event.finish_reason ?? null,
            };
            break streamEvents;
          case 'error':
            terminalError = {
              code: event.error.code,
              message: event.error.message,
              retryable: event.error.retryable,
            };
            break streamEvents;
          default: {
            const publicEvent = this.mapUpstreamEvent(
              event,
              conversation.id,
              turnId,
              input.requestId,
            );
            await this.appendPublicEvent(turnId, conversation.tenantId, publicEvent);
            if (publicEvent.type === 'content_delta') modelContent += publicEvent.text;
          }
        }
      }

      if (input.signal.aborted) return;
      if (terminalError) {
        await this.state.failTurn(turnId, terminalError, this.executionOwner);
        return;
      }
      if (!completion) {
        await this.finishAfterStreamEnd(turnId);
        return;
      }
      if (suggestedCalls.length === 0) {
        await this.completeTurn(turnId, conversation, modelContent, completion);
        return;
      }

      const remainingSteps = Math.max(0, MAX_TOOL_STEPS - processedSteps);
      if (!(await this.moveToStage(turnId, AssistantTurnStage.TOOL_EXECUTION))) return;
      await this.appendPublicEvent(turnId, conversation.tenantId, {
        type: 'status',
        phase: 'tool_executing',
      });
      const execution = await this.executeToolCalls({
        turnId,
        conversation,
        userId: input.userId,
        membershipId: input.membershipId,
        requestId: input.requestId,
        permissions: input.permissions,
        executionOwner: this.executionOwner,
        calls: suggestedCalls,
        modelStep: modelCall + 1,
        maxExecutable: remainingSteps,
        assistantContent: modelContent,
      });
      processedSteps += Math.min(suggestedCalls.length, remainingSteps);

      if (execution.ownershipLost) return;
      if (execution.limitExceeded) {
        await this.state.failTurn(turnId, {
          code: 'TOOL_LOOP_LIMIT_EXCEEDED',
          message: '工具步数超过单轮上限，超出部分未执行',
          retryable: false,
        }, this.executionOwner);
        return;
      }
    }

    await this.state.failTurn(turnId, {
      code: 'TOOL_LOOP_LIMIT_EXCEEDED',
      message: '模型调用次数超过单轮上限',
      retryable: false,
    }, this.executionOwner);
  }

  private async executeToolCalls(input: {
    turnId: string;
    conversation: { id: string; tenantId: string };
    userId: string;
    membershipId: string;
    requestId: string;
    permissions: string[];
    executionOwner: string;
    calls: UpstreamToolCall[];
    modelStep: number;
    maxExecutable: number;
    assistantContent: string;
  }): Promise<{ limitExceeded: boolean; ownershipLost: boolean }> {
    for (let index = 0; index < input.calls.length; index++) {
      const call = input.calls[index];
      const toolCallId = randomUUID();
      const record = await this.state.createToolCall({
        id: toolCallId,
        turnId: input.turnId,
        modelStep: input.modelStep,
        tenantId: input.conversation.tenantId,
        conversationId: input.conversation.id,
        executionOwner: input.executionOwner,
        upstreamCallId: call.id,
        assistantContent: index === 0 ? input.assistantContent || null : null,
        name: call.name,
        arguments: call.arguments as Prisma.InputJsonValue,
      });
      const effectiveToolCallId = record.id;

      if (
        record.name !== call.name
        || canonicalJson(record.arguments) !== canonicalJson(call.arguments)
        || (index === 0 && (record.assistantContent ?? '') !== input.assistantContent)
      ) {
        throw new Error(`Tool call ${call.id} was replayed with different arguments`);
      }

      // A retry or a competing worker may already have materialized this
      // model call. Reuse its durable result and never invoke an external
      // provider twice for the same (turn, model step, upstream call id).
      if (record.status !== 'PROPOSED') {
        // A terminal record is safe to replay from the durable TOOL message.
        // An in-flight/recovery record is not: continuing would call the
        // model without a committed result and could create a second side
        // effect. Let the current worker stop and let the owner/recovery path
        // finish the turn.
        if (
          record.status === 'EXECUTING'
          || record.status === 'RECOVERY_REQUIRED'
          || record.status === 'APPROVED'
        ) {
          return { limitExceeded: false, ownershipLost: true };
        }
        continue;
      }

      if (index >= input.maxExecutable) {
        const summary = '本轮工具步数已达到安全上限，该调用未执行';
        const settled = await this.state.rejectToolCall({
          toolCallId: effectiveToolCallId,
          turnId: input.turnId,
          tenantId: input.conversation.tenantId,
          conversationId: input.conversation.id,
          executionOwner: input.executionOwner,
          code: 'TOOL_LOOP_LIMIT_EXCEEDED',
          summary,
        });
        if (!settled) return { limitExceeded: false, ownershipLost: true };
        continue;
      }

      let approval: ReturnType<ToolPolicyService['approve']>;
      let executionPermissions = input.permissions;
      try {
        if (!(await isActiveMembership(
          this.prisma,
          input.conversation.tenantId,
          input.membershipId,
        ))) {
          throw new Error('租户成员身份已失效，拒绝执行工具');
        }
        const currentAuthorization = await resolveMembershipAuthorization(
          this.prisma,
          input.conversation.tenantId,
          input.membershipId,
        );
        executionPermissions = currentAuthorization.permissions;
        approval = this.toolPolicy.approve({
          name: call.name,
          arguments: call.arguments,
          permissions: currentAuthorization.permissions,
        });
      } catch (error) {
        const rejection = toToolFailure(error);
        const settled = await this.state.rejectToolCall({
          toolCallId: effectiveToolCallId,
          turnId: input.turnId,
          tenantId: input.conversation.tenantId,
          conversationId: input.conversation.id,
          executionOwner: input.executionOwner,
          code: rejection.code,
          summary: rejection.summary,
        });
        if (!settled) return { limitExceeded: false, ownershipLost: true };
        continue;
      }

      const executionToken = randomUUID();
      const claimed = await this.state.claimToolExecution({
        toolCallId: effectiveToolCallId,
        turnId: input.turnId,
        tenantId: input.conversation.tenantId,
        executionOwner: input.executionOwner,
        executionToken,
        leaseExpiresAt: nextTurnLease(),
      });
      if (!claimed) {
        return { limitExceeded: false, ownershipLost: true };
      }

      let result: Awaited<ReturnType<typeof approval.definition.execute>>;
      try {
        result = await approval.definition.execute(
          {
            tenantId: input.conversation.tenantId,
            userId: input.userId,
            membershipId: input.membershipId,
            requestId: input.requestId,
            conversationId: input.conversation.id,
            turnId: input.turnId,
            toolCallId: effectiveToolCallId,
            executionOwner: input.executionOwner,
            executionToken,
            permissions: executionPermissions,
          },
          approval.parsedArguments,
        );
      } catch (error) {
        const failure = toToolFailure(error);
        const settled = await this.state.failToolCall({
          toolCallId: effectiveToolCallId,
          turnId: input.turnId,
          tenantId: input.conversation.tenantId,
          conversationId: input.conversation.id,
          executionOwner: input.executionOwner,
          executionToken,
          code: failure.code,
          summary: failure.summary,
        });
        if (!settled) return { limitExceeded: false, ownershipLost: true };
        continue;
      }

      const settled = await this.state.completeToolCall({
        toolCallId: effectiveToolCallId,
        turnId: input.turnId,
        tenantId: input.conversation.tenantId,
        conversationId: input.conversation.id,
        executionOwner: input.executionOwner,
        executionToken,
        summary: result.summary,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
      });
      if (!settled) {
        return { limitExceeded: false, ownershipLost: true };
      }
    }
    return {
      limitExceeded: input.calls.length > input.maxExecutable,
      ownershipLost: false,
    };
  }

  private async appendPublicEvent(
    turnId: string,
    tenantId: string,
    event: DistributiveOmit<PublicTurnStreamEvent, 'seq'>,
  ): Promise<void> {
    await this.eventService.append(turnId, tenantId, toAssistantEventType(event.type), event);
  }

  private async completeTurn(
    turnId: string,
    conversation: { id: string; tenantId: string },
    content: string,
    completion: { latencyMs: number; finishReason: string | null },
  ): Promise<void> {
    const completed = await this.state.completeTurn({
      turnId,
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      executionOwner: this.executionOwner,
      content,
      completion,
    });
    if (!completed) return;
    await this.conversationService.setTitleFromFirstUserMessage(conversation.id).catch((error) => {
      this.logger.error(`failed to set title for conversation ${conversation.id}: ${String(error)}`);
    });
  }

  private async finishAfterStreamEnd(turnId: string): Promise<void> {
    const turn = await this.prisma.assistantTurn.findUnique({
      where: { id: turnId },
      select: { status: true },
    });
    if (!turn || isTerminalTurnStatus(turn.status)) return;
    await this.state.failTurn(turnId, {
      code: 'AI_SERVICE_INVALID_RESPONSE',
      message: 'AI 服务流在模型调用完成事件前意外结束',
      retryable: false,
    }, this.executionOwner);
  }

  private startHeartbeat(turnId: string, abortController: AbortController): void {
    const timer = setInterval(() => {
      const stage = this.activeStages.get(turnId);
      if (!stage) return;
      void this.state.heartbeat({
        turnId,
        executionOwner: this.executionOwner,
        stage,
        leaseExpiresAt: nextTurnLease(),
      }).then((owned) => {
        if (!owned) abortController.abort();
      }).catch((error) => {
        this.logger.error(`assistant heartbeat failed for turn ${turnId}: ${String(error)}`);
      });
    }, ASSISTANT_HEARTBEAT_INTERVAL_MS);
    timer.unref();
    this.heartbeatTimers.set(turnId, timer);
  }

  private stopHeartbeat(turnId: string): void {
    const timer = this.heartbeatTimers.get(turnId);
    if (timer) clearInterval(timer);
    this.heartbeatTimers.delete(turnId);
  }

  private async moveToStage(turnId: string, stage: AssistantTurnStage): Promise<boolean> {
    this.activeStages.set(turnId, stage);
    const owned = await this.state.heartbeat({
      turnId,
      executionOwner: this.executionOwner,
      stage,
      leaseExpiresAt: nextTurnLease(),
    });
    if (!owned) this.activeExecutions.get(turnId)?.abort();
    return owned;
  }

  private mapUpstreamEvent(
    event: Extract<
      ChatStreamEvent | ToolTurnStreamEvent,
      { type: 'started' | 'status' | 'content_delta' | 'usage' }
    >,
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
    }
  }

  private async requireConversationTurn(
    conversationId: string,
    turnId: string,
  ): Promise<{ tenantId: string }> {
    const conversation = await this.conversationService.requireMemberConversation(conversationId);
    const turn = await this.prisma.assistantTurn.findFirst({
      where: { id: turnId, conversationId, tenantId: conversation.tenantId },
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

function assertAfterSeq(afterSeq: number): void {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw new BadRequestException({
      code: 'EVENT_SEQUENCE_INVALID',
      message: 'afterSeq 必须是大于等于 0 的安全整数',
    });
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

function hashTurnRequest(
  conversationId: string,
  mode: string,
  content: string,
  imageFileIds: readonly string[] = [],
): string {
  return createHash('sha256')
    .update(JSON.stringify({ conversationId, mode, content, imageFileIds }))
    .digest('hex');
}

function toToolFailure(error: unknown): { summary: string; code: string } {
  if (error instanceof ToolPolicyError) {
    return { summary: error.message, code: error.code };
  }
  return {
    summary: error instanceof Error ? error.message : '工具执行失败',
    code: 'TOOL_EXECUTION_FAILED',
  };
}

/** Compare provider JSON arguments independent of object-key insertion order. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/** Omit 对联合类型会退化为公共属性；分配式 Omit 保留每个成员的结构。 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
