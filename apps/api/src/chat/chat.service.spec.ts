import type { ChatStreamEvent } from '@cees/ai-service-client';
import type { AiServiceClientService } from '../ai-orchestration/ai-service-client.service';
import type { TenantContext } from '../tenant/tenant-context';
import { ChatService } from './chat.service';

const tenantRequestContext = {
  tenantId: '10000000-0000-0000-0000-000000000001',
  userId: '20000000-0000-0000-0000-000000000001',
  membershipId: '30000000-0000-0000-0000-000000000001',
};

describe('ChatService', () => {
  const invokeChat = jest.fn();
  const compactChat = jest.fn();
  const streamChat = jest.fn();
  const aiServiceClient = { invokeChat, compactChat, streamChat } as unknown as AiServiceClientService;
  const tenantContext = { require: jest.fn(() => tenantRequestContext) } as unknown as TenantContext;
  const service = new ChatService(tenantContext, aiServiceClient);

  beforeEach(() => {
    invokeChat.mockReset();
    compactChat.mockReset();
    streamChat.mockReset();
  });

  it('injects tenant identity into Chat invoke and never accepts internal routing fields', async () => {
    invokeChat.mockResolvedValue({
      request_id: 'request-1',
      conversation_id: 'conversation-1',
      mode: 'standard',
      message: { role: 'assistant', content: '回答' },
      context_usage: {
        strategy: 'full',
        received_message_count: 1,
        included_message_count: 1,
        history_truncated: false,
        estimated_input_tokens: 8,
      },
      execution: {
        profile: 'primary',
        provider: 'deepseek',
        model: 'deepseek-chat',
        fallback_count: 0,
        latency_ms: 40,
        finish_reason: 'stop',
        token_usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      },
    });

    const result = await service.invoke({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      mode: 'standard',
      conversationSummary: null,
      messages: [{ id: 'message-1', role: 'user', content: '问题' }],
    }, 'request-1');

    expect(invokeChat).toHaveBeenCalledWith({
      request_id: 'request-1',
      tenant_id: tenantRequestContext.tenantId,
      user_id: tenantRequestContext.userId,
      conversation_id: 'conversation-1',
      mode: 'standard',
      conversation_summary: null,
      messages: [{ id: 'message-1', role: 'user', content: '问题' }],
    }, {
      membershipId: tenantRequestContext.membershipId,
      turnId: 'turn-1',
    });
    expect(result).toEqual({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      mode: 'standard',
      message: { role: 'assistant', content: '回答' },
      contextUsage: {
        strategy: 'full',
        receivedMessageCount: 1,
        includedMessageCount: 1,
        historyTruncated: false,
        estimatedInputTokens: 8,
      },
      tokenUsage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
      latencyMs: 40,
      finishReason: 'stop',
    });
    expect(JSON.stringify(invokeChat.mock.calls[0][0])).not.toContain('provider');
    expect(JSON.stringify(invokeChat.mock.calls[0][0])).not.toContain('instructions');
  });

  it('rejects invoke and stream requests whose last message is not user', async () => {
    const input = {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      mode: 'standard' as const,
      messages: [{ id: 'message-1', role: 'assistant' as const, content: '回答' }],
    };

    await expect(service.invoke(input, 'request-1')).rejects.toMatchObject({
      response: { code: 'INVALID_CHAT_REQUEST' },
    });
    await expect(service.stream(input, 'request-1')).rejects.toMatchObject({
      response: { code: 'INVALID_CHAT_REQUEST' },
    });
    expect(invokeChat).not.toHaveBeenCalled();
    expect(streamChat).not.toHaveBeenCalled();
  });

  it('returns the summary to the client while only passing tracking IDs to the adapter', async () => {
    compactChat.mockResolvedValue({
      request_id: 'request-2',
      conversation_id: 'conversation-1',
      summary: '压缩后的摘要',
      summarized_through_message_id: 'message-2',
      execution: {
        profile: 'primary',
        provider: 'openai_compatible',
        model: 'model-1',
        fallback_count: 0,
        latency_ms: 50,
        finish_reason: 'stop',
        token_usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
      },
    });

    const result = await service.compact({
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      previousSummary: '旧摘要',
      messages: [{ id: 'message-2', role: 'assistant', content: '回答' }],
    }, 'request-2');

    expect(compactChat).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: tenantRequestContext.tenantId,
      user_id: tenantRequestContext.userId,
      previous_summary: '旧摘要',
    }), {
      membershipId: tenantRequestContext.membershipId,
      turnId: 'turn-2',
    });
    expect(result).toEqual({
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      summary: '压缩后的摘要',
      summarizedThroughMessageId: 'message-2',
      tokenUsage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
      latencyMs: 50,
      finishReason: 'stop',
    });
  });

  it('maps internal Chat SSE fields without exposing provider execution metadata', async () => {
    const upstreamEvents: ChatStreamEvent[] = [
      {
        type: 'started',
        request_id: 'request-3',
        conversation_id: 'conversation-1',
        mode: 'ultra',
        context_usage: {
          strategy: 'recent_only',
          received_message_count: 2,
          included_message_count: 1,
          history_truncated: true,
          estimated_input_tokens: 6,
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
      { type: 'content_delta', text: '答' },
      { type: 'usage', token_usage: { input_tokens: 6, output_tokens: 1, total_tokens: 7 } },
      { type: 'completed', latency_ms: 60, finish_reason: null },
    ];
    streamChat.mockResolvedValue(events(upstreamEvents));

    const stream = await service.stream({
      conversationId: 'conversation-1',
      turnId: 'turn-3',
      mode: 'ultra',
      messages: [{ id: 'message-3', role: 'user', content: '问题' }],
    }, 'request-3');
    const received = [];
    for await (const event of stream) received.push(event);

    expect(received).toEqual([
      {
        type: 'started',
        requestId: 'request-3',
        conversationId: 'conversation-1',
        turnId: 'turn-3',
        mode: 'ultra',
        contextUsage: {
          strategy: 'recent_only',
          receivedMessageCount: 2,
          includedMessageCount: 1,
          historyTruncated: true,
          estimatedInputTokens: 6,
        },
      },
      { type: 'status', phase: 'answering' },
      { type: 'content_delta', text: '答' },
      { type: 'usage', tokenUsage: { inputTokens: 6, outputTokens: 1, totalTokens: 7 } },
      { type: 'completed', latencyMs: 60, finishReason: null },
    ]);
    expect(JSON.stringify(received)).not.toContain('deepseek-chat');
    expect(JSON.stringify(received)).not.toContain('provider');
  });
});

async function* events(items: ChatStreamEvent[]): AsyncGenerator<ChatStreamEvent> {
  for (const item of items) yield item;
}
