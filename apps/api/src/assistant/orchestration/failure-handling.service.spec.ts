import { AssistantTaskStepStatus } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import type { Decision, OrchestrationDecider } from './decider/decider.types';
import { FailureHandlingService } from './failure-handling.service';
import type { InteractionService } from './interaction.service';
import {
  isFailureDecisionAction,
  isRetryableFailureCode,
} from './step-failure';
import type { StepStateService } from './step-state.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const TASK_ID = '20000000-0000-0000-0000-000000000001';
const STEP_ID = '30000000-0000-0000-0000-000000000001';
const SECOND_STEP_ID = '30000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const REQUEST_ID = `task:${TASK_ID}:failure-handling`;

describe('FailureHandlingService', () => {
  it('schedules an automatic retry with the exponential backoff not-before time', async () => {
    process.env.ORCHESTRATION_STEP_RETRY_MAX = '3';
    process.env.ORCHESTRATION_STEP_RETRY_BACKOFF_SECONDS = '30';
    try {
      const harness = createHarness({
        step: stepRow({
          attemptNo: 1,
          error: { code: 'STEP_EXECUTION_ERROR', message: '连接超时' },
        }),
      });

      await expect(harness.service.reconcileStepFailure({
        taskId: TASK_ID,
        tenantId: TENANT_ID,
        stepId: STEP_ID,
      })).resolves.toBe('retry');

      // 决策输入：规则路径确认「可重试 + 尝试余额充足」。
      expect(harness.decider.decide).toHaveBeenCalledWith(expect.objectContaining({
        decisionType: 'FAILURE_HANDLING',
        stepResult: expect.objectContaining({
          stepKey: 's1',
          stepTitle: '收集数据',
          failure: { code: 'STEP_EXECUTION_ERROR', attemptNo: 1, maxAttempts: 3, retryable: true },
        }),
      }));
      // 退避：首次失败 base * 2^0 = 30s 后；FAILED → READY 交由状态服务条件更新。
      const scheduled = harness.state.scheduleStepRetry.mock.calls[0]![0] as { retryAfterAt: Date };
      expect(scheduled).toEqual(expect.objectContaining({
        taskId: TASK_ID,
        stepId: STEP_ID,
        tenantId: TENANT_ID,
      }));
      const delay = scheduled.retryAfterAt.getTime() - Date.now();
      expect(delay).toBeGreaterThan(28_000);
      expect(delay).toBeLessThan(32_000);
      // 判定留痕：错误、尝试次数与选项进审计。
      expect(harness.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: 'TASK_DECISION_EVALUATED',
          resourceId: TASK_ID,
          requestId: REQUEST_ID,
          metadata: expect.objectContaining({
            decisionType: 'FAILURE_HANDLING',
            errorCode: 'STEP_EXECUTION_ERROR',
            attemptNo: 1,
            maxAttempts: 3,
            retryable: true,
            choice: 'retry',
          }),
        }),
      }));
    } finally {
      delete process.env.ORCHESTRATION_STEP_RETRY_MAX;
      delete process.env.ORCHESTRATION_STEP_RETRY_BACKOFF_SECONDS;
    }
  });

  it('escalates a non-retryable failure into a failure decision interaction', async () => {
    const harness = createHarness({
      step: stepRow({ error: { code: 'STEP_TOOL_FORBIDDEN', message: '该操作在任务步骤内暂不可用' } }),
      decision: { choice: 'escalate', confidence: 1, rationale: '错误不可自动重试' },
    });

    await expect(harness.service.reconcileStepFailure({
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      stepId: STEP_ID,
    })).resolves.toBe('escalate');

    expect(harness.decider.decide).toHaveBeenCalledWith(expect.objectContaining({
      stepResult: expect.objectContaining({
        failure: expect.objectContaining({ retryable: false }),
      }),
    }));
    // 失败 → 挂起：状态迁移与裁决交互创建同事务提交。
    expect(harness.state.escalateStepInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      { taskId: TASK_ID, stepId: STEP_ID, tenantId: TENANT_ID },
    );
    expect(harness.interactions.createInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        taskId: TASK_ID,
        stepId: STEP_ID,
        stepKey: 's1',
        type: 'DECISION',
        summary: '步骤「收集数据」执行未成功，请选择处理方式',
        options: [
          expect.objectContaining({ id: 'retry' }),
          expect.objectContaining({ id: 'skip' }),
          expect.objectContaining({ id: 'abort' }),
        ],
        failure: { code: 'STEP_TOOL_FORBIDDEN', message: '该操作在任务步骤内暂不可用', attemptNo: 1 },
        requestId: REQUEST_ID,
        membershipId: MEMBERSHIP_ID,
      }),
    );
  });

  it('returns none for a step that is no longer failed or already has a terminal decision', async () => {
    const moved = createHarness({
      step: stepRow({ status: AssistantTaskStepStatus.READY }),
    });
    await expect(moved.service.reconcileStepFailure({
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      stepId: STEP_ID,
    })).resolves.toBe('none');
    expect(moved.decider.decide).not.toHaveBeenCalled();

    // 用户已裁决终止（error.resolution='abort'）：调度收尾跳过，不再重复升级。
    const terminal = createHarness({
      step: stepRow({
        error: { code: 'STEP_ABORTED_BY_USER', message: '用户裁决终止任务', resolution: 'abort' },
      }),
    });
    await expect(terminal.service.reconcileStepFailure({
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      stepId: STEP_ID,
    })).resolves.toBe('none');
    expect(terminal.decider.decide).not.toHaveBeenCalled();
  });

  it('does not create a duplicate interaction when the escalation loses the race', async () => {
    const harness = createHarness({
      step: stepRow({ error: { code: 'STEP_TOOL_FORBIDDEN', message: '该操作在任务步骤内暂不可用' } }),
      decision: { choice: 'escalate', confidence: 1, rationale: '错误不可自动重试' },
      escalateMoved: false,
    });

    await expect(harness.service.reconcileStepFailure({
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      stepId: STEP_ID,
    })).resolves.toBe('none');
    expect(harness.interactions.createInTransaction).not.toHaveBeenCalled();
  });

  it('reconciles only unhandled failures of the current plan version', async () => {
    const harness = createHarness({
      failedSteps: [
        { id: STEP_ID, error: { code: 'STEP_EXECUTION_ERROR', message: '连接超时' } },
        { id: SECOND_STEP_ID, error: { code: 'STEP_ABORTED_BY_USER', message: '已终止', resolution: 'abort' } },
      ],
    });
    const reconcile = jest.spyOn(harness.service, 'reconcileStepFailure').mockResolvedValue('retry');

    await expect(harness.service.reconcileUnhandledFailures(TASK_ID)).resolves.toBe(1);

    // 已终结（用户裁决终止）的失败不再处置：只处理未处置的一条。
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith({ taskId: TASK_ID, tenantId: TENANT_ID, stepId: STEP_ID });
  });

  it('keeps scanning when one failure cannot be reconciled', async () => {
    const harness = createHarness({
      failedSteps: [
        { id: STEP_ID, error: null },
        { id: SECOND_STEP_ID, error: { code: 'STEP_EXECUTION_ERROR', message: '连接超时' } },
      ],
    });
    const reconcile = jest.spyOn(harness.service, 'reconcileStepFailure')
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce('retry');

    await expect(harness.service.reconcileUnhandledFailures(TASK_ID)).resolves.toBe(1);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('applies a resolved retry decision onto the waiting step', async () => {
    const harness = createHarness({
      waitingSteps: [{ id: STEP_ID, stepKey: 's1' }],
      interaction: {
        status: 'RESOLVED',
        payload: {
          summary: '步骤「收集数据」执行未成功，请选择处理方式',
          failure: { code: 'STEP_EXECUTION_ERROR', message: '连接超时', attemptNo: 3 },
        },
        resolution: { decision: 'choose', value: 'retry' },
      },
    });

    await expect(harness.service.applyResolvedFailureDecisions(TASK_ID)).resolves.toBe(1);

    expect(harness.state.applyFailureDecision).toHaveBeenCalledWith({
      taskId: TASK_ID,
      stepId: STEP_ID,
      stepKey: 's1',
      tenantId: TENANT_ID,
      action: 'retry',
      reason: '用户裁决重试本步骤',
    });
  });

  it('applies skip and abort decisions with their action-specific reasons', async () => {
    const skipHarness = createHarness({
      waitingSteps: [{ id: STEP_ID, stepKey: 's1' }],
      interaction: {
        status: 'RESOLVED',
        payload: { summary: 'x', failure: { code: 'STEP_EXECUTION_ERROR', message: '连接超时', attemptNo: 3 } },
        resolution: { decision: 'choose', value: 'skip' },
      },
    });
    await expect(skipHarness.service.applyResolvedFailureDecisions(TASK_ID)).resolves.toBe(1);
    expect(skipHarness.state.applyFailureDecision).toHaveBeenCalledWith(expect.objectContaining({
      action: 'skip',
      reason: '用户裁决跳过本步骤，产出缺失',
    }));

    const abortHarness = createHarness({
      waitingSteps: [{ id: STEP_ID, stepKey: 's1' }],
      interaction: {
        status: 'RESOLVED',
        payload: { summary: 'x', failure: { code: 'STEP_EXECUTION_ERROR', message: '连接超时', attemptNo: 3 } },
        resolution: { decision: 'choose', value: 'abort' },
      },
    });
    await expect(abortHarness.service.applyResolvedFailureDecisions(TASK_ID)).resolves.toBe(1);
    expect(abortHarness.state.applyFailureDecision).toHaveBeenCalledWith(expect.objectContaining({
      action: 'abort',
      reason: '用户裁决终止任务',
    }));
  });

  it('ignores regular decisions without the failure marker and still-pending failures', async () => {
    // 普通（ask_user）裁决即使已解决也不在此处理：仍走窗口消息续跑路径。
    const regular = createHarness({
      waitingSteps: [{ id: STEP_ID, stepKey: 's1' }],
      interaction: {
        status: 'RESOLVED',
        payload: { summary: 'x', failure: null },
        resolution: { decision: 'choose', value: 'retry' },
      },
    });
    await expect(regular.service.applyResolvedFailureDecisions(TASK_ID)).resolves.toBe(0);
    expect(regular.state.applyFailureDecision).not.toHaveBeenCalled();

    // 失败裁决尚未解决（PENDING）：保持挂起，等用户提交裁决。
    const pending = createHarness({
      waitingSteps: [{ id: STEP_ID, stepKey: 's1' }],
      interaction: {
        status: 'PENDING',
        payload: { summary: 'x', failure: { code: 'STEP_EXECUTION_ERROR', message: '连接超时', attemptNo: 3 } },
        resolution: null,
      },
    });
    await expect(pending.service.applyResolvedFailureDecisions(TASK_ID)).resolves.toBe(0);
    expect(pending.state.applyFailureDecision).not.toHaveBeenCalled();
  });
});

describe('step-failure classification', () => {
  it('classifies only whitelisted transient codes as retryable', () => {
    expect(isRetryableFailureCode('STEP_EXECUTION_ERROR')).toBe(true);
    expect(isRetryableFailureCode('STEP_EXECUTION_LOST')).toBe(true);
    expect(isRetryableFailureCode('AI_SERVICE_UNAVAILABLE')).toBe(true);
    expect(isRetryableFailureCode('STEP_TOOL_FORBIDDEN')).toBe(false);
    expect(isRetryableFailureCode('TASK_BUDGET_EXCEEDED')).toBe(false);
  });

  it('guards the failure decision actions accepted from the resolution', () => {
    expect(isFailureDecisionAction('retry')).toBe(true);
    expect(isFailureDecisionAction('skip')).toBe(true);
    expect(isFailureDecisionAction('abort')).toBe(true);
    expect(isFailureDecisionAction('approve')).toBe(false);
  });
});

function stepRow(overrides: {
  status?: AssistantTaskStepStatus;
  attemptNo?: number;
  error?: Record<string, unknown> | null;
} = {}) {
  return {
    id: STEP_ID,
    stepKey: 's1',
    planVersion: 1,
    status: overrides.status ?? AssistantTaskStepStatus.FAILED,
    attemptNo: overrides.attemptNo ?? 1,
    error: overrides.error === undefined
      ? { code: 'STEP_EXECUTION_ERROR', message: '连接超时' }
      : overrides.error,
  };
}

function createHarness(options: {
  step?: ReturnType<typeof stepRow> | null;
  failedSteps?: Array<{ id: string; error: Record<string, unknown> | null }>;
  waitingSteps?: Array<{ id: string; stepKey: string }>;
  snapshotSteps?: Array<{ stepKey: string; status: string; summary: string | null }>;
  planSteps?: Array<{ stepKey: string; title: string | null }>;
  interaction?: Record<string, unknown> | null;
  decision?: Decision;
  escalateMoved?: boolean;
  scheduleSucceeded?: boolean;
} = {}) {
  const step = options.step === undefined ? stepRow() : options.step;
  const snapshotSteps = options.snapshotSteps ?? [
    { stepKey: 's1', status: 'FAILED', summary: null },
  ];
  const prisma: Record<string, any> = {
    $transaction: jest.fn().mockImplementation((callback: (transaction: unknown) => unknown) => callback({})),
    assistantTask: {
      findUnique: jest.fn().mockResolvedValue({
        id: TASK_ID,
        tenantId: TENANT_ID,
        userId: '60000000-0000-0000-0000-000000000001',
        membershipId: MEMBERSHIP_ID,
        goal: '完成季度销售分析',
        planVersion: 1,
      }),
    },
    assistantTaskStep: {
      findFirst: jest.fn().mockResolvedValue(step),
      findMany: jest.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        if (args.where.status === 'FAILED') return Promise.resolve(options.failedSteps ?? []);
        if (args.where.status === 'WAITING_USER') return Promise.resolve(options.waitingSteps ?? []);
        return Promise.resolve(snapshotSteps);
      }),
    },
    assistantTaskPlan: {
      findUnique: jest.fn().mockResolvedValue({
        steps: (options.planSteps ?? [{ stepKey: 's1', title: '收集数据' }]).map((row) => ({
          ...row,
          dependsOn: [],
          assignee: null,
          brief: null,
        })),
      }),
    },
    assistantTaskInteraction: {
      findFirst: jest.fn().mockResolvedValue(options.interaction ?? null),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const state = {
    scheduleStepRetry: jest.fn().mockResolvedValue(options.scheduleSucceeded ?? true),
    escalateStepInTransaction: jest.fn().mockResolvedValue(options.escalateMoved ?? true),
    applyFailureDecision: jest.fn().mockResolvedValue(true),
  };
  const interactions = { createInTransaction: jest.fn().mockResolvedValue({ id: 'i-1' }) };
  const decider = {
    decide: jest.fn().mockResolvedValue(
      options.decision ?? { choice: 'retry', confidence: 1, rationale: 'rule' },
    ),
  };
  const service = new FailureHandlingService(
    prisma as unknown as PrismaService,
    state as unknown as StepStateService,
    interactions as unknown as InteractionService,
    decider as unknown as OrchestrationDecider,
  );
  return { service, prisma, state, interactions, decider };
}
