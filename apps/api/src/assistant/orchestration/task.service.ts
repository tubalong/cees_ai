import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AssistantTask,
  AssistantTaskOriginType,
  AssistantTaskPlan,
  AssistantTaskStatus,
  AssistantTaskStep,
  AssistantTaskStepStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import { InteractionService, toPublicInteraction } from './interaction.service';
import {
  AnswerInput,
  ClarificationDraft,
  PlanService,
  PlannedStepDraft,
} from './plan.service';
import { TaskEventService } from './task-event.service';
import { TaskRunnerService } from './task-runner.service';
import { StepStateService } from './step-state.service';
import {
  isTerminalTaskStatus,
  PublicTask,
  PublicTaskClarification,
  PublicTaskDetail,
  PublicTaskListResult,
  PublicTaskPlan,
  PublicTaskPlanStep,
  PublicTaskResourceRef,
  PublicTaskStatus,
  PublicTaskStep,
} from './orchestration.types';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 总管工具成功落库后返回的任务详情（供执行器生成回喂摘要与展示引用）。 */
export interface CreateTaskFromToolInput {
  conversationId: string;
  /** 工具调用 ID：任务创建的幂等键（同会话内去重）。 */
  toolCallId: string;
  /** 工具参数哈希：同幂等键不同内容时拒绝重放。 */
  requestHash: string;
  title: string;
  goal: string;
  steps: PlannedStepDraft[];
  clarifications: ClarificationDraft[];
  /** 可用执行同事名册（agentId → 名称），用于计划快照与指派校验。 */
  agentNames: ReadonlyMap<string, string>;
}

export interface ListTasksQuery {
  status?: PublicTaskStatus;
  conversationId?: string;
  limit?: number;
  cursor?: string;
}

export interface ConfirmTaskRequest {
  decision: 'start' | 'revise';
  answers?: AnswerInput[];
}

interface TaskCursor {
  createdAt: Date;
  id: string;
}

/**
 * AI 任务生命周期服务：创建（工具落库）、查询、确认、取消。
 * 任务事实只在这里演进；状态迁移全部使用「期望前态」的条件更新抢占，
 * 并发提交只有一方生效，重复提交按公开契约返回当前状态。
 */
@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly taskEvents: TaskEventService,
    private readonly plans: PlanService,
    private readonly runner: TaskRunnerService,
    private readonly stepState: StepStateService,
    private readonly interactions: InteractionService,
  ) { }

  /**
   * 总管工具落库入口：创建任务与计划 v1，并在同一事务写 TASK_CREATED 与
   * PLAN_READY 事件——M1 计划同步生成，任务创建即待确认。幂等键为 toolCallId，
   * 重放（如轮次恢复重复执行）返回已存在任务而不是重复创建。
   */
  async createFromTool(input: CreateTaskFromToolInput): Promise<PublicTaskDetail> {
    const context = this.tenantContext.require();
    const steps = this.plans.normalizeSteps(input.steps, input.agentNames);
    const clarifications = this.plans.normalizeClarifications(input.clarifications);

    const existing = await this.prisma.assistantTask.findUnique({
      where: {
        conversationId_idempotencyKey: {
          conversationId: input.conversationId,
          idempotencyKey: input.toolCallId,
        },
      },
      select: { id: true, requestHash: true },
    });
    if (existing) {
      this.assertSameRequest(existing.requestHash, input.requestHash);
      return this.getDetail(existing.id);
    }

    let taskId: string;
    try {
      taskId = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.assistantTask.create({
          data: {
            tenantId: context.tenantId,
            conversationId: input.conversationId,
            userId: context.userId,
            membershipId: context.membershipId,
            title: input.title,
            goal: input.goal,
            originType: AssistantTaskOriginType.CONVERSATION,
            status: AssistantTaskStatus.PENDING_CONFIRM,
            idempotencyKey: input.toolCallId,
            requestHash: input.requestHash,
          },
          select: { id: true },
        });
        await this.plans.createPlanVersion(transaction, {
          tenantId: context.tenantId,
          taskId: created.id,
          version: 1,
          steps,
          clarifications,
          createdBy: 'SYSTEM',
        });
        await this.taskEvents.appendInTransaction(transaction, created.id, context.tenantId, {
          type: 'task_created',
          status: 'PENDING_CONFIRM',
        });
        await this.taskEvents.appendInTransaction(transaction, created.id, context.tenantId, {
          type: 'plan_ready',
          version: 1,
          steps,
          clarifications,
        });
        return created.id;
      });
    } catch (error) {
      // 并发重复创建（两个执行者同时恢复同一工具调用）：唯一约束失败的一方
      // 回读已创建任务，按幂等重放返回。
      if (!isUniqueConstraintError(error, 'idempotency_key')) throw error;
      const replay = await this.prisma.assistantTask.findUnique({
        where: {
          conversationId_idempotencyKey: {
            conversationId: input.conversationId,
            idempotencyKey: input.toolCallId,
          },
        },
        select: { id: true, requestHash: true },
      });
      if (!replay) throw error;
      this.assertSameRequest(replay.requestHash, input.requestHash);
      return this.getDetail(replay.id);
    }
    return this.getDetail(taskId);
  }

  /** 当前成员发起的任务列表，按创建时间倒序；仅返回本人任务。 */
  async list(query: ListTasksQuery): Promise<PublicTaskListResult> {
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    assertListLimit(limit);
    const { tenantId, membershipId } = this.tenantContext.require();
    const keyset = query.cursor ? decodeTaskCursor(query.cursor) : undefined;

    const tasks = await this.prisma.assistantTask.findMany({
      where: {
        tenantId,
        membershipId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.conversationId ? { conversationId: query.conversationId } : {}),
        ...(keyset
          ? {
            OR: [
              { createdAt: { lt: keyset.createdAt } },
              { createdAt: keyset.createdAt, id: { lt: keyset.id } },
            ],
          }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNextPage = tasks.length > limit;
    const page = hasNextPage ? tasks.slice(0, limit) : tasks;
    const last = page[page.length - 1];
    return {
      items: page.map(toPublicTask),
      nextCursor: hasNextPage && last ? encodeTaskCursor(last) : null,
    };
  }

  /** 任务详情：任务 + 最新计划版本（待确认时为草案）+ 生效计划的运行时步骤 + 挂起事项。 */
  async getDetail(taskId: string): Promise<PublicTaskDetail> {
    const task = await this.requireOwnTask(taskId);
    const plan = await this.prisma.assistantTaskPlan.findFirst({
      where: { taskId: task.id },
      orderBy: { version: 'desc' },
    });
    const steps = task.planVersion > 0
      ? await this.prisma.assistantTaskStep.findMany({
        where: { taskId: task.id, planVersion: task.planVersion },
        orderBy: { stepNo: 'asc' },
      })
      : [];
    const stepNames = await this.loadAgentNames(steps);
    const interactions = await this.prisma.assistantTaskInteraction.findMany({
      where: { taskId: task.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      task: toPublicTask(task),
      currentPlan: plan ? toPublicPlan(plan) : null,
      steps: steps.map((step) => toPublicStep(step, stepNames)),
      interactions: interactions.map(toPublicInteraction),
    };
  }

  /**
   * 确认或调整计划（派发前确认）。
   * start：答复覆盖全部待定项后，抢占 PENDING_CONFIRM → RUNNING，物化步骤并触发执行；
   * revise：保留当前草案、合并已提交答复，调整要求随后在对话中提出生成新草案（M3）。
   */
  async confirm(taskId: string, request: ConfirmTaskRequest): Promise<PublicTaskDetail> {
    const task = await this.requireOwnTask(taskId);
    const answers = request.answers ?? [];
    if (request.decision === 'revise') return this.revisePlan(task, answers);
    return this.startPlan(task, answers);
  }

  /** 取消任务：非终态 → CANCELLED 并关闭未决挂起事项；重复提交返回当前状态。 */
  async cancel(
    taskId: string,
    // reason 为契约预留字段：M1 不落库（取消理由待审计事件扩展时一并记录）。
    _request: { reason?: string | null },
  ): Promise<PublicTaskDetail> {
    const task = await this.requireOwnTask(taskId);
    if (!isTerminalTaskStatus(task.status)) {
      const completedAt = new Date();
      await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.assistantTask.updateMany({
          where: {
            id: task.id,
            tenantId: task.tenantId,
            status: {
              notIn: [
                AssistantTaskStatus.COMPLETED,
                AssistantTaskStatus.FAILED,
                AssistantTaskStatus.CANCELLED,
              ],
            },
          },
          data: { status: AssistantTaskStatus.CANCELLED, completedAt },
        });
        // 并发下已被其他请求置入终态：幂等返回当前状态，不再重复写事件。
        if (claimed.count !== 1) return;
        await this.taskEvents.appendInTransaction(transaction, task.id, task.tenantId, {
          type: 'task_cancelled',
        });
        // 契约：取消关闭未决挂起事项（CANCELLED）并逐条写 interaction_resolved。
        await this.interactions.closePendingForTaskInTransaction(transaction, {
          taskId: task.id,
          tenantId: task.tenantId,
          status: 'CANCELLED',
          now: completedAt,
        });
        // 步骤收束：非终态步骤随任务取消置 SKIPPED（逐个写 step_skipped 事件，
        // 保证事件流完整）；未执行/执行中的工具调用同步收束——状态不确定的
        // 执行中调用标 RECOVERY_REQUIRED，绝不因取消而盲目重放副作用。
        const openSteps = await transaction.assistantTaskStep.findMany({
          where: {
            taskId: task.id,
            tenantId: task.tenantId,
            status: {
              in: [
                AssistantTaskStepStatus.PENDING,
                AssistantTaskStepStatus.READY,
                AssistantTaskStepStatus.RUNNING,
                AssistantTaskStepStatus.WAITING_USER,
              ],
            },
          },
          orderBy: { stepNo: 'asc' },
          select: { id: true, stepKey: true, status: true },
        });
        if (openSteps.length > 0) {
          await this.stepState.reconcileTaskStepTools(transaction, {
            tenantId: task.tenantId,
            stepIds: openSteps.map((step) => step.id),
            now: completedAt,
            executingCode: 'TOOL_EXECUTION_CANCELLED',
            executingMessage: '任务已取消，该操作的结果状态未能确认，请留意核对',
            pendingCode: 'TASK_CANCELLED',
            pendingMessage: '任务已取消，该操作未执行',
          });
          for (const step of openSteps) {
            const skipped = await transaction.assistantTaskStep.updateMany({
              where: { id: step.id, taskId: task.id, status: step.status },
              data: {
                status: AssistantTaskStepStatus.SKIPPED,
                error: {
                  code: 'TASK_CANCELLED',
                  message: '任务已取消，本步骤未执行',
                } as Prisma.InputJsonObject,
                completedAt,
                executionOwner: null,
                leaseExpiresAt: null,
              },
            });
            if (skipped.count !== 1) continue;
            await this.taskEvents.appendInTransaction(transaction, task.id, task.tenantId, {
              type: 'step_skipped',
              stepId: step.id,
              stepKey: step.stepKey,
              reason: '任务已取消',
            });
          }
        }
      });
    }
    return this.getDetail(task.id);
  }

  /**
   * 交互解决后的即时恢复（由解决接口调用）：任务仍 WAITING_USER 且已无未决
   * 事项时转回 RUNNING 并重新调度；仍有未决事项或任务本就在跑时静默返回。
   */
  async resumeAfterInteractionResolved(taskId: string): Promise<void> {
    const task = await this.requireOwnTask(taskId);
    if (task.status !== AssistantTaskStatus.WAITING_USER) return;
    if (await this.interactions.hasPendingForTask(task.id)) return;
    const resumed = await this.prisma.assistantTask.updateMany({
      where: { id: task.id, tenantId: task.tenantId, status: AssistantTaskStatus.WAITING_USER },
      data: {
        status: AssistantTaskStatus.RUNNING,
        executionOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: new Date(),
      },
    });
    if (resumed.count !== 1) return;
    void this.runner.startTask(task.id).catch((error) => {
      this.logger.error(`failed to resume waiting task ${task.id}: ${String(error)}`);
    });
  }

  private async startPlan(task: AssistantTask, answers: AnswerInput[]): Promise<PublicTaskDetail> {
    // 已确认（含存在挂起、等待用户介入）：重复提交按契约幂等返回当前状态，不重复派发。
    if (
      task.status === AssistantTaskStatus.RUNNING
      || task.status === AssistantTaskStatus.WAITING_USER
    ) {
      return this.getDetail(task.id);
    }
    if (task.status !== AssistantTaskStatus.PENDING_CONFIRM) {
      throw new ConflictException({
        code: 'TASK_NOT_CONFIRMABLE',
        message: task.status === AssistantTaskStatus.CREATED
          ? '任务计划尚未生成，暂时无法确认'
          : '任务已进入终态，无法确认计划',
      });
    }

    const plan = await this.prisma.assistantTaskPlan.findFirst({
      where: { taskId: task.id },
      orderBy: { version: 'desc' },
    });
    if (!plan) {
      throw new ConflictException({
        code: 'TASK_PLAN_MISSING',
        message: '任务计划缺失，无法确认',
      });
    }
    const clarifications = toPublicClarifications(plan.clarifications);
    const steps = toPlanSteps(plan.steps);
    this.plans.assertAnswersSubmittable(clarifications, answers);
    this.plans.assertAnswersComplete(clarifications, answers);
    const merged = this.plans.mergeAnswers(clarifications, answers);

    const confirmedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      // 抢占式条件更新：只有从 PENDING_CONFIRM 成功迁移的一方确认计划并触发执行。
      const claimed = await transaction.assistantTask.updateMany({
        where: {
          id: task.id,
          tenantId: task.tenantId,
          status: AssistantTaskStatus.PENDING_CONFIRM,
        },
        data: { status: AssistantTaskStatus.RUNNING, planVersion: plan.version },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'TASK_STATE_CONFLICT',
          message: '任务状态已被其他请求变更，请刷新后重试',
        });
      }
      await transaction.assistantTaskPlan.update({
        where: { id: plan.id },
        data: {
          confirmedAt,
          ...(clarifications.length > 0
            ? { clarifications: merged as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      await this.plans.materializeSteps(transaction, {
        tenantId: task.tenantId,
        taskId: task.id,
        planVersion: plan.version,
        steps,
      });
      await this.taskEvents.appendInTransaction(transaction, task.id, task.tenantId, {
        type: 'plan_confirmed',
        version: plan.version,
        confirmedAt: confirmedAt.toISOString(),
      });
    });

    // 计划已确认：启动任务调度循环（任务级租约，多实例下单执行者）。
    void this.runner.startTask(task.id).catch((error) => {
      this.logger.error(`failed to start task runner for ${task.id}: ${String(error)}`);
    });

    return this.getDetail(task.id);
  }

  private async revisePlan(task: AssistantTask, answers: AnswerInput[]): Promise<PublicTaskDetail> {
    if (task.status !== AssistantTaskStatus.PENDING_CONFIRM) {
      throw new ConflictException({
        code: 'TASK_NOT_CONFIRMABLE',
        message: '任务不在待确认状态；调整要求请在对话中提出',
      });
    }
    const plan = await this.prisma.assistantTaskPlan.findFirst({
      where: { taskId: task.id },
      orderBy: { version: 'desc' },
    });
    if (!plan) {
      throw new ConflictException({
        code: 'TASK_PLAN_MISSING',
        message: '任务计划缺失，无法调整',
      });
    }
    const clarifications = toPublicClarifications(plan.clarifications);
    this.plans.assertAnswersSubmittable(clarifications, answers);
    if (clarifications.length > 0 && answers.length > 0) {
      // 草案保留、已提交答复先合并；新计划版本由用户随后的对话调整生成（M3）。
      const merged = this.plans.mergeAnswers(clarifications, answers);
      await this.prisma.assistantTaskPlan.update({
        where: { id: plan.id },
        data: { clarifications: merged as unknown as Prisma.InputJsonValue },
      });
    }
    return this.getDetail(task.id);
  }

  private async requireOwnTask(taskId: string): Promise<AssistantTask> {
    const { tenantId, membershipId } = this.tenantContext.require();
    const task = await this.prisma.assistantTask.findFirst({
      where: { id: taskId, tenantId, membershipId },
    });
    if (!task) throw taskNotFound();
    return task;
  }

  /** 批量解析步骤执行同事的当前名称；已归档/删除的同事返回原名（查询仍可见）。 */
  private async loadAgentNames(steps: AssistantTaskStep[]): Promise<Map<string, string>> {
    const agentIds = [...new Set(steps.map((step) => step.assigneeAgentId))];
    if (agentIds.length === 0) return new Map();
    const agents = await this.prisma.assistantAgent.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true },
    });
    return new Map(agents.map((agent) => [agent.id, agent.name]));
  }

  private assertSameRequest(storedHash: string, requestHash: string): void {
    if (storedHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: '同一工具调用对应不同的任务内容',
      });
    }
  }
}

function taskNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'TASK_NOT_FOUND',
    message: '任务不存在或不属于当前成员',
  });
}

function assertListLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new BadRequestException({
      code: 'PAGINATION_LIMIT_INVALID',
      message: `limit 必须是 1 至 ${MAX_LIST_LIMIT} 的整数`,
    });
  }
}

function encodeTaskCursor(task: { createdAt: Date; id: string }): string {
  return Buffer.from(`${task.createdAt.toISOString()}|${task.id}`).toString('base64url');
}

function decodeTaskCursor(cursor: string): TaskCursor {
  try {
    if (!BASE64URL_PATTERN.test(cursor)) throw new Error('invalid base64url');
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== cursor) throw new Error('non-canonical base64url');
    const fields = decoded.split('|');
    if (fields.length !== 2) throw new Error('invalid field count');
    const [timestamp, id] = fields;
    const createdAt = new Date(timestamp);
    if (
      Number.isNaN(createdAt.getTime())
      || createdAt.toISOString() !== timestamp
      || !UUID_PATTERN.test(id)
    ) {
      throw new Error('invalid cursor fields');
    }
    return { createdAt, id };
  } catch {
    throw new BadRequestException({
      code: 'PAGINATION_CURSOR_INVALID',
      message: '分页游标无效',
    });
  }
}

function toPublicTask(task: AssistantTask): PublicTask {
  return {
    id: task.id,
    title: task.title,
    goal: task.goal,
    status: task.status,
    originType: task.originType,
    conversationId: task.conversationId,
    planVersion: task.planVersion,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    failedReason: task.failedReason,
  };
}

function toPublicPlan(plan: AssistantTaskPlan): PublicTaskPlan {
  return {
    version: plan.version,
    createdBy: plan.createdBy,
    confirmedAt: plan.confirmedAt,
    createdAt: plan.createdAt,
    steps: toPlanSteps(plan.steps),
    clarifications: toPublicClarifications(plan.clarifications),
  };
}

function toPublicStep(step: AssistantTaskStep, agentNames: Map<string, string>): PublicTaskStep {
  return {
    id: step.id,
    stepNo: step.stepNo,
    stepKey: step.stepKey,
    planVersion: step.planVersion,
    status: step.status,
    assigneeAgentId: step.assigneeAgentId,
    assigneeName: agentNames.get(step.assigneeAgentId) ?? null,
    summary: step.summary,
    outputRefs: toOutputRefs(step.outputRefs),
    attemptNo: step.attemptNo,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
  };
}

/** 产出引用 JSON 由步骤回流写入，读取时形状可信；防御性回退为空数组。 */
function toOutputRefs(value: Prisma.JsonValue | null): PublicTaskResourceRef[] {
  return Array.isArray(value) ? (value as unknown as PublicTaskResourceRef[]) : [];
}

/** 计划快照 JSON 由本服务写入，读取时形状可信；防御性回退为空数组。 */
function toPlanSteps(value: Prisma.JsonValue): PublicTaskPlanStep[] {
  return Array.isArray(value) ? (value as unknown as PublicTaskPlanStep[]) : [];
}

function toPublicClarifications(value: Prisma.JsonValue | null): PublicTaskClarification[] {
  return Array.isArray(value) ? (value as unknown as PublicTaskClarification[]) : [];
}

function isUniqueConstraintError(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const needle = field.replace(/[_\s-]/g, '').toLowerCase();
  const parts = Array.isArray(target) ? target : target === undefined ? [] : [target];
  return parts.some((entry) => String(entry).replace(/[_\s-]/g, '').toLowerCase().includes(needle));
}
