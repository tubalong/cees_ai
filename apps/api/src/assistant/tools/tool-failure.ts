import { AiServiceInvocationError } from '../../ai-orchestration/ai-service-gateway.service';
import { ToolPolicyError } from './tool-policy.service';
import { ToolExecutionError } from './tool.types';

/**
 * 工具执行链的共享失败映射（轮次运行器与步骤运行器共用）。
 *
 * 把执行器异常拆成两部分：summary 回喂模型（只允许服务端固定友好文案，
 * 不携带权限码、错误码或任何动态错误详情——内部信息一旦进入模型上下文，
 * 用户即可通过诱导让模型复述），errorMessage 落库与进公开事件供排障。
 */
export function toToolFailure(error: unknown): { summary: string; errorMessage: string; code: string } {
  if (error instanceof ToolPolicyError) {
    return { summary: error.userFacingSummary, errorMessage: error.message, code: error.code };
  }
  if (error instanceof ToolExecutionError) {
    return { summary: error.userFacingSummary, errorMessage: error.message, code: error.code };
  }
  if (error instanceof AiServiceInvocationError) {
    return {
      summary: 'AI 服务暂时不可用，本次操作未能完成；请告知用户稍后重试',
      errorMessage: `${error.code}: ${error.message}`,
      code: 'TOOL_EXECUTION_FAILED',
    };
  }
  const code = isCodedToolError(error) ? error.code : 'TOOL_EXECUTION_FAILED';
  const detail = error instanceof Error ? error.message : '工具执行失败';
  return {
    summary: '该操作未能完成，请告知用户稍后重试或换一种方式表达',
    errorMessage: isCodedToolError(error) ? `${code}: ${detail}` : detail,
    code,
  };
}

export function isCodedToolError(error: unknown): error is { code: string; message: string } {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
    && 'message' in error
    && typeof error.message === 'string',
  );
}

/**
 * Compare provider JSON arguments independent of object-key insertion order.
 * 用于模型调用重放一致性校验：同一 (载体, modelStep, upstreamCallId) 的
 * 参数快照必须逐字节等价，键序不同不构成差异。
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}
