import { Injectable } from '@nestjs/common';
import {
  compactChat as requestChatCompaction,
  createClient,
  invokeChat as requestChatInvocation,
  invokeLlm,
  streamChat as requestChatStream,
  type ChatInvokeResponse,
  type ChatRequest,
  type ChatStreamEvent,
  type Client,
  type CompactChatRequest,
  type CompactChatResponse,
  type ErrorResponse,
  type ExecutionMetadata,
  type InvokeRequest,
  type InvokeResponse,
  type StreamExecutionMetadata,
  type TokenUsage,
} from '@cees/ai-service-client';
import {
  AiInvocationExecution,
  AiInvocationRecorderService,
} from './ai-invocation-recorder.service';

export class AiServiceInvocationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
    public readonly execution?: AiInvocationExecution,
  ) {
    super(message);
    this.name = 'AiServiceInvocationError';
  }
}

export interface ChatInvocationTracking {
  membershipId: string;
  turnId: string;
}

/**
 * ai-service 的内部 HTTP 适配层。业务模块只传可信上下文，本服务负责调用专用
 * Chat 接口并通过统一记录器写入模型与 Token 指标。
 */
@Injectable()
export class AiServiceClientService {
  private client?: Client;

  constructor(private readonly invocationRecorder: AiInvocationRecorderService) {}

  async invoke(input: InvokeRequest): Promise<InvokeResponse> {
    const result = await invokeLlm({ client: this.getClient(), body: input });
    if (result.error) throw this.toInvocationError(result.error, result.response?.status);
    if (!result.data) throw this.emptyResponseError();

    const response = result.data;
    await this.invocationRecorder.record({
      tenantId: input.tenant_id,
      userId: input.user_id,
      requestId: input.request_id,
      operation: 'generic.invoke',
      execution: toRecordedExecution(response.execution),
    });
    return response;
  }

  async invokeChat(
    input: ChatRequest,
    tracking: ChatInvocationTracking,
  ): Promise<ChatInvokeResponse> {
    const result = await requestChatInvocation({ client: this.getClient(), body: input });
    if (result.error) {
      const error = this.toInvocationError(result.error, result.response?.status);
      await this.recordFailedChatInvocation({
        input,
        tracking,
        operation: 'chat.invoke',
        mode: input.mode ?? 'standard',
        error,
      });
      throw error;
    }
    if (!result.data) throw this.emptyResponseError();

    const response = result.data;
    await this.invocationRecorder.record({
      tenantId: input.tenant_id,
      userId: input.user_id,
      membershipId: tracking.membershipId,
      conversationId: input.conversation_id,
      turnId: tracking.turnId,
      requestId: input.request_id,
      operation: 'chat.invoke',
      execution: toRecordedExecution(response.execution),
      metadata: {
        mode: response.mode,
        outcome: 'completed',
        contextStrategy: response.context_usage.strategy,
        receivedMessageCount: response.context_usage.received_message_count,
        includedMessageCount: response.context_usage.included_message_count,
        historyTruncated: response.context_usage.history_truncated,
        estimatedInputTokens: response.context_usage.estimated_input_tokens,
      },
    });
    return response;
  }

  async compactChat(
    input: CompactChatRequest,
    tracking: ChatInvocationTracking,
  ): Promise<CompactChatResponse> {
    const result = await requestChatCompaction({ client: this.getClient(), body: input });
    if (result.error) {
      const error = this.toInvocationError(result.error, result.response?.status);
      await this.recordFailedChatInvocation({
        input,
        tracking,
        operation: 'chat.compact',
        error,
      });
      throw error;
    }
    if (!result.data) throw this.emptyResponseError();

    const response = result.data;
    await this.invocationRecorder.record({
      tenantId: input.tenant_id,
      userId: input.user_id,
      membershipId: tracking.membershipId,
      conversationId: input.conversation_id,
      turnId: tracking.turnId,
      requestId: input.request_id,
      operation: 'chat.compact',
      execution: toRecordedExecution(response.execution),
      metadata: { outcome: 'completed' },
    });
    return response;
  }

  async streamChat(
    input: ChatRequest,
    tracking: ChatInvocationTracking,
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<ChatStreamEvent>> {
    const upstreamAbort = new AbortController();
    const forwardAbort = (): void => upstreamAbort.abort();
    if (signal?.aborted) upstreamAbort.abort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    let streamFailure: unknown;
    let iterator: AsyncIterator<ChatStreamEvent> | undefined;
    try {
      const result = await requestChatStream({
        client: this.getClient(),
        body: input,
        signal: upstreamAbort.signal,
        fetch: this.checkedSseFetch,
        // 生成客户端把首次请求计为第 1 次；设为 1 即完全禁止 POST SSE 自动重连。
        sseMaxRetryAttempts: 1,
        onSseError: (error) => {
          streamFailure = error;
        },
      });
      iterator = result.stream[Symbol.asyncIterator]();

      const first = await iterator.next();
      if (first.done) {
        if (streamFailure) {
          throw streamFailure instanceof AiServiceInvocationError
            ? streamFailure
            : this.toInvocationError(streamFailure);
        }
        throw new AiServiceInvocationError(
          'AI_SERVICE_INVALID_RESPONSE',
          'AI service chat stream returned no events',
          false,
          502,
        );
      }
      if (first.value.type !== 'started') {
        throw new AiServiceInvocationError(
          'AI_SERVICE_INVALID_RESPONSE',
          'AI service chat stream did not start with a started event',
          false,
          502,
        );
      }

      return this.recordingChatStream({
        input,
        tracking,
        iterator,
        firstEvent: first.value,
        upstreamAbort,
        externalSignal: signal,
        forwardAbort,
        getStreamFailure: () => streamFailure,
      });
    } catch (error) {
      signal?.removeEventListener('abort', forwardAbort);
      upstreamAbort.abort();
      try {
        await iterator?.return?.();
      } catch {
        // 初始化失败时以原始错误为准，关闭上游迭代器的错误不覆盖它。
      }
      throw error instanceof AiServiceInvocationError
        ? error
        : this.toInvocationError(error);
    }
  }

  private async *recordingChatStream(args: {
    input: ChatRequest;
    tracking: ChatInvocationTracking;
    iterator: AsyncIterator<ChatStreamEvent>;
    firstEvent: ChatStreamEvent;
    upstreamAbort: AbortController;
    externalSignal?: AbortSignal;
    forwardAbort: () => void;
    getStreamFailure: () => unknown;
  }): AsyncGenerator<ChatStreamEvent> {
    const startedAt = Date.now();
    let current: IteratorResult<ChatStreamEvent> = { done: false, value: args.firstEvent };
    let execution: StreamExecutionMetadata | undefined;
    let tokenUsage: TokenUsage | undefined;
    // 一次真实的上游 Chat 调用最多写一条用量日志。若日志写入本身失败，
    // finally 不能再次尝试，否则可能把一次模型调用写成两条记录。
    let recordAttempted = false;

    const recordStream = async (
      latencyMs: number,
      finishReason: string | null,
      outcome: 'completed' | 'error' | 'cancelled',
      errorCode?: string,
    ): Promise<void> => {
      if (recordAttempted || !execution) return;
      recordAttempted = true;
      await this.invocationRecorder.record({
        tenantId: args.input.tenant_id,
        userId: args.input.user_id,
        membershipId: args.tracking.membershipId,
        conversationId: args.input.conversation_id,
        turnId: args.tracking.turnId,
        requestId: args.input.request_id,
        operation: 'chat.stream',
        execution: {
          profile: execution.profile,
          provider: execution.provider,
          model: execution.model,
          fallbackCount: execution.fallback_count,
          latencyMs,
          finishReason,
          tokenUsage: toRecordedTokenUsage(tokenUsage),
        },
        metadata: {
          mode: args.input.mode ?? 'standard',
          outcome,
          ...(errorCode ? { errorCode } : {}),
        },
      });
    };

    try {
      while (!current.done) {
        const event = current.value;
        if (event.type === 'status' && event.execution) execution = event.execution;
        if (event.type === 'usage') tokenUsage = event.token_usage;

        if (event.type === 'completed') {
          if (!execution) {
            throw new AiServiceInvocationError(
              'AI_SERVICE_INVALID_RESPONSE',
              'AI service chat stream completed without execution metadata',
              false,
              502,
            );
          }
          await recordStream(event.latency_ms, event.finish_reason ?? null, 'completed');
        } else if (event.type === 'error') {
          await recordStream(
            Math.max(0, Date.now() - startedAt),
            null,
            'error',
            event.error.code,
          );
        }

        yield event;
        if (event.type === 'completed' || event.type === 'error') return;
        current = await args.iterator.next();
      }

      if (args.externalSignal?.aborted) return;

      const streamFailure = args.getStreamFailure();
      if (streamFailure) {
        const invocationError = streamFailure instanceof AiServiceInvocationError
          ? streamFailure
          : this.toInvocationError(streamFailure);
        await recordStream(
          Math.max(0, Date.now() - startedAt),
          null,
          'error',
          invocationError.code,
        );
        throw invocationError;
      }

      const invalidResponse = new AiServiceInvocationError(
        'AI_SERVICE_INVALID_RESPONSE',
        'AI service chat stream ended without a terminal event',
        false,
        502,
      );
      await recordStream(
        Math.max(0, Date.now() - startedAt),
        null,
        'error',
        invalidResponse.code,
      );
      throw invalidResponse;
    } finally {
      try {
        if (!recordAttempted && execution) {
          await recordStream(Math.max(0, Date.now() - startedAt), null, 'cancelled');
        }
      } finally {
        args.externalSignal?.removeEventListener('abort', args.forwardAbort);
        args.upstreamAbort.abort();
        try {
          await args.iterator.return?.();
        } catch {
          // 终止事件和计量结果已经确定时，清理错误不能再制造第二个流错误。
        }
      }
    }
  }

  private readonly checkedSseFetch: typeof fetch = async (input, init) => {
    const response = await globalThis.fetch(input, init);
    if (response.ok) {
      const contentType = response.headers.get('Content-Type') ?? '';
      if (contentType.toLowerCase().includes('text/event-stream')) return response;
      throw new AiServiceInvocationError(
        'AI_SERVICE_INVALID_RESPONSE',
        'AI service chat stream returned an unexpected Content-Type',
        false,
        502,
      );
    }

    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      payload = undefined;
    }
    throw this.toInvocationError(payload, response.status);
  };

  private async recordFailedChatInvocation(args: {
    input: {
      tenant_id: string;
      user_id: string;
      conversation_id: string;
      request_id: string;
    };
    tracking: ChatInvocationTracking;
    operation: 'chat.invoke' | 'chat.compact';
    mode?: string;
    error: AiServiceInvocationError;
  }): Promise<void> {
    if (!args.error.execution) return;
    await this.invocationRecorder.record({
      tenantId: args.input.tenant_id,
      userId: args.input.user_id,
      membershipId: args.tracking.membershipId,
      conversationId: args.input.conversation_id,
      turnId: args.tracking.turnId,
      requestId: args.input.request_id,
      operation: args.operation,
      execution: args.error.execution,
      metadata: {
        outcome: 'error',
        errorCode: args.error.code,
        ...(args.mode ? { mode: args.mode } : {}),
      },
    });
  }

  private toInvocationError(error: unknown, httpStatus?: number): AiServiceInvocationError {
    if (error instanceof AiServiceInvocationError) return error;
    if (isErrorResponse(error)) {
      return new AiServiceInvocationError(
        error.error.code,
        error.error.message,
        error.error.retryable,
        httpStatus,
        error.execution ? toRecordedExecution(error.execution) : undefined,
      );
    }
    return new AiServiceInvocationError(
      'AI_SERVICE_UNAVAILABLE',
      error instanceof Error ? error.message : 'AI service request failed',
      true,
      httpStatus ?? 503,
    );
  }

  private emptyResponseError(): AiServiceInvocationError {
    return new AiServiceInvocationError(
      'AI_SERVICE_INVALID_RESPONSE',
      'AI service returned an empty response',
      false,
      502,
    );
  }

  private getClient(): Client {
    if (this.client) return this.client;

    const baseUrl = process.env.AI_SERVICE_URL;
    const internalToken = process.env.AI_INTERNAL_TOKEN;
    if (!baseUrl || !internalToken) {
      throw new AiServiceInvocationError(
        'AI_SERVICE_NOT_CONFIGURED',
        'AI service URL and internal token are required',
        false,
        503,
      );
    }
    this.client = createClient({
      baseUrl,
      headers: { 'X-AI-Internal-Token': internalToken },
      responseStyle: 'fields',
    });
    return this.client;
  }
}

function toRecordedExecution(execution: ExecutionMetadata): AiInvocationExecution {
  return {
    profile: execution.profile,
    provider: execution.provider,
    model: execution.model,
    fallbackCount: execution.fallback_count,
    latencyMs: execution.latency_ms,
    finishReason: execution.finish_reason ?? null,
    tokenUsage: toRecordedTokenUsage(execution.token_usage),
  };
}

function toRecordedTokenUsage(tokenUsage?: TokenUsage): AiInvocationExecution['tokenUsage'] {
  return {
    inputTokens: tokenUsage?.input_tokens ?? null,
    outputTokens: tokenUsage?.output_tokens ?? null,
    totalTokens: tokenUsage?.total_tokens ?? null,
  };
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (!value || typeof value !== 'object') return false;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const detail = error as Record<string, unknown>;
  return typeof detail.code === 'string'
    && typeof detail.message === 'string'
    && typeof detail.retryable === 'boolean';
}
