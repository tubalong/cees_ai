import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AssistantEventType,
  AssistantTurnStage,
  AssistantTurnStatus,
  AuditOutcome,
  DraftStatus,
  ManagedImageStatus,
  Prisma,
  ToolCallStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { ConnectorContextInput, PublicToolConfirmation, PublicTurnMode, PublicTurnStreamEvent } from '../assistant.types';
import { EventService } from '../conversation/event.service';
import { lockConversationForUpdate } from '../conversation/conversation-transaction-lock';
import type { KnowledgeToolCitation, ToolSource } from '../tools/tool.types';

export interface TurnErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
}

interface StableToolResult {
  summary: string;
  resourceType: 'IMAGE' | 'DOCUMENT' | null;
  resourceId: string | null;
  sources: ToolSource[];
  citations?: KnowledgeToolCitation[];
}

/**
 * Assistant 持久化状态机。关键状态、消息和事件只在这里成组提交；TurnRunner
 * 负责决定下一步，不再自行拼接跨表写入。这样数据库才是恢复与 SSE 重放的事实源。
 */
@Injectable()
export class TurnStateService {
  private readonly logger = new Logger(TurnStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventService,
  ) { }

  /** 原子创建 Turn、用户消息并分配会话内序号；幂等冲突返回 undefined。 */
  async createTurn(input: {
    conversationId: string;
    tenantId: string;
    userId: string;
    membershipId: string;
    requestId: string;
    idempotencyKey: string;
    requestHash: string;
    content: string | null | undefined;
    imageFileIds?: string[];
    documentFileIds?: string[];
    connectorContexts?: ConnectorContextInput[];
    mode: PublicTurnMode;
    knowledgeBaseEnabled: boolean;
    executionOwner: string;
    leaseExpiresAt: Date;
  }): Promise<{ id: string } | undefined> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const now = new Date();
        // Serialize turn creation with title updates/deletion. The preflight
        // membership check in TurnRunner is not enough: deletion may commit
        // between that check and this transaction.
        await lockConversationForUpdate(transaction, input.tenantId, input.conversationId);
        const updatedConversation = await transaction.conversation.updateMany({
          where: {
            id: input.conversationId,
            tenantId: input.tenantId,
            ownerMembershipId: input.membershipId,
            deletedAt: null,
          },
          data: {
            nextTurnSeq: { increment: 1 },
            lastTurnAt: now,
            version: { increment: 1 },
          },
        });
        if (updatedConversation.count !== 1) {
          throw new NotFoundException({
            code: 'CONVERSATION_NOT_FOUND',
            message: '会话不存在或已被删除',
          });
        }
        const allocation = await transaction.conversation.findUniqueOrThrow({
          where: { id: input.conversationId },
          select: { nextTurnSeq: true },
        });
        const turn = await transaction.assistantTurn.create({
          data: {
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            seq: allocation.nextTurnSeq - 1,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            status: AssistantTurnStatus.RUNNING,
            stage: AssistantTurnStage.QUEUED,
            mode: input.mode,
            knowledgeBaseEnabled: input.knowledgeBaseEnabled,
            userId: input.userId,
            membershipId: input.membershipId,
            requestId: input.requestId,
            executionOwner: input.executionOwner,
            leaseExpiresAt: input.leaseExpiresAt,
            heartbeatAt: now,
          },
          select: { id: true },
        });
        await transaction.conversationMessage.create({
          data: {
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            turnId: turn.id,
            role: 'USER',
            content: input.content ?? '',
            imageFileIds: input.imageFileIds ?? [],
            documentFileIds: input.documentFileIds ?? [],
            connectorContexts: (input.connectorContexts ?? []) as unknown as Prisma.InputJsonValue,
          },
        });
        await this.writeOperationAudits(transaction, input, turn.id);
        return turn;
      });
    } catch (error) {
      if (isUniqueConstraintError(error, 'idempotency_key')) return undefined;
      throw error;
    }
  }

  /**
   * 外部操作审计（本机工具计划 §4.6、连接器三期计划 §5）：云端只记录动作摘要与字段白名单，
   * **不记录完整本地路径、凭据或正文**。
   *
   * 桌面端的本机操作（磁盘扫描、隔离/恢复/清理）结果以 `LOCAL_SYSTEM` 只读上下文随轮次上报，
   * 外部连接器调用同样只在客户端执行，服务端此前零记录；两者都在轮次创建事务内补写审计。
   *
   * metadata 按**字段白名单**提取，绝不原样序列化 `context.data`：即使将来客户端多传了路径、
   * 文件名或其它明细，也不会被写进审计表。这是纵深防御，不依赖客户端自觉。
   *
   * 分级：本机操作与连接器写/破坏性调用逐条审计；连接器读调用默认按轮次级聚合成一条，
   * 租户开启 `connectorReadAuditEnabled` 后逐条记录。`riskLevel` 由客户端自报，只影响审计粒度，
   * 不构成服务端授权。
   */
  private async writeOperationAudits(
    transaction: Prisma.TransactionClient,
    input: {
      tenantId: string;
      userId: string;
      membershipId: string;
      requestId: string;
      connectorContexts?: ConnectorContextInput[];
    },
    turnId: string,
  ): Promise<void> {
    const contexts = input.connectorContexts ?? [];
    if (contexts.length === 0) return;

    for (const context of contexts) {
      if (context.provider !== 'LOCAL_SYSTEM') continue;
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: input.userId,
          actorMembershipId: input.membershipId,
          action: 'LOCAL_SYSTEM_OPERATION',
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'LOCAL_SYSTEM',
          resourceId: null,
          requestId: input.requestId,
          metadata: {
            turnId,
            toolId: context.toolId,
            toolName: context.toolName,
            fetchedAt: context.fetchedAt,
            summary: pickLocalAuditSummary(context.data),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const connectorContexts = contexts.filter((context) => isConnectorProvider(context.provider));
    if (connectorContexts.length === 0) return;

    const auditBase = {
      tenantId: input.tenantId,
      actorUserId: input.userId,
      actorMembershipId: input.membershipId,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'CONNECTOR',
      resourceId: null,
      requestId: input.requestId,
    };

    const writeContexts = connectorContexts.filter((context) => resolveConnectorRiskLevel(context) !== 'READ');
    for (const context of writeContexts) {
      await transaction.auditLog.create({
        data: {
          ...auditBase,
          action: 'CONNECTOR_WRITE_OPERATION',
          metadata: {
            turnId,
            ...connectorAuditMetadata(context),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const readContexts = connectorContexts.filter((context) => resolveConnectorRiskLevel(context) === 'READ');
    if (readContexts.length === 0) return;

    if (await this.isConnectorReadAuditEnabled(transaction, input.tenantId)) {
      for (const context of readContexts) {
        await transaction.auditLog.create({
          data: {
            ...auditBase,
            action: 'CONNECTOR_READ_OPERATION',
            metadata: {
              turnId,
              aggregated: false,
              ...connectorAuditMetadata(context),
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return;
    }

    await transaction.auditLog.create({
      data: {
        ...auditBase,
        action: 'CONNECTOR_READ_OPERATION',
        metadata: {
          turnId,
          aggregated: true,
          providers: [...new Set(readContexts.map((context) => context.provider))].sort(),
          callCount: readContexts.length,
          resultBytes: readContexts.reduce((total, context) => total + connectorDataBytes(context.data), 0),
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** 租户级连接器读审计开关；缺失（存量数据或未配置）按 false 处理，即默认轮次级聚合。 */
  private async isConnectorReadAuditEnabled(
    transaction: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<boolean> {
    const tenant = await transaction.tenant.findUnique({
      where: { id: tenantId },
      select: { connectorReadAuditEnabled: true },
    });
    return tenant?.connectorReadAuditEnabled === true;
  }

  /** 刷新执行租约并写入当前检查点；返回 false 表示 Turn 已被取消或失去所有权。 */
  async heartbeat(input: {
    turnId: string;
    executionOwner: string;
    stage: AssistantTurnStage;
    leaseExpiresAt: Date;
  }): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.assistantTurn.updateMany({
        where: {
          id: input.turnId,
          status: AssistantTurnStatus.RUNNING,
          executionOwner: input.executionOwner,
          // A late heartbeat must not resurrect an already expired lease. The
          // recovery scanner is then the only component allowed to close it.
          leaseExpiresAt: { gt: now },
        },
        data: {
          stage: input.stage,
          heartbeatAt: now,
          leaseExpiresAt: input.leaseExpiresAt,
        },
      });
      if (updated.count !== 1) return false;

      // A provider call can outlive one lease interval. Renew executing tool
      // calls together with their parent turn, otherwise a healthy worker can
      // lose the tool claim before it gets a chance to persist the result.
      await transaction.toolCall.updateMany({
        where: {
          turnId: input.turnId,
          status: ToolCallStatus.EXECUTING,
          executionToken: { not: null },
        },
        data: { leaseExpiresAt: input.leaseExpiresAt },
      });
      return true;
    });
  }

  /** ToolCall 与公开 tool_call 事件原子创建，并由 Turn 行分配两个独立序号。 */
  async createToolCall(input: {
    id: string;
    turnId: string;
    modelStep: number;
    tenantId: string;
    conversationId: string;
    executionOwner: string;
    upstreamCallId: string;
    assistantContent?: string | null;
    name: string;
    arguments: Prisma.InputJsonValue;
  }): Promise<{
    id: string;
    status: ToolCallStatus;
    result: Prisma.JsonValue | null;
    errorCode: string | null;
    errorMessage: string | null;
    name: string;
    arguments: Prisma.JsonValue;
    assistantContent: string | null;
  }> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const now = new Date();
        const allocated = await transaction.assistantTurn.updateMany({
          where: {
            id: input.turnId,
            tenantId: input.tenantId,
            status: AssistantTurnStatus.RUNNING,
            executionOwner: input.executionOwner,
            leaseExpiresAt: { gt: now },
          },
          data: { nextToolCallSeq: { increment: 1 } },
        });
        if (allocated.count !== 1) {
          throw new Error(`turn ${input.turnId} execution ownership was lost`);
        }
        const allocation = await transaction.assistantTurn.findUniqueOrThrow({
          where: { id: input.turnId },
          select: { nextToolCallSeq: true },
        });
        const created = await transaction.toolCall.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            turnId: input.turnId,
            seq: allocation.nextToolCallSeq - 1,
            modelStep: input.modelStep,
            upstreamCallId: input.upstreamCallId,
            assistantContent: input.assistantContent ?? null,
            name: input.name,
            arguments: input.arguments,
            status: ToolCallStatus.PROPOSED,
          },
          select: {
            id: true,
            status: true,
            result: true,
            errorCode: true,
            errorMessage: true,
            name: true,
            arguments: true,
            assistantContent: true,
          },
        });
        await this.events.appendInTransaction(
          transaction,
          input.turnId,
          input.tenantId,
          AssistantEventType.TOOL_CALL,
          {
            type: 'tool_call',
            toolCallId: created.id,
            name: input.name,
            arguments: input.arguments,
          },
        );
        return created;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error, 'model_step')) throw error;
      const existing = await this.prisma.toolCall.findFirst({
        where: {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          modelStep: input.modelStep,
          upstreamCallId: input.upstreamCallId,
        },
        select: {
          id: true,
          status: true,
          result: true,
          errorCode: true,
          errorMessage: true,
          name: true,
          arguments: true,
          assistantContent: true,
        },
      });
      if (!existing) throw error;
      return existing;
    }
  }

  /** 执行前原子抢占；只有从 PROPOSED 成功迁移到 EXECUTING 的调用方可产生外部副作用。 */
  async claimToolExecution(input: {
    toolCallId: string;
    turnId: string;
    tenantId: string;
    executionOwner: string;
    executionToken: string;
    leaseExpiresAt: Date;
  }): Promise<boolean> {
    const now = new Date();
    const updated = await this.prisma.toolCall.updateMany({
      where: {
        id: input.toolCallId,
        turnId: input.turnId,
        tenantId: input.tenantId,
        status: ToolCallStatus.PROPOSED,
        turn: {
          is: {
            id: input.turnId,
            status: AssistantTurnStatus.RUNNING,
            executionOwner: input.executionOwner,
            leaseExpiresAt: { gt: now },
          },
        },
      },
      data: {
        status: ToolCallStatus.EXECUTING,
        approvedAt: now,
        startedAt: now,
        executionToken: input.executionToken,
        leaseExpiresAt: input.leaseExpiresAt,
      },
    });
    return updated.count === 1;
  }

  /** 批准拒绝：ToolCall、TOOL 消息和 tool_result 事件原子提交。 */
  async rejectToolCall(input: {
    toolCallId: string;
    turnId: string;
    tenantId: string;
    conversationId: string;
    executionOwner: string;
    code: string;
    summary: string;
    /**
     * 真实失败原因，落库与进公开事件供排查，**不**回喂模型。
     * 缺省时与 summary 一致。
     */
    errorMessage?: string;
  }): Promise<boolean> {
    return this.settleToolCall({
      ...input,
      expectedStatus: ToolCallStatus.PROPOSED,
      status: ToolCallStatus.REJECTED,
      eventStatus: 'rejected',
      executionToken: null,
      result: { summary: input.summary, resourceType: null, resourceId: null, sources: [] },
    });
  }

  /**
   * 写操作待确认：程序化批准通过后不执行，先落为待确认草稿。
   * ToolCall 由 PROPOSED 直接进入 AWAITING_CONFIRMATION（从未进入 EXECUTING，
   * 因此不存在“执行中丢失租约”的恢复语义）；事件携带确认预览，供客户端渲染确认卡片。
   */
  async awaitToolConfirmation(input: {
    toolCallId: string;
    turnId: string;
    tenantId: string;
    conversationId: string;
    executionOwner: string;
    summary: string;
    confirmation: PublicToolConfirmation;
  }): Promise<boolean> {
    return this.settleToolCall({
      ...input,
      expectedStatus: ToolCallStatus.PROPOSED,
      status: ToolCallStatus.AWAITING_CONFIRMATION,
      eventStatus: 'awaiting_confirmation',
      executionToken: null,
      result: { summary: input.summary, resourceType: null, resourceId: null, sources: [] },
    });
  }

  /** 执行成功：保存稳定资源引用；访问 URL 一律由资源接口按需生成，不进事件与快照。 */
  async completeToolCall(input: {
    toolCallId: string;
    turnId: string;
    tenantId: string;
    conversationId: string;
    executionOwner: string;
    executionToken: string;
    summary: string;
    resourceType: 'IMAGE' | 'DOCUMENT' | null;
    resourceId: string | null;
    sources?: ToolSource[];
    citations?: KnowledgeToolCitation[];
  }): Promise<boolean> {
    return this.settleToolCall({
      ...input,
      expectedStatus: ToolCallStatus.EXECUTING,
      status: ToolCallStatus.COMPLETED,
      eventStatus: 'completed',
      result: {
        summary: input.summary,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        sources: input.sources ?? [],
        citations: input.citations ?? [],
      },
    });
  }

  /** 执行失败：失败状态、可回喂摘要和公开事件原子提交。 */
  async failToolCall(input: {
    toolCallId: string;
    turnId: string;
    tenantId: string;
    conversationId: string;
    executionOwner: string;
    executionToken: string;
    code: string;
    summary: string;
    /** 落库与事件携带的详细错误信息；缺省时与 summary 一致。 */
    errorMessage?: string;
  }): Promise<boolean> {
    return this.settleToolCall({
      ...input,
      expectedStatus: ToolCallStatus.EXECUTING,
      status: ToolCallStatus.FAILED,
      eventStatus: 'failed',
      errorMessage: input.errorMessage ?? input.summary,
      result: { summary: input.summary, resourceType: null, resourceId: null, sources: [] },
    });
  }

  /** 最终回答消息、completed 事件和 Turn 终态原子提交。 */
  async completeTurn(input: {
    turnId: string;
    tenantId: string;
    conversationId: string;
    executionOwner: string;
    content: string;
    completion: { latencyMs: number; finishReason: string | null };
    relatedQuestions?: string[] | null;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.assistantTurn.updateMany({
        where: {
          id: input.turnId,
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          status: AssistantTurnStatus.RUNNING,
          executionOwner: input.executionOwner,
          // A worker whose lease has expired must not finalize a turn after
          // the recovery scanner has become eligible to close it.
          leaseExpiresAt: { gt: now },
        },
        data: {
          status: AssistantTurnStatus.COMPLETED,
          stage: AssistantTurnStage.FINALIZING,
          completedAt: now,
          executionOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
          relatedQuestions: (input.relatedQuestions?.length
            ? input.relatedQuestions
            : null) as Prisma.InputJsonValue,
        },
      });
      if (updated.count !== 1) return false;
      if (input.content) {
        await transaction.conversationMessage.create({
          data: {
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            turnId: input.turnId,
            role: 'ASSISTANT',
            content: input.content,
          },
        });
      }
      await this.events.appendInTransaction(
        transaction,
        input.turnId,
        input.tenantId,
        AssistantEventType.COMPLETED,
        {
          type: 'completed',
          latencyMs: input.completion.latencyMs,
          finishReason: input.completion.finishReason,
        },
      );
      return true;
    });
  }

  /** error 事件与 FAILED 终态原子提交；执行中的工具转为需恢复，禁止盲目重放。 */
  async failTurn(turnId: string, error: TurnErrorDetail, executionOwner?: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const turn = await transaction.assistantTurn.findUnique({
        where: { id: turnId },
        select: { tenantId: true, status: true, executionOwner: true, leaseExpiresAt: true },
      });
      if (!turn || turn.status !== AssistantTurnStatus.RUNNING) return false;
      if (executionOwner && turn.executionOwner !== executionOwner) return false;
      // Do not let a late worker overwrite a stale turn after its recovery
      // lease expired. A caller without an owner is reserved for explicit
      // administrative/recovery transitions.
      if (executionOwner && (!turn.leaseExpiresAt || turn.leaseExpiresAt <= now)) return false;

      const updated = await transaction.assistantTurn.updateMany({
        where: {
          id: turnId,
          status: AssistantTurnStatus.RUNNING,
          ...(executionOwner
            ? { executionOwner, leaseExpiresAt: { gt: now } }
            : {}),
        },
        data: {
          status: AssistantTurnStatus.FAILED,
          stage: AssistantTurnStage.FINALIZING,
          completedAt: now,
          executionOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
          error: { ...error },
        },
      });
      if (updated.count !== 1) return false;
      await this.reconcileInterruptedTools(transaction, {
        turnId,
        tenantId: turn.tenantId,
        now,
        executingCode: 'TOOL_EXECUTION_INTERRUPTED',
        executingMessage: '工具执行被中断，禁止自动重放',
        pendingCode: 'TURN_FAILED',
        pendingMessage: '轮次失败，工具调用未执行',
      });
      await this.events.appendInTransaction(
        transaction,
        turnId,
        turn.tenantId,
        AssistantEventType.ERROR,
        { type: 'error', error },
      );
      return true;
    });
  }

  /** 显式取消；状态、执行中工具和终止事件原子提交。 */
  async cancelTurn(turnId: string, tenantId: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.assistantTurn.updateMany({
        where: { id: turnId, tenantId, status: AssistantTurnStatus.RUNNING },
        data: {
          status: AssistantTurnStatus.CANCELLED,
          stage: AssistantTurnStage.FINALIZING,
          completedAt: now,
          executionOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
        },
      });
      if (updated.count !== 1) return false;
      await this.reconcileInterruptedTools(transaction, {
        turnId,
        tenantId,
        now,
        executingCode: 'TOOL_EXECUTION_CANCELLED',
        executingMessage: '工具执行收到取消请求，外部副作用状态需要核对',
        pendingCode: 'TURN_CANCELLED',
        pendingMessage: '轮次已取消，工具调用未执行',
      });
      await this.events.appendInTransaction(
        transaction,
        turnId,
        tenantId,
        AssistantEventType.ERROR,
        {
          type: 'error',
          error: { code: 'TURN_CANCELLED', message: '轮次已被取消', retryable: false },
        },
      );
      return true;
    });
  }

  /**
   * 收束租约过期的 RUNNING 轮次。模型阶段可由用户安全重试；若工具正在执行，
   * 标记 RECOVERY_REQUIRED，避免进程重启后再次调用外部 Provider 或重复写业务数据。
   */
  async recoverStaleTurns(now = new Date(), limit = 100): Promise<number> {
    const stale = await this.prisma.assistantTurn.findMany({
      where: {
        status: AssistantTurnStatus.RUNNING,
        leaseExpiresAt: { lte: now },
      },
      orderBy: { leaseExpiresAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let recovered = 0;
    for (const candidate of stale) {
      try {
        const changed = await this.recoverStaleTurn(candidate.id, now);
        if (changed) recovered++;
      } catch (error) {
        this.logger.error(`failed to reconcile stale assistant turn ${candidate.id}: ${String(error)}`);
      }
    }
    return recovered;
  }

  private async settleToolCall(input: {
    toolCallId: string;
    turnId: string;
    tenantId: string;
    conversationId: string;
    executionOwner: string;
    expectedStatus: ToolCallStatus;
    status: ToolCallStatus;
    eventStatus: 'completed' | 'failed' | 'rejected' | 'awaiting_confirmation';
    executionToken: string | null;
    code?: string;
    summary: string;
    /** 详细错误信息，仅落库与事件携带；回喂模型只使用 summary。 */
    errorMessage?: string;
    /** 写操作待确认预览；仅 eventStatus 为 awaiting_confirmation 时携带。 */
    confirmation?: PublicToolConfirmation;
    result: StableToolResult;
  }): Promise<boolean> {
    // 待确认不等于失败：它既不是业务成功，也不是错误，因此不写 errorCode / errorMessage。
    const settled = input.eventStatus === 'completed' || input.eventStatus === 'awaiting_confirmation';
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.toolCall.updateMany({
        where: {
          id: input.toolCallId,
          turnId: input.turnId,
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          status: input.expectedStatus,
          turn: {
            is: {
              status: AssistantTurnStatus.RUNNING,
              executionOwner: input.executionOwner,
              leaseExpiresAt: { gt: now },
            },
          },
          ...(input.executionToken
            ? { executionToken: input.executionToken, leaseExpiresAt: { gt: now } }
            : {}),
        },
        data: {
          status: input.status,
          completedAt: new Date(),
          leaseExpiresAt: null,
          result: input.result as unknown as Prisma.InputJsonObject,
          errorCode: settled ? null : input.code ?? 'TOOL_EXECUTION_FAILED',
          errorMessage: settled ? null : input.errorMessage ?? input.summary,
          executedResourceType: input.result.resourceType,
          executedResourceId: input.result.resourceId,
        },
      });
      if (updated.count !== 1) return false;
      await transaction.conversationMessage.create({
        data: {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          role: 'TOOL',
          toolCallId: input.toolCallId,
          content: input.summary,
        },
      });
      await this.events.appendInTransaction(
        transaction,
        input.turnId,
        input.tenantId,
        AssistantEventType.TOOL_RESULT,
        {
          type: 'tool_result',
          toolCallId: input.toolCallId,
          status: input.eventStatus,
          resource: input.result.resourceId && input.result.resourceType
            ? { type: input.result.resourceType, id: input.result.resourceId }
            : null,
          sources: input.eventStatus === 'completed' ? input.result.sources : [],
          citations: input.eventStatus === 'completed' ? (input.result.citations ?? []) : [],
          ...(input.eventStatus === 'awaiting_confirmation'
            ? { confirmation: input.confirmation ?? null }
            : {}),
          error: settled
            ? null
            : {
              code: input.code ?? 'TOOL_EXECUTION_FAILED',
              message: input.errorMessage ?? input.summary,
            },
        },
      );
      return true;
    });
  }

  /**
   * Reconcile tool calls when their parent turn is failed/cancelled. This is
   * deliberately part of the same transaction as the terminal turn update:
   * the durable ToolCall row, TOOL conversation message and public event must
   * either all be committed or all be rolled back.
   */
  private async reconcileInterruptedTools(
    transaction: Prisma.TransactionClient,
    input: {
      turnId: string;
      tenantId: string;
      now: Date;
      executingCode: string;
      executingMessage: string;
      pendingCode: string;
      pendingMessage: string;
    },
  ): Promise<void> {
    const calls = await transaction.toolCall.findMany({
      where: {
        turnId: input.turnId,
        tenantId: input.tenantId,
        status: {
          in: [ToolCallStatus.PROPOSED, ToolCallStatus.APPROVED, ToolCallStatus.EXECUTING],
        },
      },
      select: {
        id: true,
        conversationId: true,
        status: true,
      },
      orderBy: { seq: 'asc' },
    });

    if (calls.length === 0) return;

    const callIds = calls.map((call) => call.id);
    // A reservation can exist before the provider call (image) or while an
    // upload is in progress. Hide/mark all non-ready reservations so a failed
    // or cancelled turn cannot expose a usable-looking placeholder.
    const unfinishedImages = await transaction.managedImage.findMany({
      where: {
        toolCallId: { in: callIds },
        status: {
          in: [
            ManagedImageStatus.PENDING,
            ManagedImageStatus.GENERATING,
            ManagedImageStatus.UPLOADING,
          ],
        },
      },
      select: { id: true, status: true },
    });

    for (const call of calls) {
      const executing = call.status === ToolCallStatus.EXECUTING;
      const code = executing ? input.executingCode : input.pendingCode;
      const summary = executing ? input.executingMessage : input.pendingMessage;
      const status = executing ? ToolCallStatus.RECOVERY_REQUIRED : ToolCallStatus.REJECTED;
      const eventStatus: 'failed' | 'rejected' = executing ? 'failed' : 'rejected';

      const updated = await transaction.toolCall.updateMany({
        where: {
          id: call.id,
          turnId: input.turnId,
          tenantId: input.tenantId,
          status: call.status,
        },
        data: {
          status,
          completedAt: input.now,
          leaseExpiresAt: null,
          executionToken: null,
          errorCode: code,
          errorMessage: summary,
          result: {
            summary,
            resourceType: null,
            resourceId: null,
            sources: [],
          } as Prisma.InputJsonObject,
        },
      });
      if (updated.count !== 1) continue;

      await transaction.conversationMessage.create({
        data: {
          tenantId: input.tenantId,
          conversationId: call.conversationId,
          turnId: input.turnId,
          role: 'TOOL',
          toolCallId: call.id,
          content: summary,
        },
      });
      await this.events.appendInTransaction(
        transaction,
        input.turnId,
        input.tenantId,
        AssistantEventType.TOOL_RESULT,
        {
          type: 'tool_result',
          toolCallId: call.id,
          status: eventStatus,
          resource: null,
          error: { code, message: summary },
        },
      );
    }

    if (unfinishedImages.length > 0) {
      await transaction.managedImage.updateMany({
        where: {
          id: { in: unfinishedImages.map((image) => image.id) },
          status: ManagedImageStatus.PENDING,
        },
        data: {
          status: ManagedImageStatus.FAILED,
          failureCode: input.pendingCode,
          failureMessage: input.pendingMessage,
        },
      });
      await transaction.managedImage.updateMany({
        where: {
          id: { in: unfinishedImages.map((image) => image.id) },
          status: ManagedImageStatus.GENERATING,
        },
        data: {
          status: ManagedImageStatus.FAILED,
          failureCode: input.executingCode,
          failureMessage: input.executingMessage,
        },
      });
      await transaction.managedImage.updateMany({
        where: {
          id: { in: unfinishedImages.map((image) => image.id) },
          status: ManagedImageStatus.UPLOADING,
        },
        data: {
          status: ManagedImageStatus.ORPHANED,
          failureCode: input.executingCode,
          failureMessage: input.executingMessage,
        },
      });
      await transaction.resource.updateMany({
        where: {
          id: { in: unfinishedImages.map((image) => image.id) },
          tenantId: input.tenantId,
          deletedAt: null,
        },
        data: { deletedAt: input.now, version: { increment: 1 } },
      });
    }

    await transaction.aIActionDraft.updateMany({
      where: { toolCallId: { in: callIds }, status: DraftStatus.DRAFT },
      data: { status: DraftStatus.FAILED },
    });
  }

  private async recoverStaleTurn(turnId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const turn = await transaction.assistantTurn.findUnique({
        where: { id: turnId },
        select: {
          tenantId: true,
          status: true,
          leaseExpiresAt: true,
          toolCalls: {
            where: {
              status: {
                in: [
                  ToolCallStatus.PROPOSED,
                  ToolCallStatus.APPROVED,
                  ToolCallStatus.EXECUTING,
                ],
              },
            },
            select: { status: true },
          },
        },
      });
      if (
        !turn
        || turn.status !== AssistantTurnStatus.RUNNING
        || !turn.leaseExpiresAt
        || turn.leaseExpiresAt > now
      ) {
        return false;
      }
      const hasExecutingTool = turn.toolCalls.some(
        (call) => call.status === ToolCallStatus.EXECUTING,
      );
      const error: TurnErrorDetail = hasExecutingTool
        ? {
          code: 'TOOL_EXECUTION_RECOVERY_REQUIRED',
          message: '服务重启时工具可能已产生外部副作用，需要核对后再处理',
          retryable: false,
        }
        : {
          code: 'TURN_EXECUTION_LOST',
          message: '轮次执行进程已失联，请重新发起本轮请求',
          retryable: true,
        };
      const updated = await transaction.assistantTurn.updateMany({
        where: {
          id: turnId,
          status: AssistantTurnStatus.RUNNING,
          leaseExpiresAt: { lte: now },
        },
        data: {
          status: AssistantTurnStatus.FAILED,
          stage: AssistantTurnStage.FINALIZING,
          completedAt: now,
          executionOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
          error: { ...error },
        },
      });
      if (updated.count !== 1) return false;
      await this.reconcileInterruptedTools(transaction, {
        turnId,
        tenantId: turn.tenantId,
        now,
        executingCode: 'TOOL_EXECUTION_RECOVERY_REQUIRED',
        executingMessage: '该操作在服务中断前未能确认结果，请告知用户稍后重试',
        pendingCode: 'TURN_EXECUTION_LOST',
        pendingMessage: '该操作因服务中断未能执行，请告知用户稍后重试',
      });
      await this.events.appendInTransaction(
        transaction,
        turnId,
        turn.tenantId,
        AssistantEventType.ERROR,
        { type: 'error', error },
      );
      return true;
    });
  }
}

function isUniqueConstraintError(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const needle = normalizeConstraintPart(field);
  const parts = Array.isArray(target) ? target : target === undefined ? [] : [target];
  return parts.some((entry) => normalizeConstraintPart(String(entry)).includes(needle));
}

function normalizeConstraintPart(value: string): string {
  return value.replace(/[_\s-]/g, '').toLowerCase();
}

/**
 * 允许写入审计的本机操作聚合字段白名单（本机工具计划 §4.6）。
 * 只放聚合值与清单 hash 前缀，**不含任何本地路径或文件名**；白名单之外一律丢弃，
 * 因此即使客户端将来多传字段，审计表也不会出现本地明细。
 */
const LOCAL_AUDIT_SUMMARY_KEYS = [
  'status',
  'executed',
  'itemCount',
  'totalBytes',
  'resultCounts',
  'manifestHashPrefix',
  'rootLabel',
  'fileCount',
  'directoryCount',
  'skippedCount',
  'truncated',
  'elapsedMs',
  'volumes',
] as const;

function pickLocalAuditSummary(data: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of LOCAL_AUDIT_SUMMARY_KEYS) {
    const value = data[key];
    if (value === undefined) continue;
    // 卷容量是「盘符 + 字节数」的聚合列表，逐项按同一精神只保留容量三元组。
    if (key === 'volumes' && Array.isArray(value)) {
      summary.volumes = value.slice(0, 16).map((volume) => {
        const record = (volume ?? {}) as Record<string, unknown>;
        return {
          label: typeof record.label === 'string' ? record.label : '',
          totalBytes: typeof record.totalBytes === 'number' ? record.totalBytes : null,
          freeBytes: typeof record.freeBytes === 'number' ? record.freeBytes : null,
        };
      });
      continue;
    }
    summary[key] = value;
  }
  return summary;
}

/**
 * 允许写入连接器审计的结果状态字段白名单（连接器三期计划 §5）。
 * 值仍按类型收敛：字符串截断、只保留数值映射形式的聚合计数，数组与嵌套对象一律丢弃；
 * 白名单之外一律不落库，因此客户端多传字段也不会把正文、路径或凭据写进审计表。
 */
const CONNECTOR_AUDIT_SUMMARY_KEYS = [
  'schemaVersion',
  'status',
  'executed',
  'itemCount',
  'totalCount',
  'count',
  'truncated',
  'elapsedMs',
  'resultCounts',
] as const;

function isConnectorProvider(provider: ConnectorContextInput['provider']): boolean {
  return provider === 'DINGTALK'
    || provider === 'TENCENT_MEETING'
    || provider === 'WECOM'
    || provider === 'GITHUB';
}

/** 客户端自报风险等级；缺失或非法值一律按 DESTRUCTIVE 处理，保证审计粒度只增不减。 */
function resolveConnectorRiskLevel(context: ConnectorContextInput): 'READ' | 'WRITE' | 'DESTRUCTIVE' {
  const level = context.riskLevel;
  return level === 'READ' || level === 'WRITE' || level === 'DESTRUCTIVE' ? level : 'DESTRUCTIVE';
}

function connectorDataBytes(data: Record<string, unknown> | undefined): number {
  return Buffer.byteLength(JSON.stringify(data ?? {}), 'utf8');
}

function connectorAuditMetadata(context: ConnectorContextInput): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const key of CONNECTOR_AUDIT_SUMMARY_KEYS) {
    const sanitized = sanitizeConnectorAuditValue(key, context.data?.[key]);
    if (sanitized === undefined) continue;
    summary[key] = sanitized;
  }
  return {
    provider: context.provider,
    toolId: context.toolId,
    toolName: context.toolName,
    riskLevel: resolveConnectorRiskLevel(context),
    confirmed: context.confirmed === true,
    resultBytes: connectorDataBytes(context.data),
    summary,
  };
}

function sanitizeConnectorAuditValue(key: string, value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 120);
  if (key === 'resultCounts' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const counts: Record<string, number> = {};
    let kept = 0;
    for (const [name, count] of Object.entries(value as Record<string, unknown>)) {
      if (typeof count !== 'number' || kept >= 24) continue;
      counts[name.slice(0, 60)] = count;
      kept += 1;
    }
    return counts;
  }
  return undefined;
}
