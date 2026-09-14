import type { ChatToolDefinition } from '@cees/ai-service-client';

/**
 * 工具执行上下文：由 TurnRunner 从请求上下文组装后传入，
 * 工具不得自行读取 AsyncLocalStorage 或重复解析身份与权限。
 */
export interface ToolExecutionContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  requestId: string;
  conversationId: string;
  turnId: string;
  toolCallId: string;
  /** 持有本轮租约的 API 实例标识；业务副作用前必须再次核对。 */
  executionOwner: string;
  /** 本次 EXECUTING 抢占令牌；业务服务可据此拒绝失去租约的旧执行者。 */
  executionToken: string;
  permissions: string[];
}

/** 工具执行成功结果：正式资源引用供公开 tool_result 事件与 TOOL 消息使用。 */
export interface ToolExecutionResult {
  /** Read-only or side-effect tools may not produce a formal Resource. */
  resourceType: 'IMAGE' | 'DOCUMENT' | null;
  resourceId: string | null;
  /** 回喂模型的工具结果摘要。 */
  summary: string;
}

/**
 * 工具定义：注册到统一 ToolRegistry 的统一接口。禁止工具自行实现
 * 权限、循环、审批或额度逻辑；执行器只做校验参数与调用业务 Service。
 */
export interface ToolDefinition {
  name: string;
  version: string;
  description: string;
  /** 给模型的参数 JSON Schema（root 必须为 object）。 */
  parameters: Record<string, unknown>;
  requiredPermissions: string[];
  /**
   * 工具风险级别：READ 只读、WRITE 修改既有业务状态、EXTERNAL 生成外部产物。
   * 当前 ToolPolicy 尚未消费（预留字段）：接入写操作确认（DRAFT→用户确认）
   * 与额度计价时按该级别区分确认策略与计费单位，见 assistant-tool-loop.md 第 14 节。
   */
  riskLevel: 'READ' | 'WRITE' | 'EXTERNAL';
  /** 校验并解析模型参数；参数非法时抛错，由 ToolPolicy 统一映射为拒绝。 */
  validate(input: unknown): Record<string, unknown>;
  execute(context: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolExecutionResult>;
}

/** 把工具定义转成交给 ai-service 的 ChatToolDefinition（name/description/parameters）。 */
export function toChatToolDefinition(tool: ToolDefinition): ChatToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}
