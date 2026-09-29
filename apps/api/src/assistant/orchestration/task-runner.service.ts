import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  AssistantTaskStatus,
  AssistantTaskStepStatus,
  AuditOutcome,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { FailureHandlingService } from './failure-handling.service';
import { InteractionService, type ExpiredInteractionRow } from './interaction.service';
import { StepRunnerService } from './step-runner.service';
import { StepStateService } from './step-state.service';
import { TaskEventService } from './task-event.service';
import {
  TASK_HEARTBEAT_INTERVAL_MS,
  TASK_RECOVERY_INTERVAL_MS,
  loadSuspendTimeoutConfig,
  nextTaskLease,
  type SuspendTimeoutAction,
} from './task-execution.config';

/** 单轮恢复扫描处理的失联任务上限（避免长事务与扫描抖动）。 */
const TASK_RECOVERY_BATCH_LIMIT = 50;
const MAX_FAILURE_DETAIL_CHARS = 1000;
const MAX_TASK_FAILURE_REASON_CHARS = 500;
const DEFAULT_TASK_FAILURE_REASON = '任务中有步骤未成功完成';

/** 任务行快照：每轮调度从数据库现读（不缓存在内存，跨实例安全）。 */
interface TaskSnapshotRow {
  id: string;
  tenantId: string;
  status: AssistantTaskStatus;
  executionOwner: string | null;
  planVersion: number;
}

/** 步骤行快照：依赖推进与派发只依据这份结构。 */
interface StepSnapshotRow {
  id: string;
  stepKey: string;
  status: AssistantTaskStepStatus;
  dependsOn: Prisma.JsonValue;
  leaseExpiresAt: Date | null;
  retryAfterAt: Date | null;
}

interface TaskExecution {
  abortController: AbortController;
  heartbeat?: NodeJS.Timeout;
}

/**
 * 任务调度循环：计划确认后驱动「依赖推进 → 派发就绪步骤 → 步骤执行 → 继续
 * 推进」直到任务终态。多实例部署下同一任务只被一个执行者推进——任务级租约
 * （executionOwner / leaseExpiresAt / heartbeatAt，与轮次租约同构）以抢占式
 * 条件更新认领，心跳失败立即中止本轮执行；失联任务由恢复扫描重新认领。
 *
 * 与 step-runner 的分工：本服务决定「下一步执行哪一步、何时收尾」，
 * 单步的执行细节（派发书、窗口、工具循环、回流）全部交给 StepRunnerService。
 */
@Injectable()
export class TaskRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskRunnerService.name);
  /** 实例级执行者标识：多实例下区分同一任务的执行权归属。 */
  private readonly executionOwner = `${process.env.INSTANCE_ID ?? 'api'}:${process.pid}:${randomUUID()}`;
  private readonly activeExecutions = new Map<string, TaskExecution>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stepRunner: StepRunnerService,
    private readonly state: StepStateService,
    private readonly taskEvents: TaskEventService,
    private readonly interactions: InteractionService,
    private readonly failureHandling: FailureHandlingService,
  ) { }

  onModuleInit(): void {
    if (process.env.ORCHESTRATION_RECOVERY_ENABLED === 'false') return;
    // 启动扫描兼作断点恢复：上次进程中断后残留的 RUNNING 任务在租约过期后被重新认领。
    void this.runRecoveryScan();
    this.timer = setInterval(() => void this.runRecoveryScan(), TASK_RECOVERY_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    for (const taskId of [...this.activeExecutions.keys()]) {
      this.stopExecution(taskId);
    }
  }

  /** 计划确认后的调度入口；由 TaskService 在 PLAN_CONFIRMED 提交后调用。 */
  async startTask(taskId: string): Promise<void> {
    await this.scheduleTask(taskId);
  }

  /** 恢复扫描：收束租约过期任务的失联步骤并重新调度（多实例安全、幂等）。 */
  async recoverStaleTasks(now = new Date()): Promise<number> {
    const stale = await this.prisma.assistantTask.findMany({
      where: {
        status: AssistantTaskStatus.RUNNING,
        leaseExpiresAt: { lte: now },
      },
      orderBy: { updatedAt: 'asc' },
      take: TASK_RECOVERY_BATCH_LIMIT,
      select: { id: true },
    });
    let rescheduled = 0;
    for (const task of stale) {
      try {
        // 任务租约刚过期但步骤仍活跃（心跳抖动 / 时钟偏差）：不武断收束，
        // 交给下一轮扫描在步骤租约也过期后处理。
        const activeStep = await this.prisma.assistantTaskStep.findFirst({
          where: {
            taskId: task.id,
            status: AssistantTaskStepStatus.RUNNING,
            leaseExpiresAt: { gt: now },
          },
          select: { id: true },
        });
        if (activeStep) continue;
        await this.state.recoverStaleSteps(task.id, now);
        if (await this.scheduleTask(task.id)) rescheduled++;
      } catch (error) {
        this.logger.error(`failed to recover stale task ${task.id}: ${String(error)}`);
      }
    }
    return rescheduled;
  }

  /** 认领任务执行权：条件更新成功才启动心跳与调度循环，保证单执行者。 */
  private async scheduleTask(taskId: string): Promise<boolean> {
    if (this.activeExecutions.has(taskId)) return false;
    const now = new Date();
    const claimed = await this.prisma.assistantTask.updateMany({
      where: {
        id: taskId,
        status: AssistantTaskStatus.RUNNING,
        // 只有「从未被认领」或「租约已过期」的任务才可认领；
        // 活跃租约（含他实例持有）一律不抢占。
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        executionOwner: this.executionOwner,
        leaseExpiresAt: nextTaskLease(now),
        heartbeatAt: now,
      },
    });
    if (claimed.count !== 1) return false;

    const execution: TaskExecution = { abortController: new AbortController() };
    this.activeExecutions.set(taskId, execution);
    execution.heartbeat = setInterval(
      () => void this.heartbeat(taskId, execution),
      TASK_HEARTBEAT_INTERVAL_MS,
    );
    execution.heartbeat.unref();
    void this.driveTask(taskId).catch((error) => {
      this.logger.error(`task ${taskId} drive loop crashed: ${String(error)}`);
      this.stopExecution(taskId);
    });
    return true;
  }

  /**
   * 调度循环：每轮从数据库现读任务与步骤（不以内存态为准），单步串行派发。
   * 所有权在任意一轮丢失（取消 / 终态 / 他实例接管 / 心跳失败）即退出。
   */
  private async driveTask(taskId: string): Promise<void> {
    const execution = this.activeExecutions.get(taskId);
    if (!execution) return;
    try {
      while (!execution.abortController.signal.aborted) {
        const task = await this.loadTask(taskId);
        if (
          !task
          || task.status !== AssistantTaskStatus.RUNNING
          || task.executionOwner !== this.executionOwner
        ) {
          return;
        }
        const steps = await this.loadSteps(taskId, task.planVersion);

        // 0) 失败处置兜底：未处置的 FAILED 步骤先走失败阶梯（自动重试 / 升级裁决），
        //    覆盖「失败已写、处置未落」的崩溃窗口；处置后状态已流转，重载快照。
        if (steps.some((step) => step.status === AssistantTaskStepStatus.FAILED)) {
          if (await this.failureHandling.reconcileUnhandledFailures(taskId) > 0) continue;
        }

        // 1) 依赖推进：依赖全部成功的 PENDING → READY；依赖失败/跳过的级联 SKIPPED。
        if (await this.advanceSteps(task, steps)) continue;

        // 2) 活跃/失联步骤防护：活跃租约属于当前执行者（本循环的残留或他实例），
        //    交还执行权；租约过期则是失联步骤，先收束再继续推进。
        const running = steps.find((step) => step.status === AssistantTaskStepStatus.RUNNING);
        if (running) {
          const now = new Date();
          if (running.leaseExpiresAt && running.leaseExpiresAt > now) return;
          await this.state.recoverStaleSteps(taskId, now);
          continue;
        }

        // 3) 派发最早的就绪步骤：一次一步（窗口串行独占，进度可按 stepNo 追踪）；
        //    退避中的步骤（retryAfterAt 未到）本轮不派发，交第 5 步统一让行。
        const ready = steps.find(
          (step) => step.status === AssistantTaskStepStatus.READY
            && (!step.retryAfterAt || step.retryAfterAt.getTime() <= Date.now()),
        );
        if (ready) {
          if (!(await this.dispatchStep(task, execution, ready.id))) return;
          continue;
        }

        // 4) 挂起步骤：先应用「已解决的失败裁决」（重试/跳过/终止落状态）；
        //    仍有未决事项 → 任务转 WAITING_USER 并释放租约等待用户介入；
        //    全部已解决 → 重新派发（断点续跑）——挂起不阻塞其它步骤（第 3 步已覆盖）。
        const waitingSteps = steps.filter(
          (step) => step.status === AssistantTaskStepStatus.WAITING_USER,
        );
        if (waitingSteps.length > 0) {
          if (await this.failureHandling.applyResolvedFailureDecisions(taskId) > 0) continue;
          if (await this.interactions.hasPendingForTask(taskId)) {
            await this.markTaskWaitingUser(taskId);
            return;
          }
          if (!(await this.dispatchStep(task, execution, waitingSteps[0].id))) return;
          continue;
        }

        // 5) 无进展让行：退避等待中的就绪步骤或残留 PENDING（依赖图异常）时，
        //    交还任务执行权（租约置过期），由恢复扫描重拾续跑。
        const now = new Date();
        const cooling = steps.some(
          (step) => step.status === AssistantTaskStepStatus.READY
            && step.retryAfterAt !== null && step.retryAfterAt > now,
        );
        if (cooling || steps.some((step) => step.status === AssistantTaskStepStatus.PENDING)) {
          await this.state.yieldTaskExecution({
            taskId,
            executionOwner: this.executionOwner,
          });
          return;
        }

        // 6) 全部步骤终态：任务终态判定与终态事件原子提交。
        await this.finalizeTask(task);
        return;
      }
    } finally {
      this.stopExecution(taskId);
    }
  }

  /**
   * 派发/恢复单个步骤：执行器抛出的未处理错误（如数据库/上游异常）按失败收束，
   * 避免任务卡在无执行者的中间态；收束失败说明已失去执行权。
   */
  private async dispatchStep(
    task: TaskSnapshotRow,
    execution: TaskExecution,
    stepId: string,
  ): Promise<boolean> {
    try {
      await this.stepRunner.executeStep({
        taskId: task.id,
        stepId,
        executionOwner: this.executionOwner,
        signal: execution.abortController.signal,
      });
      return true;
    } catch (error) {
      this.logger.error(`task ${task.id} step ${stepId} execution threw: ${String(error)}`);
      return this.failStepAfterError(task, stepId, error);
    }
  }

  /**
   * 挂起等待用户：RUNNING → WAITING_USER 条件更新并释放任务租约；
   * 心跳随调度循环退出停止，恢复由交互解决（TaskService）或恢复扫描兜底。
   */
  private async markTaskWaitingUser(taskId: string): Promise<void> {
    await this.prisma.assistantTask.updateMany({
      where: {
        id: taskId,
        status: AssistantTaskStatus.RUNNING,
        executionOwner: this.executionOwner,
      },
      data: {
        status: AssistantTaskStatus.WAITING_USER,
        executionOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: new Date(),
      },
    });
  }

  /**
   * 挂起恢复兜底：WAITING_USER 且已无未决事项的任务转回 RUNNING 并重新调度。
   * 主路径是交互解决接口即时恢复；此扫描补偿接口调用中断等残留场景。
   */
  async resumeWaitingTasks(): Promise<number> {
    const waiting = await this.prisma.assistantTask.findMany({
      where: { status: AssistantTaskStatus.WAITING_USER },
      orderBy: { updatedAt: 'asc' },
      take: TASK_RECOVERY_BATCH_LIMIT,
      select: { id: true },
    });
    let resumed = 0;
    for (const task of waiting) {
      try {
        if (await this.interactions.hasPendingForTask(task.id)) continue;
        const claimed = await this.prisma.assistantTask.updateMany({
          where: { id: task.id, status: AssistantTaskStatus.WAITING_USER },
          data: {
            status: AssistantTaskStatus.RUNNING,
            executionOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: new Date(),
          },
        });
        if (claimed.count !== 1) continue;
        if (await this.scheduleTask(task.id)) resumed++;
      } catch (error) {
        this.logger.error(`failed to resume waiting task ${task.id}: ${String(error)}`);
      }
    }
    return resumed;
  }

  /**
   * 依赖推进（在本地快照上迭代至稳定）：依赖全部 SUCCEEDED → READY；
   * 任一依赖 FAILED/SKIPPED（或引用缺失）→ SKIPPED，并按 stepNo 级联到后续步骤。
   */
  private async advanceSteps(task: TaskSnapshotRow, steps: StepSnapshotRow[]): Promise<boolean> {
    let changed = false;
    let progressed = true;
    // 级联跳过可能跨多轮（后续步骤依赖刚被跳过的步骤）：推进至稳定为止；
    // 每轮至少有一个 PENDING 离开 PENDING，循环必然收敛。
    while (progressed) {
      progressed = false;
      for (const step of steps) {
        if (step.status !== AssistantTaskStepStatus.PENDING) continue;
        const dependencyKeys = asStringArray(step.dependsOn);
        const dependencies = steps.filter((row) => dependencyKeys.includes(row.stepKey));
        const blocked = dependencies.length !== dependencyKeys.length
          || dependencies.some(
            (row) => row.status === AssistantTaskStepStatus.FAILED
              || row.status === AssistantTaskStepStatus.SKIPPED,
          );
        if (blocked) {
          const skipped = await this.state.skipStep({
            taskId: task.id,
            stepId: step.id,
            stepKey: step.stepKey,
            tenantId: task.tenantId,
            reason: '前置步骤未成功完成，本步骤已跳过',
          });
          if (skipped) {
            step.status = AssistantTaskStepStatus.SKIPPED;
            changed = true;
            progressed = true;
          }
          continue;
        }
        if (!dependencies.every((row) => row.status === AssistantTaskStepStatus.SUCCEEDED)) continue;
        if (await this.state.markStepReady(task.id, step.id)) {
          step.status = AssistantTaskStepStatus.READY;
          changed = true;
          progressed = true;
        }
      }
    }
    return changed;
  }

  /** 执行器抛出未处理错误时的兜底收束：仍 RUNNING 的步骤按失败处理（幂等）。 */
  private async failStepAfterError(
    task: TaskSnapshotRow,
    stepId: string,
    error: unknown,
  ): Promise<boolean> {
    try {
      const step = await this.prisma.assistantTaskStep.findUnique({
        where: { id: stepId },
        select: { stepKey: true, status: true },
      });
      if (!step || step.status !== AssistantTaskStepStatus.RUNNING) return false;
      return await this.state.failStep({
        taskId: task.id,
        stepId,
        stepKey: step.stepKey,
        tenantId: task.tenantId,
        executionOwner: this.executionOwner,
        code: 'STEP_EXECUTION_ERROR',
        reason: '步骤执行发生内部错误，本步骤未完成',
        detail: truncate(String(error), MAX_FAILURE_DETAIL_CHARS),
      });
    } catch (failure) {
      this.logger.error(`failed to mark step ${stepId} as failed: ${String(failure)}`);
      return false;
    }
  }

  /**
   * 终态判定：存在 FAILED 步骤 → 任务 FAILED（failedReason 取失败步骤 error.message）；
   * 否则全部 SUCCEEDED/SKIPPED → COMPLETED。终态迁移与终态事件原子提交。
   */
  private async finalizeTask(task: TaskSnapshotRow): Promise<void> {
    const failedStep = await this.prisma.assistantTaskStep.findFirst({
      where: {
        taskId: task.id,
        planVersion: task.planVersion,
        status: AssistantTaskStepStatus.FAILED,
      },
      orderBy: { stepNo: 'asc' },
      select: { error: true },
    });
    const failureReason = failedStep ? describeStepFailure(failedStep.error) : null;

    const finalized = await this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const claimed = await transaction.assistantTask.updateMany({
        where: {
          id: task.id,
          status: AssistantTaskStatus.RUNNING,
          executionOwner: this.executionOwner,
        },
        data: {
          status: failureReason ? AssistantTaskStatus.FAILED : AssistantTaskStatus.COMPLETED,
          failedReason: failureReason,
          completedAt: now,
          executionOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
        },
      });
      if (claimed.count !== 1) return false;
      // 终态清理：关闭未决挂起（CANCELLED）并逐条写 interaction_resolved，与终态事件同一事务。
      await this.interactions.closePendingForTaskInTransaction(transaction, {
        taskId: task.id,
        tenantId: task.tenantId,
        status: 'CANCELLED',
        now,
      });
      await this.taskEvents.appendInTransaction(transaction, task.id, task.tenantId, failureReason
        ? { type: 'task_failed', reason: failureReason }
        : { type: 'task_completed' });
      return true;
    });
    if (!finalized) return;
    if (failureReason) {
      this.logger.warn(`task ${task.id} finished with failure: ${failureReason}`);
    } else {
      this.logger.log(`task ${task.id} completed`);
    }
  }

  /** 心跳：续约任务、活跃步骤与执行中工具；失约即中止本轮执行。 */
  private async heartbeat(taskId: string, execution: TaskExecution): Promise<void> {
    try {
      const owned = await this.state.heartbeatTask({
        taskId,
        executionOwner: this.executionOwner,
        leaseExpiresAt: nextTaskLease(),
      });
      if (!owned) execution.abortController.abort();
    } catch (error) {
      this.logger.error(`task ${taskId} heartbeat failed: ${String(error)}`);
    }
  }

  /** 停表并清理本地执行态；调度循环退出（正常/异常/失去所有权）统一经过这里。 */
  private stopExecution(taskId: string): void {
    const execution = this.activeExecutions.get(taskId);
    if (!execution) return;
    if (execution.heartbeat) clearInterval(execution.heartbeat);
    execution.abortController.abort();
    this.activeExecutions.delete(taskId);
  }

  private loadTask(taskId: string): Promise<TaskSnapshotRow | null> {
    return this.prisma.assistantTask.findUnique({
      where: { id: taskId },
      select: { id: true, tenantId: true, status: true, executionOwner: true, planVersion: true },
    });
  }

  private loadSteps(taskId: string, planVersion: number): Promise<StepSnapshotRow[]> {
    return this.prisma.assistantTaskStep.findMany({
      where: { taskId, planVersion },
      orderBy: { stepNo: 'asc' },
      select: {
        id: true,
        stepKey: true,
        status: true,
        dependsOn: true,
        leaseExpiresAt: true,
        retryAfterAt: true,
      },
    });
  }

  private async runRecoveryScan(): Promise<void> {
    try {
      // 超时策略：先关闭已过 expiresAt 的挂起事项（写 interaction_resolved），
      // 再按配置动作应用（按默认值继续 / 跳过步骤 / 终止任务）。
      const expired = await this.interactions.expireOverdueInteractions();
      if (expired.length > 0) {
        this.logger.warn(`expired ${expired.length} overdue interaction(s)`);
        await this.applySuspendTimeoutActions(expired);
      }
      const rescheduled = await this.recoverStaleTasks();
      if (rescheduled > 0) {
        this.logger.warn(`rescheduled ${rescheduled} stale task(s)`);
      }
      // 挂起恢复兜底：交互已解决/关闭但恢复未落地的 WAITING_USER 任务。
      const resumed = await this.resumeWaitingTasks();
      if (resumed > 0) {
        this.logger.warn(`resumed ${resumed} waiting task(s)`);
      }
    } catch (error) {
      this.logger.error(`task recovery scan failed: ${String(error)}`);
    }
  }

  /**
   * 挂起超时后动作（恢复扫描调用，逐条独立容错）：
   * - continue_default：向步骤窗口注入系统提示（视为未获批准 / 按默认继续），
   *   步骤维持 WAITING_USER，由本轮恢复扫描续跑；
   * - skip_step / fail_task：无执行者的 WAITING_USER 步骤条件收束为 SKIPPED /
   *   FAILED，任务随后由既有推进逻辑判定终态。
   * 每条应用均写 TASK_SUSPEND_TIMEOUT_APPLIED 审计留痕。
   */
  private async applySuspendTimeoutActions(expired: ExpiredInteractionRow[]): Promise<number> {
    const timeout = loadSuspendTimeoutConfig();
    // 无限等待（默认）：理论上不会出现过期事项，防御性短路。
    if (timeout.timeoutMinutes <= 0) return 0;
    let applied = 0;
    for (const row of expired) {
      try {
        if (timeout.action === 'continue_default') {
          if (row.stepId) {
            await this.state.writeSuspendTimeoutNotice({
              tenantId: row.tenantId,
              stepId: row.stepId,
              content: buildSuspendTimeoutNotice(row),
            });
          }
        } else if (row.stepId) {
          await this.state.expireWaitingStep({
            taskId: row.taskId,
            stepId: row.stepId,
            stepKey: row.stepKey ?? '',
            tenantId: row.tenantId,
            outcome: timeout.action === 'skip_step' ? 'skip' : 'fail',
            reason: timeout.action === 'skip_step'
              ? '等待用户处理超时，本步骤已跳过'
              : '等待用户处理超时，本步骤按失败收束',
          });
        }
        await this.auditSuspendTimeoutApplied(row, timeout.action);
        applied++;
      } catch (error) {
        this.logger.error(
          `failed to apply suspend timeout for interaction ${row.id}: ${String(error)}`,
        );
      }
    }
    return applied;
  }

  /** 超时策略应用审计：事项、触发步骤与所采取的动作。 */
  private async auditSuspendTimeoutApplied(
    row: ExpiredInteractionRow,
    action: SuspendTimeoutAction,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: row.tenantId,
        actorUserId: null,
        actorMembershipId: null,
        action: 'TASK_SUSPEND_TIMEOUT_APPLIED',
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'ASSISTANT_TASK_INTERACTION',
        resourceId: row.id,
        requestId: `task:${row.taskId}:suspend-timeout`,
        metadata: {
          taskId: row.taskId,
          interactionType: row.type,
          stepId: row.stepId,
          stepKey: row.stepKey,
          action,
        },
      },
    });
  }
}

/** dependsOn JSON 由物化写入，读取时形状可信；防御性回退为空数组。 */
function asStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * 超时「按默认值继续」的步骤窗口提示（USER 角色，服务端固定文案）：授权视为
 * 未获批准、提问无答复、裁决按最稳妥默认——模型恢复后据此继续本步骤。
 */
function buildSuspendTimeoutNotice(row: ExpiredInteractionRow): string {
  const label = `「${row.summary}」`;
  if (row.type === 'AUTHORIZATION') {
    return `授权申请${label}未在时限内处理，视为未获批准：本次操作不再执行，`
      + '请改用其他可行方式完成本步骤，或说明无法完成。';
  }
  if (row.type === 'DECISION') {
    return `裁决${label}未在时限内作出：请采用最稳妥的默认方案继续完成本步骤，`
      + '并在结果摘要中说明所采用的默认选择。';
  }
  return `提问${label}未在时限内收到答复：请基于现有信息继续完成本步骤；`
    + '确实无法完成的，说明原因。';
}

/** 失败步骤的 error JSON → 任务级失败原因（展示级）。 */
function describeStepFailure(error: Prisma.JsonValue | null): string {
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) {
      return truncate(message.trim(), MAX_TASK_FAILURE_REASON_CHARS);
    }
  }
  return DEFAULT_TASK_FAILURE_REASON;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}