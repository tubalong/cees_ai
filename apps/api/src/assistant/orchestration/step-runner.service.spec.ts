import type { ToolTurnStreamEvent, ChatStreamEvent } from '@cees/ai-service-client';
import type { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import type { PrismaService } from '../../database/prisma.service';
import {
  isActiveMembership,
  resolveMembershipAuthorization,
} from '../../rbac/authorization-resolver';
import type { ToolDefinition } from '../tools/tool.types';
import { ToolPolicyService } from '../tools/tool-policy.service';
import { ToolRegistryService } from '../tools/tool-registry';
import type { InteractionService } from './interaction.service';
import { StepRunnerService } from './step-runner.service';
import { StepStateService } from './step-state.service';
import { TaskEventService } from './task-event.service';

jest.mock('../../rbac/authorization-resolver', () => ({
  isActiveMembership: jest.fn(),
  resolveMembershipAuthorization: jest.fn(),
}));

const mockedIsActiveMembership = jest.mocked(isActiveMembership);
const mockedResolveAuthorization = jest.mocked(resolveMembershipAuthorization);

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const TASK_ID = '20000000-0000-0000-0000-000000000001';
const STEP_ID = '30000000-0000-0000-0000-000000000001';
const USER_ID = '40000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const AGENT_ID = '60000000-0000-0000-0000-000000000001';
const EXECUTION_OWNER = 'api:test:owner';

const READ_TOOL = {
  name: 'knowledge_search',
  version: '1.0.0',
  displayName: '知识检索',
  description: '检索企业内部知识库',
  parameters: { type: 'object', properties: { query: { type: 'string' } } },
  requiredPermissions: [],
  riskLevel: 'READ',
};

const WRITE_TOOL = {
  name: 'import_finance_ledger',
  version: '1.0.0',
  displayName: '导入台账',
  description: '导入财务台账',
  parameters: { type: 'object', properties: {} },
  requiredPermissions: ['finance.ledger.import'],
  riskLevel: 'WRITE',
};

describe('StepRunnerService', () => {
  beforeEach(() => {
    mockedIsActiveMembership.mockResolvedValue(true);
    mockedResolveAuthorization.mockResolvedValue({ permissions: [], roles: [] });
  });

  it('executes a step tool call and returns the model final summary with deduplicated output refs', async () => {
    const harness = createHarness({
      tools: [READ_TOOL],
      outputRefRows: [
        { executedResourceType: 'DOCUMENT', executedResourceId: 'doc-1' },
        { executedResourceType: 'DOCUMENT', executedResourceId: 'doc-1' },
        { executedResourceType: null, executedResourceId: null },
      ],
    });
    harness.gateway.streamToolTurn
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'knowledge_search', arguments: { query: '销售' } }] },
        { type: 'completed', latency_ms: 5, finish_reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(stream([
        { type: 'content_delta', text: '已汇总季度数据，结论：增长 12%。' },
        { type: 'completed', latency_ms: 6, finish_reason: 'stop' },
      ]));
    const execute = jest.fn().mockResolvedValue({
      summary: '找到 3 条记录',
      resourceType: 'DOCUMENT',
      resourceId: 'doc-1',
    });
    harness.toolPolicy.approve.mockReturnValue({
      definition: { ...READ_TOOL, execute },
      parsedArguments: { query: '销售' },
    });
    harness.state.createStepToolCall.mockImplementation(echoRecord);

    await harness.service.executeStep(executionInput());

    // 派发书：目标、本步要求与预算随 claimStep 落库。
    expect(harness.state.claimStep).toHaveBeenCalledWith(expect.objectContaining({
      taskId: TASK_ID,
      stepId: STEP_ID,
      executionOwner: EXECUTION_OWNER,
      stepKey: 's1',
      brief: expect.objectContaining({
        taskGoal: '完成季度销售分析',
        stepRequirement: '收集季度销售数据',
        toolPolicy: { knowledgeBase: true, webSearch: false },
        budget: { maxModelCalls: 5, maxToolCalls: 10 },
      }),
    }));
    // 步骤载体：turnId 为 null、taskStepId 填充、WRITE 不在执行面。
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: null,
        taskStepId: STEP_ID,
        taskId: TASK_ID,
        knowledgeBaseEnabled: true,
        webSearchEnabled: false,
      }),
      { query: '销售' },
    );
    expect(harness.state.completeStepToolCall).toHaveBeenCalledWith(expect.objectContaining({
      summary: '找到 3 条记录',
      resourceType: 'DOCUMENT',
      resourceId: 'doc-1',
    }));
    expect(harness.state.succeedStep).toHaveBeenCalledWith(expect.objectContaining({
      summary: '已汇总季度数据，结论：增长 12%。',
      outputRefs: [{ type: 'DOCUMENT', id: 'doc-1' }],
    }));
    // 工具执行播报只用显示名，任务事件不出现工具级明细。
    expect(harness.taskEvents.append).toHaveBeenCalledWith(TASK_ID, TENANT_ID, expect.objectContaining({
      type: 'step_progress',
      stepId: STEP_ID,
      note: '正在执行：知识检索',
    }));
    // 空窗口注入固定触发消息；请求承载任务与步骤跟踪。
    const firstRequest = harness.gateway.streamToolTurn.mock.calls[0]![0] as Record<string, any>;
    expect(firstRequest.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '请开始执行本步骤。' }] },
    ]);
    expect(firstRequest.conversation_id).toBe(`step:${STEP_ID}`);
    expect(harness.gateway.streamToolTurn.mock.calls[0]![1]).toEqual({
      membershipId: MEMBERSHIP_ID,
      turnId: null,
      conversationId: undefined,
      taskId: TASK_ID,
      stepId: STEP_ID,
    });
  });

  it('rebuilds the step window with a synthesized assistant tool_calls prefix', async () => {
    const harness = createHarness({
      tools: [READ_TOOL],
      windowMessages: [{ role: 'TOOL', content: '工具结果：找到 3 条记录', toolCallRef: 'tc-1' }],
      windowToolCalls: [{
        id: 'tc-1',
        modelStep: 1,
        upstreamCallId: 'call-1',
        assistantContent: null,
        name: 'knowledge_search',
        arguments: { query: '销售' },
      }],
    });
    harness.gateway.streamToolTurn.mockResolvedValueOnce(stream([
      { type: 'content_delta', text: '完成' },
      { type: 'completed', latency_ms: 3, finish_reason: 'stop' },
    ]));

    await harness.service.executeStep(executionInput());

    const request = harness.gateway.streamToolTurn.mock.calls[0]![0] as Record<string, any>;
    expect(request.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', name: 'knowledge_search', arguments: { query: '销售' } }],
      },
      {
        role: 'tool',
        content: [{ type: 'text', text: '工具结果：找到 3 条记录' }],
        tool_call_id: 'call-1',
        name: 'knowledge_search',
      },
    ]);
    expect(harness.state.succeedStep).toHaveBeenCalledWith(expect.objectContaining({ summary: '完成' }));
  });

  it('keeps WRITE tools on the tool face and prunes only step-excluded tools', async () => {
    const harness = createHarness({
      tools: [
        READ_TOOL,
        { ...READ_TOOL, name: 'create_task', riskLevel: 'WRITE', requiredPermissions: ['task.create'] },
        { ...READ_TOOL, name: 'generate_xlsx', riskLevel: 'EXTERNAL' },
        { ...READ_TOOL, name: 'create_orchestration_task', riskLevel: 'WRITE' },
      ],
    });
    harness.gateway.streamToolTurn.mockResolvedValueOnce(stream([
      { type: 'completed', latency_ms: 2, finish_reason: 'stop' },
    ]));

    await harness.service.executeStep(executionInput());

    const request = harness.gateway.streamToolTurn.mock.calls[0]![0] as Record<string, any>;
    expect(request.tools).toEqual([
      {
        name: 'knowledge_search',
        description: READ_TOOL.description,
        parameters: READ_TOOL.parameters,
      },
      {
        name: 'create_task',
        description: READ_TOOL.description,
        parameters: READ_TOOL.parameters,
      },
    ]);
  });

  it('suspends the step and raises an authorization interaction when a WRITE tool has no grant', async () => {
    const harness = createHarness({ tools: [READ_TOOL, WRITE_TOOL] });
    harness.gateway.streamToolTurn.mockResolvedValueOnce(stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-w1', name: 'import_finance_ledger', arguments: {} }] },
      { type: 'completed', latency_ms: 4, finish_reason: 'tool_calls' },
    ]));
    const writeExecute = jest.fn();
    harness.toolPolicy.approve.mockReturnValue({
      definition: { ...WRITE_TOOL, execute: writeExecute },
      parsedArguments: {},
    });
    harness.state.createStepToolCall.mockImplementation(echoRecord);

    await harness.service.executeStep(executionInput());

    expect(harness.interactions.findUsableAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      taskId: TASK_ID,
      permissionCode: 'finance.ledger.import',
    }));
    // 原子挂起：工具结算 REJECTED（写 TOOL 窗口消息）→ 创建授权交互 → 步骤 WAITING_USER。
    expect(harness.state.rejectStepToolCallInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toolCallId: 'tc-call-w1', code: 'AUTHORIZATION_REQUIRED' }),
    );
    expect(harness.interactions.createInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'AUTHORIZATION',
        stepId: STEP_ID,
        stepKey: 's1',
        permissionCode: 'finance.ledger.import',
        toolName: 'import_finance_ledger',
      }),
    );
    expect(harness.state.suspendStepInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: TASK_ID, stepId: STEP_ID, executionOwner: EXECUTION_OWNER }),
    );
    // 挂起即中止本步：不执行、不继续模型轮次、不回流终态。
    expect(writeExecute).not.toHaveBeenCalled();
    expect(harness.gateway.streamToolTurn).toHaveBeenCalledTimes(1);
    expect(harness.state.succeedStep).not.toHaveBeenCalled();
    expect(harness.state.failStep).not.toHaveBeenCalled();
  });

  it('consumes a usable authorization after claiming and executes the WRITE tool', async () => {
    const harness = createHarness({ tools: [READ_TOOL, WRITE_TOOL] });
    harness.gateway.streamToolTurn
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-w1', name: 'import_finance_ledger', arguments: {} }] },
        { type: 'completed', latency_ms: 4, finish_reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(stream([
        { type: 'content_delta', text: '台账导入完成，共 128 条。' },
        { type: 'completed', latency_ms: 4, finish_reason: 'stop' },
      ]));
    const writeExecute = jest.fn().mockResolvedValue({ summary: '导入 128 条', resourceType: null, resourceId: null });
    harness.toolPolicy.approve.mockReturnValue({
      definition: { ...WRITE_TOOL, execute: writeExecute },
      parsedArguments: {},
    });
    harness.state.createStepToolCall.mockImplementation(echoRecord);
    harness.interactions.findUsableAuthorization.mockResolvedValue({ id: 'interaction-1' });

    await harness.service.executeStep(executionInput());

    // 授权消费在抢占成功之后（失去租约不浪费用户批准），消费成功才执行。
    const claimOrder = harness.state.claimStepToolExecution.mock.invocationCallOrder[0]!;
    const consumeOrder = harness.interactions.markAuthorizationUsed.mock.invocationCallOrder[0]!;
    expect(consumeOrder).toBeGreaterThan(claimOrder);
    expect(harness.interactions.markAuthorizationUsed).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: 'interaction-1',
      membershipId: MEMBERSHIP_ID,
      tenantId: TENANT_ID,
    }));
    expect(writeExecute).toHaveBeenCalledTimes(1);
    expect(harness.state.completeStepToolCall).toHaveBeenCalledWith(expect.objectContaining({ summary: '导入 128 条' }));
    expect(harness.state.succeedStep).toHaveBeenCalledWith(expect.objectContaining({ summary: '台账导入完成，共 128 条。' }));
  });

  it('fails the tool call without executing when the grant is invalidated before consumption', async () => {
    const harness = createHarness({ tools: [READ_TOOL, WRITE_TOOL] });
    harness.gateway.streamToolTurn
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-w1', name: 'import_finance_ledger', arguments: {} }] },
        { type: 'completed', latency_ms: 4, finish_reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(stream([
        { type: 'content_delta', text: '授权已失效，未能导入。' },
        { type: 'completed', latency_ms: 4, finish_reason: 'stop' },
      ]));
    const writeExecute = jest.fn();
    harness.toolPolicy.approve.mockReturnValue({
      definition: { ...WRITE_TOOL, execute: writeExecute },
      parsedArguments: {},
    });
    harness.state.createStepToolCall.mockImplementation(echoRecord);
    harness.interactions.findUsableAuthorization.mockResolvedValue({ id: 'interaction-1' });
    harness.interactions.markAuthorizationUsed.mockResolvedValue(false);

    await harness.service.executeStep(executionInput());

    expect(writeExecute).not.toHaveBeenCalled();
    expect(harness.state.failStepToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tc-call-w1',
      code: 'AUTHORIZATION_EXPIRED',
    }));
    expect(harness.state.succeedStep).toHaveBeenCalledWith(expect.objectContaining({
      summary: '授权已失效，未能导入。',
    }));
  });

  it('rejects a repeated WRITE call after the user denied the authorization', async () => {
    const harness = createHarness({ tools: [READ_TOOL, WRITE_TOOL] });
    harness.gateway.streamToolTurn
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-w2', name: 'import_finance_ledger', arguments: {} }] },
        { type: 'completed', latency_ms: 4, finish_reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(stream([
        { type: 'content_delta', text: '缺少授权，本步骤无法完成导入。' },
        { type: 'completed', latency_ms: 4, finish_reason: 'stop' },
      ]));
    harness.toolPolicy.approve.mockReturnValue({
      definition: { ...WRITE_TOOL, execute: jest.fn() },
      parsedArguments: {},
    });
    harness.state.createStepToolCall.mockImplementation(echoRecord);
    harness.interactions.findLatestAuthorization.mockResolvedValue({ id: 'interaction-1', status: 'REJECTED' });

    await harness.service.executeStep(executionInput());

    expect(harness.state.rejectStepToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tc-call-w2',
      code: 'AUTHORIZATION_REJECTED',
    }));
    // 拒绝后不再重复挂起；循环继续由模型给出替代结论。
    expect(harness.interactions.createInTransaction).not.toHaveBeenCalled();
    expect(harness.state.suspendStepInTransaction).not.toHaveBeenCalled();
    expect(harness.state.succeedStep).toHaveBeenCalledWith(expect.objectContaining({
      summary: '缺少授权，本步骤无法完成导入。',
    }));
  });

  it('rejects a WRITE tool definition without declared permissions', async () => {
    const harness = createHarness({ tools: [READ_TOOL, WRITE_TOOL] });
    harness.gateway.streamToolTurn
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-w3', name: 'rogue_write', arguments: {} }] },
        { type: 'completed', latency_ms: 4, finish_reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(stream([
        { type: 'content_delta', text: '该操作不可用。' },
        { type: 'completed', latency_ms: 4, finish_reason: 'stop' },
      ]));
    harness.toolPolicy.approve.mockReturnValue({
      definition: { ...WRITE_TOOL, name: 'rogue_write', requiredPermissions: [], execute: jest.fn() },
      parsedArguments: {},
    });
    harness.state.createStepToolCall.mockImplementation(echoRecord);

    await harness.service.executeStep(executionInput());

    expect(harness.state.rejectStepToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tc-call-w3',
      code: 'STEP_TOOL_FORBIDDEN',
    }));
  });

  it('rejects calls beyond the per-step tool budget and fails the step', async () => {
    const harness = createHarness({ tools: [READ_TOOL] });
    const calls = Array.from({ length: 11 }, (_, index) => ({
      id: `call-${index + 1}`,
      name: 'knowledge_search',
      arguments: { query: `q${index + 1}` },
    }));
    harness.gateway.streamToolTurn.mockResolvedValueOnce(stream([
      { type: 'tool_calls', tool_calls: calls },
      { type: 'completed', latency_ms: 4, finish_reason: 'tool_calls' },
    ]));
    harness.toolPolicy.approve.mockReturnValue({
      definition: { ...READ_TOOL, execute: jest.fn().mockResolvedValue({ summary: 'ok', resourceType: null, resourceId: null }) },
      parsedArguments: { query: 'q' },
    });
    harness.state.createStepToolCall.mockImplementation(echoRecord);

    await harness.service.executeStep(executionInput());

    expect(harness.state.rejectStepToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tc-call-11',
      code: 'STEP_TOOL_LIMIT_EXCEEDED',
    }));
    expect(harness.state.completeStepToolCall).toHaveBeenCalledTimes(10);
    expect(harness.state.failStep).toHaveBeenCalledWith(expect.objectContaining({
      code: 'STEP_TOOL_LIMIT_EXCEEDED',
    }));
  });

  it('runs a plain chat step when the permission-filtered tool face is empty', async () => {
    const harness = createHarness({ tools: [] });
    harness.gateway.streamChat.mockResolvedValueOnce(chatStream([
      { type: 'content_delta', text: '数据分析结论：环比增长 12%。' },
      { type: 'completed', latency_ms: 3, finish_reason: 'stop' },
    ]));

    await harness.service.executeStep(executionInput());

    expect(harness.gateway.streamToolTurn).not.toHaveBeenCalled();
    expect(harness.gateway.streamChat).toHaveBeenCalledTimes(1);
    const request = harness.gateway.streamChat.mock.calls[0]![0] as Record<string, any>;
    expect(request.instructions).toContain('数据助理');
    expect(request.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '请开始执行本步骤。' }] },
    ]);
    expect(harness.state.succeedStep).toHaveBeenCalledWith(expect.objectContaining({
      summary: '数据分析结论：环比增长 12%。',
      outputRefs: [],
    }));
  });

  it('fails the step before any upstream call when the initiator is no longer an active member', async () => {
    const harness = createHarness({ tools: [READ_TOOL] });
    mockedIsActiveMembership.mockResolvedValue(false);

    await harness.service.executeStep(executionInput());

    expect(harness.state.failStep).toHaveBeenCalledWith(expect.objectContaining({
      code: 'MEMBERSHIP_UNAVAILABLE',
    }));
    expect(harness.gateway.streamToolTurn).not.toHaveBeenCalled();
    expect(harness.gateway.streamChat).not.toHaveBeenCalled();
  });
});

function executionInput() {
  return {
    taskId: TASK_ID,
    stepId: STEP_ID,
    executionOwner: EXECUTION_OWNER,
    signal: new AbortController().signal,
  };
}

/** 模拟 createStepToolCall 的持久化回读：字段与入参一致且状态为 PROPOSED。 */
async function echoRecord(input: {
  upstreamCallId: string;
  name: string;
  arguments: unknown;
  assistantContent?: string | null;
}) {
  return {
    id: `tc-${input.upstreamCallId}`,
    status: 'PROPOSED',
    result: null,
    errorCode: null,
    errorMessage: null,
    name: input.name,
    arguments: input.arguments,
    assistantContent: input.assistantContent ?? null,
  };
}

function createHarness(options: {
  tools?: Array<Record<string, unknown>>;
  windowMessages?: Array<{ role: string; content: string; toolCallRef: string | null }>;
  windowToolCalls?: Array<Record<string, unknown>>;
  outputRefRows?: Array<{ executedResourceType: string | null; executedResourceId: string | null }>;
} = {}) {
  const prisma: Record<string, any> = {
    assistantTask: {
      findUnique: jest.fn().mockResolvedValue({
        id: TASK_ID,
        tenantId: TENANT_ID,
        conversationId: null,
        userId: USER_ID,
        membershipId: MEMBERSHIP_ID,
        goal: '完成季度销售分析',
        status: 'RUNNING',
      }),
    },
    assistantTaskStep: {
      findUnique: jest.fn().mockResolvedValue({
        id: STEP_ID,
        taskId: TASK_ID,
        stepKey: 's1',
        stepNo: 1,
        planVersion: 1,
        status: 'READY',
        assigneeAgentId: AGENT_ID,
        dependsOn: [],
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    assistantTaskPlan: {
      findUnique: jest.fn().mockResolvedValue({
        steps: [{
          stepNo: 1,
          stepKey: 's1',
          title: '收集数据',
          requirement: '收集季度销售数据',
          assigneeAgentId: AGENT_ID,
          dependsOnStepKeys: [],
        }],
      }),
    },
    assistantAgent: {
      findUnique: jest.fn().mockResolvedValue({
        name: '数据助理',
        title: '数据分析师',
        instructions: '保持严谨与结论导向',
      }),
    },
    assistantTaskStepMessage: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(options.windowMessages ?? [])),
    },
    toolCall: {
      findMany: jest.fn().mockImplementation((args: { select?: Record<string, unknown> }) => Promise.resolve(
        args?.select?.executedResourceType ? (options.outputRefRows ?? []) : (options.windowToolCalls ?? []),
      )),
    },
    $transaction: jest.fn().mockImplementation(async (work: (tx: unknown) => unknown) => work({})),
  };
  const gateway = { streamToolTurn: jest.fn(), streamChat: jest.fn() };
  const toolRegistry = {
    listAllowedDefinitions: jest.fn().mockReturnValue(
      (options.tools ?? []) as unknown as ToolDefinition[],
    ),
  };
  const toolPolicy = { approve: jest.fn() };
  const state = {
    claimStep: jest.fn().mockResolvedValue(true),
    succeedStep: jest.fn().mockResolvedValue(true),
    failStep: jest.fn().mockResolvedValue(true),
    createStepToolCall: jest.fn(),
    claimStepToolExecution: jest.fn().mockResolvedValue(true),
    completeStepToolCall: jest.fn().mockResolvedValue(true),
    failStepToolCall: jest.fn().mockResolvedValue(true),
    rejectStepToolCall: jest.fn().mockResolvedValue(true),
    rejectStepToolCallInTransaction: jest.fn().mockResolvedValue(true),
    suspendStepInTransaction: jest.fn().mockResolvedValue(true),
  };
  const interactions = {
    findUsableAuthorization: jest.fn().mockResolvedValue(null),
    findLatestAuthorization: jest.fn().mockResolvedValue(null),
    markAuthorizationUsed: jest.fn().mockResolvedValue(true),
    createInTransaction: jest.fn().mockResolvedValue({ id: 'interaction-1' }),
  };
  const taskEvents = { append: jest.fn().mockResolvedValue(1) };
  const service = new StepRunnerService(
    prisma as unknown as PrismaService,
    gateway as unknown as AiServiceGateway,
    toolRegistry as unknown as ToolRegistryService,
    toolPolicy as unknown as ToolPolicyService,
    state as unknown as StepStateService,
    taskEvents as unknown as TaskEventService,
    interactions as unknown as InteractionService,
  );
  return { service, prisma, gateway, toolPolicy, state, taskEvents, interactions };
}

async function* stream(events: ToolTurnStreamEvent[]): AsyncGenerator<ToolTurnStreamEvent> {
  for (const event of events) yield event;
}

async function* chatStream(events: ChatStreamEvent[]): AsyncGenerator<ChatStreamEvent> {
  for (const event of events) yield event;
}
