import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  ChatContextUsage,
  ChatStreamEvent,
  TokenUsage,
} from '@cees/ai-service-client';
import { AiServiceClientService } from '../ai-orchestration/ai-service-client.service';
import { TenantContext } from '../tenant/tenant-context';
import { toChatHttpException } from './chat.errors';
import { ChatCompactRequestDto, ChatRequestDto } from './dto';
import {
  ChatCompactResult,
  ChatContextUsageResult,
  ChatInvokeResult,
  ChatStreamResultEvent,
  ChatTokenUsageResult,
} from './chat.types';

/**
 * 公开 Chat 业务适配层。会话历史由客户端本地保存，本服务不读取或写入
 * Conversation/Message，只把当前租户成员身份注入内部 ai-service 请求。
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly tenantContext: TenantContext,
    private readonly aiServiceClient: AiServiceClientService,
  ) {}

  async invoke(input: ChatRequestDto, publicRequestId?: string): Promise<ChatInvokeResult> {
    this.assertLastMessageIsUser(input);
    const context = this.tenantContext.require();
    const requestId = normalizeInternalRequestId(publicRequestId);

    try {
      const response = await this.aiServiceClient.invokeChat(
        {
          request_id: requestId,
          tenant_id: context.tenantId,
          user_id: context.userId,
          conversation_id: input.conversationId,
          mode: input.mode ?? 'standard',
          conversation_summary: input.conversationSummary ?? null,
          messages: input.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
          })),
        },
        { membershipId: context.membershipId, turnId: input.turnId },
      );

      return {
        conversationId: response.conversation_id,
        turnId: input.turnId,
        mode: response.mode,
        message: response.message,
        contextUsage: toContextUsage(response.context_usage),
        tokenUsage: toTokenUsage(response.execution.token_usage),
        latencyMs: response.execution.latency_ms,
        finishReason: response.execution.finish_reason ?? null,
      };
    } catch (error) {
      throw toChatHttpException(error);
    }
  }

  async compact(input: ChatCompactRequestDto, publicRequestId?: string): Promise<ChatCompactResult> {
    const context = this.tenantContext.require();
    const requestId = normalizeInternalRequestId(publicRequestId);

    try {
      const response = await this.aiServiceClient.compactChat(
        {
          request_id: requestId,
          tenant_id: context.tenantId,
          user_id: context.userId,
          conversation_id: input.conversationId,
          previous_summary: input.previousSummary ?? null,
          messages: input.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
          })),
        },
        { membershipId: context.membershipId, turnId: input.turnId },
      );

      return {
        conversationId: response.conversation_id,
        turnId: input.turnId,
        summary: response.summary,
        summarizedThroughMessageId: response.summarized_through_message_id ?? null,
        tokenUsage: toTokenUsage(response.execution.token_usage),
        latencyMs: response.execution.latency_ms,
        finishReason: response.execution.finish_reason ?? null,
      };
    } catch (error) {
      throw toChatHttpException(error);
    }
  }

  async stream(
    input: ChatRequestDto,
    publicRequestId?: string,
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<ChatStreamResultEvent>> {
    this.assertLastMessageIsUser(input);
    const context = this.tenantContext.require();
    const requestId = normalizeInternalRequestId(publicRequestId);

    try {
      const upstream = await this.aiServiceClient.streamChat(
        {
          request_id: requestId,
          tenant_id: context.tenantId,
          user_id: context.userId,
          conversation_id: input.conversationId,
          mode: input.mode ?? 'standard',
          conversation_summary: input.conversationSummary ?? null,
          messages: input.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
          })),
        },
        { membershipId: context.membershipId, turnId: input.turnId },
        signal,
      );
      return this.mapStream(
        upstream,
        publicRequestId?.trim() || requestId,
        input.turnId,
      );
    } catch (error) {
      throw toChatHttpException(error);
    }
  }

  private async *mapStream(
    upstream: AsyncGenerator<ChatStreamEvent>,
    publicRequestId: string,
    turnId: string,
  ): AsyncGenerator<ChatStreamResultEvent> {
    for await (const event of upstream) {
      switch (event.type) {
        case 'started':
          yield {
            type: 'started',
            requestId: publicRequestId,
            conversationId: event.conversation_id,
            turnId,
            mode: event.mode,
            contextUsage: toContextUsage(event.context_usage),
          };
          break;
        case 'status':
          yield { type: 'status', phase: event.phase };
          break;
        case 'content_delta':
          yield { type: 'content_delta', text: event.text };
          break;
        case 'usage':
          yield { type: 'usage', tokenUsage: toTokenUsage(event.token_usage) };
          break;
        case 'completed':
          yield {
            type: 'completed',
            latencyMs: event.latency_ms,
            finishReason: event.finish_reason ?? null,
          };
          break;
        case 'error':
          yield {
            type: 'error',
            error: {
              code: event.error.code,
              message: event.error.message,
              retryable: event.error.retryable,
            },
          };
          return;
      }
    }
  }

  private assertLastMessageIsUser(input: ChatRequestDto): void {
    if (input.messages.at(-1)?.role !== 'user') {
      throw new UnprocessableEntityException({
        code: 'INVALID_CHAT_REQUEST',
        message: '对话请求的最后一条消息必须是本轮 user 消息',
      });
    }
  }
}

function normalizeInternalRequestId(requestId?: string): string {
  const normalized = requestId?.trim();
  return normalized && normalized.length <= 128 ? normalized : randomUUID();
}

function toTokenUsage(tokenUsage: TokenUsage): ChatTokenUsageResult {
  return {
    inputTokens: tokenUsage.input_tokens,
    outputTokens: tokenUsage.output_tokens,
    totalTokens: tokenUsage.total_tokens,
  };
}

function toContextUsage(contextUsage: ChatContextUsage): ChatContextUsageResult {
  return {
    strategy: contextUsage.strategy,
    receivedMessageCount: contextUsage.received_message_count,
    includedMessageCount: contextUsage.included_message_count,
    historyTruncated: contextUsage.history_truncated,
    estimatedInputTokens: contextUsage.estimated_input_tokens,
  };
}
