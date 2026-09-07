import type { InvokeResponse } from '@cees/ai-service-client';
import type { PrismaService } from '../database/prisma.service';
import { AiServiceClientService, AiServiceInvocationError } from './ai-service-client.service';

const invocationResponse: InvokeResponse = {
  request_id: 'req-1',
  output: { type: 'text', text: 'hello' },
  execution: {
    profile: 'primary',
    provider: 'openai_compatible',
    model: 'model-1',
    fallback_count: 1,
    latency_ms: 42,
    token_usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
  },
};

describe('AiServiceClientService', () => {
  const originalFetch = global.fetch;
  const create = jest.fn();
  const prisma = { aIInvocationLog: { create } } as unknown as PrismaService;

  beforeEach(() => {
    process.env.AI_SERVICE_URL = 'http://ai-service:8000';
    process.env.AI_INTERNAL_TOKEN = 'secret';
    create.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the internal token and persists invocation metadata', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(invocationResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;
    const service = new AiServiceClientService(prisma);

    const response = await service.invoke({
      request_id: 'req-1',
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      messages: [{ role: 'user', content: 'hello' }],
      response_format: { type: 'text' },
    });

    expect(response).toEqual(invocationResponse);
    const [input, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?];
    const request = input instanceof Request ? input : new Request(input, init);
    expect(request.headers.get('X-AI-Internal-Token')).toBe('secret');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        requestId: 'req-1',
        model: 'model-1',
        operation: 'generic.invoke',
      }),
    });
  });

  it('fails lazily when AI service configuration is missing', async () => {
    delete process.env.AI_SERVICE_URL;
    delete process.env.AI_INTERNAL_TOKEN;
    const service = new AiServiceClientService(prisma);

    await expect(
      service.invoke({
        request_id: 'req-config',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        messages: [{ role: 'user', content: 'hello' }],
        response_format: { type: 'text' },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AiServiceInvocationError>>({
        code: 'AI_SERVICE_NOT_CONFIGURED',
        retryable: false,
      }),
    );
  });

  it('maps the generated error response to a stable application error', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'LLM_UNAVAILABLE',
            message: 'unavailable',
            request_id: 'req-2',
            retryable: true,
          },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const service = new AiServiceClientService(prisma);

    await expect(
      service.invoke({
        request_id: 'req-2',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        messages: [{ role: 'user', content: 'hello' }],
        response_format: { type: 'text' },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AiServiceInvocationError>>({
        code: 'LLM_UNAVAILABLE',
        retryable: true,
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });
});
