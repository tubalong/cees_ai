import type { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import type { PrismaService } from '../../database/prisma.service';
import type { KnowledgeDocumentService } from '../../knowledge/knowledge-document.service';
import type { KnowledgeService } from '../../knowledge/knowledge.service';
import type { TenantContext } from '../../tenant/tenant-context';
import { TaskOutputsService } from './task-outputs.service';
import type { TaskEventService } from './task-event.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const TASK_ID = '20000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const USER_ID = '60000000-0000-0000-0000-000000000001';
const DOC_A = '70000000-0000-0000-0000-000000000001';
const KB_DEPT = '80000000-0000-0000-0000-000000000001';
const KB_TENANT = '80000000-0000-0000-0000-000000000002';
const KDOC_1 = '90000000-0000-0000-0000-000000000001';
const KDOC_2 = '90000000-0000-0000-0000-000000000002';
const DEPT_ID = 'a0000000-0000-0000-0000-000000000001';

describe('TaskOutputsService.getOutputsView', () => {
  it('collects document outputs across plan versions and keeps the latest completed step', async () => {
    const harness = createHarness({
      steps: [
        step({
          stepKey: 's1',
          planVersion: 1,
          completedAt: new Date('2026-09-29T01:00:00.000Z'),
          outputRefs: [{ type: 'DOCUMENT', id: DOC_A }, { type: 'IMAGE', id: 'image-1' }],
        }),
        step({
          stepKey: 's2',
          planVersion: 2,
          completedAt: new Date('2026-09-29T02:00:00.000Z'),
          outputRefs: [{ type: 'DOCUMENT', id: DOC_A }],
        }),
      ],
      plans: [
        {
          version: 1,
          steps: [{ stepKey: 's1', title: '收集数据' }, { stepKey: 's2', title: '汇总报告' }],
        },
        {
          version: 2,
          steps: [{ stepKey: 's2', title: '重新汇总报告' }],
        },
      ],
      documents: [{ id: DOC_A, title: '销售报告' }],
    });

    const view = await harness.service.getOutputsView(TASK_ID);

    // 同一产出在多个版本 / 多个步骤出现：按最近完成步骤去重（保留 planVersion=2 的 s2）。
    expect(view.outputs).toEqual([
      {
        documentId: DOC_A,
        title: '销售报告',
        stepKey: 's2',
        stepTitle: '重新汇总报告',
        confirmed: false,
        archive: null,
        suggestions: [],
      },
    ]);
    // 已删除的 AI 文档不再进入验收清单：查询按 deletedAt 过滤。
    expect(harness.prisma.managedDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [DOC_A] }, tenantId: TENANT_ID, deletedAt: null },
      }),
    );
  });

  it('rebuilds the archive result from output_confirmed events for confirmed outputs', async () => {
    const harness = createHarness({
      steps: [step({ stepKey: 's1', outputRefs: [{ type: 'DOCUMENT', id: DOC_A }] })],
      plans: [{ version: 1, steps: [{ stepKey: 's1', title: '汇总报告' }] }],
      documents: [{ id: DOC_A, title: '销售报告' }],
      events: [
        {
          payload: {
            type: 'output_confirmed',
            seq: 5,
            documentId: DOC_A,
            knowledgeBaseId: KB_DEPT,
            knowledgeDocumentId: KDOC_1,
            visibilityScope: 'DEPARTMENT',
          },
          createdAt: new Date('2026-09-29T03:00:00.000Z'),
        },
      ],
    });

    const view = await harness.service.getOutputsView(TASK_ID);

    expect(view.outputs[0]).toMatchObject({
      confirmed: true,
      archive: {
        knowledgeBaseId: KB_DEPT,
        knowledgeDocumentId: KDOC_1,
        visibilityScope: 'DEPARTMENT',
        confirmedAt: new Date('2026-09-29T03:00:00.000Z'),
      },
      // 已确认产出恒为空建议（契约）。
      suggestions: [],
    });
  });

  it('suggests the department knowledge base via the deterministic rule path', async () => {
    const harness = createHarness({
      steps: [step({ stepKey: 's1', outputRefs: [{ type: 'DOCUMENT', id: DOC_A }] })],
      plans: [{ version: 1, steps: [{ stepKey: 's1', title: '汇总报告' }] }],
      documents: [{ id: DOC_A, title: '销售报告' }],
      membership: { departmentId: DEPT_ID },
      members: [{ knowledgeBaseId: KB_DEPT }],
      knowledgeBases: [
        { id: KB_DEPT, name: '销售部库', visibilityScope: 'DEPARTMENT', departmentId: DEPT_ID },
      ],
    });

    const view = await harness.service.getOutputsView(TASK_ID);

    expect(view.outputs[0]?.suggestions).toEqual([
      { knowledgeBaseId: KB_DEPT, reason: '按发起人部门归属推荐（部门成员可检索）' },
    ]);
    // 规则路径是确定性默认：不调模型。
    expect(harness.gateway.invoke).not.toHaveBeenCalled();
  });

  it('falls back to the LLM path without a department and hard-filters invalid suggestions', async () => {
    const harness = createHarness({
      steps: [step({ stepKey: 's1', outputRefs: [{ type: 'DOCUMENT', id: DOC_A }] })],
      plans: [{ version: 1, steps: [{ stepKey: 's1', title: '汇总报告' }] }],
      documents: [{ id: DOC_A, title: '销售报告' }],
      membership: { departmentId: null },
      members: [{ knowledgeBaseId: KB_TENANT }],
      knowledgeBases: [
        { id: KB_TENANT, name: '公司库', visibilityScope: 'TENANT', departmentId: null },
      ],
      invokeResult: {
        request_id: 'req-1:archive-suggestion:0',
        output: {
          type: 'json',
          value: {
            suggestions: [
              { documentId: DOC_A, knowledgeBaseId: KB_TENANT, reason: '与销售主题相关' },
              { documentId: DOC_A, knowledgeBaseId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', reason: '无权候选' },
              { documentId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', knowledgeBaseId: KB_TENANT, reason: '非法产出' },
            ],
          },
        },
        execution: { profile: 'mock', provider: 'mock', model: 'mock', fallback_count: 0 },
      },
    });

    const view = await harness.service.getOutputsView(TASK_ID);

    // 无权候选与非法产出被服务端硬过滤，只保留合法建议。
    expect(view.outputs[0]?.suggestions).toEqual([
      { knowledgeBaseId: KB_TENANT, reason: '与销售主题相关' },
    ]);
    expect(harness.gateway.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'archive_suggestion', temperature: 0 }),
    );
  });

  it('degrades to empty suggestions when the LLM invocation fails', async () => {
    const harness = createHarness({
      steps: [step({ stepKey: 's1', outputRefs: [{ type: 'DOCUMENT', id: DOC_A }] })],
      plans: [{ version: 1, steps: [{ stepKey: 's1', title: '汇总报告' }] }],
      documents: [{ id: DOC_A, title: '销售报告' }],
      membership: { departmentId: null },
      members: [{ knowledgeBaseId: KB_TENANT }],
      knowledgeBases: [
        { id: KB_TENANT, name: '公司库', visibilityScope: 'TENANT', departmentId: null },
      ],
      invokeError: new Error('ai-service unavailable'),
    });

    const view = await harness.service.getOutputsView(TASK_ID);

    // 失败重试后降级为空建议（用户仍可在候选内自选），不影响视图其余字段。
    expect(view.outputs[0]?.suggestions).toEqual([]);
    expect(harness.gateway.invoke).toHaveBeenCalledTimes(2);
  });
});

describe('TaskOutputsService.confirmOutputs', () => {
  it('rejects confirmation while the task is not terminal', async () => {
    const harness = createHarness({ taskStatus: 'RUNNING' });

    await expect(
      harness.service.confirmOutputs(TASK_ID, { outputs: [{ documentId: DOC_A, knowledgeBaseId: KB_TENANT }] }),
    ).rejects.toMatchObject({ response: { code: 'TASK_NOT_TERMINAL' } });
    expect(harness.knowledgeDocuments.saveFromSource).not.toHaveBeenCalled();
  });

  it('rejects outputs that do not belong to the task', async () => {
    const harness = createHarness({
      steps: [step({ stepKey: 's1', outputRefs: [{ type: 'DOCUMENT', id: DOC_A }] })],
      plans: [{ version: 1, steps: [{ stepKey: 's1', title: '汇总报告' }] }],
      documents: [{ id: DOC_A, title: '销售报告' }],
    });

    await expect(
      harness.service.confirmOutputs(TASK_ID, {
        outputs: [{ documentId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', knowledgeBaseId: KB_TENANT }],
      }),
    ).rejects.toMatchObject({ response: { code: 'TASK_OUTPUT_NOT_FOUND' } });
    expect(harness.knowledgeDocuments.saveFromSource).not.toHaveBeenCalled();
  });

  it('is idempotent for outputs already archived to the same knowledge base', async () => {
    const harness = createHarness({
      steps: [step({ stepKey: 's1', outputRefs: [{ type: 'DOCUMENT', id: DOC_A }] })],
      plans: [{ version: 1, steps: [{ stepKey: 's1', title: '汇总报告' }] }],
      documents: [{ id: DOC_A, title: '销售报告' }],
      events: [confirmedEvent(KB_DEPT, KDOC_1)],
    });

    const view = await harness.service.confirmOutputs(TASK_ID, {
      outputs: [{ documentId: DOC_A, knowledgeBaseId: KB_DEPT }],
    });

    // 幂等：不重复转存、不重复写事件，按当前状态返回视图。
    expect(harness.knowledgeDocuments.saveFromSource).not.toHaveBeenCalled();
    expect(harness.taskEvents.appendInTransaction).not.toHaveBeenCalled();
    expect(view.outputs[0]?.confirmed).toBe(true);
  });

  it('returns 409 when the output was archived to another knowledge base', async () => {
    const harness = createHarness({
      steps: [step({ stepKey: 's1', outputRefs: [{ type: 'DOCUMENT', id: DOC_A }] })],
      plans: [{ version: 1, steps: [{ stepKey: 's1', title: '汇总报告' }] }],
      documents: [{ id: DOC_A, title: '销售报告' }],
      events: [confirmedEvent(KB_DEPT, KDOC_1)],
    });

    await expect(
      harness.service.confirmOutputs(TASK_ID, {
        outputs: [{ documentId: DOC_A, knowledgeBaseId: KB_TENANT }],
      }),
    ).rejects.toMatchObject({ response: { code: 'TASK_OUTPUT_ALREADY_ARCHIVED' } });
    expect(harness.knowledgeDocuments.saveFromSource).not.toHaveBeenCalled();
  });

  it('archives the output through the knowledge pipeline and records output_confirmed', async () => {
    const harness = createHarness({
      steps: [step({ stepKey: 's1', outputRefs: [{ type: 'DOCUMENT', id: DOC_A }] })],
      plans: [{ version: 1, steps: [{ stepKey: 's1', title: '汇总报告' }] }],
      documents: [{ id: DOC_A, title: '销售报告' }],
      permission: {
        result: {
          id: KB_TENANT,
          name: '公司库',
          visibilityScope: 'TENANT',
          departmentId: null,
          projectId: null,
        },
      },
      saved: { id: KDOC_2, visibilityScope: 'TENANT' },
    });

    const view = await harness.service.confirmOutputs(TASK_ID, {
      outputs: [{ documentId: DOC_A, knowledgeBaseId: KB_TENANT }],
    });

    // 目标库权限校验：EDITOR 门槛（manage_all 短路在知识库服务内）。
    expect(harness.knowledge.assertKnowledgeBaseMemberPermission).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: USER_ID,
      permissions: [],
      knowledgeBaseId: KB_TENANT,
      minimumPermission: 'EDITOR',
    });
    // 转存：sourceType=DOCUMENT 锚定来源（同源重复转存追加版本），可见范围跟随归档库。
    expect(harness.knowledgeDocuments.saveFromSource).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, membershipId: MEMBERSHIP_ID }),
      {
        knowledgeBaseId: KB_TENANT,
        sourceType: 'DOCUMENT',
        sourceId: DOC_A,
        name: '销售报告',
        visibilityScope: 'TENANT',
        departmentId: null,
        projectId: null,
      },
    );
    // 事件：任务行锁下写入 output_confirmed（payload 四字段）。
    expect(harness.prisma.$queryRaw).toHaveBeenCalled();
    expect(harness.taskEvents.appendInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      TASK_ID,
      TENANT_ID,
      {
        type: 'output_confirmed',
        documentId: DOC_A,
        knowledgeBaseId: KB_TENANT,
        knowledgeDocumentId: KDOC_2,
        visibilityScope: 'TENANT',
      },
    );
    expect(view.outputs[0]).toMatchObject({
      confirmed: true,
      archive: { knowledgeBaseId: KB_TENANT, knowledgeDocumentId: KDOC_2 },
    });
  });

  it('returns 404 semantics when the task does not belong to the current member', async () => {
    const harness = createHarness({ task: null });

    await expect(
      harness.service.confirmOutputs(TASK_ID, { outputs: [{ documentId: DOC_A, knowledgeBaseId: KB_TENANT }] }),
    ).rejects.toMatchObject({ response: { code: 'TASK_NOT_FOUND' } });
  });
});

interface HarnessOptions {
  task?: Record<string, unknown> | null;
  taskStatus?: string;
  steps?: Array<Record<string, unknown>>;
  plans?: Array<Record<string, unknown>>;
  documents?: Array<{ id: string; title: string }>;
  events?: Array<{ payload: Record<string, unknown>; createdAt: Date }>;
  membership?: { departmentId: string | null };
  members?: Array<{ knowledgeBaseId: string }>;
  knowledgeBases?: Array<Record<string, unknown>>;
  permission?: { result: Record<string, unknown> };
  saved?: Record<string, unknown>;
  invokeResult?: Record<string, unknown>;
  invokeError?: Error;
}

function createHarness(options: HarnessOptions = {}) {
  const task = options.task === undefined
    ? {
      id: TASK_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      membershipId: MEMBERSHIP_ID,
      conversationId: null,
      status: options.taskStatus ?? 'COMPLETED',
      title: '月度报告',
      goal: '生成月度报告',
      planVersion: 2,
    }
    : options.task;

  // 事件队列：appendInTransaction 会同步追加，使确认后的视图重建读数真实。
  const eventsState: Array<{ payload: Record<string, unknown>; createdAt: Date }> =
    (options.events ?? []).map((event) => ({ ...event }));
  const prisma = {
    assistantTask: { findFirst: jest.fn().mockResolvedValue(task) },
    assistantTaskStep: { findMany: jest.fn().mockResolvedValue(options.steps ?? []) },
    assistantTaskPlan: { findMany: jest.fn().mockResolvedValue(options.plans ?? []) },
    assistantTaskEvent: {
      findMany: jest.fn(async () => eventsState.map((event) => ({ ...event }))),
    },
    managedDocument: { findMany: jest.fn().mockResolvedValue(options.documents ?? []) },
    knowledgeBase: { findMany: jest.fn().mockResolvedValue(options.knowledgeBases ?? []) },
    knowledgeBaseMember: { findMany: jest.fn().mockResolvedValue(options.members ?? []) },
    tenantMembership: {
      findUnique: jest.fn().mockResolvedValue(options.membership ?? { departmentId: null }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (transaction: unknown) => Promise<unknown>) => callback(prisma),
  );

  const tenantContext = {
    require: () => ({
      tenantId: TENANT_ID,
      userId: USER_ID,
      membershipId: MEMBERSHIP_ID,
      requestId: 'req-1',
      roles: [],
      permissions: [],
    }),
  };
  const knowledge = {
    assertKnowledgeBaseMemberPermission: jest.fn().mockResolvedValue(
      options.permission?.result ?? {
        id: KB_TENANT,
        name: '公司库',
        visibilityScope: 'TENANT',
        departmentId: null,
        projectId: null,
      },
    ),
  };
  const knowledgeDocuments = {
    saveFromSource: jest.fn().mockResolvedValue(options.saved ?? { id: KDOC_2, visibilityScope: 'TENANT' }),
  };
  const gateway = {
    invoke: options.invokeError
      ? jest.fn().mockRejectedValue(options.invokeError)
      : jest.fn().mockResolvedValue(options.invokeResult),
  };
  const taskEvents = {
    appendInTransaction: jest.fn(
      async (_transaction: unknown, _taskId: string, _tenantId: string, event: Record<string, unknown>) => {
        eventsState.push({
          payload: { ...event, seq: eventsState.length + 1 },
          createdAt: new Date(),
        });
        return eventsState.length;
      },
    ),
  };

  const service = new TaskOutputsService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
    taskEvents as unknown as TaskEventService,
    knowledge as unknown as KnowledgeService,
    knowledgeDocuments as unknown as KnowledgeDocumentService,
    gateway as unknown as AiServiceGateway,
  );
  return { service, prisma, taskEvents, knowledge, knowledgeDocuments, gateway };
}

function step(overrides: Record<string, unknown>) {
  return {
    stepKey: 's1',
    planVersion: 1,
    completedAt: new Date('2026-09-29T01:00:00.000Z'),
    outputRefs: [],
    ...overrides,
  };
}

function confirmedEvent(knowledgeBaseId: string, knowledgeDocumentId: string) {
  return {
    payload: {
      type: 'output_confirmed',
      seq: 3,
      documentId: DOC_A,
      knowledgeBaseId,
      knowledgeDocumentId,
      visibilityScope: 'DEPARTMENT',
    },
    createdAt: new Date('2026-09-29T03:00:00.000Z'),
  };
}
