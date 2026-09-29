import { HttpStatus } from '@nestjs/common';
import { AiServiceInvocationError } from '../ai-orchestration/ai-service-gateway.service';
import { describeAssistantError } from './assistant.errors';

describe('describeAssistantError', () => {
    it('maps truncated tool arguments to an actionable Chinese message', () => {
        // 模型把长文档内联进工具参数时会被输出上限截断，用户需要知道下一步怎么做，
        // 而不是只看到「AI 请求失败」。
        const described = describeAssistantError(
            new AiServiceInvocationError(
                'LLM_TOOL_ARGUMENTS_INVALID',
                'tool call arguments were incomplete, usually truncated by the output token limit',
                false,
                502,
            ),
        );

        expect(described.code).toBe('LLM_TOOL_ARGUMENTS_INVALID');
        expect(described.status).toBe(HttpStatus.BAD_GATEWAY);
        expect(described.retryable).toBe(false);
        expect(described.message).toContain('缩小本次请求的范围');
        expect(described.message).not.toContain('truncated by the output token limit');
    });

    it('turns an upstream request-validation rejection into an actionable next step', () => {
        // ai-service 拒绝调用请求（上下文超出契约上限）时只回 INVALID_INVOCATION_REQUEST /
        // 「Request validation failed」，且刻意不含字段级原因。用户需要一条能照做的出路，
        // 否则只能在同一个会话里反复重试一个注定失败的请求。
        const described = describeAssistantError(
            new AiServiceInvocationError(
                'INVALID_INVOCATION_REQUEST',
                'Request validation failed',
                false,
                422,
            ),
        );

        expect(described.code).toBe('INVALID_INVOCATION_REQUEST');
        expect(described.status).toBe(HttpStatus.BAD_GATEWAY);
        expect(described.retryable).toBe(false);
        expect(described.message).toContain('新建会话');
        expect(described.message).not.toContain('Request validation failed');
    });
    it('keeps the generic unavailable message for ai-service availability errors', () => {
        const described = describeAssistantError(
            new AiServiceInvocationError('AI_SERVICE_UNAVAILABLE', 'upstream down', true, 503),
        );

        expect(described.message).toBe('AI 助手服务暂不可用');
        expect(described.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('falls back to a retryable generic error for unknown failures', () => {
        const described = describeAssistantError(new Error('boom'));

        expect(described.code).toBe('TURN_REQUEST_FAILED');
        expect(described.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(described.retryable).toBe(true);
    });
});
