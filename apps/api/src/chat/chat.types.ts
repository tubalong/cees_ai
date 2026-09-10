import { PublicChatMode } from './dto';

export interface ChatTokenUsageResult {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface ChatContextUsageResult {
  strategy: 'full' | 'summary_plus_recent' | 'recent_only';
  receivedMessageCount: number;
  includedMessageCount: number;
  historyTruncated: boolean;
  estimatedInputTokens: number;
}

export interface ChatInvokeResult {
  conversationId: string;
  turnId: string;
  mode: PublicChatMode;
  message: {
    role: 'assistant';
    content: string;
  };
  contextUsage: ChatContextUsageResult;
  tokenUsage: ChatTokenUsageResult;
  latencyMs: number;
  finishReason: string | null;
}

export interface ChatCompactResult {
  conversationId: string;
  turnId: string;
  summary: string;
  summarizedThroughMessageId: string | null;
  tokenUsage: ChatTokenUsageResult;
  latencyMs: number;
  finishReason: string | null;
}

export interface ChatStreamErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
}

export type ChatStreamResultEvent =
  | {
      type: 'started';
      requestId: string;
      conversationId: string;
      turnId: string;
      mode: PublicChatMode;
      contextUsage: ChatContextUsageResult;
    }
  | { type: 'status'; phase: 'reasoning' | 'answering' }
  | { type: 'content_delta'; text: string }
  | { type: 'usage'; tokenUsage: ChatTokenUsageResult }
  | { type: 'completed'; latencyMs: number; finishReason: string | null }
  | { type: 'error'; error: ChatStreamErrorDetail };
