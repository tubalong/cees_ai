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

  it('prunes WRITE tools and step-excluded tools from the tool face', async () => {
    const harness = createHarness({
      tools: [
        READ_TOOL,
        { ...READ_TOOL, name: 'create_task', riskLevel: 'WRITE' },
        { ...READ_TOOL, name: 'generate_xlsx', riskLevel: 'EXTERNAL' },
        { ...READ_TOOL, name: 'create_orchestration_task', riskLevel: 'WRITE' },
      ],
    });
    harness.gateway.streamToolTurn.mockResolvedValueOnce(stream([
      { type: 'completed', latency_ms: 2, finish_reason: 'stop' },
    ]));

    await harness.service.executeStep(executionInput());

    const request = harness.gateway.streamToolTurn.mock.calls[0]![0] as Record<string, any>;
    expect(request.tools).toEqual([{
      name: 'knowledge_search',
      description: READ_TOOL.description,
      parameters: READ_TOOL.parameters,
    }]);
  });

  it('rejects a WRITE tool call hallucinated by the model', async () => {
    const harness = createHarness({ tools: [READ_TOOL] });
    harness.gateway.streamToolTurn
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-9', name: 'import_finance_ledger', arguments: {} }] },
        { type: 'completed', latency_ms: 4, finish_reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(stream([
        { type: 'content_delta', text: '该操作改由用户在对话中发起。' },
        { type: 'completed', latency_ms: 4, finish_reason: 'stop' },
      ]));
    const writeExecute = jest.fn();
    harness.toolPolicy.approve.mockReturnValue({
      definition: { ...READ_TOOL, name: 'import_finance_ledger', riskLevel: 'WRITE', displayName: '导入台账', execute: writeExecute },
      parsedArguments: {},
    });
    harness.state.createStepToolCall.mockImplementation(echoRecord);

    await harness.service.executeStep(executionInput());

    expect(harness.state.rejectStepToolCall).toHaveBeenCalledWith(expect.objectContaining({
      code: 'STEP_TOOL_FORBIDDEN',
      toolCallId: 'tc-call-9',
    }));
    expect(writeExecute).not.toHaveBeenCalled();
    // 拒绝后循环继续：模型下一轮给出替代结论。
    expect(harness.state.succeedStep).toHaveBeenCalledWith(expect.objectContaining({
      summary: '该操作改由用户在对话中发起。',
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
  };
  const taskEvents = { append: jest.fn().mockResolvedValue(1) };
  const service = new StepRunnerService(
    prisma as unknown as PrismaService,
    gateway as unknown as AiServiceGateway,
    toolRegistry as unknown as ToolRegistryService,
    toolPolicy as unknown as ToolPolicyService,
    state as unknown as StepStateService,
    taskEvents as unknown as TaskEventService,
  );
  return { service, prisma, gateway, toolPolicy, state, taskEvents };
}

async function* stream(events: ToolTurnStreamEvent[]): AsyncGenerator<ToolTurnStreamEvent> {
  for (const event of events) yield event;
}

async function* chatStream(events: ChatStreamEvent[]): AsyncGenerator<ChatStreamEvent> {
  for (const event of events) yield event;
}
