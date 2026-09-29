import {
  AssistantTaskStepStatus,
  ManagedImageStatus,
  Prisma,
  ToolCallStatus,
} from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import { StepStateService } from './step-state.service';
import { TaskEventService } from './task-event.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const TASK_ID = '20000000-0000-0000-0000-000000000001';
const STEP_ID = '30000000-0000-0000-0000-000000000001';
const TOOL_CALL_ID = '40000000-0000-0000-0000-000000000001';
const EXECUTION_OWNER = 'api:test:owner';
const EXECUTION_TOKEN = '50000000-0000-0000-0000-000000000001';

describe('StepStateService', () => {
  it('renews the task, the running step and executing tools in one transaction', async () => {
    const harness = createHarness();
    const leaseExpiresAt = new Date('2026-09-28T10:01:00.000Z');

    await expect(harness.service.heartbeatTask({
      taskId: TASK_ID,
      executionOwner: EXECUTION_OWNER,
      leaseExpiresAt,
    })).resolves.toBe(true);

    expect(harness.tx.assistantTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: TASK_ID,
        status: 'RUNNING',
        executionOwner: EXECUTION_OWNER,
        leaseExpiresAt: { gt: expect.any(Date) },
      },
      data: { heartbeatAt: expect.any(Date), leaseExpiresAt },
    });
    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith({
      where: {
        taskId: TASK_ID,
        status: AssistantTaskStepStatus.RUNNING,
        executionOwner: EXECUTION_OWNER,
      },
      data: { heartbeatAt: expect.any(Date), leaseExpiresAt },
    });
    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith({
      where: {
        taskStep: { taskId: TASK_ID },
        status: ToolCallStatus.EXECUTING,
        executionToken: { not: null },
      },
      data: { leaseExpiresAt },
    });
  });

  it('refuses to renew an expired or cancelled task lease', async () => {
    const harness = createHarness({ taskUpdateCount: 0 });

    await expect(harness.service.heartbeatTask({
      taskId: TASK_ID,
      executionOwner: EXECUTION_OWNER,
      leaseExpiresAt: new Date(),
    })).resolves.toBe(false);

    // 租约已被他人接管/取消：不再触碰步骤与工具。
    expect(harness.tx.assistantTaskStep.updateMany).not.toHaveBeenCalled();
    expect(harness.tx.toolCall.updateMany).not.toHaveBeenCalled();
  });

  it('claims a ready step with its brief and appends step_started atomically', async () => {
    const harness = createHarness();

    await expect(harness.service.claimStep({
      taskId: TASK_ID,
      stepId: STEP_ID,
      tenantId: TENANT_ID,
      executionOwner: EXECUTION_OWNER,
      leaseExpiresAt: new Date('2026-09-28T10:01:00.000Z'),
      brief: { taskGoal: '季度分析' } as Prisma.InputJsonObject,
      stepKey: 's1',
      stepNo: 1,
      stepTitle: '收集数据',
      assigneeName: '数据助理',
    })).resolves.toBe(true);

    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: STEP_ID,
        taskId: TASK_ID,
        tenantId: TENANT_ID,
        status: AssistantTaskStepStatus.READY,
        task: {
          is: {
            status: 'RUNNING',
            executionOwner: EXECUTION_OWNER,
            leaseExpiresAt: { gt: expect.any(Date) },
          },
        },
      },
      data: expect.objectContaining({
        status: AssistantTaskStepStatus.RUNNING,
        attemptNo: { increment: 1 },
        brief: { taskGoal: '季度分析' },
      }),
    }));
    expect(harness.events.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      {
        type: 'step_started',
        stepId: STEP_ID,
        stepKey: 's1',
        stepNo: 1,
        title: '收集数据',
        assigneeName: '数据助理',
      },
    );
  });

  it('does not emit a step_started event when the claim loses the condition race', async () => {
    const harness = createHarness({ stepUpdateCount: 0 });

    await expect(harness.service.claimStep({
      taskId: TASK_ID,
      stepId: STEP_ID,
      tenantId: TENANT_ID,
      executionOwner: EXECUTION_OWNER,
      leaseExpiresAt: new Date(),
      brief: {},
      stepKey: 's1',
      stepNo: 1,
      stepTitle: null,
      assigneeName: null,
    })).resolves.toBe(false);

    expect(harness.events.appendInTransaction).not.toHaveBeenCalled();
  });

  it('resumes a suspended step from WAITING_USER without a new attempt or step_started event', async () => {
    const harness = createHarness({ stepUpdateCounts: [0, 1] });

    await expect(harness.service.claimStep({
      taskId: TASK_ID,
      stepId: STEP_ID,
      tenantId: TENANT_ID,
      executionOwner: EXECUTION_OWNER,
      leaseExpiresAt: new Date('2026-09-28T10:01:00.000Z'),
      brief: { taskGoal: '季度分析' } as Prisma.InputJsonObject,
      stepKey: 's1',
      stepNo: 1,
      stepTitle: '收集数据',
      assigneeName: '数据助理',
    })).resolves.toBe(true);

    // 先试 READY 前态失败（首次派发），再走 WAITING_USER 恢复路径。
    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledTimes(2);
    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ status: AssistantTaskStepStatus.READY }),
      data: expect.objectContaining({ attemptNo: { increment: 1 } }),
    }));
    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ status: AssistantTaskStepStatus.WAITING_USER }),
      data: {
        status: AssistantTaskStepStatus.RUNNING,
        brief: { taskGoal: '季度分析' },
        executionOwner: EXECUTION_OWNER,
        leaseExpiresAt: new Date('2026-09-28T10:01:00.000Z'),
        heartbeatAt: expect.any(Date),
      },
    }));
    // 恢复是同一执行尝试的继续：不递增 attemptNo，也不重复写 step_started。
    expect(harness.events.appendInTransaction).not.toHaveBeenCalled();
  });

  it('suspends a leased step onto the user inside the caller transaction', async () => {
    const harness = createHarness();
    const now = new Date('2026-09-28T10:00:00.000Z');

    await expect(harness.service.suspendStepInTransaction(harness.tx as unknown as Prisma.TransactionClient, {
      taskId: TASK_ID,
      stepId: STEP_ID,
      tenantId: TENANT_ID,
      executionOwner: EXECUTION_OWNER,
      now,
    })).resolves.toBe(true);

    // 挂起即释放步骤租约：等待期间步骤不属于任何执行者。
    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith({
      where: {
        id: STEP_ID,
        taskId: TASK_ID,
        tenantId: TENANT_ID,
        status: AssistantTaskStepStatus.RUNNING,
        executionOwner: EXECUTION_OWNER,
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: AssistantTaskStepStatus.WAITING_USER,
        executionOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
      },
    });
  });

  it('refuses to suspend a step whose lease was lost', async () => {
    const harness = createHarness({ stepUpdateCount: 0 });

    await expect(harness.service.suspendStepInTransaction(harness.tx as unknown as Prisma.TransactionClient, {
      taskId: TASK_ID,
      stepId: STEP_ID,
      tenantId: TENANT_ID,
      executionOwner: EXECUTION_OWNER,
    })).resolves.toBe(false);
  });

  it('skips a pending step with the dependency failure marker and event', async () => {
    const harness = createHarness();

    await expect(harness.service.skipStep({
      taskId: TASK_ID,
      stepId: STEP_ID,
      stepKey: 's2',
      tenantId: TENANT_ID,
      reason: '前置步骤未成功完成，本步骤已跳过',
    })).resolves.toBe(true);

    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: STEP_ID, taskId: TASK_ID, tenantId: TENANT_ID, status: 'PENDING' },
      data: expect.objectContaining({
        status: AssistantTaskStepStatus.SKIPPED,
        error: { code: 'STEP_DEPENDENCY_FAILED', message: '前置步骤未成功完成，本步骤已跳过' },
      }),
    }));
    expect(harness.events.appendInTransaction).toHaveBeenCalledWith(harness.tx, TASK_ID, TENANT_ID, {
      type: 'step_skipped',
      stepId: STEP_ID,
      stepKey: 's2',
      reason: '前置步骤未成功完成，本步骤已跳过',
    });
  });

  it('allocates the tool call seq from the step row and stores a proposed call', async () => {
    const harness = createHarness();

    const record = await harness.service.createStepToolCall({
      id: TOOL_CALL_ID,
      taskId: TASK_ID,
      stepId: STEP_ID,
      modelStep: 1,
      tenantId: TENANT_ID,
      conversationId: TASK_ID,
      executionOwner: EXECUTION_OWNER,
      upstreamCallId: 'call-1',
      assistantContent: null,
      name: 'knowledge_search',
      arguments: { query: '销售' },
    });

    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: STEP_ID,
        status: AssistantTaskStepStatus.RUNNING,
        executionOwner: EXECUTION_OWNER,
      }),
      data: { nextToolCallSeq: { increment: 1 } },
    }));
    // findUniqueOrThrow 返回 nextToolCallSeq=3 → 本条分配的 seq 是 2。
    expect(harness.tx.toolCall.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: TOOL_CALL_ID,
        taskStepId: STEP_ID,
        seq: 2,
        modelStep: 1,
        upstreamCallId: 'call-1',
        status: ToolCallStatus.PROPOSED,
        arguments: { query: '销售' },
      }),
    }));
    expect(record.status).toBe(ToolCallStatus.PROPOSED);
  });

  it('replays the existing record instead of duplicating a model step call', async () => {
    const existing = {
      id: TOOL_CALL_ID,
      status: ToolCallStatus.COMPLETED,
      result: { summary: '已完成' },
      errorCode: null,
      errorMessage: null,
      name: 'knowledge_search',
      arguments: { query: '销售' },
      assistantContent: null,
    };
    const harness = createHarness({
      transactionError: new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['task_step_id', 'model_step', 'upstream_call_id'] },
      }),
      existingToolCall: existing,
    });

    await expect(harness.service.createStepToolCall({
      id: '60000000-0000-0000-0000-000000000001',
      taskId: TASK_ID,
      stepId: STEP_ID,
      modelStep: 1,
      tenantId: TENANT_ID,
      conversationId: TASK_ID,
      executionOwner: EXECUTION_OWNER,
      upstreamCallId: 'call-1',
      name: 'knowledge_search',
      arguments: { query: '销售' },
    })).resolves.toEqual(existing);
    expect(harness.prisma.toolCall.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        taskStepId: STEP_ID,
        modelStep: 1,
        upstreamCallId: 'call-1',
      }),
    }));
  });

  it('settles a proposed call as rejected without touching the execution token', async () => {
    const harness = createHarness();

    await expect(harness.service.rejectStepToolCall({
      toolCallId: TOOL_CALL_ID,
      taskId: TASK_ID,
      stepId: STEP_ID,
      tenantId: TENANT_ID,
      executionOwner: EXECUTION_OWNER,
      code: 'STEP_TOOL_FORBIDDEN',
      summary: '该操作在任务步骤内暂不可用',
    })).resolves.toBe(true);

    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: TOOL_CALL_ID,
        status: ToolCallStatus.PROPOSED,
        taskStep: {
          is: expect.objectContaining({
            status: AssistantTaskStepStatus.RUNNING,
            executionOwner: EXECUTION_OWNER,
          }),
        },
      }),
      data: expect.objectContaining({
        status: ToolCallStatus.REJECTED,
        errorCode: 'STEP_TOOL_FORBIDDEN',
        leaseExpiresAt: null,
      }),
    }));
    expect(harness.tx.assistantTaskStepMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        stepId: STEP_ID,
        role: 'TOOL',
        content: '该操作在任务步骤内暂不可用',
        toolCallRef: TOOL_CALL_ID,
      }),
    }));
  });

  it('rejects a proposed call inside the caller transaction for the authorization pause', async () => {
    const harness = createHarness();

    await expect(harness.service.rejectStepToolCallInTransaction(
      harness.tx as unknown as Prisma.TransactionClient,
      {
        toolCallId: TOOL_CALL_ID,
        taskId: TASK_ID,
        stepId: STEP_ID,
        tenantId: TENANT_ID,
        executionOwner: EXECUTION_OWNER,
        code: 'AUTHORIZATION_REQUIRED',
        summary: '该操作需要用户授权，本次未执行',
      },
    )).resolves.toBe(true);

    // 与 rejectStepToolCall 同语义（PROPOSED → REJECTED + TOOL 窗口消息），
    // 但复用调用方事务，保证与挂起事项创建、步骤挂起原子提交。
    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: TOOL_CALL_ID,
        status: ToolCallStatus.PROPOSED,
        taskStep: {
          is: expect.objectContaining({
            status: AssistantTaskStepStatus.RUNNING,
            executionOwner: EXECUTION_OWNER,
          }),
        },
      }),
      data: expect.objectContaining({
        status: ToolCallStatus.REJECTED,
        errorCode: 'AUTHORIZATION_REQUIRED',
        errorMessage: '该操作需要用户授权，本次未执行',
        leaseExpiresAt: null,
      }),
    }));
    expect(harness.tx.assistantTaskStepMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        stepId: STEP_ID,
        role: 'TOOL',
        content: '该操作需要用户授权，本次未执行',
        toolCallRef: TOOL_CALL_ID,
      }),
    }));
  });

  it('settles an executing call as completed with the resource reference', async () => {
    const harness = createHarness();

    await expect(harness.service.completeStepToolCall({
      toolCallId: TOOL_CALL_ID,
      taskId: TASK_ID,
      stepId: STEP_ID,
      tenantId: TENANT_ID,
      executionOwner: EXECUTION_OWNER,
      executionToken: EXECUTION_TOKEN,
      summary: '找到 3 条记录',
      resourceType: 'DOCUMENT',
      resourceId: 'doc-1',
      sources: [],
      citations: [],
    })).resolves.toBe(true);

    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: ToolCallStatus.EXECUTING,
        executionToken: EXECUTION_TOKEN,
      }),
      data: expect.objectContaining({
        status: ToolCallStatus.COMPLETED,
        errorCode: null,
        executedResourceType: 'DOCUMENT',
        executedResourceId: 'doc-1',
      }),
    }));
  });

  it('completes a step with the summary, final message and step_completed event', async () => {
    const harness = createHarness();
    const outputRefs = [{ type: 'DOCUMENT' as const, id: 'doc-1' }];

    await expect(harness.service.succeedStep({
      taskId: TASK_ID,
      stepId: STEP_ID,
      stepKey: 's1',
      tenantId: TENANT_ID,
      executionOwner: EXECUTION_OWNER,
      summary: '已完成季度数据汇总',
      outputRefs,
    })).resolves.toBe(true);

    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: AssistantTaskStepStatus.RUNNING }),
      data: expect.objectContaining({
        status: AssistantTaskStepStatus.SUCCEEDED,
        summary: '已完成季度数据汇总',
        outputRefs,
        executionOwner: null,
      }),
    }));
    expect(harness.tx.assistantTaskStepMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'ASSISTANT', content: '已完成季度数据汇总' }),
    }));
    expect(harness.events.appendInTransaction).toHaveBeenCalledWith(harness.tx, TASK_ID, TENANT_ID, {
      type: 'step_completed',
      stepId: STEP_ID,
      stepKey: 's1',
      summary: '已完成季度数据汇总',
      outputRefs,
    });
  });

  it('keeps the failure detail in the row while the event only carries the reason', async () => {
    const harness = createHarness();

    await expect(harness.service.failStep({
      taskId: TASK_ID,
      stepId: STEP_ID,
      stepKey: 's1',
      tenantId: TENANT_ID,
      executionOwner: EXECUTION_OWNER,
      code: 'STEP_EXECUTION_ERROR',
      reason: '步骤执行发生内部错误，本步骤未完成',
      detail: 'connect ECONNREFUSED 127.0.0.1:8000',
    })).resolves.toBe(true);

    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: AssistantTaskStepStatus.FAILED,
        error: {
          code: 'STEP_EXECUTION_ERROR',
          message: 'connect ECONNREFUSED 127.0.0.1:8000',
        },
      }),
    }));
    expect(harness.events.appendInTransaction).toHaveBeenCalledWith(harness.tx, TASK_ID, TENANT_ID, {
      type: 'step_failed',
      stepId: STEP_ID,
      stepKey: 's1',
      reason: '步骤执行发生内部错误，本步骤未完成',
    });
  });

  it('recovers a stale running step and reconciles its unfinished tools', async () => {
    const harness = createHarness({
      staleSteps: [{ id: STEP_ID, stepKey: 's1', tenantId: TENANT_ID }],
      interruptedCalls: [
        { id: 'tc-exec', taskStepId: STEP_ID, status: ToolCallStatus.EXECUTING },
        { id: 'tc-prop', taskStepId: STEP_ID, status: ToolCallStatus.PROPOSED },
      ],
      unfinishedImages: [{ id: 'image-1', status: ManagedImageStatus.GENERATING }],
    });
    const now = new Date('2026-09-28T10:00:00.000Z');

    await expect(harness.service.recoverStaleSteps(TASK_ID, now)).resolves.toBe(1);

    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: STEP_ID,
        status: AssistantTaskStepStatus.RUNNING,
        leaseExpiresAt: { lte: now },
      }),
      data: expect.objectContaining({
        status: AssistantTaskStepStatus.FAILED,
        error: expect.objectContaining({ code: 'STEP_EXECUTION_LOST' }),
      }),
    }));
    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: ToolCallStatus.RECOVERY_REQUIRED,
        errorCode: 'TOOL_EXECUTION_RECOVERY_REQUIRED',
      }),
    }));
    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: ToolCallStatus.REJECTED,
        errorCode: 'STEP_EXECUTION_LOST',
      }),
    }));
    expect(harness.tx.managedImage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: ManagedImageStatus.GENERATING }),
      data: expect.objectContaining({ status: ManagedImageStatus.FAILED }),
    }));
    expect(harness.events.appendInTransaction).toHaveBeenLastCalledWith(harness.tx, TASK_ID, TENANT_ID, {
      type: 'step_failed',
      stepId: STEP_ID,
      stepKey: 's1',
      reason: '步骤执行进程已失联，本步骤未完成',
    });
  });

  it('reconciles task step tools for the cancel path inside the caller transaction', async () => {
    const harness = createHarness({
      interruptedCalls: [{ id: TOOL_CALL_ID, taskStepId: STEP_ID, status: ToolCallStatus.EXECUTING }],
    });
    const now = new Date('2026-09-28T10:00:00.000Z');

    await harness.service.reconcileTaskStepTools(harness.tx as unknown as Prisma.TransactionClient, {
      tenantId: TENANT_ID,
      stepIds: [STEP_ID],
      now,
      executingCode: 'TOOL_EXECUTION_CANCELLED',
      executingMessage: '任务已取消，该操作的结果状态未能确认，请留意核对',
      pendingCode: 'TASK_CANCELLED',
      pendingMessage: '任务已取消，该操作未执行',
    });

    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: TOOL_CALL_ID, status: ToolCallStatus.EXECUTING }),
      data: expect.objectContaining({
        status: ToolCallStatus.RECOVERY_REQUIRED,
        errorCode: 'TOOL_EXECUTION_CANCELLED',
      }),
    }));
    expect(harness.tx.assistantTaskStepMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ toolCallRef: TOOL_CALL_ID, role: 'TOOL' }),
    }));
  });

  it('yields the task execution by releasing the lease to the current moment', async () => {
    const harness = createHarness();

    await expect(harness.service.yieldTaskExecution({
      taskId: TASK_ID,
      executionOwner: EXECUTION_OWNER,
    })).resolves.toBe(true);

    // 让行即交还执行权：租约置为当前时刻，恢复扫描可立即重拾（退避窗口不空转）。
    expect(harness.prisma.assistantTask.updateMany).toHaveBeenCalledWith({
      where: { id: TASK_ID, status: 'RUNNING', executionOwner: EXECUTION_OWNER },
      data: {
        executionOwner: null,
        leaseExpiresAt: expect.any(Date),
        heartbeatAt: expect.any(Date),
      },
    });
  });

  it('escalates a failed step onto the user inside the caller transaction', async () => {
    const harness = createHarness();

    await expect(harness.service.escalateStepInTransaction(
      harness.tx as unknown as Prisma.TransactionClient,
      { taskId: TASK_ID, stepId: STEP_ID, tenantId: TENANT_ID },
    )).resolves.toBe(true);

    // 失败 → 挂起：清空完成时间；等待期间步骤不属于任何执行者。
    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith({
      where: {
        id: STEP_ID,
        taskId: TASK_ID,
        tenantId: TENANT_ID,
        status: AssistantTaskStepStatus.FAILED,
      },
      data: {
        status: AssistantTaskStepStatus.WAITING_USER,
        completedAt: null,
        heartbeatAt: expect.any(Date),
      },
    });
  });

  it('schedules a failed step for retry with the backoff not-before time', async () => {
    const harness = createHarness();
    const retryAfterAt = new Date('2026-09-28T10:00:30.000Z');

    await expect(harness.service.scheduleStepRetry({
      taskId: TASK_ID,
      stepId: STEP_ID,
      tenantId: TENANT_ID,
      retryAfterAt,
    })).resolves.toBe(true);

    // 退避调度不写事件：本次失败已由 step_failed 留痕，重试开始由下一次 step_started 表达。
    expect(harness.prisma.assistantTaskStep.updateMany).toHaveBeenCalledWith({
      where: {
        id: STEP_ID,
        taskId: TASK_ID,
        tenantId: TENANT_ID,
        status: AssistantTaskStepStatus.FAILED,
      },
      data: {
        status: AssistantTaskStepStatus.READY,
        retryAfterAt,
        heartbeatAt: expect.any(Date),
      },
    });
    expect(harness.events.appendInTransaction).not.toHaveBeenCalled();
  });

  it('applies a user retry decision by clearing the backoff and returning to READY', async () => {
    const harness = createHarness();

    await expect(harness.service.applyFailureDecision({
      taskId: TASK_ID,
      stepId: STEP_ID,
      stepKey: 's1',
      tenantId: TENANT_ID,
      action: 'retry',
      reason: '用户裁决重试本步骤',
    })).resolves.toBe(true);

    expect(harness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith({
      where: {
        id: STEP_ID,
        taskId: TASK_ID,
        tenantId: TENANT_ID,
        status: AssistantTaskStepStatus.WAITING_USER,
      },
      data: {
        status: AssistantTaskStepStatus.READY,
        retryAfterAt: null,
        heartbeatAt: expect.any(Date),
      },
    });
    expect(harness.events.appendInTransaction).not.toHaveBeenCalled();
  });

  it('settles the user skip and abort decisions with their terminal markers and events', async () => {
    const skipHarness = createHarness();

    await expect(skipHarness.service.applyFailureDecision({
      taskId: TASK_ID,
      stepId: STEP_ID,
      stepKey: 's1',
      tenantId: TENANT_ID,
      action: 'skip',
      reason: '用户裁决跳过本步骤，产出缺失',
    })).resolves.toBe(true);

    expect(skipHarness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: AssistantTaskStepStatus.WAITING_USER }),
      data: expect.objectContaining({
        status: AssistantTaskStepStatus.SKIPPED,
        error: { code: 'STEP_SKIPPED_BY_USER', message: '用户裁决跳过本步骤，产出缺失' },
      }),
    }));
    expect(skipHarness.events.appendInTransaction).toHaveBeenCalledWith(skipHarness.tx, TASK_ID, TENANT_ID, {
      type: 'step_skipped',
      stepId: STEP_ID,
      stepKey: 's1',
      reason: '用户裁决跳过本步骤，产出缺失',
    });

    const abortHarness = createHarness();

    await expect(abortHarness.service.applyFailureDecision({
      taskId: TASK_ID,
      stepId: STEP_ID,
      stepKey: 's1',
      tenantId: TENANT_ID,
      action: 'abort',
      reason: '用户裁决终止任务',
    })).resolves.toBe(true);

    // 终止：FAILED + resolution=abort（调度收尾据此跳过再次升级并判定任务失败）。
    expect(abortHarness.tx.assistantTaskStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: AssistantTaskStepStatus.WAITING_USER }),
      data: expect.objectContaining({
        status: AssistantTaskStepStatus.FAILED,
        error: {
          code: 'STEP_ABORTED_BY_USER',
          message: '用户裁决终止任务',
          resolution: 'abort',
        },
      }),
    }));
    expect(abortHarness.events.appendInTransaction).toHaveBeenCalledWith(abortHarness.tx, TASK_ID, TENANT_ID, {
      type: 'step_failed',
      stepId: STEP_ID,
      stepKey: 's1',
      reason: '用户裁决终止任务',
    });
  });
});

function createHarness(options: {
  taskUpdateCount?: number;
  stepUpdateCount?: number;
  stepUpdateCounts?: number[];
  transactionError?: unknown;
  staleSteps?: Array<{ id: string; stepKey: string; tenantId: string }>;
  interruptedCalls?: Array<{ id: string; taskStepId: string | null; status: ToolCallStatus }>;
  unfinishedImages?: Array<{ id: string; status: ManagedImageStatus }>;
  existingToolCall?: Record<string, unknown> | null;
} = {}) {
  const stepUpdateCounts = options.stepUpdateCounts ?? [options.stepUpdateCount ?? 1];
  let stepUpdateCall = 0;
  const tx: Record<string, any> = {
    assistantTask: {
      updateMany: jest.fn().mockResolvedValue({ count: options.taskUpdateCount ?? 1 }),
    },
    assistantTaskStep: {
      updateMany: jest.fn().mockImplementation(() => {
        const value = stepUpdateCounts[Math.min(stepUpdateCall, stepUpdateCounts.length - 1)] ?? 1;
        stepUpdateCall += 1;
        return Promise.resolve({ count: value });
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ nextToolCallSeq: 3 }),
    },
    assistantTaskStepMessage: {
      findFirst: jest.fn().mockResolvedValue({ seq: 2 }),
      create: jest.fn().mockResolvedValue({}),
    },
    toolCall: {
      create: jest.fn().mockResolvedValue({
        id: TOOL_CALL_ID,
        status: ToolCallStatus.PROPOSED,
        result: null,
        errorCode: null,
        errorMessage: null,
        name: 'knowledge_search',
        arguments: { query: '销售' },
        assistantContent: null,
      }),
      findMany: jest.fn().mockResolvedValue(options.interruptedCalls ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    managedImage: {
      findMany: jest.fn().mockResolvedValue(options.unfinishedImages ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma: Record<string, any> = {
    $transaction: jest.fn(),
    assistantTask: {
      updateMany: jest.fn().mockResolvedValue({ count: options.taskUpdateCount ?? 1 }),
    },
    assistantTaskStep: {
      findMany: jest.fn().mockResolvedValue(options.staleSteps ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: options.stepUpdateCount ?? 1 }),
    },
    toolCall: {
      findFirst: jest.fn().mockResolvedValue(options.existingToolCall ?? null),
    },
  };
  prisma.$transaction.mockImplementation((callback: (transaction: unknown) => unknown) => (
    options.transactionError ? Promise.reject(options.transactionError) : callback(tx)
  ));
  const events = { appendInTransaction: jest.fn().mockResolvedValue(1) };
  const service = new StepStateService(
    prisma as unknown as PrismaService,
    events as unknown as TaskEventService,
  );
  return { service, prisma, tx, events };
}
