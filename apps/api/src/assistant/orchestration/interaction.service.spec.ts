import type { PrismaService } from '../../database/prisma.service';
import type { TenantContext } from '../../tenant/tenant-context';
import { InteractionService } from './interaction.service';
import type { TaskEventService } from './task-event.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const TASK_ID = '20000000-0000-0000-0000-000000000001';
const INTERACTION_ID = '40000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const REQUEST_ID = 'req-1';

const AUTHORIZATION_PAYLOAD = {
  summary: '把生成的季度报告写入部门知识库',
  reason: '该操作会新增企业知识库文档',
  stepKey: 's1',
  permissionCode: 'knowledge.document.create',
  toolName: 'save_to_knowledge',
};

const QUESTION_PAYLOAD = {
  summary: '报告里是否需要包含去年同期对比？',
  reason: null,
  stepKey: 's2',
  options: [
    { id: 'yes', label: '需要对比', description: null },
    { id: 'no', label: '只看本季度', description: null },
  ],
};

interface RowOverrides {
  status?: string;
  type?: string;
  scope?: string | null;
  stepId?: string | null;
  payload?: Record<string, unknown>;
  taskStatus?: string;
  expiresAt?: Date | null;
  usedAt?: Date | null;
  resolution?: Record<string, unknown> | null;
}

function interactionRow(overrides: RowOverrides = {}) {
  return {
    id: INTERACTION_ID,
    tenantId: TENANT_ID,
    taskId: TASK_ID,
    stepId: overrides.stepId === undefined ? null : overrides.stepId,
    type: overrides.type ?? 'AUTHORIZATION',
    payload: overrides.payload ?? AUTHORIZATION_PAYLOAD,
    status: overrides.status ?? 'PENDING',
    resolution: overrides.resolution ?? null,
    resolvedByMembershipId: null as string | null,
    resolvedAt: null as Date | null,
    expiresAt: overrides.expiresAt ?? null,
    scope: overrides.scope ?? null,
    usedAt: overrides.usedAt ?? null,
    createdAt: new Date('2026-09-28T08:00:00.000Z'),
    updatedAt: new Date('2026-09-28T08:00:00.000Z'),
    task: { status: overrides.taskStatus ?? 'RUNNING' },
  };
}

describe('InteractionService', () => {
  it('creates an authorization interaction and appends an interaction_requested event', async () => {
    const harness = createHarness();

    const created = await harness.service.createInTransaction(harness.tx as any, {
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      stepId: '30000000-0000-0000-0000-000000000001',
      stepKey: 's1',
      type: 'AUTHORIZATION',
      summary: AUTHORIZATION_PAYLOAD.summary,
      reason: AUTHORIZATION_PAYLOAD.reason,
      permissionCode: 'knowledge.document.create',
      toolName: 'save_to_knowledge',
      requestId: REQUEST_ID,
      membershipId: MEMBERSHIP_ID,
    });

    expect(created.id).toBe(INTERACTION_ID);
    const createArgs = harness.tx.assistantTaskInteraction.create.mock.calls[0][0] as {
      data: { taskId: string; type: string; payload: Record<string, unknown> };
    };
    expect(createArgs.data).toEqual(expect.objectContaining({
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      type: 'AUTHORIZATION',
      expiresAt: null,
    }));
    expect(createArgs.data.payload).toEqual(expect.objectContaining({
      summary: AUTHORIZATION_PAYLOAD.summary,
      stepKey: 's1',
      permissionCode: 'knowledge.document.create',
      toolName: 'save_to_knowledge',
      options: [],
    }));
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      expect.objectContaining({
        type: 'interaction_requested',
        interactionId: INTERACTION_ID,
        interactionType: 'AUTHORIZATION',
        stepId: '30000000-0000-0000-0000-000000000001',
        stepKey: 's1',
        summary: AUTHORIZATION_PAYLOAD.summary,
        options: [],
      }),
    );
    // 申请段审计：与「决定 / 使用」两段对称（操作者、请求、资源与元数据）。
    expect(harness.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'TASK_INTERACTION_REQUESTED',
        resourceId: INTERACTION_ID,
        requestId: REQUEST_ID,
        actorMembershipId: MEMBERSHIP_ID,
        metadata: expect.objectContaining({
          taskId: TASK_ID,
          interactionType: 'AUTHORIZATION',
          permissionCode: 'knowledge.document.create',
        }),
      }),
    });
  });

  it('rejects an option interaction without candidates', async () => {
    const harness = createHarness();

    await expect(harness.service.createInTransaction(harness.tx as any, {
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      type: 'QUESTION',
      summary: '需要补充哪个区域的数据？',
      options: [],
      requestId: REQUEST_ID,
    })).rejects.toMatchObject({ response: { code: 'INTERACTION_INPUT_INVALID' } });
  });

  it('resolves an authorization approval with scope and writes the resolved event and audit', async () => {
    const harness = createHarness();

    const resolved = await harness.service.resolve(INTERACTION_ID, { decision: 'approve', scope: 'TASK' });

    // 归属校验：交互属于当前成员的任务（task 关联过滤），并在同一查询带出任务状态。
    expect(harness.prisma.assistantTaskInteraction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: INTERACTION_ID,
        tenantId: TENANT_ID,
        task: { membershipId: MEMBERSHIP_ID },
      }),
    }));
    // 条件更新：只有 PENDING 才能被解决，后状态与 resolution 一并写入。
    expect(harness.tx.assistantTaskInteraction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: INTERACTION_ID, status: 'PENDING' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        scope: 'TASK',
        resolution: { decision: 'approve', scope: 'TASK' },
        resolvedByMembershipId: MEMBERSHIP_ID,
        resolvedAt: expect.any(Date),
      }),
    }));
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      expect.objectContaining({
        type: 'interaction_resolved',
        interactionId: INTERACTION_ID,
        interactionType: 'AUTHORIZATION',
        status: 'RESOLVED',
        scope: 'TASK',
        value: null,
      }),
    );
    expect(harness.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'TASK_INTERACTION_RESOLVED',
        resourceType: 'ASSISTANT_TASK_INTERACTION',
        resourceId: INTERACTION_ID,
        metadata: expect.objectContaining({ taskId: TASK_ID, decision: 'approve' }),
      }),
    });
    expect((resolved as { status: string }).status).toBe('RESOLVED');
  });

  it('resolves an authorization rejection as REJECTED and defaults approve scope to ONCE', async () => {
    const harness = createHarness();

    await harness.service.resolve(INTERACTION_ID, { decision: 'reject' });

    expect(harness.tx.assistantTaskInteraction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'REJECTED',
        scope: null,
        resolution: { decision: 'reject' },
      }),
    }));
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      expect.objectContaining({ type: 'interaction_resolved', status: 'REJECTED' }),
    );

    const approveHarness = createHarness();
    await approveHarness.service.resolve(INTERACTION_ID, { decision: 'approve' });
    expect(approveHarness.tx.assistantTaskInteraction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scope: 'ONCE', resolution: { decision: 'approve', scope: 'ONCE' } }),
    }));
  });

  it('resolves a question answer with the provided value', async () => {
    const harness = createHarness({
      interaction: interactionRow({ type: 'QUESTION', payload: QUESTION_PAYLOAD }),
    });

    await harness.service.resolve(INTERACTION_ID, { decision: 'answer', value: '需要对比' });

    expect(harness.tx.assistantTaskInteraction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'RESOLVED',
        resolution: { decision: 'answer', value: '需要对比' },
      }),
    }));
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      expect.objectContaining({ type: 'interaction_resolved', value: '需要对比', scope: null }),
    );
  });

  it('returns the current state without new writes when the interaction is already resolved', async () => {
    const harness = createHarness({
      interaction: interactionRow({ status: 'RESOLVED', scope: 'ONCE', resolution: { decision: 'approve', scope: 'ONCE' } }),
    });

    const result = await harness.service.resolve(INTERACTION_ID, { decision: 'approve' });

    expect((result as { status: string }).status).toBe('RESOLVED');
    expect(harness.tx.assistantTaskInteraction.updateMany).not.toHaveBeenCalled();
    expect(harness.taskEvents.appendInTransaction).not.toHaveBeenCalled();
  });

  it('enforces the resolution action against the interaction type', async () => {
    const harness = createHarness({
      interaction: interactionRow({ type: 'QUESTION', payload: QUESTION_PAYLOAD }),
    });

    await expect(harness.service.resolve(INTERACTION_ID, { decision: 'approve' }))
      .rejects.toMatchObject({ response: { code: 'INTERACTION_DECISION_INVALID' } });
    await expect(harness.service.resolve(INTERACTION_ID, { decision: 'answer', value: '  ' }))
      .rejects.toMatchObject({ response: { code: 'INTERACTION_VALUE_REQUIRED' } });
    expect(harness.tx.assistantTaskInteraction.updateMany).not.toHaveBeenCalled();
  });

  it('rejects resolving while the task is already terminal', async () => {
    const harness = createHarness({
      interaction: interactionRow({ taskStatus: 'CANCELLED' }),
    });

    await expect(harness.service.resolve(INTERACTION_ID, { decision: 'approve' }))
      .rejects.toMatchObject({ response: { code: 'TASK_TERMINAL' } });
    expect(harness.tx.assistantTaskInteraction.updateMany).not.toHaveBeenCalled();
  });

  it('returns 404 semantics when the interaction does not belong to the current member', async () => {
    const harness = createHarness({ interaction: null });

    await expect(harness.service.resolve(INTERACTION_ID, { decision: 'approve' }))
      .rejects.toMatchObject({ response: { code: 'INTERACTION_NOT_FOUND' } });
  });

  it('closes pending interactions for a terminal task with resolved events per row', async () => {
    const harness = createHarness({
      pendingRows: [
        interactionRow({ payload: AUTHORIZATION_PAYLOAD }),
        interactionRow({ type: 'QUESTION', payload: QUESTION_PAYLOAD, stepId: '30000000-0000-0000-0000-000000000002' }),
      ],
    });
    const now = new Date('2026-09-28T10:00:00.000Z');

    const closed = await harness.service.closePendingForTaskInTransaction(harness.tx as any, {
      taskId: TASK_ID,
      tenantId: TENANT_ID,
      status: 'CANCELLED',
      now,
    });

    expect(closed).toBe(2);
    expect(harness.tx.assistantTaskInteraction.updateMany).toHaveBeenCalledTimes(2);
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledTimes(2);
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      expect.objectContaining({
        type: 'interaction_resolved',
        status: 'CANCELLED',
        value: null,
        resolvedAt: now.toISOString(),
      }),
    );
  });

  it('expires overdue pending interactions in a bounded scan', async () => {
    const harness = createHarness({
      pendingRows: [interactionRow({ expiresAt: new Date('2026-09-28T09:00:00.000Z') })],
    });
    const now = new Date('2026-09-28T10:00:00.000Z');

    await expect(harness.service.expireOverdueInteractions(now)).resolves.toBe(1);

    expect(harness.prisma.assistantTaskInteraction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'PENDING',
        expiresAt: { not: null, lte: now },
      }),
      take: 50,
    }));
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TASK_ID,
      TENANT_ID,
      expect.objectContaining({ type: 'interaction_resolved', status: 'EXPIRED' }),
    );
  });

  it('finds a usable authorization by scope, usage and permission item', async () => {
    const now = new Date('2026-09-28T10:00:00.000Z');
    // TASK 范围可重复使用；ONCE 已使用 / 权限项不匹配不可用。
    const usable = interactionRow({ status: 'RESOLVED', scope: 'TASK' });
    const harness = createHarness({ candidates: [usable] });

    const found = await harness.service.findUsableAuthorization({
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      permissionCode: 'knowledge.document.create',
      now,
    });
    expect(found).toBe(usable);
    expect(harness.prisma.assistantTaskInteraction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: TENANT_ID,
        taskId: TASK_ID,
        type: 'AUTHORIZATION',
        status: 'RESOLVED',
        task: { status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } },
      }),
    }));

    const consumedOnce = createHarness({
      candidates: [interactionRow({ status: 'RESOLVED', scope: 'ONCE', usedAt: now })],
    });
    await expect(consumedOnce.service.findUsableAuthorization({
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      permissionCode: 'knowledge.document.create',
      now,
    })).resolves.toBeNull();

    const otherPermission = createHarness({
      candidates: [interactionRow({ status: 'RESOLVED', scope: 'ONCE' })],
    });
    await expect(otherPermission.service.findUsableAuthorization({
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      permissionCode: 'finance.ledger.import',
      now,
    })).resolves.toBeNull();
  });

  it('marks an authorization used with a conditional update and audit trail', async () => {
    const harness = createHarness();
    const now = new Date('2026-09-28T10:00:00.000Z');

    await expect(harness.service.markAuthorizationUsed({
      tenantId: TENANT_ID,
      interactionId: INTERACTION_ID,
      membershipId: MEMBERSHIP_ID,
      requestId: REQUEST_ID,
      stepId: '30000000-0000-0000-0000-000000000001',
      toolCallId: 'tc-w1',
      now,
    })).resolves.toBe(true);

    expect(harness.tx.assistantTaskInteraction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: INTERACTION_ID,
        status: 'RESOLVED',
        type: 'AUTHORIZATION',
        OR: [
          { scope: 'TASK' },
          { scope: 'ONCE', usedAt: null },
        ],
      }),
      data: { usedAt: now },
    }));
    expect(harness.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'TASK_AUTHORIZATION_USED',
        resourceId: INTERACTION_ID,
        metadata: expect.objectContaining({
          usedAt: now.toISOString(),
          stepId: '30000000-0000-0000-0000-000000000001',
          toolCallId: 'tc-w1',
        }),
      }),
    });
  });

  it('reports a consumed authorization when the conditional update loses the race', async () => {
    const harness = createHarness();
    harness.tx.assistantTaskInteraction.updateMany.mockResolvedValue({ count: 0 });

    await expect(harness.service.markAuthorizationUsed({
      tenantId: TENANT_ID,
      interactionId: INTERACTION_ID,
      membershipId: MEMBERSHIP_ID,
      requestId: REQUEST_ID,
    })).resolves.toBe(false);
    expect(harness.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('finds the latest authorization for the permission code and skips other codes', async () => {
    const otherCode = interactionRow({
      type: 'AUTHORIZATION',
      payload: { ...AUTHORIZATION_PAYLOAD, permissionCode: 'task.create' },
    });
    const rejected = interactionRow({ status: 'REJECTED' });
    const older = interactionRow({ status: 'RESOLVED', scope: 'ONCE' });
    const harness = createHarness({ candidates: [otherCode, rejected, older] });

    // 数据库序即最近优先（createdAt desc + id desc），服务层只按权限项过滤。
    await expect(harness.service.findLatestAuthorization({
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      permissionCode: 'knowledge.document.create',
    })).resolves.toBe(rejected);
    expect(harness.prisma.assistantTaskInteraction.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, taskId: TASK_ID, type: 'AUTHORIZATION' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });

    const empty = createHarness({ candidates: [] });
    await expect(empty.service.findLatestAuthorization({
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      permissionCode: 'knowledge.document.create',
    })).resolves.toBeNull();
  });

  it('reports whether the task still has pending interactions', async () => {
    const blocked = createHarness({ pendingCount: 2 });
    await expect(blocked.service.hasPendingForTask(TASK_ID)).resolves.toBe(true);
    expect(blocked.prisma.assistantTaskInteraction.count).toHaveBeenCalledWith({
      where: { taskId: TASK_ID, status: 'PENDING' },
    });

    const clear = createHarness();
    await expect(clear.service.hasPendingForTask(TASK_ID)).resolves.toBe(false);
  });
});

function createHarness(options: {
  interaction?: ReturnType<typeof interactionRow> | null;
  candidates?: Array<ReturnType<typeof interactionRow>>;
  pendingRows?: Array<ReturnType<typeof interactionRow>>;
  pendingCount?: number;
} = {}) {
  const interaction = options.interaction === undefined ? interactionRow() : options.interaction;
  const tx = {
    assistantTaskInteraction: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...interactionRow(),
          ...args.data,
          id: INTERACTION_ID,
          expiresAt: args.data.expiresAt ?? null,
        })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue(options.pendingRows ?? []),
      findUniqueOrThrow: jest.fn().mockResolvedValue(interactionRow({ status: 'RESOLVED' })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback: (transaction: unknown) => unknown) => callback(tx)),
    assistantTaskInteraction: {
      findFirst: jest.fn().mockResolvedValue(interaction),
      count: jest.fn().mockResolvedValue(options.pendingCount ?? 0),
      findMany: jest.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        // 过期扫描按「PENDING + expiresAt」查询；其余（可用授权候选）返回候选集。
        if (args.where.status === 'PENDING' && args.where.expiresAt) {
          return Promise.resolve(options.pendingRows ?? []);
        }
        return Promise.resolve(options.candidates ?? []);
      }),
    },
  };
  const taskEvents = { appendInTransaction: jest.fn().mockResolvedValue(1) };
  const tenantContext = {
    require: () => ({
      tenantId: TENANT_ID,
      userId: '60000000-0000-0000-0000-000000000001',
      membershipId: MEMBERSHIP_ID,
      requestId: REQUEST_ID,
      roles: [],
      permissions: [],
    }),
  };
  const service = new InteractionService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
    taskEvents as unknown as TaskEventService,
  );
  return { service, prisma, tx, taskEvents };
}
