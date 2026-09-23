import { BadGatewayException, BadRequestException } from '@nestjs/common';
import type { ToolTurnStreamEvent } from '@cees/ai-service-client';
import type { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import type { TenantContext } from '../../tenant/tenant-context';
import type { TencentMeetingConnectorToolInput } from '../assistant.types';
import { TencentMeetingConnectorPlannerService } from './tencent-meeting-connector-planner.service';

describe('TencentMeetingConnectorPlannerService', () => {
  const context = {
    tenantId: '10000000-0000-0000-0000-000000000001',
    userId: '20000000-0000-0000-0000-000000000001',
    membershipId: '30000000-0000-0000-0000-000000000001',
    requestId: 'request-1',
    roles: [],
    permissions: [],
  };
  const tools: TencentMeetingConnectorToolInput[] = [{
    toolId: 'meeting.list',
    name: '查询会议列表',
    description: '查询当前 OAuth 账号可见的会议列表',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { start_time: { type: 'string' } },
    },
    riskLevel: 'READ',
    requiresConfirmation: false,
  }, {
    toolId: 'meeting.cancel',
    name: '取消会议',
    description: '取消指定会议',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { meeting_id: { type: 'string' } },
      required: ['meeting_id'],
    },
    riskLevel: 'DESTRUCTIVE',
    requiresConfirmation: true,
  }];

  it('只返回动态目录内的腾讯会议工具调用', async () => {
    const streamToolTurn = jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'meeting.list', arguments: { start_time: '2026-09-23' } }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ]));
    const service = createService(streamToolTurn);

    await expect(service.plan('查我今天的腾讯会议', tools)).resolves.toEqual({
      calls: [{ toolId: 'meeting.list', arguments: { start_time: '2026-09-23' } }],
    });
    expect(streamToolTurn).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: context.tenantId,
      user_id: context.userId,
      tools: expect.arrayContaining([expect.objectContaining({ name: 'meeting.list' })]),
    }), expect.objectContaining({ membershipId: context.membershipId }));
  });

  it('拒绝目录外工具和风险确认标记不一致', async () => {
    const unknownToolService = createService(jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'unknown_tool', arguments: {} }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ])));
    await expect(unknownToolService.plan('查询腾讯会议', tools)).rejects.toBeInstanceOf(BadGatewayException);

    const invalidRisk = [{ ...tools[0]!, requiresConfirmation: true }];
    const invalidRiskService = createService(jest.fn());
    await expect(invalidRiskService.plan('查询腾讯会议', invalidRisk)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('拒绝重复工具 ID', async () => {
    const service = createService(jest.fn());
    await expect(service.plan('查询腾讯会议', [tools[0]!, { ...tools[0]! }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('工具超过 32 个时先选择候选再规划调用', async () => {
    const manyTools = Array.from({ length: 33 }, (_, index): TencentMeetingConnectorToolInput => ({
      ...tools[0]!,
      toolId: `meeting.list_${index}`,
      name: `查询会议列表 ${index}`,
    }));
    const selected = manyTools[32]!;
    const streamToolTurn = jest.fn()
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'select-1', name: 'select_tencent_meeting_tools', arguments: { toolIds: [selected.toolId] } }] },
        { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: selected.toolId, arguments: {} }] },
        { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
      ]));
    const service = createService(streamToolTurn);

    await expect(service.plan('查询腾讯会议', manyTools)).resolves.toEqual({
      calls: [{ toolId: selected.toolId, arguments: {} }],
    });
    expect(streamToolTurn).toHaveBeenCalledTimes(2);
    expect(streamToolTurn.mock.calls[0]![0].tools).toHaveLength(1);
    expect(streamToolTurn.mock.calls[1]![0].tools).toEqual([expect.objectContaining({ name: selected.toolId })]);
  });

  it('上游事件流未完成时拒绝返回不完整计划', async () => {
    const service = createService(jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'meeting.list', arguments: {} }] },
    ])));

    await expect(service.plan('查询腾讯会议', tools)).rejects.toThrow('规划未正常完成');
  });

  function createService(streamToolTurn: jest.Mock): TencentMeetingConnectorPlannerService {
    return new TencentMeetingConnectorPlannerService(
      { streamToolTurn } as unknown as AiServiceGateway,
      { require: () => context } as unknown as TenantContext,
    );
  }
});

async function* stream(events: ToolTurnStreamEvent[]): AsyncGenerator<ToolTurnStreamEvent> {
  for (const event of events) yield event;
}
