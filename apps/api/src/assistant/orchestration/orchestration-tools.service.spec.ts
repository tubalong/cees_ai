import type { ChatToolDefinition } from '@cees/ai-service-client';
import { PrismaService } from '../../database/prisma.service';
import { OrchestrationToolsService } from './orchestration-tools.service';

/**
 * 门控服务的核心承诺：没有在职 AI 同事时只移除编排工具，正常对话与其余
 * 工具完全不受影响；任何查询异常都 fail-closed 到「仅移除编排工具」且不抛出。
 */
describe('OrchestrationToolsService', () => {
  it('returns the same list without querying when no orchestration tool is present', async () => {
    const prisma = createPrismaMock();
    const service = new OrchestrationToolsService(prisma as unknown as PrismaService);
    const tools = [chatTool('knowledge_search'), chatTool('web_search')];

    const gated = await service.gate('tenant-1', tools);

    expect(gated).toBe(tools);
    expect(prisma.assistantAgent.findMany).not.toHaveBeenCalled();
  });

  it('removes only the orchestration tool when the tenant has no active agent', async () => {
    const prisma = createPrismaMock();
    prisma.assistantAgent.findMany.mockResolvedValue([]);
    const service = new OrchestrationToolsService(prisma as unknown as PrismaService);
    const tools = [
      chatTool('create_orchestration_task'),
      chatTool('revise_orchestration_task'),
      chatTool('web_search'),
    ];

    const gated = await service.gate('tenant-1', tools);

    expect(gated.map((tool) => tool.name)).toEqual(['web_search']);
    expect(prisma.assistantAgent.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', status: 'ACTIVE', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, title: true },
    });
  });

  it('injects the active agent roster into the orchestration tool description', async () => {
    const prisma = createPrismaMock();
    prisma.assistantAgent.findMany.mockResolvedValue([
      { id: 'agent-1', name: '财务助理', title: '财务分析' },
      { id: 'agent-2', name: '法务助理', title: '' },
    ]);
    const service = new OrchestrationToolsService(prisma as unknown as PrismaService);
    const orchestration = chatTool('create_orchestration_task');
    const search = chatTool('web_search');

    const gated = await service.gate('tenant-1', [orchestration, search]);

    expect(gated[1]).toBe(search);
    expect(gated[0].description).toContain('财务助理（财务分析），id=agent-1');
    expect(gated[0].description).toContain('法务助理（未设定职责），id=agent-2');
    // 名册注入生成新对象，不修改注册表中的原始工具定义。
    expect(orchestration.description).toBe('create_orchestration_task tool');
  });

  it('fails closed to removing orchestration tools when the agent query rejects', async () => {
    const prisma = createPrismaMock();
    prisma.assistantAgent.findMany.mockRejectedValue(new Error('database unavailable'));
    const service = new OrchestrationToolsService(prisma as unknown as PrismaService);
    const tools = [chatTool('create_orchestration_task'), chatTool('web_search')];

    const gated = await service.gate('tenant-1', tools);

    expect(gated.map((tool) => tool.name)).toEqual(['web_search']);
  });
});

function chatTool(name: string): ChatToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
  };
}

function createPrismaMock() {
  return {
    assistantAgent: { findMany: jest.fn() },
  };
}
