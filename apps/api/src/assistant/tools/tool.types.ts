import type { ChatToolDefinition } from '@cees/ai-service-client';
import type { RequestTenantContext, TenantContext } from '../../tenant/tenant-context';

/** 对话级知识库开关控制的可检索工具名；开关关闭时该工具不进入模型工具列表。 */
export const KNOWLEDGE_SEARCH_TOOL_NAME = 'knowledge_search';

/** 对话级联网开关控制的可检索工具名；开关关闭时该工具不进入模型工具列表。 */
export const WEB_SEARCH_TOOL_NAME = 'web_search';

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
  /**
   * 轮次执行载体的轮次 ID；任务步骤内发起的调用为 null（见 taskStepId）。
   * 依赖轮次内容（如本轮上传的文件、图片）的工具必须自行判空并拒绝步骤载体调用。
   */
  turnId: string | null;
  /** 任务步骤执行载体的步骤 ID；轮次内发起的调用为 null（见 turnId）。 */
  taskStepId?: string | null;
  /** 任务步骤执行载体所属的任务 ID；仅步骤载体填充（调用日志 metadata 记录用）。 */
  taskId?: string | null;
  toolCallId: string;
  /** 持有本轮租约的 API 实例标识；业务副作用前必须再次核对。 */
  executionOwner: string;
  /** 本次 EXECUTING 抢占令牌；业务服务可据此拒绝失去租约的旧执行者。 */
  executionToken: string;
  /** Turn 被取消时用于终止可取消的外部 I/O。 */
  signal?: AbortSignal;
  permissions: string[];
  /**
   * 本次执行时实时解析出的角色码。
   * 业务 Service 除了权限码，偶尔还会按角色判断（例如钉钉导入要求 tenant_admin），
   * 因此工具转交业务调用时必须能提供角色，而不能只传权限。
   * 可选：由 `runAsTenant` 统一归一化为空数组，避免每个构造点都要补字段。
   */
  roles?: string[];
  /** 本轮是否允许检索知识库（对话级开关）；开关关闭时模型拿不到知识库工具。 */
  knowledgeBaseEnabled: boolean;
  /**
   * 本轮是否允许联网搜索：由显式开关与意图自动启用合并后的“有效值”。
   * 关闭时模型拿不到联网工具，执行器再做一次兜底校验。
   */
  webSearchEnabled: boolean;
}

export interface ToolSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt: string | null;
}

/** 知识库检索命中的文档引用，进公开 tool_result 事件的 citations 字段。 */
export interface KnowledgeToolCitation {
  id: string;
  title: string;
  snippet: string;
  pageIndex: number | null;
  /** 文档所属知识库 ID；用于前端定位与删除操作。 */
  knowledgeBaseId: string | null;
  /** 当前用户是否为该文档所属库的 EDITOR 及以上成员（或 manage_all），可直接删除该文档。 */
  deletable: boolean;
}

/** 工具执行成功结果：正式资源引用供公开 tool_result 事件与 TOOL 消息使用。 */
export interface ToolExecutionResult {
  /** Read-only or side-effect tools may not produce a formal Resource. */
  resourceType: 'IMAGE' | 'DOCUMENT' | null;
  resourceId: string | null;
  /** 回喂模型的工具结果摘要；可包含后续工具调用所需的内部引用，不得直接展示给用户。 */
  summary: string;
  /**
   * 用户可见摘要。省略时沿用 summary；当 summary 含内部 ID、权限枚举或模型指令时必须提供。
   * 确认结果、助手历史消息和客户端提示只允许使用此字段。
   */
  userSummary?: string;
  /** 非资源型工具（例如联网搜索）的结构化来源。 */
  sources?: ToolSource[];
  /** 知识库检索命中的文档引用；与 sources 互斥，进公开事件的 citations 字段。 */
  citations?: KnowledgeToolCitation[];
}

/**
 * 工具执行阶段可安全回喂模型的受控错误。内部 message 进入审计与排障，
 * userFacingSummary 只能使用服务端固定文案，禁止包含上游响应、Token 或权限码。
 */
export class ToolExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly userFacingSummary: string,
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

/**
 * 工具定义：注册到统一 ToolRegistry 的统一接口。禁止工具自行实现
 * 权限、循环、审批或额度逻辑；执行器只做校验参数与调用业务 Service。
 */
export interface ToolDefinition {
  name: string;
  version: string;
  /** 用户可理解的功能名称，用于权限拒绝等面向用户的文案；不发给模型。 */
  displayName: string;
  description: string;
  /** 给模型的参数 JSON Schema（root 必须为 object）。 */
  parameters: Record<string, unknown>;
  requiredPermissions: string[];
  /**
   * 工具风险级别：READ 只读、WRITE 修改既有业务状态、EXTERNAL 生成外部产物。
   * READ 直接执行；WRITE 声明 buildConfirmation 后走待确认草稿；
   * 生成新资产（图片/文档，EXTERNAL）幂等且无破坏性，仍然直接执行。
   */
  riskLevel: 'READ' | 'WRITE' | 'EXTERNAL';
  /**
   * 写操作确认钩子：WRITE 工具声明本钩子后，模型给出的参数不会直接落库，
   * 而是先落为 AssistantActionDraft 待确认草稿，用户确认后才真正执行。
   * 钩子只负责生成用户可核对的预览与回喂摘要；权限与参数校验仍由 ToolPolicy 负责。
   */
  buildConfirmation?(
    context: ToolConfirmationContext,
    input: Record<string, unknown>,
  ): Promise<ToolConfirmationRequest>;
  /** 校验并解析模型参数；参数非法时抛错，由 ToolPolicy 统一映射为拒绝。 */
  validate(input: unknown): Record<string, unknown>;
  execute(context: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolExecutionResult>;
}

/**
 * 确认预览的上下文：只包含身份与租户事实。
 * 刻意不包含 executionOwner / executionToken / signal——生成预览不执行副作用，
 * 不应持有轮次租约语义，避免工具作者误以为可以在预览阶段调用业务写服务。
 */
export type ToolConfirmationContext = Pick<
  ToolExecutionContext,
  'tenantId' | 'userId' | 'membershipId' | 'requestId' | 'turnId' | 'permissions' | 'roles'
>;

/** 待确认草稿的预览字段；只放用户能核对的业务值，不放内部 ID 与权限枚举。 */
export interface ToolConfirmationField {
  label: string;
  value: string;
}

/** 工具给出的写操作确认信息。 */
export interface ToolConfirmationRequest {
  /** 动作标题，例如「新建部门」。 */
  title: string;
  /** 预览字段列表，决定确认卡片上展示什么。 */
  fields: ToolConfirmationField[];
  /** 回喂模型并写入 TOOL 消息的中文摘要。 */
  summary: string;
}

/** 把工具定义转成交给 ai-service 的 ChatToolDefinition（name/description/parameters）。 */
export function toChatToolDefinition(tool: ToolDefinition): ChatToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

/**
 * 以工具上下文调用既有业务 Service。
 *
 * 业务 Service 普遍通过 `TenantContext.require()` 读上下文（AsyncLocalStorage），
 * 而工具既可能在后台轮次里执行（无请求上下文，甚至由 `TurnRecoveryService` 在
 * 定时任务里恢复执行），也可能在确认接口里执行。
 * 与其给每个业务方法复制一份「显式上下文」重载，这里用 `TenantContext.run`
 * 把工具上下文注回 ALS：
 *   - 业务 Service **一行不改**即可被工具复用；
 *   - 新增工具不再需要业务侧配合，真正只写一个工具文件；
 *   - 权限与角色都取执行瞬间的实时解析结果，不沿用生成工具清单时的快照。
 */
export function runAsTenant<T>(
  tenantContext: TenantContext,
  context: ToolConfirmationContext,
  work: () => T,
): T {
  const requestContext: RequestTenantContext = {
    tenantId: context.tenantId,
    userId: context.userId,
    membershipId: context.membershipId,
    requestId: context.requestId,
    roles: context.roles ?? [],
    permissions: context.permissions,
  };
  return tenantContext.run(requestContext, work);
}
