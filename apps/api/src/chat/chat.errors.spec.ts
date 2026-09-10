import { HttpStatus } from '@nestjs/common';
import { AiServiceInvocationError } from '../ai-orchestration/ai-service-client.service';
import { describeChatError } from './chat.errors';

describe('describeChatError', () => {
  it('maps an unexpected ai-service 500 response to a gateway error', () => {
    expect(describeChatError(new AiServiceInvocationError(
      'INTERNAL_ERROR',
      'An unexpected internal error occurred',
      false,
      HttpStatus.INTERNAL_SERVER_ERROR,
    ))).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred',
      retryable: false,
      status: HttpStatus.BAD_GATEWAY,
    });
  });

  it('does not expose missing internal URL or Token configuration details', () => {
    expect(describeChatError(new AiServiceInvocationError(
      'AI_SERVICE_NOT_CONFIGURED',
      'AI service URL and internal token are required',
      false,
      HttpStatus.SERVICE_UNAVAILABLE,
    ))).toEqual({
      code: 'AI_SERVICE_NOT_CONFIGURED',
      message: 'AI 对话服务暂不可用',
      retryable: false,
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});
