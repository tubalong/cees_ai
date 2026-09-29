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
