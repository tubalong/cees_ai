/**
 * 公开 /conversations 资源类型，与 packages/contracts 0.22.0 的
 * TurnStreamEvent / Conversation 系列 schema 一一对应；契约是唯一事实源，
 * 本文件仅提供 NestJS 实现侧的类型约束。
 */
export type PublicConversationVisibility = 'PRIVATE';
export type PublicConversationMessageRole = 'USER' | 'ASSISTANT' | 'TOOL';
export type PublicTurnStatus = 'RECEIVED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type PublicTurnMode = 'standard' | 'ultra';
export type PublicTurnPhase = 'reasoning' | 'answering' | 'tool_executing';

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

export interface PublicTurnErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
}

export type PublicToolResultStatus = 'completed' | 'failed' | 'rejected';

/**
 * 公开轮次事件联合。纯文本轮次只产出 started/status/content_delta/usage/completed/error；
 * 工具轮次额外产出 tool_call / tool_result，结构与公开契约 0.22.0 的
 * TurnStreamToolCallEvent / TurnStreamToolResultEvent 一致。
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
      /** 图片资源生成时签发的短期可下载 URL；其他资源或失败/拒绝事件为 null。 */
      resourceUrl: string | null;
      error: { code: string; message: string } | null;
    }
  | { type: 'completed'; seq: number; latencyMs: number; finishReason: string | null }
  | { type: 'error'; seq: number; error: PublicTurnErrorDetail };

export function isTerminalTurnStatus(status: PublicTurnStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}
