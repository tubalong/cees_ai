import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AssistantTaskStepStatus,
  AuditOutcome,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  ORCHESTRATION_DECIDER,
  type Decision,
  type DecisionTaskSnapshot,
  type OrchestrationDecider,
} from './decider/decider.types';
import { InteractionService } from './interaction.service';
import { StepStateService } from './step-state.service';
import {
  isFailureDecisionAction,
  isRetryableFailureCode,
  type FailureDecisionAction,
} from './step-failure';
import { loadStepRetryConfig, nextRetryAt } from './task-execution.config';
import type { PublicTaskPlanStep } from './orchestration.types';

const MAX_FAILURE_MESSAGE_CHARS = 300;
const DEFAULT_FAILURE_CODE = 'STEP_EXECUTION_ERROR';
const DEFAULT_FAILURE_MESSAGE = '步骤执行未成功';

/** 失败裁决动作的候选文案（升级交互 options，id 与 resolution.value 一致）。 */
const FAILURE_DECISION_OPTIONS = [
  { id: 'retry', label: '重试该步骤', description: '再执行一次本步骤' },
  { id: 'skip', label: '跳过该步骤', description: '本步产出缺失，继续后续步骤' },
  { id: 'abort', label: '终止任务', description: '结束任务并保留已产出的内容' },
] as const;

/**
 * 失败处置阶梯（需求 §8.1）：FAILED 步骤的统一处置者。
 *
 * - 自动重试：可重试错误且尝试未达上限 → FAILED → READY，写指数退避
 *   「不早于」时间（attemptNo 在下一次派发时 +1）；
 * - 升级用户裁决：不可重试或尝试超限 → FAILED → WAITING_USER 并创建
 *   DECISION 交互（重试 / 跳过 / 终止），用户裁决经 applyResolvedFailureDecisions
 *   落回步骤状态。
 *
 * 决策经编排决策器（FAILURE_HANDLING 规则路径，确定性判定），处置本身由本
 * 服务执行——与「决策器给建议、代码执行」的总原则一致（技术设计 §6）。
 * 所有入口幂等：条件更新保证并发与重放只生效一次。
 */
@Injectable()
export class FailureHandlingService {
  private readonly logger = new Logger(FailureHandlingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: StepStateService,
    private readonly interactions: InteractionService,
    @Inject(ORCHESTRATION_DECIDER) private readonly decider: OrchestrationDecider,
  ) { }

  /**
   * 任务级处置兜底（调度循环 / 恢复扫描调用）：扫描当前计划版本内未处置的
   * FAILED 步骤并逐条处置。覆盖「失败已写、处置未落」的崩溃窗口与失联收束。
   */
  async reconcileUnhandledFailures(taskId: string): Promise<number> {
    const task = await this.prisma.assistantTask.findUnique({
      where: { id: taskId },
      select: { id: true, tenantId: true, planVersion: true },
    });
    if (!task) return 0;
    const failed = await this.prisma.assistantTaskStep.findMany({
      where: {
        taskId,
        planVersion: task.planVersion,
        status: AssistantTaskStepStatus.FAILED,
      },
      orderBy: { stepNo: 'asc' },
      select: { id: true, error: true },
    });
    let handled = 0;
    for (const step of failed) {
      if (hasTerminalResolution(step.error)) continue;
      try {
        const action = await this.reconcileStepFailure({
          taskId,
          tenantId: task.tenantId,
          stepId: step.id,
        });
        if (action !== 'none') handled++;
      } catch (error) {
        this.logger.error(`failed to reconcile step ${step.id}: ${String(error)}`);
      }
    }
    return handled;
  }

  /**
   * 单步失败处置（幂等）：读失败步骤与任务快照，经决策器判定后落状态。
   * 返回实际生效的动作；步骤已流转（非 FAILED）或裁决已终结时返回 none。
   */
  async reconcileStepFailure(input: {
    taskId: string;
    tenantId: string;
    stepId: string;
  }): Promise<'retry' | 'escalate' | 'none'> {
    const step = await this.prisma.assistantTaskStep.findFirst({
      where: { id: input.stepId, taskId: input.taskId, tenantId: input.tenantId },
      select: {
        id: true,
        stepKey: true,
        planVersion: true,
        status: true,
        attemptNo: true,
        error: true,
      },
    });
    if (!step || step.status !== AssistantTaskStepStatus.FAILED) return 'none';
    if (hasTerminalResolution(step.error)) return 'none';

    const task = await this.prisma.assistantTask.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        membershipId: true,
        goal: true,
        planVersion: true,
      },
    });
    if (!task) return 'none';

    const failure = describeFailure(step.error);
    const retry = loadStepRetryConfig();
    const retryable = isRetryableFailureCode(failure.code);
    const taskSnapshot = await this.buildTaskSnapshot(task, step.planVersion);
    const requestId = `task:${task.id}:failure-handling`;
    const decision = await this.decider.decide({
      decisionType: 'FAILURE_HANDLING',
      context: { tenantId: task.tenantId, userId: task.userId, requestId },
      taskSnapshot,
      stepResult: {
        stepKey: step.stepKey,
        stepTitle: taskSnapshot.steps.find((row) => row.stepKey === step.stepKey)?.title ?? null,
        summary: null,
        failure: {
          code: failure.code,
          attemptNo: step.attemptNo,
          maxAttempts: retry.maxAttempts,
          retryable,
        },
      },
    });
    await this.auditFailureDecision({
      taskId: task.id,
      tenantId: task.tenantId,
      membershipId: task.membershipId,
      stepId: step.id,
      stepKey: step.stepKey,
      failure,
      attemptNo: step.attemptNo,
      maxAttempts: retry.maxAttempts,
      retryable,
      decision,
      requestId,
    });

    if (decision.choice === 'retry') {
      const scheduled = await this.state.scheduleStepRetry({
        taskId: task.id,
        stepId: step.id,
        tenantId: task.tenantId,
        retryAfterAt: nextRetryAt(step.attemptNo, retry.backoffSeconds),
      });
      return scheduled ? 'retry' : 'none';
    }

    const escalated = await this.escalateFailure({
      taskId: task.id,
      tenantId: task.tenantId,
      membershipId: task.membershipId,
      stepId: step.id,
      stepKey: step.stepKey,
      stepTitle: taskSnapshot.steps.find((row) => row.stepKey === step.stepKey)?.title ?? null,
      failure,
      attemptNo: step.attemptNo,
      maxAttempts: retry.maxAttempts,
      requestId,
    });
    return escalated ? 'escalate' : 'none';
  }

  /**
   * 应用已解决的失败裁决（解决接口即时恢复 / 调度循环兜底调用，幂等）：
   * 对「WAITING_USER 步骤 + 最近一条已解决且携带 failure 标记的 DECISION 交互」
   * 执行裁决动作——retry=清退避立即重试、skip=跳过、abort=失败收束。
   * 普通（ask_user）裁决不在此处理，仍走窗口消息续跑路径。
   */
  async applyResolvedFailureDecisions(taskId: string): Promise<number> {
    const task = await this.prisma.assistantTask.findUnique({
      where: { id: taskId },
      select: { id: true, tenantId: true, planVersion: true },
    });
    if (!task) return 0;
    const waiting = await this.prisma.assistantTaskStep.findMany({
      where: {
        taskId,
        planVersion: task.planVersion,
        status: AssistantTaskStepStatus.WAITING_USER,
      },
      orderBy: { stepNo: 'asc' },
      select: { id: true, stepKey: true },
    });
    let applied = 0;
    for (const step of waiting) {
      const interaction = await this.prisma.assistantTaskInteraction.findFirst({
        where: {
          taskId,
          stepId: step.id,
          type: 'DECISION',
        },
        orderBy: { createdAt: 'desc' },
        select: { status: true, payload: true, resolution: true },
      });
      if (!interaction || interaction.status !== 'RESOLVED') continue;
      if (!hasFailureMarker(interaction.payload)) continue;
      const action = readResolutionValue(interaction.resolution);
      if (!action || !isFailureDecisionAction(action)) continue;
      const ok = await this.state.applyFailureDecision({
        taskId,
        stepId: step.id,
        stepKey: step.stepKey,
        tenantId: task.tenantId,
        action,
        reason: describeAppliedAction(action),
      });
      if (ok) applied++;
    }
    return applied;
  }

  /** 升级用户裁决：FAILED → WAITING_USER 并创建 DECISION 交互（同事务）。 */
  private async escalateFailure(input: {
    taskId: string;
    tenantId: string;
    membershipId: string | null;
    stepId: string;
    stepKey: string;
    stepTitle: string | null;
    failure: { code: string; message: string };
    attemptNo: number;
    maxAttempts: number;
    requestId: string;
  }): Promise<boolean> {
    const label = input.stepTitle ?? input.stepKey;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const moved = await this.state.escalateStepInTransaction(transaction, {
          taskId: input.taskId,
          stepId: input.stepId,
          tenantId: input.tenantId,
        });
        // 状态未迁移说明已被并发处置（重试 / 已升级 / 已裁决），不重复创建交互。
        if (!moved) return false;
        await this.interactions.createInTransaction(transaction, {
          tenantId: input.tenantId,
          taskId: input.taskId,
          stepId: input.stepId,
          stepKey: input.stepKey,
          type: 'DECISION',
          summary: `步骤「${label}」执行未成功，请选择处理方式`,
          reason: `第 ${input.attemptNo}/${input.maxAttempts} 次尝试失败（${input.failure.code}）：`
            + input.failure.message,
          options: FAILURE_DECISION_OPTIONS.map((option) => ({ ...option })),
          failure: {
            code: input.failure.code,
            message: input.failure.message,
            attemptNo: input.attemptNo,
          },
          requestId: input.requestId,
          membershipId: input.membershipId,
        });
        return true;
      });
    } catch (error) {
      this.logger.warn(`step ${input.stepId} escalate failed: ${String(error)}`);
      return false;
    }
  }

  /** 决策评估审计：每次失败处置判定留痕（错误 / 尝试次数 / 选项与理由）。 */
  private async auditFailureDecision(input: {
    taskId: string;
    tenantId: string;
    membershipId: string | null;
    stepId: string;
    stepKey: string;
    failure: { code: string; message: string };
    attemptNo: number;
    maxAttempts: number;
    retryable: boolean;
    decision: Decision;
    requestId: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: null,
        actorMembershipId: input.membershipId,
        action: 'TASK_DECISION_EVALUATED',
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'ASSISTANT_TASK',
        resourceId: input.taskId,
        requestId: input.requestId,
        metadata: {
          decisionType: 'FAILURE_HANDLING',
          stepId: input.stepId,
          stepKey: input.stepKey,
          errorCode: input.failure.code,
          attemptNo: input.attemptNo,
          maxAttempts: input.maxAttempts,
          retryable: input.retryable,
          choice: input.decision.choice,
          confidence: input.decision.confidence,
          rationale: input.decision.rationale ?? null,
        },
      },
    });
  }

  /** 决策输入的任务状态快照：任务目标 + 当前计划版本的步骤状态与摘要。 */
  private async buildTaskSnapshot(
    task: { id: string; goal: string },
    planVersion: number,
  ): Promise<DecisionTaskSnapshot> {
    const [steps, planSteps] = await Promise.all([
      this.prisma.assistantTaskStep.findMany({
        where: { taskId: task.id, planVersion },
        orderBy: { stepNo: 'asc' },
        select: { stepKey: true, status: true, summary: true },
      }),
      this.loadPlanSteps(task.id, planVersion),
    ]);
    const titleByKey = new Map(planSteps.map((planned) => [planned.stepKey, planned.title ?? null]));
    return {
      taskId: task.id,
      goal: task.goal,
      planVersion,
      steps: steps.map((row) => ({
        stepKey: row.stepKey,
        title: titleByKey.get(row.stepKey) ?? null,
        status: row.status,
        summary: row.summary,
      })),
    };
  }

  private async loadPlanSteps(taskId: string, planVersion: number): Promise<PublicTaskPlanStep[]> {
    const plan = await this.prisma.assistantTaskPlan.findUnique({
      where: { taskId_version: { taskId, version: planVersion } },
      select: { steps: true },
    });
    const value = plan?.steps;
    return Array.isArray(value) ? (value as unknown as PublicTaskPlanStep[]) : [];
  }
}

/** error JSON → 失败码与展示消息（未知结构按兜底值）。 */
function describeFailure(error: Prisma.JsonValue | null): { code: string; message: string } {
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === 'string' && record.code.trim()
      ? record.code
      : DEFAULT_FAILURE_CODE;
    const message = typeof record.message === 'string' && record.message.trim()
      ? record.message.trim().slice(0, MAX_FAILURE_MESSAGE_CHARS)
      : DEFAULT_FAILURE_MESSAGE;
    return { code, message };
  }
  return { code: DEFAULT_FAILURE_CODE, message: DEFAULT_FAILURE_MESSAGE };
}

/** 裁决已终结（用户选终止）：调度收尾据此跳过再次升级。 */
function hasTerminalResolution(error: Prisma.JsonValue | null): boolean {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  return (error as Record<string, unknown>).resolution === 'abort';
}

/** 交互 payload 是否携带失败标记（区分失败裁决与普通 ask_user 裁决）。 */
function hasFailureMarker(payload: Prisma.JsonValue): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const failure = (payload as Record<string, unknown>).failure;
  return Boolean(failure && typeof failure === 'object' && !Array.isArray(failure));
}

/** resolution JSON → 所选动作（choose 的 value）。 */
function readResolutionValue(resolution: Prisma.JsonValue | null): string | null {
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) return null;
  const value = (resolution as Record<string, unknown>).value;
  return typeof value === 'string' ? value : null;
}

function describeAppliedAction(action: FailureDecisionAction): string {
  if (action === 'retry') return '用户裁决重试本步骤';
  if (action === 'skip') return '用户裁决跳过本步骤，产出缺失';
  return '用户裁决终止任务';
}
