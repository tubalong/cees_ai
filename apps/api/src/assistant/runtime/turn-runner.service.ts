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
  AssistantTaskEventType,
  AssistantTaskStatus,
  AssistantTaskStepStatus,
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
import { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import { describeAssistantError } from '../assistant.errors';
import {
  ConnectorContextInput,
  GenerationOptionsInput,
  PageAssistantContextInput,
  isTerminalTurnStatus,
  PublicTurn,
  PublicTurnCapabilities,
  PublicTurnMode,
  PublicTurnStreamEvent,
} from '../assistant.types';
import { ConversationService } from '../conversation/conversation.service';
import { EventService } from '../conversation/event.service';
import { AssistantActionDraftService } from '../drafts/assistant-action-draft.service';
import { FailureHandlingService } from '../orchestration/failure-handling.service';
import { OrchestrationToolsService } from '../orchestration/orchestration-tools.service';
import { PublicTaskResourceRef } from '../orchestration/orchestration.types';
import { canonicalJson, toToolFailure } from '../tools/tool-failure';
import { ToolPolicyService } from '../tools/tool-policy.service';
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
/** 计划调整引导只在工具面开放 revise 工具时注入；单轮最多提示的任务数。 */
const REVISE_ORCHESTRATION_TASK_TOOL = 'revise_orchestration_task';
const MAX_TASK_GUIDANCE_TASKS = 3;
/** 终态任务感知：单轮最多提示的最近终态任务数、每任务产出数与失败原因截断长度。 */
const MAX_TERMINAL_TASK_GUIDANCE_TASKS = 3;
const MAX_TERMINAL_TASK_GUIDANCE_OUTPUTS = 3;
const MAX_TASK_REASON_GUIDANCE_CHARS = 60;

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
    private readonly actionDrafts: AssistantActionDraftService,
    private readonly orchestrationTools: OrchestrationToolsService,
    private readonly failureHandling: FailureHandlingService,
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
    assistantContext?: PageAssistantContextInput;
    generationOptions?: GenerationOptionsInput;
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
      input.assistantContext,
      input.generationOptions,
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
      assistantContext: input.assistantContext,
      generationOptions: input.generationOptions,
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
    assistantContext?: PageAssistantContextInput;
    generationOptions?: GenerationOptionsInput;
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
      // 编排门控：企业没有在职 AI 同事时仅移除编排工具——对话本身与其余
      // 工具不受任何影响；有同事时把名册注入工具描述。门控服务自身
      // fail-closed 且不抛出，任何异常都不会波及本轮对话。
      const orchestratedTools = await this.orchestrationTools.gate(
        input.conversation.tenantId,
        gatedTools,
      );
      if (orchestratedTools.length === 0) {
        await this.runPlainTurn(input);
        return;
      }
      await this.runToolTurn({
        ...input,
        permissions: currentAuthorization.permissions,
        allowedTools: orchestratedTools,
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
    assistantContext?: PageAssistantContextInput;
    generationOptions?: GenerationOptionsInput;
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
    // 并引导它在用户确有需求时提示开启开关或改写为明确请求；已结束任务同理注入，
    // 让纯聊天路径也能准确回答任务进展与产出去向。
    const guidance = joinGuidance(
      buildCapabilityGuidance(input.capabilities),
      await this.buildTerminalTaskGuidance(input.conversation, input.membershipId),
    );
    const instructions = combineAssistantInstructions(guidance, input.assistantContext, input.generationOptions);
    if (instructions) chatRequest.instructions = instructions;
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
    assistantContext?: PageAssistantContextInput;
    generationOptions?: GenerationOptionsInput;
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

      // 计划调整引导：任务卡片「调整要求」与失败裁决「调整计划」都由用户在对话
      // 中补充调整内容，这里把待调整任务、失败步骤与可沿用步骤注入 instructions，
      // 模型才能正确调用 revise 工具。每个模型调用前重算，避免引导过期。
      const taskGuidance = input.allowedTools.some((tool) => tool.name === REVISE_ORCHESTRATION_TASK_TOOL)
        ? await this.buildTaskAdjustmentGuidance(conversation, input.membershipId)
        : null;
      if (input.signal.aborted) return;

      // 终态任务感知：把会话里已结束任务（含产出）注入 instructions，让模型在
      // 后续对话中准确回答任务进展与产出去向。每个模型调用前重算，长会话被
      // 压缩后汇报消息可能不在上下文里，这里作为兜底。
      const terminalTaskGuidance = await this.buildTerminalTaskGuidance(
        conversation,
        input.membershipId,
      );
      if (input.signal.aborted) return;

      const request: ToolTurnRequest = {
        request_id: input.requestId,
        tenant_id: conversation.tenantId,
        user_id: input.userId,
        conversation_id: conversation.id,
        mode: input.mode === 'ultra' ? 'ultra' : 'standard',
        instructions: combineAssistantInstructions(
          joinGuidance(buildCapabilityGuidance(input.capabilities), taskGuidance, terminalTaskGuidance),
          input.assistantContext,
          input.generationOptions,
        ),
        conversation_summary: messages.summary ?? null,
        user_memories: messages.userMemories.length > 0 ? messages.userMemories : null,
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

  /**
   * 计划调整引导：列出当前会话中「等待重排」与「调整要求后待确认」的任务并注入
   * 本轮 instructions。前者给出失败步骤与可沿用的已完成步骤（模型据此生成调整
   * 后的完整计划），后者提示模型按用户消息决定是否生成新版本草案。无匹配任务时
   * 返回 null，轮次行为与未启用本引导时完全一致。
   */
  private async buildTaskAdjustmentGuidance(
    conversation: { id: string; tenantId: string },
    membershipId: string,
  ): Promise<string | null> {
    const tasks = await this.prisma.assistantTask.findMany({
      where: {
        conversationId: conversation.id,
        tenantId: conversation.tenantId,
        membershipId,
        status: { in: [AssistantTaskStatus.WAITING_USER, AssistantTaskStatus.PENDING_CONFIRM] },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true, status: true, planVersion: true },
      take: MAX_TASK_GUIDANCE_TASKS,
    });
    const notes: string[] = [];
    for (const task of tasks) {
      if (task.status === AssistantTaskStatus.WAITING_USER) {
        if (await this.failureHandling.hasAwaitingReplan(task.id)) {
          notes.push(await this.describeAwaitingReplanTask(task));
        }
        continue;
      }
      if (await this.hasRequestedRevision(task.id)) {
        notes.push(await this.describeRequestedRevisionTask(task));
      }
    }
    if (notes.length === 0) return null;
    return [
      '当前会话有以下任务正在调整计划（与本轮用户消息无关时不要调用调整工具）：',
      ...notes,
      `调整计划时调用 ${REVISE_ORCHESTRATION_TASK_TOOL}：给出调整后的完整步骤（全量替换），`
        + '沿用已完成的步骤须填写其 carried_from_step_key（仅限清单中给出的可沿用步骤）；'
        + '新草案由用户在任务卡片再次确认后才会执行，不要声称任务已继续执行。',
    ].join('\n');
  }

  /** 任务是否存在「调整要求」事件；存在即说明用户点过卡片调整或任务经过重排。 */
  private async hasRequestedRevision(taskId: string): Promise<boolean> {
    const event = await this.prisma.assistantTaskEvent.findFirst({
      where: { taskId, type: AssistantTaskEventType.PLAN_REVISION_REQUESTED },
      select: { id: true },
    });
    return Boolean(event);
  }

  /** 执行中失败选择「调整计划」的挂起任务：给出失败步骤与可沿用的已完成步骤。 */
  private async describeAwaitingReplanTask(task: {
    id: string;
    title: string;
    planVersion: number;
  }): Promise<string> {
    const [plan, runtimeSteps] = await Promise.all([
      this.prisma.assistantTaskPlan.findFirst({
        where: { taskId: task.id, version: task.planVersion },
        select: { steps: true },
      }),
      this.prisma.assistantTaskStep.findMany({
        where: {
          taskId: task.id,
          planVersion: task.planVersion,
          status: {
            in: [AssistantTaskStepStatus.WAITING_USER, AssistantTaskStepStatus.SUCCEEDED],
          },
        },
        orderBy: { stepNo: 'asc' },
        select: { stepKey: true, status: true },
      }),
    ]);
    const titles = stepTitleIndex(plan?.steps ?? null);
    const failed = runtimeSteps
      .filter((step) => step.status === AssistantTaskStepStatus.WAITING_USER)
      .map((step) => formatStepRef(step.stepKey, titles.get(step.stepKey)));
    const carried = runtimeSteps
      .filter((step) => step.status === AssistantTaskStepStatus.SUCCEEDED)
      .map((step) => formatStepRef(step.stepKey, titles.get(step.stepKey)));
    return `- 任务「${task.title}」（task_id：${task.id}）执行中步骤 ${failed.join('、') || '（未知）'} `
      + '失败后用户选择了「调整计划」，任务正等待调整后的新计划（生成后回到待确认，不自动执行）。'
      + (carried.length > 0 ? `可沿用的已完成步骤：${carried.join('、')}。` : '没有可沿用的已完成步骤。');
  }

  /** 「调整要求」后的待确认任务：给出草案步骤，提示按用户消息生成新版本。 */
  private async describeRequestedRevisionTask(task: {
    id: string;
    title: string;
    planVersion: number;
  }): Promise<string> {
    const plan = await this.prisma.assistantTaskPlan.findFirst({
      where: { taskId: task.id },
      orderBy: { version: 'desc' },
      select: { version: true, steps: true },
    });
    const titles = stepTitleIndex(plan?.steps ?? null);
    const refs = [...titles.entries()]
      .map(([stepKey, title]) => formatStepRef(stepKey, title))
      .join('、');
    return `- 任务「${task.title}」（task_id：${task.id}）已被用户要求调整计划，`
      + `当前草案 v${plan?.version ?? task.planVersion} 待确认：${refs || '（步骤不可读）'}。`
      + '若用户本轮提出了具体调整内容，请生成调整后的完整计划；仅表达“确认/继续”意图时不要调用调整工具。';
  }

  /**
   * 终态任务感知：把会话里最近的终态任务（状态、失败原因与产出文档）注入本轮
   * instructions，让模型在后续对话中准确回答任务进展与产出去向。任何查询异常
   * 都降级为不注入（对话本身不受影响）；无终态任务时返回 null。
   */
  private async buildTerminalTaskGuidance(
    conversation: { id: string; tenantId: string },
    membershipId: string,
  ): Promise<string | null> {
    try {
      const tasks = await this.prisma.assistantTask.findMany({
        where: {
          conversationId: conversation.id,
          tenantId: conversation.tenantId,
          membershipId,
          status: {
            in: [
              AssistantTaskStatus.COMPLETED,
              AssistantTaskStatus.FAILED,
              AssistantTaskStatus.CANCELLED,
            ],
          },
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, title: true, status: true, failedReason: true },
        take: MAX_TERMINAL_TASK_GUIDANCE_TASKS,
      });
      if (tasks.length === 0) return null;
      const outputTitles = await this.loadTerminalTaskOutputTitles(conversation.tenantId, tasks);
      const notes = tasks.map((task) => {
        const outputs = outputTitles.get(task.id) ?? [];
        const outputNote = outputs.length > 0
          ? `产出文档：${formatGuidanceOutputList(outputs)}`
          : '没有文档产出';
        if (task.status === AssistantTaskStatus.COMPLETED) {
          return `- 任务「${task.title}」已完成；${outputNote}。`;
        }
        if (task.status === AssistantTaskStatus.FAILED) {
          const reason = truncateText(
            task.failedReason ?? '存在未成功完成的步骤',
            MAX_TASK_REASON_GUIDANCE_CHARS,
          );
          return `- 任务「${task.title}」未全部成功（${reason}）；${outputNote}。`;
        }
        return `- 任务「${task.title}」已被取消；${outputNote}。`;
      });
      return [
        '当前会话最近有任务已结束（仅当用户提及相关话题时参考，不要主动重复汇报）：',
        ...notes,
        '任务执行细节以任务卡片与系统汇报消息为准，不要编造进度或产出；'
          + '用户询问产出去向时，说明可在任务卡片中验收并按提示归档到知识库。',
      ].join('\n');
    } catch (error) {
      this.logger.warn(`failed to build terminal task guidance: ${String(error)}`);
      return null;
    }
  }

  /**
   * 终态任务的产出文档标题：一次查询覆盖全部提示任务，SUCCEEDED 步骤的
   * DOCUMENT 产出按顺序去重，已删除文档跳过。
   */
  private async loadTerminalTaskOutputTitles(
    tenantId: string,
    tasks: Array<{ id: string }>,
  ): Promise<Map<string, string[]>> {
    const steps = await this.prisma.assistantTaskStep.findMany({
      where: {
        taskId: { in: tasks.map((task) => task.id) },
        status: AssistantTaskStepStatus.SUCCEEDED,
      },
      orderBy: [{ completedAt: 'asc' }, { stepNo: 'asc' }],
      select: { taskId: true, outputRefs: true },
    });
    const idsByTask = new Map<string, string[]>();
    for (const step of steps) {
      if (!Array.isArray(step.outputRefs)) continue;
      const ids = idsByTask.get(step.taskId) ?? [];
      for (const ref of step.outputRefs as unknown as PublicTaskResourceRef[]) {
        if (ref?.type === 'DOCUMENT' && typeof ref.id === 'string' && !ids.includes(ref.id)) {
          ids.push(ref.id);
        }
      }
      idsByTask.set(step.taskId, ids);
    }
    const documentIds = [...new Set([...idsByTask.values()].flat())];
    if (documentIds.length === 0) return new Map();
    const documents = await this.prisma.managedDocument.findMany({
      where: { id: { in: documentIds }, tenantId, deletedAt: null },
      select: { id: true, title: true },
    });
    const titleById = new Map(documents.map((document) => [document.id, document.title]));
    const result = new Map<string, string[]>();
    for (const [taskId, ids] of idsByTask) {
      result.set(taskId, ids.flatMap((id) => {
        const title = titleById.get(id);
        return title ? [title] : [];
      }));
    }
    return result;
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
      /** 执行瞬间实时解析出的角色；业务 Service 可能按角色判断，不能只传权限。 */
      let executionRoles: string[] = [];
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
        executionRoles = currentAuthorization.roles;
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

      /**
       * 写操作确认：声明了 buildConfirmation 的 WRITE 工具不在此处执行。
       * 先把参数快照与预览落为待确认草稿，把 ToolCall 置为 AWAITING_CONFIRMATION，
       * 并以 awaiting_confirmation 的 tool_result 事件把确认卡片推给客户端；
       * 真正的副作用由 AssistantActionDraftService 在用户确认后执行。
       * 预览生成失败（如上级部门已不存在）按工具被拒绝处理，让模型据实说明。
       */
      if (approval.definition.riskLevel === 'WRITE' && approval.definition.buildConfirmation) {
        let confirmation; let draft;
        try {
          confirmation = await approval.definition.buildConfirmation(
            {
              tenantId: input.conversation.tenantId,
              userId: input.userId,
              membershipId: input.membershipId,
              requestId: input.requestId,
              turnId: input.turnId,
              permissions: executionPermissions,
              roles: executionRoles,
            },
            approval.parsedArguments,
          );
          draft = await this.actionDrafts.createDraft({
            tenantId: input.conversation.tenantId,
            conversationId: input.conversation.id,
            turnId: input.turnId,
            membershipId: input.membershipId,
            userId: input.userId,
            requestId: input.requestId,
            toolCallId: effectiveToolCallId,
            toolName: approval.definition.name,
            toolVersion: approval.definition.version,
            riskLevel: approval.definition.riskLevel,
            arguments: approval.parsedArguments,
            confirmation,
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
            // 预览失败的真实原因必须落到库与公开事件：客户端要能告诉用户到底哪一行/哪个字段
            // 不合法（例如台账附件里「第 172 行方向只能是收入或支出」）。
            // 模型仍然只拿 summary，避免内部错误码进入模型上下文。
            errorMessage: rejection.errorMessage,
          });
          if (!settled) return { limitExceeded: false, ownershipLost: true };
          continue;
        }

        const awaiting = await this.state.awaitToolConfirmation({
          toolCallId: effectiveToolCallId,
          turnId: input.turnId,
          tenantId: input.conversation.tenantId,
          conversationId: input.conversation.id,
          executionOwner: input.executionOwner,
          summary: confirmation.summary,
          confirmation: {
            draftId: draft.draftId,
            toolName: approval.definition.name,
            title: confirmation.title,
            fields: confirmation.fields,
            expiresAt: draft.expiresAt.toISOString(),
          },
        });
        if (!awaiting) return { limitExceeded: false, ownershipLost: true };
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
            roles: executionRoles,
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
  assistantContext?: PageAssistantContextInput,
  generationOptions?: GenerationOptionsInput,
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
      assistantContext,
      generationOptions,
    }))
    .digest('hex');
}

function combineAssistantInstructions(guidance: string | null, assistantContext?: PageAssistantContextInput, generationOptions?: GenerationOptionsInput): string | null {
  const instructions: string[] = [];
  if (assistantContext) {
    const context = normalizePageAssistantContext(assistantContext);
    instructions.push(
      `当前页面角色：${context.role}`,
      `当前页面来源：${context.source}`,
      `当前页面结构化摘要：${JSON.stringify({ selected: context.selected ?? null, summary: context.summary ?? null })}`,
      '以上页面上下文仅用于理解用户当前工作位置，不代表权限或业务事实；查询和写入仍必须调用受控工具并遵守权限与确认流程。',
    );
  }
  if (generationOptions) instructions.push(`当前生成参数（不要原样展示给用户）：${JSON.stringify(normalizeGenerationOptions(generationOptions))}`);
  if (guidance) instructions.push(guidance);
  return instructions.length ? instructions.join('\n') : null;
}

/** 按序合并多段 guidance（段间换行）；全为空时返回 null，保持零引导语义。 */
function joinGuidance(...parts: Array<string | null>): string | null {
  const merged = parts.filter((part): part is string => Boolean(part));
  return merged.length > 0 ? merged.join('\n') : null;
}

/** 引导文案中的产出清单：最多列出 MAX_TERMINAL_TASK_GUIDANCE_OUTPUTS 份，超出折叠为总数。 */
function formatGuidanceOutputList(titles: string[]): string {
  const shown = titles.slice(0, MAX_TERMINAL_TASK_GUIDANCE_OUTPUTS).map((title) => `《${title}》`);
  const rest = titles.length - shown.length;
  return shown.join('、') + (rest > 0 ? ` 等 ${titles.length} 份` : '');
}

/** 引导文案截断；超长保留省略号便于模型理解。 */
function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function normalizeGenerationOptions(input: GenerationOptionsInput): GenerationOptionsInput {
  if (input.kind !== 'image' && input.kind !== 'document') throw new BadRequestException({ code: 'GENERATION_OPTIONS_INVALID', message: '生成参数类型无效' });
  return { kind: input.kind, ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}), ...(input.quality ? { quality: input.quality } : {}), ...(input.template ? { template: input.template } : {}) };
}

function normalizePageAssistantContext(input: PageAssistantContextInput): PageAssistantContextInput {
  const allowedSources: PageAssistantContextInput['source'][] = ['project-management', 'finance-management', 'legal-contracts', 'knowledge-management', 'organization-management', 'hr-management'];
  if (!allowedSources.includes(input.source)) {
    throw new BadRequestException({ code: 'PAGE_ASSISTANT_CONTEXT_INVALID', message: '页面助手上下文来源无效' });
  }
  if (typeof input.role !== 'string' || input.role.trim().length === 0 || input.role.length > 80) {
    throw new BadRequestException({ code: 'PAGE_ASSISTANT_CONTEXT_INVALID', message: '页面助手角色无效' });
  }
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, 'utf8') > 16 * 1024) {
    throw new BadRequestException({ code: 'PAGE_ASSISTANT_CONTEXT_TOO_LARGE', message: '页面助手上下文过大，请缩小当前页面范围后重试' });
  }
  return { source: input.source, role: input.role.trim(), selected: input.selected, summary: input.summary };
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

/** 计划快照 steps JSON 的 stepKey → 标题索引；标题缺失时值为 null。 */
function stepTitleIndex(steps: Prisma.JsonValue | null): Map<string, string | null> {
  const index = new Map<string, string | null>();
  if (!Array.isArray(steps)) return index;
  for (const item of steps) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { stepKey?: unknown; title?: unknown };
    if (typeof row.stepKey !== 'string') continue;
    index.set(row.stepKey, typeof row.title === 'string' ? row.title : null);
  }
  return index;
}

/** 步骤引用文案：s1「收集数据」；标题缺失时只写标识（模型仍可引用标识）。 */
function formatStepRef(stepKey: string, title: string | null | undefined): string {
  return title ? `${stepKey}「${title}」` : stepKey;
}

/** Omit 对联合类型会退化为公共属性；分配式 Omit 保留每个成员的结构。 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
