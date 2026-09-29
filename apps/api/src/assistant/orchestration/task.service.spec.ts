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

  it('keeps the task waiting while a failure awaits a plan revision', async () => {
    const harness = createHarness({ awaitingReplan: true });

    await harness.service.resumeAfterInteractionResolved(TASK_ID);

    // 选择「调整计划」：保持挂起等待重排草案与再次确认，不恢复执行。
    expect(harness.failureHandling.applyResolvedFailureDecisions).toHaveBeenCalledWith(TASK_ID);
    expect(harness.failureHandling.hasAwaitingReplan).toHaveBeenCalledWith(TASK_ID);
    expect(harness.interactions.hasPendingForTask).not.toHaveBeenCalled();
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

describe('TaskService.reviseFromTool', () => {
  it('appends a new plan version in the draft phase and records the revision events', async () => {
    const harness = createReviseHarness({
      planFindFirstResults: [null, planRow({ version: 1 }), planRow({ version: 2, createdBy: 'USER' })],
    });

    await harness.service.reviseFromTool({
      taskId: TASK_ID,
      toolCallId: 'tool-call-1',
      steps: [{ requirement: '重新汇总', assigneeAgentId: 'agent-1' }],
      agentNames: new Map([['agent-1', '执行同事']]),
    });

    // v1 → v2：createdBy=USER 标识「调整计划」产生的版本。
    expect(harness.plans.createPlanVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: TASK_ID, version: 2, createdBy: 'USER' }),
    );
    // 事件：调整请求（去重写）+ 新版本计划就绪；草案期不改任务状态。
    const events = harness.taskEvents.appendInTransaction.mock.calls.map((call) => call[3]);
    expect(events).toEqual([
      { type: 'plan_revision_requested', version: 1 },
      expect.objectContaining({ type: 'plan_ready', version: 2, steps: expect.any(Array) }),
    ]);
    expect(harness.prisma.assistantTask.updateMany).not.toHaveBeenCalled();
  });

  it('returns the existing version for a replayed tool call without appending', async () => {
    const harness = createReviseHarness({
      planFindFirstResults: [planRow({ id: 'plan-x', version: 2 }), planRow({ version: 2 })],
    });

    await harness.service.reviseFromTool({
      taskId: TASK_ID,
      toolCallId: 'tool-call-1',
      steps: [{ requirement: '重新汇总', assigneeAgentId: 'agent-1' }],
      agentNames: new Map([['agent-1', '执行同事']]),
    });

    expect(harness.plans.createPlanVersion).not.toHaveBeenCalled();
    expect(harness.taskEvents.appendInTransaction).not.toHaveBeenCalled();
  });

  it('moves an executed task back to pending confirmation and accepts a valid carry anchor', async () => {
    const harness = createReviseHarness({
      task: waitingTask(),
      planFindFirstResults: [null, planRow({ version: 1 }), planRow({ version: 2, createdBy: 'USER' })],
      stepFindManyResults: [[{ stepKey: 's1' }], []],
    });

    await harness.service.reviseFromTool({
      taskId: TASK_ID,
      toolCallId: 'tool-call-2',
      steps: [
        { requirement: '重新汇总', assigneeAgentId: 'agent-1', carriedFromStepKey: 's1' },
        { requirement: '出报告', assigneeAgentId: 'agent-1' },
      ],
      agentNames: new Map([['agent-1', '执行同事']]),
    });

    // 已成功步骤可沿用（s1 命中已成功集合）；任务回到待确认等待再次确认。
    expect(harness.plans.createPlanVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ version: 2, createdBy: 'USER' }),
    );
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledWith({
      where: { id: TASK_ID, tenantId: TENANT_ID, status: 'WAITING_USER' },
      data: expect.objectContaining({
        status: 'PENDING_CONFIRM',
        executionOwner: null,
        leaseExpiresAt: null,
      }),
    });
  });

  it('refuses to revise while a step is still running', async () => {
    const harness = createReviseHarness({ task: waitingTask(), runningSteps: 1, planFindFirstResults: [null] });

    await expect(harness.service.reviseFromTool({
      taskId: TASK_ID,
      toolCallId: 'tool-call-3',
      steps: [{ requirement: '重新汇总', assigneeAgentId: 'agent-1' }],
      agentNames: new Map([['agent-1', '执行同事']]),
    })).rejects.toMatchObject({ response: { code: 'TASK_REVISE_STEPS_RUNNING' } });
    expect(harness.plans.createPlanVersion).not.toHaveBeenCalled();
  });

  it('refuses to revise while pending interactions remain', async () => {
    const harness = createReviseHarness({
      task: waitingTask(),
      pendingInteraction: true,
      planFindFirstResults: [null],
    });

    await expect(harness.service.reviseFromTool({
      taskId: TASK_ID,
      toolCallId: 'tool-call-4',
      steps: [{ requirement: '重新汇总', assigneeAgentId: 'agent-1' }],
      agentNames: new Map([['agent-1', '执行同事']]),
    })).rejects.toMatchObject({ response: { code: 'TASK_REVISE_INTERACTION_PENDING' } });
    expect(harness.plans.createPlanVersion).not.toHaveBeenCalled();
  });

  it('rejects a carry anchor that is not a succeeded step of the running version', async () => {
    const harness = createReviseHarness({
      task: waitingTask(),
      planFindFirstResults: [null, planRow({ version: 1 })],
      stepFindManyResults: [[]],
    });

    await expect(harness.service.reviseFromTool({
      taskId: TASK_ID,
      toolCallId: 'tool-call-5',
      steps: [{ requirement: '重新汇总', assigneeAgentId: 'agent-1', carriedFromStepKey: 's3' }],
      agentNames: new Map([['agent-1', '执行同事']]),
    })).rejects.toMatchObject({ response: { code: 'TASK_REVISE_CARRY_INVALID' } });
    expect(harness.plans.createPlanVersion).not.toHaveBeenCalled();
  });

  it('rejects duplicated carry anchors without touching the database', async () => {
    const harness = createReviseHarness({ task: waitingTask() });

    await expect(harness.service.reviseFromTool({
      taskId: TASK_ID,
      toolCallId: 'tool-call-6',
      steps: [
        { requirement: 'A', assigneeAgentId: 'agent-1', carriedFromStepKey: 's1' },
        { requirement: 'B', assigneeAgentId: 'agent-1', carriedFromStepKey: 's1' },
      ],
      agentNames: new Map([['agent-1', '执行同事']]),
    })).rejects.toMatchObject({ response: { code: 'TASK_REVISE_CARRY_DUPLICATED' } });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects revision when the task is not in a stable state', async () => {
    const harness = createReviseHarness({
      task: { ...waitingTask(), status: 'RUNNING' },
    });

    await expect(harness.service.reviseFromTool({
      taskId: TASK_ID,
      toolCallId: 'tool-call-7',
      steps: [{ requirement: '重新汇总', assigneeAgentId: 'agent-1' }],
      agentNames: new Map([['agent-1', '执行同事']]),
    })).rejects.toMatchObject({ response: { code: 'TASK_NOT_REVISABLE' } });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('TaskService.confirm revise', () => {
  it('records a plan revision request event when the user asks to adjust', async () => {
    const harness = createReviseHarness({
      planFindFirstResults: [planRow({ version: 1 }), planRow({ version: 1 })],
    });

    await harness.service.confirm(TASK_ID, { decision: 'revise', answers: [] });

    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      TASK_ID,
      TENANT_ID,
      { type: 'plan_revision_requested', version: 1 },
    );
    // 无答复时不改草案快照。
    expect(harness.prisma.assistantTaskPlan.update).not.toHaveBeenCalled();
  });

  it('does not duplicate the revision request event when the latest event already is one', async () => {
    const harness = createReviseHarness({
      latestEvent: { payload: { type: 'plan_revision_requested', seq: 3, version: 1 } },
      planFindFirstResults: [planRow({ version: 1 }), planRow({ version: 1 })],
    });

    await harness.service.confirm(TASK_ID, { decision: 'revise', answers: [] });

    expect(harness.taskEvents.appendInTransaction).not.toHaveBeenCalled();
  });
});

describe('TaskService.confirm start', () => {
  it('re-materializes the latest plan with the executed version anchors on re-confirmation', async () => {
    const harness = createConfirmHarness({ taskPlanVersion: 1, planVersion: 2 });

    await harness.service.confirm(TASK_ID, { decision: 'start', answers: [] });

    // 执行中重排后的再次确认：抢占 PENDING_CONFIRM → RUNNING 并物化最新版本，
    // 以旧执行版本（1）为锚复用已完成步骤产出。
    expect(harness.tx.assistantTask.updateMany).toHaveBeenCalledWith({
      where: { id: TASK_ID, tenantId: TENANT_ID, status: 'PENDING_CONFIRM' },
      data: { status: 'RUNNING', planVersion: 2 },
    });
    expect(harness.plans.materializeSteps).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({ planVersion: 2, carryFromPlanVersion: 1 }),
    );
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      expect.objectContaining({ type: 'plan_confirmed', version: 2 }),
    );
    expect(harness.runner.startTask).toHaveBeenCalledWith(TASK_ID);
  });

  it('materializes the first version without carry anchors in the draft phase', async () => {
    const harness = createConfirmHarness({ taskPlanVersion: 0, planVersion: 1 });

    await harness.service.confirm(TASK_ID, { decision: 'start' });

    expect(harness.plans.materializeSteps).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({ planVersion: 1 }),
    );
    const materializeArgs = harness.plans.materializeSteps.mock.calls[0]![1] as Record<string, unknown>;
    expect('carryFromPlanVersion' in materializeArgs).toBe(false);
  });

  it('rejects a stale plan that is not newer than the materialized version', async () => {
    const harness = createConfirmHarness({ taskPlanVersion: 2, planVersion: 2 });

    await expect(harness.service.confirm(TASK_ID, { decision: 'start' }))
      .rejects.toMatchObject({ response: { code: 'TASK_PLAN_REVISION_CONFLICT' } });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.runner.startTask).not.toHaveBeenCalled();
  });
});

function waitingTask(): Record<string, unknown> {
  return {
    id: TASK_ID,
    tenantId: TENANT_ID,
    membershipId: MEMBERSHIP_ID,
    status: 'WAITING_USER',
    planVersion: 1,
    title: '月度报告',
    goal: '生成月度报告',
  };
}

function planRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'plan-1',
    version: 1,
    createdBy: 'SYSTEM',
    confirmedAt: null,
    createdAt: new Date('2026-09-29T00:00:00Z'),
    steps: [],
    clarifications: null,
    ...overrides,
  };
}

function createReviseHarness(options: {
  task?: Record<string, unknown>;
  planFindFirstResults?: Array<Record<string, unknown> | null>;
  stepFindManyResults?: Array<Array<Record<string, unknown>>>;
  runningSteps?: number;
  pendingInteraction?: boolean;
  latestEvent?: Record<string, unknown> | null;
} = {}) {
  const task = options.task ?? {
    id: TASK_ID,
    tenantId: TENANT_ID,
    membershipId: MEMBERSHIP_ID,
    status: 'PENDING_CONFIRM',
    planVersion: 0,
    title: '月度报告',
    goal: '生成月度报告',
  };
  const planQueue = [...(options.planFindFirstResults ?? [])];
  const stepQueue = [...(options.stepFindManyResults ?? [])];
  const prisma = {
    assistantTask: {
      findFirst: jest.fn().mockResolvedValue(task),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    assistantTaskPlan: {
      findFirst: jest.fn(async () => (planQueue.length > 0 ? planQueue.shift() : null)),
      update: jest.fn().mockResolvedValue({}),
    },
    assistantTaskStep: {
      count: jest.fn().mockResolvedValue(options.runningSteps ?? 0),
      findMany: jest.fn(async () => (stepQueue.length > 0 ? stepQueue.shift() : [])),
    },
    assistantTaskEvent: {
      findFirst: jest.fn().mockResolvedValue(options.latestEvent ?? null),
    },
    assistantAgent: { findMany: jest.fn().mockResolvedValue([]) },
    assistantTaskInteraction: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (transaction: unknown) => Promise<unknown>) => callback(prisma),
  );
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
  const plans = {
    normalizeSteps: jest.fn((steps: Array<Record<string, unknown>>) => steps.map((step, index) => ({
      stepNo: index + 1,
      stepKey: `s${index + 1}`,
      requirement: step.requirement,
      assigneeAgentId: step.assigneeAgentId,
      assigneeName: '执行同事',
      expectedOutput: null,
      dependsOnStepKeys: [],
      ...(step.carriedFromStepKey ? { carriedFromStepKey: step.carriedFromStepKey } : {}),
    }))),
    normalizeClarifications: jest.fn(() => []),
    createPlanVersion: jest.fn().mockResolvedValue({}),
    assertAnswersSubmittable: jest.fn(),
  };
  const taskEvents = { appendInTransaction: jest.fn().mockResolvedValue(2) };
  const interactions = {
    hasPendingForTask: jest.fn().mockResolvedValue(options.pendingInteraction ?? false),
  };
  const service = new TaskService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
    taskEvents as unknown as TaskEventService,
    plans as unknown as PlanService,
    {} as unknown as TaskRunnerService,
    {} as unknown as StepStateService,
    interactions as unknown as InteractionService,
    {} as unknown as FailureHandlingService,
  );
  return { service, prisma, plans, taskEvents, interactions };
}

function createHarness(options: {
  task?: Record<string, unknown> | null;
  taskStatus?: string;
  pending?: boolean;
  resumedCount?: number;
  awaitingReplan?: boolean;
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
  const failureHandling = {
    applyResolvedFailureDecisions: jest.fn().mockResolvedValue(0),
    hasAwaitingReplan: jest.fn().mockResolvedValue(options.awaitingReplan ?? false),
  };
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

function createConfirmHarness(options: {
  taskPlanVersion?: number;
  planVersion?: number;
} = {}) {
  const planVersion = options.planVersion ?? 1;
  const task = {
    id: TASK_ID,
    tenantId: TENANT_ID,
    membershipId: MEMBERSHIP_ID,
    status: 'PENDING_CONFIRM',
    planVersion: options.taskPlanVersion ?? 0,
    title: '月度报告',
    goal: '生成月度报告',
  };
  const plan = {
    id: '30000000-0000-0000-0000-000000000001',
    version: planVersion,
    createdBy: 'AI',
    confirmedAt: null,
    createdAt: new Date('2026-09-29T08:00:00.000Z'),
    steps: [{
      stepNo: 1,
      stepKey: 's1',
      requirement: '汇总销售数据',
      assigneeAgentId: 'agent-1',
      assigneeName: '数据助理',
      expectedOutput: null,
      dependsOnStepKeys: [],
    }],
    clarifications: null,
  };
  const tx = {
    assistantTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    assistantTaskPlan: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    assistantTask: {
      findFirst: jest.fn().mockResolvedValue(task),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    assistantTaskPlan: {
      findFirst: jest.fn().mockResolvedValue(plan),
      update: jest.fn().mockResolvedValue({}),
    },
    assistantTaskStep: { findMany: jest.fn().mockResolvedValue([]) },
    assistantTaskInteraction: { findMany: jest.fn().mockResolvedValue([]) },
    assistantAgent: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (transaction: unknown) => Promise<unknown>) => callback(tx),
  );
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
  const plans = {
    assertAnswersSubmittable: jest.fn(),
    assertAnswersComplete: jest.fn(),
    mergeAnswers: jest.fn().mockReturnValue([]),
    materializeSteps: jest.fn().mockResolvedValue(undefined),
  };
  const taskEvents = { appendInTransaction: jest.fn().mockResolvedValue(3) };
  const runner = { startTask: jest.fn().mockResolvedValue(undefined) };
  const service = new TaskService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
    taskEvents as unknown as TaskEventService,
    plans as unknown as PlanService,
    runner as unknown as TaskRunnerService,
    {} as unknown as StepStateService,
    {} as unknown as InteractionService,
    {} as unknown as FailureHandlingService,
  );
  return { service, prisma, tx, plans, taskEvents, runner };
}
