import { BadGatewayException, BadRequestException } from '@nestjs/common';
import type { ToolTurnStreamEvent } from '@cees/ai-service-client';
import type { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import type { TenantContext } from '../../tenant/tenant-context';
import type { WeComConnectorToolInput } from '../assistant.types';
import { WeComConnectorPlannerService } from './wecom-connector-planner.service';

describe('WeComConnectorPlannerService', () => {
  const context = {
    tenantId: '10000000-0000-0000-0000-000000000001',
    userId: '20000000-0000-0000-0000-000000000001',
    membershipId: '30000000-0000-0000-0000-000000000001',
    requestId: 'request-1',
    roles: [],
    permissions: [],
  };
  const tools: WeComConnectorToolInput[] = [{
    toolId: 'calendar.schedules.list',
    name: '查询日程列表',
    description: '查询当前机器人授权可见的日程列表',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { start_time: { type: 'string' } },
    },
    riskLevel: 'READ',
    requiresConfirmation: false,
  }, {
    toolId: 'calendar.schedules.delete',
    name: '删除日程',
    description: '删除指定日程',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { meeting_id: { type: 'string' } },
      required: ['meeting_id'],
    },
    riskLevel: 'DESTRUCTIVE',
    requiresConfirmation: true,
  }];

  it('只返回动态目录内的企业微信工具调用', async () => {
    const streamToolTurn = jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'wecom_tool_1', arguments: { start_time: '2026-09-23' } }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ]));
    const service = createService(streamToolTurn);

    await expect(service.plan('查我今天的企业微信', tools)).resolves.toEqual({
      calls: [{ toolId: 'calendar.schedules.list', arguments: { start_time: '2026-09-23' } }],
    });
    expect(streamToolTurn).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: context.tenantId,
      user_id: context.userId,
      tools: expect.arrayContaining([expect.objectContaining({ name: 'wecom_tool_1' })]),
    }), expect.objectContaining({ membershipId: context.membershipId }));
  });

  it('拒绝目录外工具和风险确认标记不一致', async () => {
    const unknownToolService = createService(jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'unknown_tool', arguments: {} }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ])));
    await expect(unknownToolService.plan('查询企业微信', tools)).rejects.toBeInstanceOf(BadGatewayException);

    const invalidRisk = [{ ...tools[0]!, requiresConfirmation: true }];
    const invalidRiskService = createService(jest.fn());
    await expect(invalidRiskService.plan('查询企业微信', invalidRisk)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('拒绝重复工具 ID', async () => {
    const service = createService(jest.fn());
    await expect(service.plan('查询企业微信', [tools[0]!, { ...tools[0]! }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('工具超过 32 个时先选择候选再规划调用', async () => {
    const manyTools = Array.from({ length: 33 }, (_, index): WeComConnectorToolInput => ({
      ...tools[0]!,
      toolId: `calendar.schedules.list_${index}`,
      name: `查询日程列表 ${index}`,
    }));
    const selected = manyTools[32]!;
    const streamToolTurn = jest.fn()
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'select-1', name: 'select_wecom_tools', arguments: { toolIds: [selected.toolId] } }] },
        { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'wecom_tool_1', arguments: {} }] },
        { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
      ]));
    const service = createService(streamToolTurn);

    await expect(service.plan('查询企业微信', manyTools)).resolves.toEqual({
      calls: [{ toolId: selected.toolId, arguments: {} }],
    });
    expect(streamToolTurn).toHaveBeenCalledTimes(2);
    expect(streamToolTurn.mock.calls[0]![0].tools).toHaveLength(1);
    expect(streamToolTurn.mock.calls[1]![0].tools).toEqual([expect.objectContaining({ name: 'wecom_tool_1' })]);
  });

  it('上游事件流未完成时拒绝返回不完整计划', async () => {
    const service = createService(jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'wecom_tool_1', arguments: {} }] },
    ])));

    await expect(service.plan('查询企业微信', tools)).rejects.toThrow('规划未正常完成');
  });

  function createService(streamToolTurn: jest.Mock): WeComConnectorPlannerService {
    return new WeComConnectorPlannerService(
      { streamToolTurn } as unknown as AiServiceGateway,
      { require: () => context } as unknown as TenantContext,
    );
  }
});

async function* stream(events: ToolTurnStreamEvent[]): AsyncGenerator<ToolTurnStreamEvent> {
  for (const event of events) yield event;
}
