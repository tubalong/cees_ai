import { Injectable, Logger } from '@nestjs/common';
import { AssistantAgentStatus } from '@prisma/client';
import type { ChatToolDefinition } from '@cees/ai-service-client';
import { PrismaService } from '../../database/prisma.service';

/** 受同事门控的编排工具名；无在职 AI 同事时这些工具不进入模型工具列表。 */
export const ORCHESTRATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  'create_orchestration_task',
]);

/** 在职同事名册条目：供工具描述注入与执行器指派校验。 */
export interface ActiveAgentSummary {
  id: string;
  name: string;
  title: string;
}

/**
 * 编排能力的对话级门控。多子 agent 任务是 AI 同事能力之上的编排：
 * 企业没有在职 AI 同事（尚未配置或全部归档）时，编排工具从模型工具列表中
 * 移除——正常对话与其余工具不受任何影响；有同事时把名册注入工具描述，
 * 让模型为步骤选择合法的执行同事。
 *
 * 失败策略是 fail-closed 且只作用于编排工具：查询异常时仅移除编排工具并
 * 记录日志，本服务绝不向调用方抛出异常，保证对话链路永远可用。
 * 与 knowledge_search 的「工具列表 + 执行器」双闸同构：这里的列表门控决定
 * 模型能否看到工具，执行器内的名册校验是最后兜底（见 create_orchestration_task）。
 */
@Injectable()
export class OrchestrationToolsService {
  private readonly logger = new Logger(OrchestrationToolsService.name);

  constructor(private readonly prisma: PrismaService) { }

  /** 查询租户在职 AI 同事（ACTIVE 且未删除），按创建时间升序。 */
  async listActiveAgents(tenantId: string): Promise<ActiveAgentSummary[]> {
    return this.prisma.assistantAgent.findMany({
      where: { tenantId, status: AssistantAgentStatus.ACTIVE, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, title: true },
    });
  }

  /**
   * 对话级编排门控：无在职同事时移除编排工具；有同事时注入名册。
   * 工具列表中没有编排工具时零查询直接返回；任何异常 fail-closed 到
   * 「仅移除编排工具」，本方法保证不抛出。
   */
  async gate(tenantId: string, tools: ChatToolDefinition[]): Promise<ChatToolDefinition[]> {
    if (!tools.some((tool) => ORCHESTRATION_TOOL_NAMES.has(tool.name))) return tools;
    try {
      const agents = await this.listActiveAgents(tenantId);
      if (agents.length === 0) {
        return tools.filter((tool) => !ORCHESTRATION_TOOL_NAMES.has(tool.name));
      }
      return tools.map((tool) =>
        ORCHESTRATION_TOOL_NAMES.has(tool.name) ? enrichWithRoster(tool, agents) : tool);
    } catch (error) {
      this.logger.error(
        `orchestration tool gating failed for tenant ${tenantId}: ${String(error)}`,
      );
      return tools.filter((tool) => !ORCHESTRATION_TOOL_NAMES.has(tool.name));
    }
  }
}

/** 把在职同事名册注入编排工具描述；仅生成新对象，不修改注册表中的定义。 */
function enrichWithRoster(tool: ChatToolDefinition, agents: ActiveAgentSummary[]): ChatToolDefinition {
  const roster = agents
    .map((agent) => `- ${agent.name}（${agent.title || '未设定职责'}），id=${agent.id}`)
    .join('\n');
  return {
    ...tool,
    description: `${tool.description}\n\n当前企业可用的 AI 同事名册（steps[].assignee_agent_id 必须从以下 id 中选择）：\n${roster}`,
  };
}
