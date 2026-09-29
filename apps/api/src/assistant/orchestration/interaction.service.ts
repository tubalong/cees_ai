import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AssistantTaskInteraction,
  AssistantTaskInteractionScope,
  AssistantTaskInteractionStatus,
  AssistantTaskInteractionType,
  AssistantTaskStatus,
  AuditOutcome,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import {
  PublicTaskInteraction,
  PublicTaskInteractionOption,
  PublicTaskInteractionScope,
  PublicTaskInteractionType,
} from './orchestration.types';
import { TaskEventService } from './task-event.service';

/** 单次过期扫描处理的挂起事项上限（避免长扫描与事件风暴）。 */
const EXPIRY_BATCH_LIMIT = 50;
const MAX_SUMMARY_CHARS = 1000;
const MAX_REASON_CHARS = 1000;
const MAX_OPTIONS = 10;
const MAX_RESOLUTION_CHARS = 2000;

/** 单个任务内授权交互的扫描上限（拒绝循环防御与最近结局判定用）。 */
const AUTHORIZATION_SCAN_LIMIT = 50;

/** 挂起（创建交互）入参；由 step-runner / 决策器在后台上下文调用，租户与任务显式传入。 */
export interface CreateInteractionInput {
  tenantId: string;
  taskId: string;
  /** 触发的步骤；任务级事项为空。 */
  stepId?: string | null;
  /** 触发步骤的计划内稳定标识（展示用）。 */
  stepKey?: string | null;
  type: PublicTaskInteractionType;
  /** 展示级摘要：授权=要执行的动作与影响；提问=问题文本；裁决=待拍板的分岔说明。 */
  summary: string;
  /** 需要用户介入的原因：授权理由 / 提问背景 / 裁决背景。 */
  reason?: string | null;
  /** 提问与裁决的候选项；授权不传（为空数组）。 */
  options?: PublicTaskInteractionOption[];
  /** 授权申请的权限项（type=AUTHORIZATION 必填，批准后按此匹配使用）。 */
  permissionCode?: string;
  /** 授权申请的工具展示名（type=AUTHORIZATION 必填）。 */
  toolName?: string;
  /** 超时失效时间；不限时为空。 */
  expiresAt?: Date | null;
  /** 申请请求的 requestId（审计「记录请求」维度；后台调用方显式传入）。 */
  requestId: string;
  /** 发起人成员（审计操作者维度）；后台调用方可空。 */
  membershipId?: string | null;
}

/** 解决挂起事项的请求（与契约 AssistantTaskInteractionResolveRequest 一致）。 */
export interface ResolveInteractionRequest {
  decision: 'approve' | 'reject' | 'answer' | 'choose';
  /** 临时授权范围（仅 decision=approve）；缺省 ONCE。 */
  scope?: PublicTaskInteractionScope | null;
  /** 所选候选 id 或答复文本（answer / choose 必填）。 */
  value?: string | null;
}

/** 内部 payload 的展示级解析结果；未知结构按空值兜底，读取永不抛出。 */
export interface ParsedInteractionPayload {
  summary: string;
  reason: string | null;
  stepKey: string | null;
  options: PublicTaskInteractionOption[];
  permissionCode: string | null;
  toolName: string | null;
}

interface InteractionCloseRow {
  id: string;
  taskId: string;
  tenantId: string;
  type: AssistantTaskInteractionType;
  stepId: string | null;
  payload: Prisma.JsonValue;
}

/**
 * 用户介入事项（挂起 / 恢复的统一载体）服务：授权 / 提问 / 裁决共用同一管道。
 *
 * - 创建：写入 PENDING 交互并追加 interaction_requested 事件（同一事务）；
 * - 解决：PENDING 条件更新（RESOLVED / REJECTED）幂等——重复提交按当前状态返回，
 *   解决动作与事项类型强匹配（approve·reject 仅授权、answer 仅提问、choose 仅裁决）；
 * - 终态清理：任务进入终态或超时策略触发时批量关闭 PENDING 并逐条写 interaction_resolved；
 * - 临时授权校验链：使用时刻校验「任务未终态、scope 未耗尽、权限项匹配」，ONCE 用后置
 *   usedAt 耗尽、TASK 可多次使用；每次使用写审计事件。
 *
 * 后台调用（step-runner / 任务运行器）不依赖 HTTP 上下文，租户与操作者显式传入。
 */
@Injectable()
export class InteractionService {
  private readonly logger = new Logger(InteractionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly taskEvents: TaskEventService,
  ) { }

  /** 创建挂起事项（PENDING）并追加 interaction_requested 事件；返回持久化行。 */
  async createInTransaction(
    transaction: Prisma.TransactionClient,
    input: CreateInteractionInput,
  ): Promise<AssistantTaskInteraction> {
    const payload = this.buildPayload(input);
    const created = await transaction.assistantTaskInteraction.create({
      data: {
        tenantId: input.tenantId,
        taskId: input.taskId,
        stepId: input.stepId ?? null,
        type: input.type,
        payload: payload as unknown as Prisma.InputJsonValue,
        expiresAt: input.expiresAt ?? null,
      },
    });
    await this.taskEvents.appendInTransaction(transaction, input.taskId, input.tenantId, {
      type: 'interaction_requested',
      interactionId: created.id,
      interactionType: created.type,
      stepId: created.stepId,
      stepKey: payload.stepKey,
      summary: payload.summary,
      reason: payload.reason,
      options: payload.options,
      expiresAt: created.expiresAt ? created.expiresAt.toISOString() : null,
    });
    // 申请段审计：与「决定 / 使用」两段对称，记录租户、操作者、请求、资源与元数据。
    await transaction.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: null,
        actorMembershipId: input.membershipId ?? null,
        action: 'TASK_INTERACTION_REQUESTED',
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'ASSISTANT_TASK_INTERACTION',
        resourceId: created.id,
        requestId: input.requestId,
        metadata: {
          taskId: input.taskId,
          interactionType: created.type,
          stepId: created.stepId,
          permissionCode: payload.permissionCode,
        },
      },
    });
    return created;
  }

  /**
   * 解决挂起事项（幂等）。返回解决后的交互行（含 taskId / stepId），
   * 供接口层拼装任务详情、执行层（M3-S）触发恢复。
   */
  async resolve(interactionId: string, request: ResolveInteractionRequest): Promise<AssistantTaskInteraction> {
    const context = this.tenantContext.require();
    const interaction = await this.prisma.assistantTaskInteraction.findFirst({
      where: {
        id: interactionId,
        tenantId: context.tenantId,
        // 归属校验并含任务：挂起事项只属于发起成员的任务。
        task: { membershipId: context.membershipId },
      },
      include: { task: { select: { status: true } } },
    });
    if (!interaction) throw interactionNotFound();

    // 幂等：非 PENDING（已解决 / 已拒绝 / 已过期 / 已取消）直接返回当前状态。
    if (interaction.status !== AssistantTaskInteractionStatus.PENDING) {
      return interaction;
    }
    // 防御：任务终态时不应存在 PENDING 事项（终态清理保证）；出现说明数据异常，拒绝解决。
    if (isTerminalStatus(interaction.task.status)) {
      throw new ConflictException({
        code: 'TASK_TERMINAL',
        message: '任务已进入终态，挂起事项不可解决',
      });
    }

    const outcome = this.buildOutcome(interaction.type, request);
    const resolvedAt = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.assistantTaskInteraction.updateMany({
        where: { id: interaction.id, status: AssistantTaskInteractionStatus.PENDING },
        data: {
          status: outcome.status,
          resolution: outcome.resolution as unknown as Prisma.InputJsonValue,
          scope: outcome.scope,
          resolvedByMembershipId: context.membershipId,
          resolvedAt,
        },
      });
      // 并发下已被其他请求解决：按幂等语义返回最新状态。
      if (claimed.count !== 1) return null;
      await this.taskEvents.appendInTransaction(transaction, interaction.taskId, interaction.tenantId, {
        type: 'interaction_resolved',
        interactionId: interaction.id,
        interactionType: interaction.type,
        stepId: interaction.stepId,
        stepKey: parseInteractionPayload(interaction.payload).stepKey,
        status: outcome.eventStatus,
        value: outcome.value,
        scope: outcome.scope,
        resolvedAt: resolvedAt.toISOString(),
      });
      await transaction.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          action: 'TASK_INTERACTION_RESOLVED',
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'ASSISTANT_TASK_INTERACTION',
          resourceId: interaction.id,
          requestId: context.requestId,
          metadata: {
            taskId: interaction.taskId,
            interactionType: interaction.type,
            decision: request.decision,
            scope: outcome.scope,
          },
        },
      });
      return transaction.assistantTaskInteraction.findUniqueOrThrow({ where: { id: interaction.id } });
    });
    if (updated) return updated;
    return this.prisma.assistantTaskInteraction.findUniqueOrThrow({ where: { id: interaction.id } });
  }

  /**
   * 任务终态清理：批量关闭未决挂起（CANCELLED）并逐条写 interaction_resolved，
   * 与任务终态迁移在同一事务提交。任务取消与调度收尾共用此入口。
   */
  async closePendingForTaskInTransaction(
    transaction: Prisma.TransactionClient,
    input: { taskId: string; tenantId: string; status: 'CANCELLED' | 'EXPIRED'; now: Date },
  ): Promise<number> {
    const pending = await transaction.assistantTaskInteraction.findMany({
      where: { taskId: input.taskId, tenantId: input.tenantId, status: AssistantTaskInteractionStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      select: { id: true, taskId: true, tenantId: true, type: true, stepId: true, payload: true },
    });
    let closed = 0;
    for (const row of pending) {
      if (await this.closeInteractionInTransaction(transaction, row, input.status, input.now)) {
        closed++;
      }
    }
    return closed;
  }

  /** 超时策略：将已过 expiresAt 的 PENDING 事项关闭为 EXPIRED（由任务运行器的恢复扫描周期调用）。 */
  async expireOverdueInteractions(now = new Date()): Promise<number> {
    const overdue = await this.prisma.assistantTaskInteraction.findMany({
      where: {
        status: AssistantTaskInteractionStatus.PENDING,
        expiresAt: { not: null, lte: now },
      },
      orderBy: { createdAt: 'asc' },
      take: EXPIRY_BATCH_LIMIT,
      select: { id: true, taskId: true, tenantId: true, type: true, stepId: true, payload: true },
    });
    let expired = 0;
    for (const row of overdue) {
      try {
        const closed = await this.prisma.$transaction((transaction) =>
          this.closeInteractionInTransaction(transaction, row, 'EXPIRED', now));
        if (closed) expired++;
      } catch (error) {
        this.logger.error(`failed to expire interaction ${row.id}: ${String(error)}`);
      }
    }
    return expired;
  }

  /**
   * 临时授权校验链（使用时刻实时求值）：任务未终态、授权已批准、未过期、
   * scope 未耗尽（ONCE 未被使用 / TASK 可多次）、权限项匹配；命中返回授权行。
   */
  async findUsableAuthorization(input: {
    tenantId: string;
    taskId: string;
    permissionCode: string;
    now?: Date;
  }): Promise<AssistantTaskInteraction | null> {
    const now = input.now ?? new Date();
    const candidates = await this.prisma.assistantTaskInteraction.findMany({
      where: {
        tenantId: input.tenantId,
        taskId: input.taskId,
        type: AssistantTaskInteractionType.AUTHORIZATION,
        status: AssistantTaskInteractionStatus.RESOLVED,
        // 任务未终态：终态后临时授权一律失效（不可用即不可再匹配）。
        task: {
          status: {
            notIn: [AssistantTaskStatus.COMPLETED, AssistantTaskStatus.FAILED, AssistantTaskStatus.CANCELLED],
          },
        },
      },
      orderBy: { resolvedAt: 'desc' },
    });
    for (const row of candidates) {
      if (row.expiresAt && row.expiresAt <= now) continue;
      if (row.scope === AssistantTaskInteractionScope.ONCE && row.usedAt) continue;
      if (row.scope !== AssistantTaskInteractionScope.ONCE && row.scope !== AssistantTaskInteractionScope.TASK) continue;
      const payload = parseInteractionPayload(row.payload);
      if (payload.permissionCode !== input.permissionCode) continue;
      return row;
    }
    return null;
  }

  /**
   * 该权限项最近一次授权交互（按创建时间倒序取第一条）：拒绝循环防御与
   * “已有未决请求”防御共用——拒绝后不再重复挂起，未决请求不重复创建。
   */
  async findLatestAuthorization(input: {
    tenantId: string;
    taskId: string;
    permissionCode: string;
  }): Promise<AssistantTaskInteraction | null> {
    const candidates = await this.prisma.assistantTaskInteraction.findMany({
      where: {
        tenantId: input.tenantId,
        taskId: input.taskId,
        type: AssistantTaskInteractionType.AUTHORIZATION,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: AUTHORIZATION_SCAN_LIMIT,
    });
    for (const row of candidates) {
      if (parseInteractionPayload(row.payload).permissionCode !== input.permissionCode) continue;
      return row;
    }
    return null;
  }

  /** 任务是否仍有未决事项：调度器判定「挂起等待 / 恢复续跑」的统一入口。 */
  async hasPendingForTask(taskId: string): Promise<boolean> {
    const count = await this.prisma.assistantTaskInteraction.count({
      where: { taskId, status: AssistantTaskInteractionStatus.PENDING },
    });
    return count > 0;
  }

  /**
   * 使用临时授权：ONCE 条件更新置 usedAt 耗尽（并发下只有一次成功）；
   * TASK 记录最近使用时间、可重复使用。每次使用写审计事件。
   */
  async markAuthorizationUsed(input: {
    tenantId: string;
    interactionId: string;
    membershipId: string | null;
    requestId: string;
    /** 使用发生的步骤与工具调用（审计「被用在哪里」）。 */
    stepId?: string | null;
    toolCallId?: string | null;
    now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? new Date();
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.assistantTaskInteraction.updateMany({
        where: {
          id: input.interactionId,
          tenantId: input.tenantId,
          type: AssistantTaskInteractionType.AUTHORIZATION,
          status: AssistantTaskInteractionStatus.RESOLVED,
          OR: [
            { scope: AssistantTaskInteractionScope.TASK },
            { scope: AssistantTaskInteractionScope.ONCE, usedAt: null },
          ],
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return false;
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: null,
          actorMembershipId: input.membershipId,
          action: 'TASK_AUTHORIZATION_USED',
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'ASSISTANT_TASK_INTERACTION',
          resourceId: input.interactionId,
          requestId: input.requestId,
          metadata: {
            usedAt: now.toISOString(),
            stepId: input.stepId ?? null,
            toolCallId: input.toolCallId ?? null,
          },
        },
      });
      return true;
    });
  }

  /** 解决动作与事项类型的强匹配校验，并推导后状态、resolution 与事件字段。 */
  private buildOutcome(
    type: AssistantTaskInteractionType,
    request: ResolveInteractionRequest,
  ): {
    status: AssistantTaskInteractionStatus;
    eventStatus: 'RESOLVED' | 'REJECTED';
    resolution: Record<string, unknown>;
    scope: AssistantTaskInteractionScope | null;
    value: string | null;
  } {
    if (type === AssistantTaskInteractionType.AUTHORIZATION) {
      if (request.decision === 'approve') {
        const scope = request.scope === 'TASK'
          ? AssistantTaskInteractionScope.TASK
          : AssistantTaskInteractionScope.ONCE;
        return {
          status: AssistantTaskInteractionStatus.RESOLVED,
          eventStatus: 'RESOLVED',
          resolution: { decision: 'approve', scope },
          scope,
          value: null,
        };
      }
      if (request.decision === 'reject') {
        return {
          status: AssistantTaskInteractionStatus.REJECTED,
          eventStatus: 'REJECTED',
          resolution: { decision: 'reject' },
          scope: null,
          value: null,
        };
      }
      throw decisionMismatch('授权事项仅接受 approve / reject');
    }

    if (type === AssistantTaskInteractionType.QUESTION) {
      if (request.decision !== 'answer') {
        throw decisionMismatch('提问事项仅接受 answer');
      }
      const value = requireValue(request.value);
      return {
        status: AssistantTaskInteractionStatus.RESOLVED,
        eventStatus: 'RESOLVED',
        resolution: { decision: 'answer', value },
        scope: null,
        value,
      };
    }

    if (request.decision !== 'choose') {
      throw decisionMismatch('裁决事项仅接受 choose');
    }
    const value = requireValue(request.value);
    return {
      status: AssistantTaskInteractionStatus.RESOLVED,
      eventStatus: 'RESOLVED',
      resolution: { decision: 'choose', value },
      scope: null,
      value,
    };
  }

  /** 按 type 组装内部 payload（含展示级 stepKey）；必填项缺失说明调用方编程错误。 */
  private buildPayload(input: CreateInteractionInput): ParsedInteractionPayload {
    const summary = truncate(input.summary.trim(), MAX_SUMMARY_CHARS);
    if (!summary) throw interactionInputInvalid('挂起事项摘要不能为空');
    const reason = input.reason?.trim() ? truncate(input.reason.trim(), MAX_REASON_CHARS) : null;
    const stepKey = input.stepKey ?? null;

    if (input.type === AssistantTaskInteractionType.AUTHORIZATION) {
      if (!input.permissionCode || !input.toolName) {
        throw interactionInputInvalid('授权申请必须携带权限项与工具名');
      }
      return {
        summary,
        reason,
        stepKey,
        options: [],
        permissionCode: input.permissionCode,
        toolName: input.toolName,
      };
    }

    const options = (input.options ?? [])
      .slice(0, MAX_OPTIONS)
      .map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description ?? null,
      }));
    if (options.length === 0) {
      throw interactionInputInvalid('提问与裁决必须携带候选项');
    }
    return { summary, reason, stepKey, options, permissionCode: null, toolName: null };
  }

  /** 关闭单条 PENDING 事项并写 interaction_resolved 事件；竞争失败（已被处理）返回 false。 */
  private async closeInteractionInTransaction(
    transaction: Prisma.TransactionClient,
    row: InteractionCloseRow,
    status: 'CANCELLED' | 'EXPIRED',
    now: Date,
  ): Promise<boolean> {
    const claimed = await transaction.assistantTaskInteraction.updateMany({
      where: { id: row.id, status: AssistantTaskInteractionStatus.PENDING },
      data: { status: toDbStatus(status), resolvedAt: now },
    });
    if (claimed.count !== 1) return false;
    await this.taskEvents.appendInTransaction(transaction, row.taskId, row.tenantId, {
      type: 'interaction_resolved',
      interactionId: row.id,
      interactionType: row.type,
      stepId: row.stepId,
      stepKey: parseInteractionPayload(row.payload).stepKey,
      status,
      value: null,
      scope: null,
      resolvedAt: now.toISOString(),
    });
    return true;
  }
}

/** 挂起事项行 → 公开形态（与契约 AssistantTaskInteraction 一致）。 */
export function toPublicInteraction(row: AssistantTaskInteraction): PublicTaskInteraction {
  const payload = parseInteractionPayload(row.payload);
  return {
    id: row.id,
    taskId: row.taskId,
    stepId: row.stepId,
    stepKey: payload.stepKey,
    type: row.type,
    status: row.status,
    summary: payload.summary,
    reason: payload.reason,
    options: payload.options,
    scope: row.scope,
    resolution: toDisplayResolution(row.resolution),
    resolvedAt: row.resolvedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/** 展示用解决内容：答复/所选候选的 value 优先，其次 approve / reject 的 decision。 */
function toDisplayResolution(resolution: Prisma.JsonValue | null): string | null {
  if (!isRecord(resolution)) return null;
  const value = asString(resolution.value);
  if (value) return value;
  return asString(resolution.decision);
}

/** 防御式解析内部 payload：非预期结构按空值兜底（数据由本服务写入，形状可信）。 */
export function parseInteractionPayload(payload: Prisma.JsonValue): ParsedInteractionPayload {
  const record = isRecord(payload) ? payload : {};
  return {
    summary: asString(record.summary) ?? '',
    reason: asString(record.reason),
    stepKey: asString(record.stepKey),
    options: parseOptions(record.options),
    permissionCode: asString(record.permissionCode),
    toolName: asString(record.toolName),
  };
}

function parseOptions(value: unknown): PublicTaskInteractionOption[] {
  if (!Array.isArray(value)) return [];
  const options: PublicTaskInteractionOption[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = asString(entry.id);
    const label = asString(entry.label);
    if (!id || !label) continue;
    options.push({ id, label, description: asString(entry.description) });
  }
  return options;
}

function requireValue(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new BadRequestException({
      code: 'INTERACTION_VALUE_REQUIRED',
      message: '解决该事项必须携带所选候选 id 或答复文本',
    });
  }
  if (normalized.length > MAX_RESOLUTION_CHARS) {
    throw new BadRequestException({
      code: 'INTERACTION_VALUE_TOO_LONG',
      message: `解决内容不能超过 ${MAX_RESOLUTION_CHARS} 字符`,
    });
  }
  return normalized;
}

function decisionMismatch(message: string): BadRequestException {
  return new BadRequestException({
    code: 'INTERACTION_DECISION_INVALID',
    message,
  });
}

function interactionInputInvalid(message: string): BadRequestException {
  return new BadRequestException({
    code: 'INTERACTION_INPUT_INVALID',
    message,
  });
}

function interactionNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'INTERACTION_NOT_FOUND',
    message: '挂起事项不存在或不属于当前成员的任务',
  });
}

function isTerminalStatus(status: AssistantTaskStatus): boolean {
  return status === AssistantTaskStatus.COMPLETED
    || status === AssistantTaskStatus.FAILED
    || status === AssistantTaskStatus.CANCELLED;
}

function toDbStatus(status: 'CANCELLED' | 'EXPIRED'): AssistantTaskInteractionStatus {
  return status === 'CANCELLED'
    ? AssistantTaskInteractionStatus.CANCELLED
    : AssistantTaskInteractionStatus.EXPIRED;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
