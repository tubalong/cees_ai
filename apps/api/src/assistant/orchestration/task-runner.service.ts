import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  AssistantTaskStatus,
  AssistantTaskStepStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { StepRunnerService } from './step-runner.service';
import { StepStateService } from './step-state.service';
import { TaskEventService } from './task-event.service';
import {
  TASK_HEARTBEAT_INTERVAL_MS,
  TASK_RECOVERY_INTERVAL_MS,
  nextTaskLease,
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

        // 3) 派发最早的就绪步骤：一次一步（窗口串行独占，进度可按 stepNo 追踪）。
        const ready = steps.find((step) => step.status === AssistantTaskStepStatus.READY);
        if (ready) {
          try {
            await this.stepRunner.executeStep({
              taskId,
              stepId: ready.id,
              executionOwner: this.executionOwner,
              signal: execution.abortController.signal,
            });
          } catch (error) {
            // 执行器抛出的未处理错误（如数据库/上游异常）：把仍 RUNNING 的步骤
            // 按失败收束，避免任务卡在无执行者的中间态；收束失败说明失去执行权。
            this.logger.error(`task ${taskId} step ${ready.id} execution threw: ${String(error)}`);
            if (!(await this.failStepAfterError(task, ready.id, error))) return;
          }
          continue;
        }

        // 4) 防御：无 READY 也无 RUNNING，但仍有未终态步骤（依赖图异常 / M3 挂起）
        //    → 交还执行权，等待交互解决或恢复扫描。
        const stalled = steps.some(
          (step) => step.status === AssistantTaskStepStatus.PENDING
            || step.status === AssistantTaskStepStatus.WAITING_USER,
        );
        if (stalled) return;

        // 5) 全部步骤终态：任务终态判定与终态事件原子提交。
        await this.finalizeTask(task);
        return;
      }
    } finally {
      this.stopExecution(taskId);
    }
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
      select: { id: true, stepKey: true, status: true, dependsOn: true, leaseExpiresAt: true },
    });
  }

  private async runRecoveryScan(): Promise<void> {
    try {
      const rescheduled = await this.recoverStaleTasks();
      if (rescheduled > 0) {
        this.logger.warn(`rescheduled ${rescheduled} stale task(s)`);
      }
    } catch (error) {
      this.logger.error(`task recovery scan failed: ${String(error)}`);
    }
  }
}

/** dependsOn JSON 由物化写入，读取时形状可信；防御性回退为空数组。 */
function asStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
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