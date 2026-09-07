import { Injectable } from '@nestjs/common';
import {
  createClient,
  invokeLlm,
  type Client,
  type ErrorResponse,
  type InvokeRequest,
  type InvokeResponse,
} from '@cees/ai-service-client';
import { PrismaService } from '../database/prisma.service';

export class AiServiceInvocationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiServiceInvocationError';
  }
}

@Injectable()
export class AiServiceClientService {
  private client?: Client;

  constructor(private readonly prisma: PrismaService) {}

  async invoke(input: InvokeRequest): Promise<InvokeResponse> {
    const result = await invokeLlm({ client: this.getClient(), body: input });
    if (result.error) {
      const error = result.error as ErrorResponse;
      throw new AiServiceInvocationError(
        error.error.code,
        error.error.message,
        error.error.retryable,
      );
    }
    if (!result.data) {
      throw new AiServiceInvocationError(
        'AI_SERVICE_INVALID_RESPONSE',
        'AI service returned an empty response',
        false,
      );
    }

    const response = result.data;
    await this.prisma.aIInvocationLog.create({
      data: {
        tenantId: input.tenant_id,
        userId: input.user_id,
        requestId: input.request_id,
        model: response.execution.model,
        latencyMs: response.execution.latency_ms,
        inputTokens: response.execution.token_usage.input_tokens,
        outputTokens: response.execution.token_usage.output_tokens,
        operation: 'generic.invoke',
        metadata: {
          profile: response.execution.profile,
          provider: response.execution.provider,
          fallbackCount: response.execution.fallback_count,
          totalTokens: response.execution.token_usage.total_tokens,
        },
      },
    });
    return response;
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
