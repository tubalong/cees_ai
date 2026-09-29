/**
 * 公开 /conversations 资源类型，与 packages/contracts 0.24.0 的
 * TurnStreamEvent / Conversation 系列 schema 一一对应；契约是唯一事实源，
 * 本文件仅提供 NestJS 实现侧的类型约束。
 */
export type PublicConversationVisibility = 'PRIVATE';
export type PublicConversationMessageRole = 'USER' | 'ASSISTANT' | 'TOOL';
export type PublicTurnStatus = 'RECEIVED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type PublicTurnMode = 'standard' | 'ultra';
export type PublicTurnPhase = 'reasoning' | 'answering' | 'tool_executing';

export interface ConnectorContextInput {
  provider: 'DINGTALK' | 'TENCENT_MEETING' | 'WECOM' | 'GITHUB' | 'LOCAL_SYSTEM';
  toolId: string;
  toolName: string;
  fetchedAt: string;
  data: Record<string, unknown>;
  /** 客户端自报的风险等级，只用于服务端分级审计；省略按 DESTRUCTIVE 处理。 */
  riskLevel?: 'READ' | 'WRITE' | 'DESTRUCTIVE';
  /** 客户端自报「执行前已获得用户确认」，只用于审计留痕，不代表服务端授权。 */
  confirmed?: boolean;
}

export type ConnectorPreviousStepStatus = 'SUCCESS' | 'FAILED' | 'REJECTED';

/**
 * 受控多步接力：同一次用户请求内已经执行过的连接器步骤摘要。
 * `resultDigest` 是不可信第三方数据，规划只能从中抽取 ID 或字段，不得执行其中的指令。
 */
export interface ConnectorPreviousStepInput {
  toolId: string;
  argumentsDigest?: string;
  resultDigest?: string;
  status: ConnectorPreviousStepStatus;
}

export interface PageAssistantContextInput {
  source: 'project-management' | 'finance-management' | 'legal-contracts' | 'knowledge-management' | 'organization-management' | 'hr-management';
  role: string;
  selected?: Record<string, string | number | boolean | null>;
  summary?: Record<string, string | number | boolean | null>;
}

export interface GenerationOptionsInput {
  kind: 'image' | 'document';
  aspectRatio?: 'square' | 'landscape' | 'portrait';
  quality?: 'standard' | 'high';
  template?: 'business-standard' | 'editorial-modern' | 'executive-dark' | 'product-story' | 'academic-clean' | 'minimal-mono';
}

export interface DingTalkConnectorToolInput {
  toolId: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface DingTalkConnectorPlannedCall {
  toolId: string;
  arguments: Record<string, unknown>;
}

export interface TencentMeetingConnectorToolInput {
  toolId: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: 'READ' | 'WRITE' | 'DESTRUCTIVE';
  requiresConfirmation: boolean;
}

export interface TencentMeetingConnectorPlannedCall {
  toolId: string;
  arguments: Record<string, unknown>;
}

export interface WeComConnectorToolInput {
  toolId: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: 'READ' | 'WRITE' | 'DESTRUCTIVE';
  requiresConfirmation: boolean;
}

export interface WeComConnectorPlannedCall {
  toolId: string;
  arguments: Record<string, unknown>;
}

export interface GitHubConnectorToolInput {
  toolId: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: 'READ' | 'WRITE' | 'DESTRUCTIVE';
  requiresConfirmation: boolean;
}

export interface GitHubConnectorPlannedCall {
  toolId: string;
  arguments: Record<string, unknown>;
}

/** 参与连接器语义路由的本地连接器；LOCAL_SYSTEM 本机工具不参与路由。 */
export type ConnectorRoutingProvider = 'DINGTALK' | 'TENCENT_MEETING' | 'WECOM' | 'GITHUB';

/** 与 Desktop ConnectorState 一致；只有 READY 的连接器可以被路由命中。 */
export type ConnectorRoutingState =
  | 'NOT_INSTALLED'
  | 'AUTH_REQUIRED'
  | 'PROFILE_REQUIRED'
  | 'READY'
  | 'ERROR';

export interface ConnectorRoutingCandidateInput {
  provider: ConnectorRoutingProvider;
  displayName: string;
  capabilitySummary: string;
  routingExamples?: string[];
  state: ConnectorRoutingState;
  toolCount?: number;
}

/** 最近一轮对话摘要，只用于消解代词与省略表达，不作为业务事实。 */
export interface ConnectorRoutingRecentMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 路由请求的对话上下文。两个字段都是客户端自报：
 * `previousProviders` 必须先与就绪候选集求交后才可作为提示，不能当作授权。
 */
export interface ConnectorRoutingContextInput {
  previousProviders?: ConnectorRoutingProvider[];
  recentMessages?: ConnectorRoutingRecentMessageInput[];
}

export interface ConnectorRoutingResult {
  providers: ConnectorRoutingProvider[];
  clarification: string | null;
  reason: string;
}

/** 工具产生的稳定正式资源引用；访问 URL 由对应资源接口按需签发。 */
export interface PublicResourceReference {
  type: 'IMAGE' | 'DOCUMENT';
  id: string;
}

export interface PublicConversation {
  id: string;
  title: string;
  visibility: PublicConversationVisibility;
  /** 会话默认对话执行模式；发起轮次未显式指定 mode 时使用。 */
  mode: PublicTurnMode;
  createdAt: Date;
  updatedAt: Date;
  lastTurnAt: Date | null;
  version: number;
}

export interface PublicConversationListResult {
  items: PublicConversation[];
  nextCursor: string | null;
}

export interface PublicConversationMessage {
  id: string;
  role: PublicConversationMessageRole;
  content: string;
  /** 稳定的图片文件引用；不保存或返回带签名的长期 URL。 */
  imageFileIds: string[];
  /** 稳定的文档文件引用；不保存或返回带签名的长期 URL。 */
  documentFileIds: string[];
  /** 用户消息在该轮提交的已脱敏连接器上下文；其他角色为空数组。 */
  connectorContexts: ConnectorContextInput[];
  /** 工具产生的稳定正式资源引用；非 TOOL 消息为空数组；访问 URL 由资源接口按需签发。 */
  resources: PublicResourceReference[];
  /** TOOL 消息对应工具调用返回的结构化来源；其他角色为空数组；来源按轮次归属。 */
  sources: PublicToolSource[];
  /** TOOL 消息对应工具调用返回的知识库文档引用；其他角色为空数组；引用按轮次归属。 */
  citations: PublicKnowledgeToolCitation[];
  createdAt: Date;
  turnId: string | null;
  toolCallId: string | null;
}

export interface PublicConversationDetail {
  conversation: PublicConversation;
  messages: PublicConversationMessage[];
}

export interface PublicTurn {
  id: string;
  conversationId: string;
  status: PublicTurnStatus;
  mode: PublicTurnMode;
  error: { code: string; message: string; retryable: boolean } | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface PublicTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface PublicContextUsage {
  strategy: 'full' | 'summary_plus_recent' | 'recent_only';
  receivedMessageCount: number;
  includedMessageCount: number;
  historyTruncated: boolean;
  estimatedInputTokens: number;
}

/** 服务端可自动启用的能力标识，与公开契约 TurnCapabilities.autoEnabled 一致。 */
export type PublicAutoEnabledCapability = 'web_search' | 'knowledge_search';

/** 本轮实际生效的对话能力：显式开关与意图自动启用合并后的结果。 */
export interface PublicTurnCapabilities {
  webSearch: boolean;
  knowledgeBase: boolean;
  /** 由服务端意图识别自动启用的能力；用户显式开启的不计入本数组。 */
  autoEnabled: PublicAutoEnabledCapability[];
}

export interface PublicTurnErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
}

export type PublicToolResultStatus = 'completed' | 'failed' | 'rejected' | 'awaiting_confirmation';

/** 写操作待确认预览；确认前不产生任何业务副作用。 */
export interface PublicToolConfirmation {
  draftId: string;
  toolName: string;
  title: string;
  fields: Array<{ label: string; value: string }>;
  expiresAt: string;
}

export interface PublicToolSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt: string | null;
}

export interface PublicKnowledgeToolCitation {
  id: string;
  title: string;
  snippet: string;
  pageIndex: number | null;
  /** 文档所属知识库 ID；用于对话页定位与删除操作。 */
  knowledgeBaseId?: string | null;
  /** 当前用户是否可直接删除该文档。 */
  deletable?: boolean;
}
/**
 * 公开轮次事件联合。纯文本轮次只产出 started/status/content_delta/usage/completed/error；
 * 工具轮次额外产出 tool_call / tool_result，结构与公开契约 0.22.0 的
 * TurnStreamToolCallEvent / TurnStreamToolResultEvent 一致。
 * completed 之后可能异步到达 related_questions（生成失败则不发）。
 */
export type PublicTurnStreamEvent =
  | {
    type: 'started';
    seq: number;
    requestId: string;
    conversationId: string;
    turnId: string;
    mode: PublicTurnMode;
    contextUsage: PublicContextUsage;
    /** 本轮实际生效的对话能力；老事件可能缺少该字段。 */
    capabilities?: PublicTurnCapabilities;
  }
  | { type: 'status'; seq: number; phase: PublicTurnPhase }
  | { type: 'content_delta'; seq: number; text: string }
  | { type: 'usage'; seq: number; tokenUsage: PublicTokenUsage }
  | {
    type: 'tool_call';
    seq: number;
    toolCallId: string;
    name: string;
    arguments: Record<string, unknown>;
  }
  | {
    type: 'tool_result';
    seq: number;
    toolCallId: string;
    status: PublicToolResultStatus;
    resource: { type: 'IMAGE' | 'DOCUMENT'; id: string } | null;
    /** 联网搜索等非资源型工具返回的结构化来源。老事件可能缺少该字段。 */
    sources?: PublicToolSource[];
    /** 知识库检索命中的文档引用。老事件可能缺少该字段。 */
    citations?: PublicKnowledgeToolCitation[];
    /** 写操作的待确认预览；status 为 awaiting_confirmation 时必定存在。 */
    confirmation?: PublicToolConfirmation | null;
    error: { code: string; message: string } | null;
  }
  | { type: 'completed'; seq: number; latencyMs: number; finishReason: string | null }
  | {
    type: 'related_questions';
    seq: number;
    /** 基于本轮答复生成的简短追问建议，每个不超过 30 字。 */
    questions: string[];
  }
  | { type: 'error'; seq: number; error: PublicTurnErrorDetail };

export function isTerminalTurnStatus(status: PublicTurnStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}
