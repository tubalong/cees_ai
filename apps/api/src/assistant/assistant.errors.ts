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

  if (error.code === 'LLM_TOOL_ARGUMENTS_INVALID') {
    // 模型输出的工具参数不完整，最常见原因是被输出上限截断（例如试图把长文档
    // 内联进工具参数）。给用户可执行的下一步，而不是笼统的「AI 请求失败」。
    return {
      code: error.code,
      message: '模型这次生成的工具参数不完整（内容过多被截断）。请缩小本次请求的范围后重试；'
        + '长文档请先上传附件或先生成文档，再让助手引用保存。',
      retryable: false,
      status: HttpStatus.BAD_GATEWAY,
    };
  }

  if (error.code === 'INVALID_INVOCATION_REQUEST') {
    // ai-service 拒绝调用请求（上下文条数/体积超出契约上限）时返回的 422，
    // 响应体刻意不含字段级原因。这里给出可执行出路：原会话历史仍在，
    // 换一个会话即可继续，而不是让用户反复重试一个注定失败的请求。
    return {
      code: error.code,
      message: '本轮的上下文超出模型可接受的范围（对话历史过长），请新建会话继续；'
        + '原会话内容仍保留在历史记录中。',
      retryable: false,
      status: HttpStatus.BAD_GATEWAY,
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
