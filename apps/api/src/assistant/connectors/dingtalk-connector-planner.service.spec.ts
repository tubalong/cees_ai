import { BadGatewayException } from '@nestjs/common';
import type { ToolTurnStreamEvent } from '@cees/ai-service-client';
import type { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import type { TenantContext } from '../../tenant/tenant-context';
import { DingTalkConnectorPlannerService } from './dingtalk-connector-planner.service';

describe('DingTalkConnectorPlannerService', () => {
  const context = {
    tenantId: '10000000-0000-0000-0000-000000000001',
    userId: '20000000-0000-0000-0000-000000000001',
    membershipId: '30000000-0000-0000-0000-000000000001',
    requestId: 'request-1',
    roles: [],
    permissions: [],
  };
  const tools = [{
    toolId: 'dws_read_0123456789abcdef',
    name: 'calendar.event.list',
    description: '查询当前账号可见日程',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { start: { type: 'string' } },
    },
  }];

  it('只返回目录内的模型工具调用', async () => {
    const streamToolTurn = jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: tools[0]!.toolId, arguments: { start: '2026-09-20' } }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ]));
    const service = new DingTalkConnectorPlannerService(
      { streamToolTurn } as unknown as AiServiceGateway,
      { require: () => context } as unknown as TenantContext,
    );

    await expect(service.plan('查我今天的日程', tools)).resolves.toEqual({
      calls: [{ toolId: tools[0]!.toolId, arguments: { start: '2026-09-20' } }],
    });
    expect(streamToolTurn).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: context.tenantId,
      user_id: context.userId,
      tools: [expect.objectContaining({ name: tools[0]!.toolId })],
    }), expect.objectContaining({ membershipId: context.membershipId }));
  });

  it('拒绝模型返回目录外工具', async () => {
    const service = new DingTalkConnectorPlannerService(
      { streamToolTurn: jest.fn(async () => stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'dws_read_ffffffffffffffff', arguments: {} }] },
        { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
      ])) } as unknown as AiServiceGateway,
      { require: () => context } as unknown as TenantContext,
    );

    await expect(service.plan('查询数据', tools)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('工具超过上游 32 个限制时先从完整目录动态选择候选', async () => {
    const manyTools = Array.from({ length: 33 }, (_, index) => ({
      ...tools[0]!,
      toolId: `dws_read_${index.toString(16).padStart(16, '0')}`,
      name: `calendar.event.list_${index}`,
    }));
    const selected = manyTools[32]!;
    const streamToolTurn = jest.fn()
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'select-1', name: 'select_dws_read_tools', arguments: { toolIds: [selected.toolId] } }] },
        { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: selected.toolId, arguments: { start: '2026-09-20' } }] },
        { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
      ]));
    const service = new DingTalkConnectorPlannerService(
      { streamToolTurn } as unknown as AiServiceGateway,
      { require: () => context } as unknown as TenantContext,
    );

    await expect(service.plan('查我今天的日程', manyTools)).resolves.toEqual({
      calls: [{ toolId: selected.toolId, arguments: { start: '2026-09-20' } }],
    });
    expect(streamToolTurn).toHaveBeenCalledTimes(2);
    expect(streamToolTurn.mock.calls[0]![0].tools).toHaveLength(1);
    expect(streamToolTurn.mock.calls[1]![0].tools).toEqual([expect.objectContaining({ name: selected.toolId })]);
  });
});

async function* stream(events: ToolTurnStreamEvent[]): AsyncGenerator<ToolTurnStreamEvent> {
  for (const event of events) yield event;
}
