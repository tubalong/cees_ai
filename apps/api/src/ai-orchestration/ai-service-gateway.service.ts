import { HttpException, Injectable } from '@nestjs/common';
import {
  answerKnowledge as requestKnowledgeAnswer,
  compactChat as requestChatCompaction,
  composeDocument as requestComposeDocument,
  createClient,
  deleteKnowledgeIndex as requestKnowledgeIndexDelete,
  extractFile as requestFileExtraction,
  generateDocumentDocx as requestGenerateDocumentDocx,
  generateImage as requestImageGeneration,
  getReadiness,
  indexKnowledgeDocument,
  invokeChat as requestChatInvocation,
  invokeLlm,
  renderDocumentDocx as requestRenderDocumentDocx,
  renderDocumentPdf as requestRenderDocumentPdf,
  renderDocumentPptx as requestRenderDocumentPptx,
  streamChat as requestChatStream,
  streamChatToolTurn as requestToolTurnStream,
  type ChatInvokeResponse,
  type ChatMode,
  type ChatRequest,
  type ChatStreamEvent,
  type Client,
  type CompactChatRequest,
  type CompactChatResponse,
  type ComposeDocumentRequest,
  type ComposeDocumentResponse,
  type ErrorResponse,
  type ExecutionMetadata,
  type FileExtractionRequest,
  type FileExtractionResponse,
  type ImageGenerateRequest,
  type ImageGenerateResponse,
  type ImageGenerationMetadata,
  type InvokeRequest,
  type InvokeResponse,
  type KnowledgeAnswerRequest,
  type KnowledgeAnswerResponse,
  type KnowledgeIndexDeleteRequest,
  type KnowledgeIndexDeleteResponse,
  type KnowledgeIndexRequest,
  type KnowledgeIndexResponse,
  type RenderDocxRequest,
  type RenderPdfRequest,
  type RenderPptxRequest,
  type StreamExecutionMetadata,
  type TokenUsage,
  type ToolTurnRequest,
  type ToolTurnStreamEvent,
} from '@cees/ai-service-client';
import {
  AiInvocationExecution,
  AiInvocationRecorderService,
} from './ai-invocation-recorder.service';

export class AiServiceInvocationError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
    public readonly execution?: AiInvocationExecution,
  ) {
    const status = httpStatus && httpStatus >= 400 && httpStatus <= 599 ? httpStatus : 503;
    super({
      code,
      message,
      details: {
        retryable,
        ...(execution ? { execution } : {}),
      },
    }, status);
    this.name = 'AiServiceInvocationError';
  }
}

export interface ChatInvocationTracking {
  membershipId: string;
  turnId: string;
  /** Service-side conversation identity for observability. */
  conversationId?: string;
}

/** ai-service /ready 暴露的各聊天模式输入 Token 预算（context_budget_tokens）。 */
export interface ChatContextBudgets {
  standard?: number;
  ultra?: number;
}

/** 预算缓存的存活时间：压缩判断低频，短 TTL 足以跟随配置变更。 */
const CHAT_CONTEXT_BUDGETS_TTL_MS = 60_000;

/** Chat 与 ToolTurn 请求共有的身份与追踪字段；网关据此写调用日志。 */
interface ChatLikeRequest {
  readonly request_id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly conversation_id: string;
  readonly mode?: ChatMode | undefined;
}

/** 可记录用量事件的最小结构；Chat 与 ToolTurn 的 SSE 事件联合均满足该形状。 */
interface RecordableStreamEvent {
  readonly type: string;
  readonly execution?: StreamExecutionMetadata | undefined;
  readonly token_usage?: TokenUsage | undefined;
  readonly latency_ms?: number | undefined;
  readonly finish_reason?: string | null | undefined;
  readonly error?: { readonly code: string } | undefined;
}

/**
 * ai-service 的统一出站网关。业务模块只传可信上下文，本网关负责所有对
 * ai-service 的 HTTP/SSE 调用（通用 invoke、Chat、Tool Loop 轮次、图片生成），
 * 并通过统一记录器写入模型与 Token 指标；业务模块不得直接持有 ai-service 客户端。
 */
@Injectable()
export class AiServiceGateway {
  private client?: Client;
  private cachedChatContextBudgets?: { budgets: ChatContextBudgets; fetchedAt: number };

  constructor(private readonly invocationRecorder: AiInvocationRecorderService) { }

  /**
   * 拉取 ai-service /ready 暴露的各模式输入 Token 预算，供上下文压缩触发使用。
   * 结果带短 TTL 缓存；ai-service 未就绪、字段缺失或调用失败时返回 null，
   * 由调用方回退到内置默认预算，避免压缩逻辑因配置服务不可用而失效。
   */
  async fetchChatContextBudgets(): Promise<ChatContextBudgets | null> {
    const cached = this.cachedChatContextBudgets;
    const now = Date.now();
    if (cached && now - cached.fetchedAt < CHAT_CONTEXT_BUDGETS_TTL_MS) {
      return cached.budgets;
    }
    try {
      const result = await getReadiness({ client: this.getClient() });
      if (result.error || !result.data?.chat_context_budgets) return null;
      this.cachedChatContextBudgets = {
        budgets: result.data.chat_context_budgets,
        fetchedAt: now,
      };
      return result.data.chat_context_budgets;
    } catch {
      return null;
    }
  }

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
    return this.openRecordingStream({
      input,
      tracking,
      operation: 'chat.stream',
      signal,
      openStream: async (options) => {
        const result = await requestChatStream({
          client: this.getClient(),
          body: input,
          signal: options.signal,
          fetch: options.fetch,
          // 生成客户端把首次请求计为第 1 次；设为 1 即完全禁止 POST SSE 自动重连。
          sseMaxRetryAttempts: 1,
          onSseError: options.onSseError,
        });
        return result.stream[Symbol.asyncIterator]();
      },
    });
  }

  /**
   * 发起一次 Tool Loop 轮次调用。ai-service 只返回模型决策（final answer 或
   * tool_calls 建议），工具由 NestJS 执行后以 TOOL 消息再次调用；本方法每次
   * 只代表一轮独立模型调用。
   */
  async streamToolTurn(
    input: ToolTurnRequest,
    tracking: ChatInvocationTracking,
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<ToolTurnStreamEvent>> {
    return this.openRecordingStream({
      input,
      tracking,
      operation: 'chat.tool_turn',
      signal,
      openStream: async (options) => {
        const result = await requestToolTurnStream({
          client: this.getClient(),
          body: input,
          signal: options.signal,
          fetch: options.fetch,
          sseMaxRetryAttempts: 1,
          onSseError: options.onSseError,
        });
        return result.stream[Symbol.asyncIterator]();
      },
    });
  }

  /**
   * 调用 ai-service 图片生成路由（内部 ImageRouter 选择 Provider/模型），
   * 返回 Base64 图片字节与执行元数据；不落库、不创建正式资源。
   * 工具执行幂等由 request_id + tool_call_id 关联，经统一记录器写入调用日志。
   */
  async generateImage(
    input: ImageGenerateRequest,
    tracking: ChatInvocationTracking & { toolCallId: string },
  ): Promise<ImageGenerateResponse> {
    const result = await requestImageGeneration({ client: this.getClient(), body: input });
    if (result.error) {
      const error = this.toInvocationError(result.error, result.response?.status);
      if (error.execution) {
        await this.invocationRecorder.record({
          tenantId: input.tenant_id,
          userId: input.user_id,
          membershipId: tracking.membershipId,
          conversationId: tracking.conversationId ?? null,
          turnId: tracking.turnId,
          requestId: input.request_id,
          toolCallId: tracking.toolCallId,
          operation: 'image.generate',
          execution: error.execution,
          metadata: { outcome: 'error', errorCode: error.code },
        });
      }
      throw error;
    }
    if (!result.data) throw this.emptyResponseError();

    const response = result.data;
    await this.invocationRecorder.record({
      tenantId: input.tenant_id,
      userId: input.user_id,
      membershipId: tracking.membershipId,
      conversationId: tracking.conversationId ?? null,
      turnId: tracking.turnId,
      requestId: input.request_id,
      toolCallId: tracking.toolCallId,
      operation: 'image.generate',
      execution: toRecordedImageExecution(response.execution),
      metadata: { outcome: 'completed', promptLength: input.prompt.length },
    });
    return response;
  }

  /**
   * 调用 ai-service 文档组合路由（DocumentComposer 生成结构化 DocumentSpec），
   * 返回文档规格与执行元数据；不落库、不创建正式资源。
   * 工具执行幂等由 request_id + tool_call_id 关联，经统一记录器写入调用日志。
   */
  async composeDocument(
    input: ComposeDocumentRequest,
    tracking: ChatInvocationTracking & { toolCallId: string },
  ): Promise<ComposeDocumentResponse> {
    const result = await requestComposeDocument({ client: this.getClient(), body: input });
    if (result.error) {
      const error = this.toInvocationError(result.error, result.response?.status);
      if (error.execution) {
        await this.invocationRecorder.record({
          tenantId: input.tenant_id,
          userId: input.user_id,
          membershipId: tracking.membershipId,
          conversationId: tracking.conversationId ?? null,
          turnId: tracking.turnId,
          requestId: input.request_id,
          toolCallId: tracking.toolCallId,
          operation: 'document.compose',
          execution: error.execution,
          metadata: { outcome: 'error', errorCode: error.code },
        });
      }
      throw error;
    }
    if (!result.data) throw this.emptyResponseError();

    const response = result.data;
    await this.invocationRecorder.record({
      tenantId: input.tenant_id,
      userId: input.user_id,
      membershipId: tracking.membershipId,
      conversationId: tracking.conversationId ?? null,
      turnId: tracking.turnId,
      requestId: input.request_id,
      toolCallId: tracking.toolCallId,
      operation: 'document.compose',
      execution: toRecordedExecution(response.execution),
      metadata: { outcome: 'completed', instructionLength: input.instruction.length },
    });
    return response;
  }

  /**
   * 调用 ai-service 文档 DOCX 渲染路由：DocxRenderer 对结构化 DocumentSpec 做
   * 确定性渲染，不调用 LLM、不产生 Token 指标，返回 DOCX 文件字节；不落库、
   * 不创建正式资源。导出动作的审计由业务层负责。
   */
  async renderDocumentDocx(input: RenderDocxRequest): Promise<Buffer> {
    const result = await requestRenderDocumentDocx({ client: this.getClient(), body: input });
    if (result.error) throw this.toInvocationError(result.error, result.response?.status);
    if (!result.data) throw this.emptyResponseError();
    return Buffer.from(await result.data.arrayBuffer());
  }

  /**
   * 调用 ai-service 文档 PDF 渲染路由：PdfRenderer 对结构化 DocumentSpec 做
   * 确定性渲染（内嵌 CJK 字体），不调用 LLM、不产生 Token 指标，返回 PDF 字节。
   */
  async renderDocumentPdf(input: RenderPdfRequest): Promise<Buffer> {
    const result = await requestRenderDocumentPdf({ client: this.getClient(), body: input });
    if (result.error) throw this.toInvocationError(result.error, result.response?.status);
    if (!result.data) throw this.emptyResponseError();
    return Buffer.from(await result.data.arrayBuffer());
  }

  /**
   * 调用 ai-service 文档 PPTX 渲染路由：PptxRenderer 对结构化 PptxSpec 做
   * 确定性渲染，不调用 LLM、不产生 Token 指标，返回 PPTX 字节。
   */
  async renderDocumentPptx(input: RenderPptxRequest): Promise<Buffer> {
    const result = await requestRenderDocumentPptx({ client: this.getClient(), body: input });
    if (result.error) throw this.toInvocationError(result.error, result.response?.status);
    if (!result.data) throw this.emptyResponseError();
    return Buffer.from(await result.data.arrayBuffer());
  }

  /**
   * 调用 ai-service 文档 DOCX 一键生成路由：compose + render 一步完成，
   * 返回 DOCX 文件字节；不落库、不创建正式资源。
   * 注意：该路由内部会再执行一次 LLM compose，业务链路已有 DocumentSpec 时
   * 应使用 renderDocumentDocx 避免重复生成与内容不一致，本方法仅作透传保留。
   */
  async generateDocumentDocx(input: ComposeDocumentRequest): Promise<Buffer> {
    const result = await requestGenerateDocumentDocx({ client: this.getClient(), body: input });
    if (result.error) throw this.toInvocationError(result.error, result.response?.status);
    if (!result.data) throw this.emptyResponseError();
    return Buffer.from(await result.data.arrayBuffer());
  }

  /**
   * 调用 ai-service 文件提取路由：把文件字节（base64）交给本地确定性提取器，
   * 返回纯文本 parts。提取不调用 LLM、不产生 Token 指标；知识库文本类解析
   * （3.7 节格式分流）与对话附件注入共用该入口。
   */
  async extractFile(input: FileExtractionRequest): Promise<FileExtractionResponse> {
    const result = await requestFileExtraction({ client: this.getClient(), body: input });
    if (result.error) throw this.toInvocationError(result.error, result.response?.status);
    if (!result.data) throw this.emptyResponseError();
    return result.data;
  }

  /**
   * 调用 ai-service 知识索引路由：接收 ParsedDocument 后切分、Embedding 并幂等写入
   * 独立向量库。索引不调用 LLM、不产生 Token 指标；处理状态与审计由 knowledge 模块负责。
   */
  async indexKnowledge(input: KnowledgeIndexRequest): Promise<KnowledgeIndexResponse> {
    const result = await indexKnowledgeDocument({ client: this.getClient(), body: input });
    if (result.error) throw this.toInvocationError(result.error, result.response?.status);
    if (!result.data) throw this.emptyResponseError();
    return result.data;
  }

  /**
   * 调用 ai-service 知识问答路由：内部先按可信 scope 检索，再由 rag role
   * 基于证据生成带引用校验的答案。模型只输出引用编号，服务端映射回真实
   * chunk 来源；检索无结果时短路不调用模型。查询日志与审计由 knowledge 模块负责。
   */
  async answerKnowledge(input: KnowledgeAnswerRequest): Promise<KnowledgeAnswerResponse> {
    const result = await requestKnowledgeAnswer({ client: this.getClient(), body: input });
    if (result.error) throw this.toInvocationError(result.error, result.response?.status);
    if (!result.data) throw this.emptyResponseError();
    return result.data;
  }

  /**
   * 调用 ai-service 索引删除路由：移除指定文档版本在当前 index_version 下的
   * 派生向量节点。删除不调用 LLM、不产生 Token 指标；失败语义由 knowledge
   * 模块决定（当前：记日志不阻塞业务，幂等重试后收敛）。
   */
  async deleteKnowledgeIndex(input: KnowledgeIndexDeleteRequest): Promise<KnowledgeIndexDeleteResponse> {
    const result = await requestKnowledgeIndexDelete({ client: this.getClient(), body: input });
    if (result.error) throw this.toInvocationError(result.error, result.response?.status);
    if (!result.data) throw this.emptyResponseError();
    return result.data;
  }

  /**
   * 打开上游 SSE 流并校验首事件，再交给 recordingInvocationStream 统一记录。
   * Chat 与 ToolTurn 两种上游流共用同一套初始化、终止与错误语义。
   */
  private async openRecordingStream<E extends RecordableStreamEvent>(args: {
    input: ChatLikeRequest;
    tracking: ChatInvocationTracking;
    operation: 'chat.stream' | 'chat.tool_turn';
    signal?: AbortSignal;
    openStream: (options: {
      signal: AbortSignal;
      fetch: typeof fetch;
      onSseError: (error: unknown) => void;
    }) => Promise<AsyncIterator<E>>;
  }): Promise<AsyncGenerator<E>> {
    const upstreamAbort = new AbortController();
    const forwardAbort = (): void => upstreamAbort.abort();
    if (args.signal?.aborted) upstreamAbort.abort();
    else args.signal?.addEventListener('abort', forwardAbort, { once: true });

    let streamFailure: unknown;
    let iterator: AsyncIterator<E> | undefined;
    try {
      iterator = await args.openStream({
        signal: upstreamAbort.signal,
        fetch: this.checkedSseFetch,
        onSseError: (error) => {
          streamFailure = error;
        },
      });

      const first = await iterator.next();
      if (first.done) {
        if (streamFailure) {
          throw streamFailure instanceof AiServiceInvocationError
            ? streamFailure
            : this.toInvocationError(streamFailure);
        }
        throw new AiServiceInvocationError(
          'AI_SERVICE_INVALID_RESPONSE',
          'AI service stream returned no events',
          false,
          502,
        );
      }
      if (first.value.type !== 'started') {
        throw new AiServiceInvocationError(
          'AI_SERVICE_INVALID_RESPONSE',
          'AI service stream did not start with a started event',
          false,
          502,
        );
      }

      return this.recordingInvocationStream({
        input: args.input,
        tracking: args.tracking,
        operation: args.operation,
        iterator,
        firstEvent: first.value,
        upstreamAbort,
        externalSignal: args.signal,
        forwardAbort,
        getStreamFailure: () => streamFailure,
      });
    } catch (error) {
      args.signal?.removeEventListener('abort', forwardAbort);
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

  private async *recordingInvocationStream<E extends RecordableStreamEvent>(args: {
    input: ChatLikeRequest;
    tracking: ChatInvocationTracking;
    operation: 'chat.stream' | 'chat.tool_turn';
    iterator: AsyncIterator<E>;
    firstEvent: E;
    upstreamAbort: AbortController;
    externalSignal?: AbortSignal;
    forwardAbort: () => void;
    getStreamFailure: () => unknown;
  }): AsyncGenerator<E> {
    const startedAt = Date.now();
    let current: IteratorResult<E> = { done: false, value: args.firstEvent };
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
        operation: args.operation,
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
        if (event.type === 'usage' && event.token_usage) tokenUsage = event.token_usage;

        if (event.type === 'completed') {
          if (!execution) {
            throw new AiServiceInvocationError(
              'AI_SERVICE_INVALID_RESPONSE',
              'AI service stream completed without execution metadata',
              false,
              502,
            );
          }
          await recordStream(
            event.latency_ms ?? Math.max(0, Date.now() - startedAt),
            event.finish_reason ?? null,
            'completed',
          );
        } else if (event.type === 'error') {
          await recordStream(
            Math.max(0, Date.now() - startedAt),
            null,
            'error',
            event.error?.code ?? 'UNKNOWN',
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
        'AI service stream ended without a terminal event',
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
    operation: 'chat.invoke' | 'chat.compact' | 'chat.related_questions';
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

function toRecordedImageExecution(execution: ImageGenerationMetadata): AiInvocationExecution {
  return {
    profile: execution.profile,
    provider: execution.provider,
    model: execution.model,
    fallbackCount: execution.fallback_count,
    latencyMs: execution.latency_ms,
    finishReason: null,
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
