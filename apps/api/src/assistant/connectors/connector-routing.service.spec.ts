import { BadGatewayException, BadRequestException } from '@nestjs/common';
import type { ToolTurnStreamEvent } from '@cees/ai-service-client';
import type { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import type { TenantContext } from '../../tenant/tenant-context';
import type { ConnectorRoutingCandidateInput } from '../assistant.types';
import { ConnectorRoutingService } from './connector-routing.service';
import { MODEL_TOOL_DESCRIPTION_MAX_LENGTH, MODEL_TOOL_NAME_PATTERN } from './model-tool-definition';

describe('ConnectorRoutingService', () => {
  const context = {
    tenantId: '10000000-0000-0000-0000-000000000001',
    userId: '20000000-0000-0000-0000-000000000001',
    membershipId: '30000000-0000-0000-0000-000000000001',
    requestId: 'request-1',
    roles: [],
    permissions: [],
  };
  const connectors: ConnectorRoutingCandidateInput[] = [{
    provider: 'DINGTALK',
    displayName: '钉钉',
    capabilitySummary: '查询本人可见的钉钉考勤、审批、日历与群聊消息。',
    routingExamples: ['我这个月打了几天卡', '我有哪些待审批'],
    state: 'READY',
    toolCount: 120,
  }, {
    provider: 'TENCENT_MEETING',
    displayName: '腾讯会议',
    capabilitySummary: '查询本人腾讯会议的日程、历史会议与参会人。',
    routingExamples: ['我今天的会议', '上周开了哪些会'],
    state: 'READY',
    toolCount: 18,
  }];

  it('把一级能力摘要交给模型并只返回目录内的连接器', async () => {
    const streamToolTurn: jest.Mock = jest.fn(async () => stream([
      {
        type: 'tool_calls',
        tool_calls: [{
          id: 'call-1',
          name: 'select_connectors',
          arguments: { providers: ['TENCENT_MEETING'], reason: '问的是会议' },
        }],
      },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ]));
    const service = createService(streamToolTurn);

    await expect(service.route('我今天的会议', connectors)).resolves.toEqual({
      providers: ['TENCENT_MEETING'],
      clarification: null,
      reason: '问的是会议',
    });
    expect(streamToolTurn).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: context.tenantId,
      user_id: context.userId,
      tools: [
        expect.objectContaining({ name: 'select_connectors' }),
      ],
      instructions: expect.stringContaining('provider=TENCENT_MEETING'),
    }), expect.objectContaining({ membershipId: context.membershipId }));
    // 一级目录只上报能力摘要，不携带工具名或参数。
    const request = streamToolTurn.mock.calls[0]![0] as { instructions: string };
    expect(request.instructions).not.toContain('toolId');
  });

  it('路由工具定义满足 ai-service 契约的名称与描述上限', async () => {
    const streamToolTurn: jest.Mock = jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'select_connectors', arguments: { providers: [], reason: '不需要' } }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ]));
    const service = createService(streamToolTurn);

    await expect(service.route('你好', connectors)).resolves.toEqual({
      providers: [],
      clarification: null,
      reason: '不需要',
    });
    const definitions = streamToolTurn.mock.calls[0]![0].tools as Array<{ name: string; description: string }>;
    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.name).toMatch(MODEL_TOOL_NAME_PATTERN);
    expect(definitions[0]!.description.length).toBeLessThanOrEqual(MODEL_TOOL_DESCRIPTION_MAX_LENGTH);
  });

  it('只有一个就绪连接器时直接命中，不调用模型', async () => {
    const streamToolTurn = jest.fn();
    const service = createService(streamToolTurn);

    await expect(service.route('我今天的会议', [connectors[1]!])).resolves.toEqual({
      providers: ['TENCENT_MEETING'],
      clarification: null,
      reason: '仅 腾讯会议 处于就绪状态',
    });
    expect(streamToolTurn).not.toHaveBeenCalled();
  });

  it('没有就绪连接器时返回空结果，不调用模型', async () => {
    const streamToolTurn = jest.fn();
    const service = createService(streamToolTurn);

    await expect(service.route('我今天的会议', [
      { ...connectors[0]!, state: 'AUTH_REQUIRED' },
      { ...connectors[1]!, state: 'NOT_INSTALLED' },
    ])).resolves.toEqual({
      providers: [],
      clarification: null,
      reason: '没有处于就绪状态的连接器',
    });
    expect(streamToolTurn).not.toHaveBeenCalled();
  });

  it('模型返回澄清问题时清空连接器选择', async () => {
    const streamToolTurn = jest.fn(async () => stream([
      {
        type: 'tool_calls',
        tool_calls: [{
          id: 'call-1',
          name: 'select_connectors',
          arguments: {
            providers: ['DINGTALK'],
            clarification: '你想查钉钉考勤还是腾讯会议？',
            reason: '目标不唯一',
          },
        }],
      },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ]));
    const service = createService(streamToolTurn);

    await expect(service.route('帮我看看今天的记录', connectors)).resolves.toEqual({
      providers: [],
      clarification: '你想查钉钉考勤还是腾讯会议？',
      reason: '目标不唯一',
    });
  });

  it('拒绝目录外的连接器与重复候选', async () => {
    const outOfCatalog = createService(jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'select_connectors', arguments: { providers: ['GITHUB'], reason: 'x' } }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ])));
    await expect(outOfCatalog.route('我今天的会议', connectors)).rejects.toBeInstanceOf(BadGatewayException);

    const duplicated = createService(jest.fn());
    await expect(duplicated.route('我今天的会议', [connectors[0]!, { ...connectors[0]! }]))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('未返回选择结果或上游未完成时拒绝返回不完整路由', async () => {
    const empty = createService(jest.fn(async () => stream([
      { type: 'completed', latency_ms: 1, finish_reason: 'stop' },
    ])));
    await expect(empty.route('我今天的会议', connectors)).rejects.toThrow('未返回选择结果');

    const incomplete = createService(jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'select_connectors', arguments: { providers: [], reason: 'x' } }] },
    ])));
    await expect(incomplete.route('我今天的会议', connectors)).rejects.toThrow('未正常完成');
  });

  it('把最近几轮对话随本轮问题一起交给模型，用于消解省略式追问', async () => {
    const streamToolTurn: jest.Mock = jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'select_connectors', arguments: { providers: ['DINGTALK'], reason: '延续上一轮考勤话题' } }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ]));
    const service = createService(streamToolTurn);

    await expect(service.route('那这个月的呢', connectors, {
      previousProviders: ['DINGTALK'],
      recentMessages: [
        { role: 'user', content: '帮我查一下考勤' },
        { role: 'assistant', content: '可以问我本月的打卡情况' },
      ],
    })).resolves.toEqual({ providers: ['DINGTALK'], clarification: null, reason: '延续上一轮考勤话题' });

    const request = streamToolTurn.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
      instructions: string;
    };
    // 历史轮次在前、本轮问题在最后，模型才能把「那这个月的呢」接回上一轮话题。
    expect(request.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(request.messages[0]!.content[0]!.text).toBe('帮我查一下考勤');
    expect(request.messages[2]!.content[0]!.text).toBe('那这个月的呢');
    expect(request.instructions).toContain('elliptical');
    expect(request.instructions).toContain('Connectors used in the previous turn');
    expect(request.instructions).toContain('DINGTALK');
  });

  it('上一轮连接器先与就绪候选集求交：未就绪或目录外的提示一律丢弃', async () => {
    const streamToolTurn: jest.Mock = jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'select_connectors', arguments: { providers: [], reason: '不需要' } }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ]));
    const service = createService(streamToolTurn);

    await service.route('你好', [
      // 两个就绪连接器才会走模型，否则会命中「仅一个就绪」的确定性捷径。
      { ...connectors[0]!, state: 'AUTH_REQUIRED' },
      connectors[1]!,
      { provider: 'WECOM', displayName: '企业微信', capabilitySummary: '查询企业微信消息与日程。', state: 'READY', toolCount: 90 },
    ], { previousProviders: ['DINGTALK', 'GITHUB'] });

    const request = streamToolTurn.mock.calls[0]![0] as { instructions: string };
    // 钉钉未就绪、GitHub 不在一级目录中：两者都不得作为「上一轮连接器」提示出现。
    expect(request.instructions).not.toContain('Connectors used in the previous turn');
    expect(request.instructions).not.toContain('DINGTALK');
    expect(request.instructions).not.toContain('GITHUB');
  });

  function createService(streamToolTurn: jest.Mock): ConnectorRoutingService {
    return new ConnectorRoutingService(
      { streamToolTurn } as unknown as AiServiceGateway,
      { require: () => context } as unknown as TenantContext,
    );
  }
});

async function* stream(events: ToolTurnStreamEvent[]): AsyncGenerator<ToolTurnStreamEvent> {
  for (const event of events) yield event;
}
