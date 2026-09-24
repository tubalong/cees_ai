import { BadGatewayException, BadRequestException } from '@nestjs/common';
import type { ToolTurnStreamEvent } from '@cees/ai-service-client';
import type { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import type { TenantContext } from '../../tenant/tenant-context';
import type { GitHubConnectorToolInput } from '../assistant.types';
import { GitHubConnectorPlannerService } from './github-connector-planner.service';

describe('GitHubConnectorPlannerService', () => {
  const context = {
    tenantId: '10000000-0000-0000-0000-000000000001',
    userId: '20000000-0000-0000-0000-000000000001',
    membershipId: '30000000-0000-0000-0000-000000000001',
    requestId: 'request-1', roles: [], permissions: [],
  };
  const tools: GitHubConnectorToolInput[] = [{
    toolId: 'list_issues', name: 'List issues', description: 'List issues in a GitHub repository',
    parameters: { type: 'object', additionalProperties: false, properties: { owner: { type: 'string' }, repo: { type: 'string' } }, required: ['owner', 'repo'] },
    riskLevel: 'READ', requiresConfirmation: false,
  }, {
    toolId: 'create_issue', name: 'Create issue', description: 'Create an issue in a GitHub repository',
    parameters: { type: 'object', additionalProperties: false, properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' } }, required: ['owner', 'repo', 'title'] },
    riskLevel: 'WRITE', requiresConfirmation: true,
  }];

  it('只返回动态目录内的 GitHub MCP 工具调用', async () => {
    const streamToolTurn = jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'github_tool_1', arguments: { owner: 'openai', repo: 'openai-node' } }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ]));
    const service = createService(streamToolTurn);
    await expect(service.plan('查看 openai/openai-node 的 issue', tools)).resolves.toEqual({
      calls: [{ toolId: 'list_issues', arguments: { owner: 'openai', repo: 'openai-node' } }],
    });
    expect(streamToolTurn).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: context.tenantId,
      user_id: context.userId,
      tools: expect.arrayContaining([expect.objectContaining({ name: 'github_tool_1' })]),
    }), expect.objectContaining({ membershipId: context.membershipId }));
  });

  it('拒绝目录外工具和风险确认标记不一致', async () => {
    const unknownToolService = createService(jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'unknown_tool', arguments: {} }] },
      { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
    ])));
    await expect(unknownToolService.plan('查询 GitHub', tools)).rejects.toBeInstanceOf(BadGatewayException);
    const invalidRiskService = createService(jest.fn());
    await expect(invalidRiskService.plan('查询 GitHub', [{ ...tools[0]!, requiresConfirmation: true }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('拒绝重复工具 ID', async () => {
    const service = createService(jest.fn());
    await expect(service.plan('查询 GitHub', [tools[0]!, { ...tools[0]! }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('工具超过 32 个时先选择候选再规划调用', async () => {
    const manyTools = Array.from({ length: 33 }, (_, index): GitHubConnectorToolInput => ({ ...tools[0]!, toolId: `list_issues_${index}`, name: `List issues ${index}` }));
    const selected = manyTools[32]!;
    const streamToolTurn = jest.fn()
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'select-1', name: 'select_github_tools', arguments: { toolIds: [selected.toolId] } }] },
        { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
      ]))
      .mockResolvedValueOnce(stream([
        { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'github_tool_1', arguments: { owner: 'openai', repo: 'openai-node' } }] },
        { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' },
      ]));
    const service = createService(streamToolTurn);
    await expect(service.plan('查询 GitHub', manyTools)).resolves.toEqual({ calls: [{ toolId: selected.toolId, arguments: { owner: 'openai', repo: 'openai-node' } }] });
    expect(streamToolTurn).toHaveBeenCalledTimes(2);
    expect(streamToolTurn.mock.calls[0]![0].tools).toHaveLength(1);
    expect(streamToolTurn.mock.calls[1]![0].tools).toEqual([expect.objectContaining({ name: 'github_tool_1' })]);
  });

  it('上游事件流未完成时拒绝返回不完整计划', async () => {
    const service = createService(jest.fn(async () => stream([
      { type: 'tool_calls', tool_calls: [{ id: 'call-1', name: 'github_tool_1', arguments: {} }] },
    ])));
    await expect(service.plan('查询 GitHub', tools)).rejects.toThrow('规划未正常完成');
  });

  function createService(streamToolTurn: jest.Mock): GitHubConnectorPlannerService {
    return new GitHubConnectorPlannerService(
      { streamToolTurn } as unknown as AiServiceGateway,
      { require: () => context } as unknown as TenantContext,
    );
  }
});

async function* stream(events: ToolTurnStreamEvent[]): AsyncGenerator<ToolTurnStreamEvent> {
  for (const event of events) yield event;
}
