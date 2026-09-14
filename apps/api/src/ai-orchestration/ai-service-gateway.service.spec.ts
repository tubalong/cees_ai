import type {
  ChatInvokeResponse,
  ChatStreamEvent,
  CompactChatResponse,
  ComposeDocumentResponse,
  InvokeResponse,
} from '@cees/ai-service-client';
import type { AiInvocationRecorderService } from './ai-invocation-recorder.service';
import { AiServiceGateway, AiServiceInvocationError } from './ai-service-gateway.service';

const execution = {
  profile: 'primary',
  provider: 'openai_compatible' as const,
  model: 'model-1',
  fallback_count: 1,
  latency_ms: 42,
  finish_reason: 'stop',
  token_usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
};

const invocationResponse: InvokeResponse = {
  request_id: 'req-1',
  output: { type: 'text', text: 'hello' },
  execution,
};

const chatResponse: ChatInvokeResponse = {
  request_id: 'req-chat-1',
  conversation_id: 'conversation-1',
  mode: 'standard',
  message: { role: 'assistant', content: '你好' },
  context_usage: {
    strategy: 'full',
    received_message_count: 1,
    included_message_count: 1,
    history_truncated: false,
    estimated_input_tokens: 4,
  },
  execution,
};

const compactResponse: CompactChatResponse = {
  request_id: 'req-compact-1',
  conversation_id: 'conversation-1',
  summary: '用户正在测试对话。',
  summarized_through_message_id: 'message-2',
  execution,
};

const composeResponse: ComposeDocumentResponse = {
  request_id: 'req-compose-1',
  document: {
    schema_version: '1.0',
    title: '项目周报',
    subtitle: null,
    sections: [{ heading: '进展', level: 1, blocks: [{ type: 'paragraph', text: '内容' }] }],
    source_refs: [],
  },
  execution,
};

describe('AiServiceGateway', () => {
  const originalFetch = global.fetch;
  const record = jest.fn();
  const recorder = { record } as unknown as AiInvocationRecorderService;

  beforeEach(() => {
    process.env.AI_SERVICE_URL = 'http://ai-service:8000';
    process.env.AI_INTERNAL_TOKEN = 'secret';
    record.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps the generic invoke contract and records it through the shared recorder', async () => {
    const fetchMock = jsonFetch(invocationResponse);
    global.fetch = fetchMock;
    const service = new AiServiceGateway(recorder);

    const response = await service.invoke({
      request_id: 'req-1',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      response_format: { type: 'text' },
    });

    expect(response).toEqual(invocationResponse);
    expectInternalToken(fetchMock);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      requestId: 'req-1',
      operation: 'generic.invoke',
      execution: expect.objectContaining({ model: 'model-1' }),
    }));
  });

  it('uses the dedicated Chat invoke endpoint and records member, conversation and turn', async () => {
    const fetchMock = jsonFetch(chatResponse);
    global.fetch = fetchMock;
    const service = new AiServiceGateway(recorder);

    const response = await service.invokeChat({
      request_id: 'req-chat-1',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      conversation_id: 'conversation-1',
      mode: 'standard',
      messages: [{ id: 'message-1', role: 'user', content: [{ type: 'text', text: '你好' }] }],
    }, { membershipId: 'membership-1', turnId: 'turn-1' });

    expect(response).toEqual(chatResponse);
    expect(requestUrl(fetchMock)).toBe('http://ai-service:8000/internal/v1/chat/invoke');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      membershipId: 'membership-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      operation: 'chat.invoke',
      metadata: expect.objectContaining({ outcome: 'completed' }),
    }));
    expect(JSON.stringify(record.mock.calls[0])).not.toContain('你好');
  });

  it('uses the dedicated Chat compact endpoint and records its Token usage once', async () => {
    const fetchMock = jsonFetch(compactResponse);
    global.fetch = fetchMock;
    const service = new AiServiceGateway(recorder);

    const response = await service.compactChat({
      request_id: 'req-compact-1',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      conversation_id: 'conversation-1',
      messages: [{ id: 'message-2', role: 'assistant', content: [{ type: 'text', text: '回答' }] }],
    }, { membershipId: 'membership-1', turnId: 'turn-2' });

    expect(response).toEqual(compactResponse);
    expect(requestUrl(fetchMock)).toBe('http://ai-service:8000/internal/v1/chat/compact');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      membershipId: 'membership-1',
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      operation: 'chat.compact',
      metadata: { outcome: 'completed' },
    }));
    expect(JSON.stringify(record.mock.calls[0])).not.toContain('用户正在测试对话');
  });

  it('fetches chat context budgets from /ready and caches them briefly', async () => {
    const fetchMock = jsonFetch({
      status: 'ready',
      service: 'ai-service',
      configured_roles: [],
      configured_chat_modes: ['standard', 'ultra'],
      errors: [],
      chat_context_budgets: { standard: 65536, ultra: 131072 },
    });
    global.fetch = fetchMock;
    const service = new AiServiceGateway(recorder);

    await expect(service.fetchChatContextBudgets()).resolves.toEqual({
      standard: 65536,
      ultra: 131072,
    });
    expect(requestUrl(fetchMock)).toBe('http://ai-service:8000/ready');
    expectInternalToken(fetchMock);

    // TTL 内重复调用命中缓存，不再请求 /ready。
    await expect(service.fetchChatContextBudgets()).resolves.toEqual({
      standard: 65536,
      ultra: 131072,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when /ready omits chat_context_budgets', async () => {
    global.fetch = jsonFetch({
      status: 'ready',
      service: 'ai-service',
      configured_roles: [],
      configured_chat_modes: ['standard'],
      errors: [],
    });
    const service = new AiServiceGateway(recorder);

    await expect(service.fetchChatContextBudgets()).resolves.toBeNull();
  });

  it('returns null and stays silent when the readiness call fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));
    const service = new AiServiceGateway(recorder);

    await expect(service.fetchChatContextBudgets()).resolves.toBeNull();
  });

  it('uses the dedicated document compose endpoint and records the tool call', async () => {
    const fetchMock = jsonFetch(composeResponse);
    global.fetch = fetchMock;
    const service = new AiServiceGateway(recorder);

    const response = await service.composeDocument({
      request_id: 'req-compose-1',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      instruction: '写一份周报',
      source_materials: [],
      document_options: { locale: 'zh-CN', generation_mode: 'fast' },
    }, { membershipId: 'membership-1', turnId: 'turn-4', toolCallId: 'tool-call-1' });

    expect(response).toEqual(composeResponse);
    expect(requestUrl(fetchMock)).toBe('http://ai-service:8000/internal/v1/documents/compose');
    expectInternalToken(fetchMock);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      membershipId: 'membership-1',
      turnId: 'turn-4',
      toolCallId: 'tool-call-1',
      operation: 'document.compose',
      execution: expect.objectContaining({ model: 'model-1' }),
      metadata: { outcome: 'completed', instructionLength: 5 },
    }));
    expect(JSON.stringify(record.mock.calls[0])).not.toContain('写一份周报');
  });

  it('proxies Chat SSE events and records the completed stream exactly once', async () => {
    const streamEvents: ChatStreamEvent[] = [
      {
        type: 'started',
        request_id: 'req-stream-1',
        conversation_id: 'conversation-1',
        mode: 'ultra',
        context_usage: {
          strategy: 'summary_plus_recent',
          received_message_count: 3,
          included_message_count: 2,
          history_truncated: false,
          estimated_input_tokens: 12,
        },
      },
      {
        type: 'status',
        phase: 'answering',
        execution: {
          profile: 'reasoning',
          provider: 'deepseek',
          model: 'deepseek-chat',
          fallback_count: 0,
        },
      },
      { type: 'content_delta', text: '你好' },
      { type: 'usage', token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
      { type: 'completed', latency_ms: 88, finish_reason: 'stop' },
    ];
    const fetchMock = sseFetch(streamEvents);
    global.fetch = fetchMock;
    const service = new AiServiceGateway(recorder);

    const stream = await service.streamChat({
      request_id: 'req-stream-1',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      conversation_id: 'conversation-1',
      mode: 'ultra',
      messages: [{ id: 'message-3', role: 'user', content: [{ type: 'text', text: '你好' }] }],
    }, { membershipId: 'membership-1', turnId: 'turn-3' });
    const received: ChatStreamEvent[] = [];
    for await (const event of stream) received.push(event);

    expect(received).toEqual(streamEvents);
    expect(requestUrl(fetchMock)).toBe('http://ai-service:8000/internal/v1/chat/stream');
    expectInternalToken(fetchMock);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      membershipId: 'membership-1',
      conversationId: 'conversation-1',
      turnId: 'turn-3',
      operation: 'chat.stream',
      execution: expect.objectContaining({
        model: 'deepseek-chat',
        latencyMs: 88,
        tokenUsage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      }),
    }));
  });

  it('records a started provider stream that ends with an error even when Token usage is unavailable', async () => {
    const streamEvents: ChatStreamEvent[] = [
      {
        type: 'started',
        request_id: 'req-stream-error',
        conversation_id: 'conversation-1',
        mode: 'standard',
        context_usage: {
          strategy: 'full',
          received_message_count: 1,
          included_message_count: 1,
          history_truncated: false,
          estimated_input_tokens: 4,
        },
      },
      {
        type: 'status',
        phase: 'answering',
        execution: {
          profile: 'primary',
          provider: 'openai_compatible',
          model: 'model-1',
          fallback_count: 0,
        },
      },
      {
        type: 'error',
        error: {
          code: 'CHAT_STREAM_INTERRUPTED',
          message: 'stream interrupted',
          request_id: 'req-stream-error',
          retryable: true,
        },
      },
    ];
    global.fetch = sseFetch(streamEvents);
    const service = new AiServiceGateway(recorder);

    const stream = await service.streamChat({
      request_id: 'req-stream-error',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      conversation_id: 'conversation-1',
      messages: [{ id: 'message-error', role: 'user', content: [{ type: 'text', text: '你好' }] }],
    }, { membershipId: 'membership-1', turnId: 'turn-error' });
    const received = await collectEvents(stream);

    expect(received).toEqual(streamEvents);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'chat.stream',
      execution: expect.objectContaining({
        model: 'model-1',
        tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null },
      }),
      metadata: expect.objectContaining({
        outcome: 'error',
        errorCode: 'CHAT_STREAM_INTERRUPTED',
      }),
    }));
  });

  it('records a client-cancelled provider stream once even before Token usage is reported', async () => {
    const abortController = new AbortController();
    const encoder = new TextEncoder();
    const initialEvents: ChatStreamEvent[] = [
      {
        type: 'started',
        request_id: 'req-stream-cancel',
        conversation_id: 'conversation-1',
        mode: 'standard',
        context_usage: {
          strategy: 'full',
          received_message_count: 1,
          included_message_count: 1,
          history_truncated: false,
          estimated_input_tokens: 4,
        },
      },
      {
        type: 'status',
        phase: 'answering',
        execution: {
          profile: 'primary',
          provider: 'openai_compatible',
          model: 'model-1',
          fallback_count: 0,
        },
      },
    ];
    const body = initialEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
    global.fetch = jest.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body));
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    const service = new AiServiceGateway(recorder);

    const stream = await service.streamChat({
      request_id: 'req-stream-cancel',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      conversation_id: 'conversation-1',
      messages: [{ id: 'message-cancel', role: 'user', content: [{ type: 'text', text: '你好' }] }],
    }, { membershipId: 'membership-1', turnId: 'turn-cancel' }, abortController.signal);
    const iterator = stream[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toEqual(initialEvents[0]);
    expect((await iterator.next()).value).toEqual(initialEvents[1]);
    abortController.abort();
    expect((await iterator.next()).done).toBe(true);

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'chat.stream',
      execution: expect.objectContaining({
        model: 'model-1',
        tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null },
      }),
      metadata: expect.objectContaining({ outcome: 'cancelled' }),
    }));
  });

  it('does not retry a failed usage write from stream cleanup', async () => {
    const streamEvents: ChatStreamEvent[] = [
      {
        type: 'started',
        request_id: 'req-stream-record-failure',
        conversation_id: 'conversation-1',
        mode: 'standard',
        context_usage: {
          strategy: 'full',
          received_message_count: 1,
          included_message_count: 1,
          history_truncated: false,
          estimated_input_tokens: 4,
        },
      },
      {
        type: 'status',
        phase: 'answering',
        execution: {
          profile: 'primary',
          provider: 'openai_compatible',
          model: 'model-1',
          fallback_count: 0,
        },
      },
      { type: 'completed', latency_ms: 25, finish_reason: 'stop' },
    ];
    record.mockRejectedValueOnce(new Error('usage database unavailable'));
    global.fetch = sseFetch(streamEvents);
    const service = new AiServiceGateway(recorder);

    const stream = await service.streamChat({
      request_id: 'req-stream-record-failure',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      conversation_id: 'conversation-1',
      messages: [{ id: 'message-record-failure', role: 'user', content: [{ type: 'text', text: '浣犲ソ' }] }],
    }, { membershipId: 'membership-1', turnId: 'turn-record-failure' });

    await expect(collectEvents(stream)).rejects.toThrow('usage database unavailable');
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('rejects a provider stream that closes without a terminal event and records the started call', async () => {
    const streamEvents: ChatStreamEvent[] = [
      {
        type: 'started',
        request_id: 'req-stream-invalid',
        conversation_id: 'conversation-1',
        mode: 'standard',
        context_usage: {
          strategy: 'full',
          received_message_count: 1,
          included_message_count: 1,
          history_truncated: false,
          estimated_input_tokens: 4,
        },
      },
      {
        type: 'status',
        phase: 'answering',
        execution: {
          profile: 'primary',
          provider: 'openai_compatible',
          model: 'model-1',
          fallback_count: 0,
        },
      },
    ];
    global.fetch = sseFetch(streamEvents);
    const service = new AiServiceGateway(recorder);

    const stream = await service.streamChat({
      request_id: 'req-stream-invalid',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      conversation_id: 'conversation-1',
      messages: [{ id: 'message-invalid', role: 'user', content: [{ type: 'text', text: '你好' }] }],
    }, { membershipId: 'membership-1', turnId: 'turn-invalid' });

    await expect(collectEvents(stream)).rejects.toEqual(
      expect.objectContaining<Partial<AiServiceInvocationError>>({
        code: 'AI_SERVICE_INVALID_RESPONSE',
        httpStatus: 502,
      }),
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      execution: expect.objectContaining({
        tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null },
      }),
      metadata: expect.objectContaining({
        outcome: 'error',
        errorCode: 'AI_SERVICE_INVALID_RESPONSE',
      }),
    }));
  });

  it('rejects a non-SSE upstream response without retrying the Token-consuming POST', async () => {
    const fetchMock = jsonFetch({ unexpected: true });
    global.fetch = fetchMock;
    const service = new AiServiceGateway(recorder);

    await expect(service.streamChat({
      request_id: 'req-stream-content-type',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      conversation_id: 'conversation-1',
      messages: [{ id: 'message-content-type', role: 'user', content: [{ type: 'text', text: '你好' }] }],
    }, { membershipId: 'membership-1', turnId: 'turn-content-type' })).rejects.toEqual(
      expect.objectContaining<Partial<AiServiceInvocationError>>({
        code: 'AI_SERVICE_INVALID_RESPONSE',
        httpStatus: 502,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
  });

  it('fails lazily when AI service configuration is missing', async () => {
    delete process.env.AI_SERVICE_URL;
    delete process.env.AI_INTERNAL_TOKEN;
    const service = new AiServiceGateway(recorder);

    await expect(service.invoke({
      request_id: 'req-config',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      response_format: { type: 'text' },
    })).rejects.toEqual(expect.objectContaining<Partial<AiServiceInvocationError>>({
      code: 'AI_SERVICE_NOT_CONFIGURED',
      retryable: false,
      httpStatus: 503,
    }));
  });

  it('maps generated error responses and never writes a usage row for a rejected call', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'LLM_UNAVAILABLE',
        message: 'unavailable',
        request_id: 'req-2',
        retryable: true,
      },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    const service = new AiServiceGateway(recorder);

    await expect(service.invoke({
      request_id: 'req-2',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      response_format: { type: 'text' },
    })).rejects.toEqual(expect.objectContaining<Partial<AiServiceInvocationError>>({
      code: 'LLM_UNAVAILABLE',
      retryable: true,
      httpStatus: 503,
    }));
    expect(record).not.toHaveBeenCalled();
  });

  it('records non-stream Chat usage when ai-service rejects a post-execution result', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'CHAT_COMPACTION_TRUNCATED',
        message: 'Chat compaction reached the output token limit',
        request_id: 'req-compact-error',
        retryable: false,
      },
      execution,
    }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
    const service = new AiServiceGateway(recorder);

    await expect(service.compactChat({
      request_id: 'req-compact-error',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      conversation_id: 'conversation-1',
      messages: [{ id: 'message-compact-error', role: 'assistant', content: [{ type: 'text', text: '回答' }] }],
    }, { membershipId: 'membership-1', turnId: 'turn-compact-error' })).rejects.toEqual(
      expect.objectContaining<Partial<AiServiceInvocationError>>({
        code: 'CHAT_COMPACTION_TRUNCATED',
        httpStatus: 502,
      }),
    );

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      membershipId: 'membership-1',
      conversationId: 'conversation-1',
      turnId: 'turn-compact-error',
      operation: 'chat.compact',
      execution: expect.objectContaining({
        model: 'model-1',
        tokenUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      }),
      metadata: {
        outcome: 'error',
        errorCode: 'CHAT_COMPACTION_TRUNCATED',
      },
    }));
  });
});

function jsonFetch(payload: unknown): jest.Mock {
  return jest.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function sseFetch(events: ChatStreamEvent[]): jest.Mock {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return jest.fn().mockResolvedValue(new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  }));
}

function requestFrom(fetchMock: jest.Mock): Request {
  const [input, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?];
  return input instanceof Request ? input : new Request(input, init);
}

function requestUrl(fetchMock: jest.Mock): string {
  return requestFrom(fetchMock).url;
}

function expectInternalToken(fetchMock: jest.Mock): void {
  expect(requestFrom(fetchMock).headers.get('X-AI-Internal-Token')).toBe('secret');
}

async function collectEvents(stream: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const received: ChatStreamEvent[] = [];
  for await (const event of stream) received.push(event);
  return received;
}
