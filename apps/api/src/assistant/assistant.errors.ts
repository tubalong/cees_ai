import { HttpException, HttpStatus } from '@nestjs/common';
import { AiServiceInvocationError } from '../ai-orchestration/ai-service-gateway.service';
import type { PublicTurnErrorDetail } from './assistant.types';

export interface PublicAssistantError extends PublicTurnErrorDetail {
  status: number;
}

/** 将网关或上游错误映射为公开错误；SSE 事件与 JSON 响应共用同一套描述。 */
export function describeAssistantError(error: unknown): PublicAssistantError {
  if (!(error instanceof AiServiceInvocationError)) {
    return {
      code: 'TURN_REQUEST_FAILED',
      message: 'AI 助手请求处理失败',
      retryable: true,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  if (error.httpStatus === HttpStatus.UNAUTHORIZED) {
    return {
      code: 'AI_SERVICE_INTERNAL_AUTH_FAILED',
      message: 'AI 服务内部认证配置无效',
      retryable: false,
      status: HttpStatus.SERVICE_UNAVAILABLE,
    };
  }

  if (
    error.code === 'AI_SERVICE_NOT_CONFIGURED'
    || error.code === 'AI_SERVICE_UNAVAILABLE'
    || error.code === 'AI_SERVICE_NOT_READY'
  ) {
    return {
      code: error.code,
      message: 'AI 助手服务暂不可用',
      retryable: error.retryable,
      status: HttpStatus.SERVICE_UNAVAILABLE,
    };
  }

  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    status: publicStatus(error),
  };
}

export function toAssistantHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  const described = describeAssistantError(error);
  return new HttpException(
    {
      code: described.code,
      message: described.message,
      details: { retryable: described.retryable },
    },
    described.status,
  );
}

function publicStatus(error: AiServiceInvocationError): number {
  if (
    error.code === 'AI_SERVICE_NOT_CONFIGURED'
    || error.code === 'AI_SERVICE_UNAVAILABLE'
    || error.code === 'AI_SERVICE_NOT_READY'
    || error.code === 'CHAT_MODE_UNAVAILABLE'
  ) {
    return HttpStatus.SERVICE_UNAVAILABLE;
  }
  if (error.code === 'INVALID_CHAT_REQUEST' || error.code === 'CHAT_CONTEXT_TOO_LARGE') {
    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
  if (
    error.code === 'AI_SERVICE_INVALID_RESPONSE'
    || error.code === 'CHAT_OUTPUT_INVALID'
    || error.code === 'CHAT_SUMMARY_INVALID'
    || error.code === 'CHAT_COMPACTION_TRUNCATED'
  ) {
    return HttpStatus.BAD_GATEWAY;
  }
  if (
    error.httpStatus === HttpStatus.BAD_REQUEST
    || error.httpStatus === HttpStatus.UNPROCESSABLE_ENTITY
    || error.httpStatus === HttpStatus.BAD_GATEWAY
    || error.httpStatus === HttpStatus.SERVICE_UNAVAILABLE
  ) {
    return error.httpStatus;
  }
  return HttpStatus.BAD_GATEWAY;
}
