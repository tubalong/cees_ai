import type { PrismaService } from '../database/prisma.service';
import { AiInvocationRecorderService } from './ai-invocation-recorder.service';

describe('AiInvocationRecorderService', () => {
  const create = jest.fn();
  const prisma = { aIInvocationLog: { create } } as unknown as PrismaService;
  const service = new AiInvocationRecorderService(prisma);

  beforeEach(() => {
    create.mockReset().mockResolvedValue({});
  });

  it('writes tenant, member, conversation, turn and Token metrics in one row', async () => {
    await service.record({
      tenantId: '10000000-0000-0000-0000-000000000001',
      userId: '20000000-0000-0000-0000-000000000001',
      membershipId: '30000000-0000-0000-0000-000000000001',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      operation: 'chat.invoke',
      execution: {
        profile: 'primary',
        provider: 'deepseek',
        model: 'deepseek-chat',
        fallbackCount: 0,
        latencyMs: 52,
        finishReason: 'stop',
        tokenUsage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      },
      metadata: { mode: 'standard' },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: '10000000-0000-0000-0000-000000000001',
        userId: '20000000-0000-0000-0000-000000000001',
        membershipId: '30000000-0000-0000-0000-000000000001',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        requestId: 'request-1',
        traceId: null,
        model: 'deepseek-chat',
        latencyMs: 52,
        inputTokens: 11,
        outputTokens: 7,
        operation: 'chat.invoke',
        metadata: {
          mode: 'standard',
          profile: 'primary',
          provider: 'deepseek',
          fallbackCount: 0,
          finishReason: 'stop',
          totalTokens: 18,
        },
      },
    });
  });

  it('keeps optional Chat dimensions nullable for existing generic callers', async () => {
    await service.record({
      tenantId: '10000000-0000-0000-0000-000000000001',
      userId: '20000000-0000-0000-0000-000000000001',
      requestId: 'request-generic',
      operation: 'generic.invoke',
      execution: {
        profile: 'primary',
        provider: 'openai_compatible',
        model: 'model-1',
        fallbackCount: 1,
        latencyMs: 12,
        finishReason: null,
        tokenUsage: { inputTokens: null, outputTokens: null, totalTokens: null },
      },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        membershipId: null,
        conversationId: null,
        turnId: null,
        operation: 'generic.invoke',
      }),
    });
    expect(JSON.stringify(create.mock.calls[0])).not.toContain('content');
    expect(JSON.stringify(create.mock.calls[0])).not.toContain('summary');
  });
});
