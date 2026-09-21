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
  UserMemoryCandidate,
} from '@cees/ai-service-client';
import { AiServiceGateway, AiServiceInvocationError } from '../../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import { describeAssistantError } from '../assistant.errors';
import {
  ConnectorContextInput,
  isTerminalTurnStatus,
  PublicTurn,
  PublicTurnCapabilities,
  PublicTurnMode,
  PublicTurnStreamEvent,
} from '../assistant.types';
import { ConversationService } from '../conversation/conversation.service';
import { EventService } from '../conversation/event.service';
import { ToolPolicyError, ToolPolicyService } from '../tools/tool-policy.service';
import { ToolRegistryService } from '../tools/tool-registry';
import { KNOWLEDGE_SEARCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '../tools/tool.types';
import { UserMemoryService } from '../../user-memory/user-memory.service';
import { ContextBuilderService } from './context-builder.service';
import { IntentCapabilityService, type AutoEnabledCapability } from './intent-capability.service';
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
    private readonly intentCapability: IntentCapabilityService,
    private readonly userMemory: UserMemoryService,
  ) { }

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
    documentFileIds?: string[];
    connectorContexts?: ConnectorContextInput[];
    /** 未显式指定时使用会话的默认模式。 */
    mode?: PublicTurnMode;
    /** 本轮是否允许检索知识库；省略时默认关闭。 */
    knowledgeBaseEnabled?: boolean;
    /** 本轮是否允许联网搜索；省略时默认关闭。 */
    webSearchEnabled?: boolean;
  }): Promise<StartTurnResult> {
    const conversation = await this.conversationService.requireMemberConversation(input.conversationId);
    const context = this.tenantContext.require();
    if (!(await isActiveMembership(this.prisma, conversation.tenantId, context.membershipId))) {
      throw new ForbiddenException({
        code: 'MEMBERSHIP_UNAVAILABLE',
        message: '当前租户成员身份已失效，无法使用 AI 助手',
      });
    }
    const mode = input.mode ?? toPublicMode(conversation.mode);
    const imageFileIds = await this.messageContent.validateImageFileIds(input.imageFileIds, {
      tenantId: conversation.tenantId,
      userId: context.userId,
      membershipId: context.membershipId,
      requestId: context.requestId,
    });
    const documentFileIds = input.documentFileIds ?? [];
    const connectorContexts = normalizeConnectorContexts(input.connectorContexts);
    if (!input.content?.trim() && imageFileIds.length === 0 && documentFileIds.length === 0) {
      throw new BadRequestException({
        code: 'MESSAGE_CONTENT_EMPTY',
        message: '消息至少需要包含文本、一张图片或一个文档',
      });
    }
    const requestHash = hashTurnRequest(
      input.conversationId,
      mode,
      input.content ?? '',
      imageFileIds,
      documentFileIds,
      connectorContexts,
      input.knowledgeBaseEnabled ?? false,
      input.webSearchEnabled ?? false,
    );

    // 本轮有效能力 = 用户显式开关 ∪ 服务端意图识别结果。意图识别只把用户
    // “明确提到”的需求翻译成能力，并把自动启用的部分回传前端做透明提示。
    const capabilities = resolveTurnCapabilities({
      knowledgeBaseEnabled: input.knowledgeBaseEnabled ?? false,
      webSearchEnabled: input.webSearchEnabled ?? false,
      detected: this.intentCapability.detect(input.content),
    });

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
      documentFileIds,
      connectorContexts,
      mode,
      knowledgeBaseEnabled: input.knowledgeBaseEnabled ?? false,
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
      mode,
      permissions: context.permissions,
      capabilities,
      signal: abortController.signal,
    });

    return { turnId: turn.id };
  }

  /** 校验轮次归属后订阅事件；signal 只终止订阅，不取消后台执行。 */
  async subscribeTurn(input: {
    conversationId: string;
    turnId: string;
    afterSeq: number;
    /** 终态后等待异步追加事件（related_questions）的宽限毫秒数；省略时终态即结束。 */
    lingerMs?: number;
  }, signal?: AbortSignal): Promise<AsyncGenerator<PublicTurnStreamEvent>> {
    assertAfterSeq(input.afterSeq);
    await this.requireConversationTurn(input.conversationId, input.turnId);
    return this.eventService.poll(input.turnId, input.afterSeq, signal, {
      lingerMs: input.lingerMs,
    });
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
    /** 本轮有效能力（显式开关 ∪ 意图识别），决定哪些检索工具可进入模型工具列表。 */
    capabilities: PublicTurnCapabilities;
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
      // 对话级能力开关只管“读”：知识库/联网开关关闭时模型拿不到对应检索工具；
      // 即使模型仍发起调用，执行器还有一次开关兜底校验。这里用的是本轮
      // “有效能力”（显式开关 ∪ 意图自动启用），而不是原始请求值。
      const gatedTools = allowedTools.filter((tool) => {
        if (tool.name === KNOWLEDGE_SEARCH_TOOL_NAME && !input.capabilities.knowledgeBase) return false;
        if (tool.name === WEB_SEARCH_TOOL_NAME && !input.capabilities.webSearch) return false;
        return true;
      });
      if (gatedTools.length === 0) {
        await this.runPlainTurn(input);
        return;
      }
      await this.runToolTurn({
        ...input,
        permissions: currentAuthorization.permissions,
        allowedTools: gatedTools,
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
    capabilities: PublicTurnCapabilities;
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
    // 未启用的能力通过可信 instructions 告知模型，避免它凭记忆编造外部/内部信息，
    // 并引导它在用户确有需求时提示开启开关或改写为明确请求。
    const guidance = buildCapabilityGuidance(input.capabilities);
    if (guidance) chatRequest.instructions = guidance;
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
          relatedQuestions: event.related_questions ?? null,
          memoryCandidates: event.memory_candidates ?? null,
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
      const publicEvent = this.mapUpstreamEvent(
        event,
        conversation.id,
        turnId,
        input.requestId,
        input.capabilities,
      );
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
    capabilities: PublicTurnCapabilities;
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
        instructions: buildCapabilityGuidance(input.capabilities) ?? null,
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
      // 工具调用轮次的模型文本是「调用工具前的说明/预告」，不属于用户可见回答：
      // 先缓存；若该轮最终没有工具调用（纯回答轮）再按序补发，保持回答的流式体验。
      const pendingContentDeltas: DistributiveOmit<PublicTurnStreamEvent, 'seq'>[] = [];
      // 追问随回答一次输出：只有最终回答轮（无工具调用）的 completed 才携带追问；
      // 工具调用轮次的追问按 ai-service 约定不输出，此处统一丢弃。
      let completion: {
        latencyMs: number;
        finishReason: string | null;
        relatedQuestions: string[] | null;
        memoryCandidates: UserMemoryCandidate[] | null;
      } | null = null;
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
              relatedQuestions: suggestedCalls.length === 0 ? event.related_questions ?? null : null,
              // 记忆候选与追问同理：只有最终回答轮（无工具调用）的 completed 才携带。
              memoryCandidates: suggestedCalls.length === 0 ? event.memory_candidates ?? null : null,
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
              input.capabilities,
            );
            if (publicEvent.type === 'content_delta') {
              pendingContentDeltas.push(publicEvent);
              modelContent += publicEvent.text;
              break;
            }
            await this.appendPublicEvent(turnId, conversation.tenantId, publicEvent);
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
        // 纯回答轮：补发缓存的内容增量，让最终回答仍以流式方式展示。
        for (const pendingDelta of pendingContentDeltas) {
          await this.appendPublicEvent(turnId, conversation.tenantId, pendingDelta);
        }
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
        capabilities: input.capabilities,
        executionOwner: this.executionOwner,
        calls: suggestedCalls,
        modelStep: modelCall + 1,
        maxExecutable: remainingSteps,
        assistantContent: modelContent,
        signal: input.signal,
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
    capabilities: PublicTurnCapabilities;
    executionOwner: string;
    calls: UpstreamToolCall[];
    modelStep: number;
    maxExecutable: number;
    assistantContent: string;
    signal: AbortSignal;
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
            signal: input.signal,
            permissions: executionPermissions,
            knowledgeBaseEnabled: input.capabilities.knowledgeBase,
            webSearchEnabled: input.capabilities.webSearch,
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
          errorMessage: failure.errorMessage,
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
        sources: result.sources ?? [],
        citations: result.citations ?? [],
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
    completion: {
      latencyMs: number;
      finishReason: string | null;
      relatedQuestions: string[] | null;
      memoryCandidates: UserMemoryCandidate[] | null;
    },
  ): Promise<void> {
    const completed = await this.state.completeTurn({
      turnId,
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      executionOwner: this.executionOwner,
      content,
      completion: { latencyMs: completion.latencyMs, finishReason: completion.finishReason },
      relatedQuestions: completion.relatedQuestions,
    });
    if (!completed) return;
    await this.conversationService.setTitleFromFirstUserMessage(conversation.id).catch((error) => {
      this.logger.error(`failed to set title for conversation ${conversation.id}: ${String(error)}`);
    });
    // 追问已随回答一次输出并持久化到 Turn；这里在 completed 事件之后追加
    // related_questions 公开事件（seq 更晚），前端在完成事件后的短暂停留窗口内仍可读到。
    if (completion.relatedQuestions?.length) {
      await this.appendPublicEvent(turnId, conversation.tenantId, {
        type: 'related_questions',
        questions: completion.relatedQuestions,
      });
    }
    // 记忆候选由 ai-service 随回答输出；NestJS 校验后落库，失败不影响本轮结果。
    if (completion.memoryCandidates?.length) {
      await this.userMemory.applyCandidates(completion.memoryCandidates, {
        conversationId: conversation.id,
        turnId,
      }).catch((error) => {
        this.logger.error(`failed to apply memory candidates for turn ${turnId}: ${String(error)}`);
      });
    }
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
    capabilities: PublicTurnCapabilities,
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
          capabilities,
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
    mode: toPublicMode(turn.mode),
    error: toPublicError(turn.error),
    createdAt: turn.createdAt,
    completedAt: turn.completedAt,
  };
}

/** DB 存储的模式字符串归一化为公开枚举；非法值回退 standard。 */
function toPublicMode(mode: string): PublicTurnMode {
  return mode === 'ultra' ? 'ultra' : 'standard';
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
    case 'related_questions': return AssistantEventType.RELATED_QUESTIONS;
    case 'error': return AssistantEventType.ERROR;
  }
}

function hashTurnRequest(
  conversationId: string,
  mode: string,
  content: string,
  imageFileIds: readonly string[] = [],
  documentFileIds: readonly string[] = [],
  connectorContexts: readonly ConnectorContextInput[] = [],
  knowledgeBaseEnabled = false,
  webSearchEnabled = false,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      conversationId,
      mode,
      content,
      imageFileIds,
      documentFileIds,
      connectorContexts,
      knowledgeBaseEnabled,
      webSearchEnabled,
    }))
    .digest('hex');
}

function normalizeConnectorContexts(input: readonly ConnectorContextInput[] | undefined): ConnectorContextInput[] {
  if (!input?.length) return [];
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) {
    throw new BadRequestException({
      code: 'CONNECTOR_CONTEXT_TOO_LARGE',
      message: '本轮连接器上下文超过 64KB，请缩小查询范围后重试',
    });
  }
  assertNoConnectorSecrets(input);
  return input.map((context) => ({
    provider: context.provider,
    toolId: context.toolId,
    toolName: context.toolName,
    fetchedAt: context.fetchedAt,
    data: context.data,
  }));
}

function assertNoConnectorSecrets(value: unknown, depth = 0): void {
  if (depth > 12) {
    throw new BadRequestException({ code: 'CONNECTOR_CONTEXT_INVALID', message: '连接器上下文嵌套层级过深' });
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoConnectorSecrets(item, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/(?:token|secret|cookie|authorization|credential|password)/i.test(key)) {
      throw new BadRequestException({
        code: 'CONNECTOR_CONTEXT_SECRET_REJECTED',
        message: '连接器上下文不得包含 Token、Cookie、密码或其他授权凭据',
      });
    }
    assertNoConnectorSecrets(item, depth + 1);
  }
}

/**
 * 合并显式开关与意图识别结果得到“本轮有效能力”。autoEnabled 只记录
 * “用户没开、但服务端因意图识别自动打开”的能力，供前端做透明提示。
 */
function resolveTurnCapabilities(input: {
  knowledgeBaseEnabled: boolean;
  webSearchEnabled: boolean;
  detected: { webSearch: boolean; knowledgeBase: boolean };
}): PublicTurnCapabilities {
  const autoEnabled: AutoEnabledCapability[] = [];
  if (!input.webSearchEnabled && input.detected.webSearch) autoEnabled.push('web_search');
  if (!input.knowledgeBaseEnabled && input.detected.knowledgeBase) autoEnabled.push('knowledge_search');
  return {
    webSearch: input.webSearchEnabled || input.detected.webSearch,
    knowledgeBase: input.knowledgeBaseEnabled || input.detected.knowledgeBase,
    autoEnabled,
  };
}

/**
 * 生成可信 instructions 片段，向模型说明本轮未启用的检索能力：避免它凭记忆
 * 编造外部/内部信息，并引导它在用户确有需求时提示开启开关或改写为明确请求。
 * 两项能力都已启用时返回 null（无需额外提示）。本片段只约束能力边界，
 * 不改变回答风格。
 */
function buildCapabilityGuidance(capabilities: PublicTurnCapabilities): string | null {
  const notes: string[] = [];
  if (!capabilities.webSearch) {
    notes.push('本轮未启用联网搜索：不要凭记忆编造实时或外部信息（新闻、股价、天气、最新版本等）。'
      + '若用户确实需要联网，请提示可在输入框开启「联网搜索」或直接说“联网查一下”。');
  }
  if (!capabilities.knowledgeBase) {
    notes.push('本轮未启用知识库检索：不要凭记忆编造公司内部资料（制度、人员、项目、流程等）。'
      + '若用户确实需要内部资料，请提示可在输入框开启「知识库」或直接说“查一下知识库”。');
  }
  if (notes.length === 0) return null;
  return notes.join('\n');
}

/**
 * 把执行器异常拆成两部分：summary 回喂模型（只允许服务端固定友好文案，
 * 不携带权限码、错误码或任何动态错误详情——内部信息一旦进入模型上下文，
 * 用户即可通过诱导让模型复述），errorMessage 落库与进公开事件供排障。
 */
function toToolFailure(error: unknown): { summary: string; errorMessage: string; code: string } {
  if (error instanceof ToolPolicyError) {
    return { summary: error.userFacingSummary, errorMessage: error.message, code: error.code };
  }
  if (error instanceof AiServiceInvocationError) {
    return {
      summary: 'AI 服务暂时不可用，本次操作未能完成；请告知用户稍后重试',
      errorMessage: `${error.code}: ${error.message}`,
      code: 'TOOL_EXECUTION_FAILED',
    };
  }
  const code = isCodedToolError(error) ? error.code : 'TOOL_EXECUTION_FAILED';
  const detail = error instanceof Error ? error.message : '工具执行失败';
  return {
    summary: '该操作未能完成，请告知用户稍后重试或换一种方式表达',
    errorMessage: isCodedToolError(error) ? `${code}: ${detail}` : detail,
    code,
  };
}

function isCodedToolError(error: unknown): error is { code: string; message: string } {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
    && 'message' in error
    && typeof error.message === 'string',
  );
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
