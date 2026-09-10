import { ApiError } from './core/ApiError';
import type { ApiRequestOptions } from './core/ApiRequestOptions';
import { OpenAPI } from './core/OpenAPI';
import { getHeaders } from './core/request';
import type { ChatRequest } from './models/ChatRequest';
import type { ChatStreamEvent } from './models/ChatStreamEvent';
import type { ErrorResponseEnvelope } from './models/ErrorResponseEnvelope';

export interface StreamChatEventsOptions {
  requestBody: ChatRequest;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

/**
 * 通过 fetch 读取 POST /chat/stream 的 SSE 事件。
 *
 * 本函数故意不做自动重连：Chat 是会产生 Token 成本的 POST 调用，自动重连可能
 * 重复触发模型生成。调用方收到 error 或网络中断后，应由用户决定是否新建请求重试。
 */
export async function* streamChatEvents(
  options: StreamChatEventsOptions,
): AsyncGenerator<ChatStreamEvent> {
  const requestOptions: ApiRequestOptions = {
    method: 'POST',
    url: '/chat/stream',
    body: options.requestBody,
    mediaType: 'application/json',
    headers: options.headers,
  };
  const headers = await getHeaders(OpenAPI, requestOptions);
  headers.set('Accept', 'text/event-stream');

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(`${OpenAPI.BASE.replace(/\/$/, '')}/chat/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.requestBody),
    signal: options.signal,
    ...(OpenAPI.WITH_CREDENTIALS ? { credentials: OpenAPI.CREDENTIALS } : {}),
  });

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new ApiError(
      requestOptions,
      {
        url: response.url,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body,
      },
      body?.error?.message ?? `Chat stream request failed with status ${response.status}`,
    );
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    throw new Error(`Chat stream returned unexpected Content-Type: ${contentType || 'missing'}`);
  }
  if (!response.body) throw new Error('Chat stream returned an empty response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n?/g, '\n');

      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      if (done && buffer.trim()) chunks.push(buffer);

      for (const chunk of chunks) {
        const event = parseSseChunk(chunk);
        if (!event) continue;
        const terminal = event.type === 'completed' || event.type === 'error';
        if (terminal) completed = true;
        yield event;
        if (terminal) return;
      }
      if (done) throw new Error('Chat stream ended without a completed or error event');
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseSseChunk(chunk: string): ChatStreamEvent | undefined {
  const data = chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s?/, ''))
    .join('\n');
  if (!data) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error('Chat stream returned invalid JSON event data');
  }
  if (!isChatStreamEvent(parsed)) throw new Error('Chat stream returned an unknown event type');
  return parsed;
}

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return type === 'started'
    || type === 'status'
    || type === 'content_delta'
    || type === 'usage'
    || type === 'completed'
    || type === 'error';
}

async function readErrorBody(response: Response): Promise<ErrorResponseEnvelope | undefined> {
  try {
    return await response.json() as ErrorResponseEnvelope;
  } catch {
    return undefined;
  }
}
