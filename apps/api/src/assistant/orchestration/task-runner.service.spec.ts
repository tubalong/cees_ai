import type { PrismaService } from '../../database/prisma.service';
import { InteractionService } from './interaction.service';
import { StepRunnerService } from './step-runner.service';
import { StepStateService } from './step-state.service';
import { TaskEventService } from './task-event.service';
import { TaskRunnerService } from './task-runner.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const TASK_ID = '20000000-0000-0000-0000-000000000001';
const STEP_ONE = '30000000-0000-0000-0000-000000000001';
const STEP_TWO = '30000000-0000-0000-0000-000000000002';

interface StepRow {
  id: string;
  stepKey: string;
  status: string;
  dependsOn: string[];
  leaseExpiresAt: Date | null;
  error?: { code: string; message: string } | null;
}

describe('TaskRunnerService', () => {
  it('claims the task lease, advances dependencies and dispatches ready steps in order', async () => {
    const harness = createHarness({
      steps: [
        { id: STEP_ONE, stepKey: 's1', status: 'READY', dependsOn: [], leaseExpiresAt: null },
        { id: STEP_TWO, stepKey: 's2', status: 'PENDING', dependsOn: ['s1'], leaseExpiresAt: null },
      ],
    });

    await harness.service.startTask(TASK_ID);
    await waitForFinalize(harness);

    // 认领：只有从未认领或租约过期的任务可被抢占。
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: TASK_ID,
        status: 'RUNNING',
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: expect.any(Date) } }],
      }),
      data: expect.objectContaining({
        executionOwner: expect.any(String),
        leaseExpiresAt: expect.any(Date),
        heartbeatAt: expect.any(Date),
      }),
    }));
    // 步骤串行：先 s1；s1 成功后依赖推进使 s2 就绪并接续执行。
    expect(harness.stepRunner.executeStep.mock.calls.map((call: any[]) => call[0].stepId))
      .toEqual([STEP_ONE, STEP_TWO]);
    expect(harness.stepRunner.executeStep.mock.calls[0]![0]).toEqual(expect.objectContaining({
      taskId: TASK_ID,
      executionOwner: harness.owner(),
      signal: expect.any(AbortSignal),
    }));
    expect(harness.stepState.markStepReady).toHaveBeenCalledWith(TASK_ID, STEP_TWO);
    expect(harness.stepState.skipStep).not.toHaveBeenCalled();
    // 终态：全部步骤成功 → COMPLETED 与 task_completed 事件原子提交。
    expect(harness.tx.assistantTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TASK_ID, status: 'RUNNING', executionOwner: harness.owner() },
      data: expect.objectContaining({ status: 'COMPLETED', failedReason: null }),
    }));
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      { type: 'task_completed' },
    );
    // 终态清理：未决挂起随任务终态批量关闭（与终态事件同一事务）。
    expect(harness.interactions.closePendingForTaskInTransaction).toHaveBeenCalledWith(
      harness.tx,
      { taskId: TASK_ID, tenantId: TENANT_ID, status: 'CANCELLED', now: expect.any(Date) },
    );
  });

  it('cascades a failed dependency to skipped steps and finalizes the task as failed', async () => {
    const harness = createHarness({
      steps: [
        { id: STEP_ONE, stepKey: 's1', status: 'READY', dependsOn: [], leaseExpiresAt: null },
        { id: STEP_TWO, stepKey: 's2', status: 'PENDING', dependsOn: ['s1'], leaseExpiresAt: null },
      ],
      executeStepBehavior: 'fail',
      executeStepError: { code: 'AI_SERVICE_ERROR', message: '检索服务不可用' },
    });

    await harness.service.startTask(TASK_ID);
    await waitForFinalize(harness);

    expect(harness.stepState.skipStep).toHaveBeenCalledWith(expect.objectContaining({
      taskId: TASK_ID,
      stepId: STEP_TWO,
      stepKey: 's2',
      tenantId: TENANT_ID,
      reason: '前置步骤未成功完成，本步骤已跳过',
    }));
    expect(harness.tx.assistantTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        failedReason: '检索服务不可用',
      }),
    }));
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      { type: 'task_failed', reason: '检索服务不可用' },
    );
  });

  it('fails the step when the executor throws and converges the task to failed', async () => {
    const harness = createHarness({
      steps: [{ id: STEP_ONE, stepKey: 's1', status: 'READY', dependsOn: [], leaseExpiresAt: null }],
      executeStepBehavior: 'throw',
    });

    await harness.service.startTask(TASK_ID);
    await waitForFinalize(harness);

    expect(harness.stepState.failStep).toHaveBeenCalledWith(expect.objectContaining({
      code: 'STEP_EXECUTION_ERROR',
      stepId: STEP_ONE,
      detail: expect.stringContaining('ai-service connection refused'),
    }));
    expect(harness.tx.assistantTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      expect.objectContaining({ type: 'task_failed' }),
    );
  });

  it('skips stale tasks whose steps are still actively leased and reschedules the rest', async () => {
    const harness = createHarness({
      staleTasks: [{ id: 'task-1' }, { id: 'task-2' }],
      activeStepTaskIds: ['task-1'],
    });
    const now = new Date('2026-09-28T10:00:00.000Z');

    await expect(harness.service.recoverStaleTasks(now)).resolves.toBe(1);

    // task-1 有活跃步骤租约（可能只是心跳抖动）：不武断收束，也不认领。
    expect(harness.stepState.recoverStaleSteps).toHaveBeenCalledTimes(1);
    expect(harness.stepState.recoverStaleSteps).toHaveBeenCalledWith('task-2', now);
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-2' }),
    }));
    expect(harness.stepRunner.executeStep).not.toHaveBeenCalled();
  });

  it('exits the drive loop immediately when another instance owns the task', async () => {
    const harness = createHarness({
      steps: [{ id: STEP_ONE, stepKey: 's1', status: 'READY', dependsOn: [], leaseExpiresAt: null }],
      claimedOwnerOverride: 'other-instance:1:xyz',
    });

    await harness.service.startTask(TASK_ID);
    await flush();

    expect(harness.stepRunner.executeStep).not.toHaveBeenCalled();
    expect(harness.taskEvents.appendInTransaction).not.toHaveBeenCalled();
  });

  it('marks the task waiting for the user when a suspended step still has pending interactions', async () => {
    const harness = createHarness({
      steps: [{ id: STEP_ONE, stepKey: 's1', status: 'WAITING_USER', dependsOn: [], leaseExpiresAt: null }],
      pendingTaskIds: [TASK_ID],
    });

    await harness.service.startTask(TASK_ID);
    await waitForTaskWaiting(harness);

    // 未决事项未解决：不派发、不终态；RUNNING → WAITING_USER 并释放任务租约。
    expect(harness.stepRunner.executeStep).not.toHaveBeenCalled();
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledWith({
      where: { id: TASK_ID, status: 'RUNNING', executionOwner: harness.owner() },
      data: {
        status: 'WAITING_USER',
        executionOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: expect.any(Date),
      },
    });
    expect(harness.taskEvents.appendInTransaction).not.toHaveBeenCalled();
  });

  it('keeps dispatching ready steps while another step waits on a pending interaction', async () => {
    const harness = createHarness({
      steps: [
        { id: STEP_ONE, stepKey: 's1', status: 'WAITING_USER', dependsOn: [], leaseExpiresAt: null },
        { id: STEP_TWO, stepKey: 's2', status: 'READY', dependsOn: [], leaseExpiresAt: null },
      ],
      pendingTaskIds: [TASK_ID],
    });

    await harness.service.startTask(TASK_ID);
    await waitForTaskWaiting(harness);

    // 挂起不阻塞：就绪步骤先派发；可执行步骤全部收敛后才转 WAITING_USER。
    expect(harness.stepRunner.executeStep).toHaveBeenCalledTimes(1);
    expect(harness.stepRunner.executeStep.mock.calls[0]![0].stepId).toBe(STEP_TWO);
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: TASK_ID, status: 'RUNNING' }),
      data: expect.objectContaining({ status: 'WAITING_USER' }),
    }));
  });

  it('re-dispatches the suspended step once its interactions are resolved', async () => {
    const harness = createHarness({
      steps: [{ id: STEP_ONE, stepKey: 's1', status: 'WAITING_USER', dependsOn: [], leaseExpiresAt: null }],
    });

    await harness.service.startTask(TASK_ID);
    await waitForFinalize(harness);

    // 无未决事项：挂起步骤直接重新派发（断点续跑，不经过 READY 重规划）。
    expect(harness.interactions.hasPendingForTask).toHaveBeenCalledWith(TASK_ID);
    expect(harness.stepRunner.executeStep).toHaveBeenCalledTimes(1);
    expect(harness.stepRunner.executeStep.mock.calls[0]![0].stepId).toBe(STEP_ONE);
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      { type: 'task_completed' },
    );
  });

  it('resumes waiting tasks without pending interactions during the recovery scan', async () => {
    const harness = createHarness({
      waitingTasks: [{ id: 'task-1' }, { id: 'task-2' }],
      pendingTaskIds: ['task-1'],
    });

    await expect(harness.service.resumeWaitingTasks()).resolves.toBe(1);

    // task-1 仍有未决事项：保持挂起，不迁移不调度。
    expect(harness.prisma.assistantTask.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-1' }),
    }));
    // task-2 已无未决事项：WAITING_USER → RUNNING 后重新认领调度。
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-2', status: 'WAITING_USER' },
      data: {
        status: 'RUNNING',
        executionOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: expect.any(Date),
      },
    });
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-2', status: 'RUNNING' }),
      data: expect.objectContaining({ executionOwner: expect.any(String) }),
    }));
  });
});

function createHarness(options: {
  steps?: StepRow[];
  staleTasks?: Array<{ id: string }>;
  waitingTasks?: Array<{ id: string }>;
  pendingTaskIds?: string[];
  activeStepTaskIds?: string[];
  claimedOwnerOverride?: string;
  executeStepBehavior?: 'succeed' | 'fail' | 'throw';
  executeStepError?: { code: string; message: string };
} = {}) {
  const steps = options.steps ?? [];
  let capturedOwner: string | null = null;
  const findStep = (id: string) => steps.find((step) => step.id === id);

  const tx = {
    assistantTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma: Record<string, any> = {
    $transaction: jest.fn().mockImplementation((callback: (transaction: unknown) => unknown) => callback(tx)),
    assistantTask: {
      findUnique: jest.fn().mockImplementation((args: { where: { id: string } }) => Promise.resolve({
        id: args.where.id,
        tenantId: TENANT_ID,
        status: 'RUNNING',
        executionOwner: options.claimedOwnerOverride ?? capturedOwner,
        planVersion: 1,
      })),
      updateMany: jest.fn().mockImplementation((args: { data?: { executionOwner?: string } }) => {
        if (args.data?.executionOwner) capturedOwner = args.data.executionOwner;
        return Promise.resolve({ count: 1 });
      }),
      findMany: jest.fn().mockImplementation((args: { where?: { status?: string } }) => Promise.resolve(
        args.where?.status === 'WAITING_USER'
          ? (options.waitingTasks ?? [])
          : (options.staleTasks ?? []),
      )),
    },
    assistantTaskStep: {
      findMany: jest.fn().mockImplementation((args: { where: { taskId: string } }) => Promise.resolve(
        args.where.taskId === TASK_ID ? steps.map((step) => ({ ...step })) : [],
      )),
      findFirst: jest.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        // 恢复扫描的活跃步骤探测：status + leaseExpiresAt 同时出现。
        if (args.where.status === 'RUNNING' && args.where.leaseExpiresAt) {
          const active = (options.activeStepTaskIds ?? []).includes(String(args.where.taskId));
          return Promise.resolve(active ? { id: 'active-step' } : null);
        }
        const failed = steps.find((step) => step.status === 'FAILED');
        return Promise.resolve(failed ? { error: failed.error ?? null } : null);
      }),
      findUnique: jest.fn().mockImplementation((args: { where: { id: string } }) => {
        const step = findStep(args.where.id);
        return Promise.resolve(step ? { stepKey: step.stepKey, status: step.status } : null);
      }),
    },
  };

  const stepState = {
    heartbeatTask: jest.fn().mockResolvedValue(true),
    markStepReady: jest.fn().mockImplementation(async (_taskId: string, stepId: string) => {
      const step = findStep(stepId);
      if (step && step.status === 'PENDING') {
        step.status = 'READY';
        return true;
      }
      return false;
    }),
    skipStep: jest.fn().mockImplementation(async (input: { stepId: string }) => {
      const step = findStep(input.stepId);
      if (step && step.status === 'PENDING') {
        step.status = 'SKIPPED';
        return true;
      }
      return false;
    }),
    recoverStaleSteps: jest.fn().mockResolvedValue(0),
    failStep: jest.fn().mockImplementation(async (input: {
      stepId: string;
      code: string;
      reason: string;
      detail?: string;
    }) => {
      const step = findStep(input.stepId);
      if (step && step.status === 'RUNNING') {
        step.status = 'FAILED';
        step.error = { code: input.code, message: input.detail ?? input.reason };
        return true;
      }
      return false;
    }),
  };

  const stepRunner = {
    executeStep: jest.fn().mockImplementation(async (input: { stepId: string }) => {
      const step = findStep(input.stepId);
      if (options.executeStepBehavior === 'throw') {
        if (step) step.status = 'RUNNING';
        throw new Error('ai-service connection refused');
      }
      if (options.executeStepBehavior === 'fail') {
        if (step) {
          step.status = 'FAILED';
          step.error = options.executeStepError ?? { code: 'STEP_EXECUTION_ERROR', message: '步骤执行失败' };
        }
        return;
      }
      if (step) step.status = 'SUCCEEDED';
    }),
  };

  const taskEvents = { appendInTransaction: jest.fn().mockResolvedValue(1) };
  const interactions = {
    closePendingForTaskInTransaction: jest.fn().mockResolvedValue(0),
    expireOverdueInteractions: jest.fn().mockResolvedValue(0),
    hasPendingForTask: jest.fn().mockImplementation(
      async (taskId: string) => (options.pendingTaskIds ?? []).includes(taskId),
    ),
  };
  const service = new TaskRunnerService(
    prisma as unknown as PrismaService,
    stepRunner as unknown as StepRunnerService,
    stepState as unknown as StepStateService,
    taskEvents as unknown as TaskEventService,
    interactions as unknown as InteractionService,
  );
  return {
    service,
    prisma,
    tx,
    steps,
    stepState,
    stepRunner,
    taskEvents,
    interactions,
    owner: () => capturedOwner,
  };
}

/** 等待后台调度循环完成终态提交（finalize 才会写任务事件）。 */
async function waitForFinalize(harness: { taskEvents: { appendInTransaction: jest.Mock } }): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (harness.taskEvents.appendInTransaction.mock.calls.length > 0) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('task drive loop did not finalize in time');
}

/** 等待任务被挂起（markTaskWaitingUser 的迁移信号）。 */
async function waitForTaskWaiting(harness: { prisma: Record<string, any> }): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const marked = harness.prisma.assistantTask.updateMany.mock.calls.some(
      (call: unknown[]) => (call[0] as { data?: { status?: string } }).data?.status === 'WAITING_USER',
    );
    if (marked) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('task was not marked WAITING_USER in time');
}

async function flush(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
