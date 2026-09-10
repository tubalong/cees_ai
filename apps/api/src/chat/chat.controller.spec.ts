import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import type { ChatStreamResultEvent } from './chat.types';
import { AiServiceInvocationError } from '../ai-orchestration/ai-service-client.service';

describe('ChatController', () => {
  const stream = jest.fn();
  const chatService = { stream } as unknown as ChatService;
  const controller = new ChatController(chatService);
  const input = {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    mode: 'standard' as const,
    messages: [{ id: 'message-1', role: 'user' as const, content: '问题' }],
  };

  beforeEach(() => stream.mockReset());

  it('writes public Chat events as SSE without the JSON response envelope', async () => {
    stream.mockResolvedValue(events([
      {
        type: 'started',
        requestId: 'request-1',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        mode: 'standard',
        contextUsage: {
          strategy: 'full',
          receivedMessageCount: 1,
          includedMessageCount: 1,
          historyTruncated: false,
          estimatedInputTokens: 4,
        },
      },
      { type: 'content_delta', text: '回答' },
      { type: 'usage', tokenUsage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } },
      { type: 'completed', latencyMs: 20, finishReason: 'stop' },
    ]));
    const response = new FakeResponse();

    await controller.stream('request-1', input, response as unknown as Response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(response.chunks.join('')).toContain('event: started\ndata: {"type":"started"');
    expect(response.chunks.join('')).toContain('event: completed\ndata: {"type":"completed"');
    expect(response.chunks.join('')).not.toContain('"success":true');
    expect(response.writableEnded).toBe(true);
  });

  it('keeps pre-stream failures as normal HTTP errors', async () => {
    stream.mockRejectedValue(new AiServiceInvocationError(
      'CHAT_MODE_UNAVAILABLE',
      'mode unavailable',
      true,
      503,
    ));
    const response = new FakeResponse();

    await expect(controller.stream('request-1', input, response as unknown as Response))
      .rejects.toMatchObject({ status: 503, response: { code: 'CHAT_MODE_UNAVAILABLE' } });
    expect(response.chunks).toHaveLength(0);
  });

  it('aborts the upstream signal when the client disconnects', async () => {
    let upstreamSignal: AbortSignal | undefined;
    stream.mockImplementation((_input, _requestId, signal: AbortSignal) => {
      upstreamSignal = signal;
      return Promise.resolve(events([{
        type: 'started',
        requestId: 'request-1',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        mode: 'standard',
        contextUsage: {
          strategy: 'full',
          receivedMessageCount: 1,
          includedMessageCount: 1,
          historyTruncated: false,
          estimatedInputTokens: 4,
        },
      }]));
    });
    const response = new FakeResponse(true);

    await controller.stream('request-1', input, response as unknown as Response);

    expect(upstreamSignal?.aborted).toBe(true);
  });
});

async function* events(items: ChatStreamResultEvent[]): AsyncGenerator<ChatStreamResultEvent> {
  for (const item of items) yield item;
}

class FakeResponse extends EventEmitter {
  readonly headers: Record<string, string> = {};
  readonly chunks: string[] = [];
  statusCode = 0;
  headersSent = false;
  writableEnded = false;
  destroyed = false;

  constructor(private readonly disconnectOnFirstWrite = false) {
    super();
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  flushHeaders(): void {
    this.headersSent = true;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    if (this.disconnectOnFirstWrite) {
      this.destroyed = true;
      this.emit('close');
    }
    return true;
  }

  end(): this {
    this.writableEnded = true;
    return this;
  }
}
