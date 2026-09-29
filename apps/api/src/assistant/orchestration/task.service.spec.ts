import type { PrismaService } from '../../database/prisma.service';
import type { TenantContext } from '../../tenant/tenant-context';
import type { FailureHandlingService } from './failure-handling.service';
import type { InteractionService } from './interaction.service';
import type { PlanService } from './plan.service';
import { TaskService } from './task.service';
import type { TaskEventService } from './task-event.service';
import type { TaskRunnerService } from './task-runner.service';
import type { StepStateService } from './step-state.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const TASK_ID = '20000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';

describe('TaskService', () => {
  it('resumes a waiting task without pending interactions and re-schedules it', async () => {
    const harness = createHarness();

    await harness.service.resumeAfterInteractionResolved(TASK_ID);

    // 归属校验：任务按当前成员过滤查询，不属于则 404。
    expect(harness.prisma.assistantTask.findFirst).toHaveBeenCalledWith({
      where: { id: TASK_ID, tenantId: TENANT_ID, membershipId: MEMBERSHIP_ID },
    });
    // 失败裁决先行落状态（重试/跳过/终止），再做挂起恢复判定。
    expect(harness.failureHandling.applyResolvedFailureDecisions).toHaveBeenCalledWith(TASK_ID);
    expect(harness.interactions.hasPendingForTask).toHaveBeenCalledWith(TASK_ID);
    // WAITING_USER → RUNNING：释放执行权与租约，交回调度器重新认领（断点续跑）。
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledWith({
      where: { id: TASK_ID, tenantId: TENANT_ID, status: 'WAITING_USER' },
      data: {
        status: 'RUNNING',
        executionOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: expect.any(Date),
      },
    });
    expect(harness.runner.startTask).toHaveBeenCalledWith(TASK_ID);
  });

  it('keeps the task waiting while it still has pending interactions', async () => {
    const harness = createHarness({ pending: true });

    await harness.service.resumeAfterInteractionResolved(TASK_ID);

    // 失败裁决先行落状态（幂等），但仍有未决事项：任务保持挂起。
    expect(harness.failureHandling.applyResolvedFailureDecisions).toHaveBeenCalledWith(TASK_ID);
    expect(harness.prisma.assistantTask.updateMany).not.toHaveBeenCalled();
    expect(harness.runner.startTask).not.toHaveBeenCalled();
  });

  it('ignores tasks that are not waiting for the user', async () => {
    const harness = createHarness({ taskStatus: 'RUNNING' });

    await harness.service.resumeAfterInteractionResolved(TASK_ID);

    expect(harness.failureHandling.applyResolvedFailureDecisions).not.toHaveBeenCalled();
    expect(harness.interactions.hasPendingForTask).not.toHaveBeenCalled();
    expect(harness.prisma.assistantTask.updateMany).not.toHaveBeenCalled();
    expect(harness.runner.startTask).not.toHaveBeenCalled();
  });

  it('returns 404 semantics when the task does not belong to the current member', async () => {
    const harness = createHarness({ task: null });

    await expect(harness.service.resumeAfterInteractionResolved(TASK_ID))
      .rejects.toMatchObject({ response: { code: 'TASK_NOT_FOUND' } });
    expect(harness.prisma.assistantTask.updateMany).not.toHaveBeenCalled();
  });

  it('does not re-schedule when the resume update loses the race', async () => {
    const harness = createHarness({ resumedCount: 0 });

    await harness.service.resumeAfterInteractionResolved(TASK_ID);

    // 条件更新失败（并发方已迁移）：静默返回，不重复调度。
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.runner.startTask).not.toHaveBeenCalled();
  });
});

function createHarness(options: {
  task?: Record<string, unknown> | null;
  taskStatus?: string;
  pending?: boolean;
  resumedCount?: number;
} = {}) {
  const task = options.task === undefined
    ? {
      id: TASK_ID,
      tenantId: TENANT_ID,
      membershipId: MEMBERSHIP_ID,
      status: options.taskStatus ?? 'WAITING_USER',
    }
    : options.task;
  const prisma = {
    assistantTask: {
      findFirst: jest.fn().mockResolvedValue(task),
      updateMany: jest.fn().mockResolvedValue({ count: options.resumedCount ?? 1 }),
    },
  };
  const tenantContext = {
    require: () => ({
      tenantId: TENANT_ID,
      userId: '60000000-0000-0000-0000-000000000001',
      membershipId: MEMBERSHIP_ID,
      requestId: 'req-1',
      roles: [],
      permissions: [],
    }),
  };
  const interactions = {
    hasPendingForTask: jest.fn().mockResolvedValue(options.pending ?? false),
  };
  const runner = { startTask: jest.fn().mockResolvedValue(undefined) };
  const failureHandling = { applyResolvedFailureDecisions: jest.fn().mockResolvedValue(0) };
  const service = new TaskService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
    {} as unknown as TaskEventService,
    {} as unknown as PlanService,
    runner as unknown as TaskRunnerService,
    {} as unknown as StepStateService,
    interactions as unknown as InteractionService,
    failureHandling as unknown as FailureHandlingService,
  );
  return { service, prisma, runner, interactions, failureHandling };
}
