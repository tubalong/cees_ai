/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatCompactRequest } from '../models/ChatCompactRequest';
import type { ChatCompactResponseEnvelope } from '../models/ChatCompactResponseEnvelope';
import type { ChatInvokeResponseEnvelope } from '../models/ChatInvokeResponseEnvelope';
import type { ChatRequest } from '../models/ChatRequest';
import type { ChatStreamEvent } from '../models/ChatStreamEvent';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ChatService {
    /**
     * 生成一轮完整的 AI 对话回答
     * 当前租户成员提交保存在客户端本地的历史摘要和近期消息，API 注入可信的租户、用户和成员上下文后调用 ai-service。
     * 会话正文、消息和摘要不会由 API 持久化；API 只记录本次模型调用的租户、成员、会话、轮次和 Token 指标。
     *
     * @returns ChatInvokeResponseEnvelope AI 回答生成成功
     * @throws ApiError
     */
    public static chatInvoke({
        requestBody,
    }: {
        requestBody: ChatRequest,
    }): CancelablePromise<ChatInvokeResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/chat/invoke',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                422: `对话上下文或消息顺序不符合 Chat 规则`,
                502: `AI Provider 返回了无效结果`,
                503: `ai-service、Chat 模式或模型暂时不可用`,
            },
        });
    }
    /**
     * 以 SSE 流式生成一轮 AI 对话回答
     * 成功建立流后，每个 SSE `data` 字段都是一个 `ChatStreamEvent` JSON 对象，不使用普通 JSON 响应包络。
     * 事件依次为 `started`、可选 `status`、零个或多个 `content_delta`、可选 `usage` 和 `completed`；流开始后的失败以 `error` 事件终止。
     * 客户端断开连接时 API 会取消对 ai-service 的上游调用。会话正文仍由客户端本地保存。
     *
     * @returns ChatStreamEvent AI 对话事件流
     * @throws ApiError
     */
    public static chatStream({
        requestBody,
    }: {
        requestBody: ChatRequest,
    }): CancelablePromise<ChatStreamEvent> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/chat/stream',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                422: `对话上下文或消息顺序不符合 Chat 规则`,
                502: `AI Provider 返回了无效结果`,
                503: `ai-service、Chat 模式或模型暂时不可用`,
            },
        });
    }
    /**
     * 将本地对话历史压缩为可复用摘要
     * API 调用 ai-service 生成摘要并把结果返回客户端，由客户端保存摘要及压缩截止消息 ID。
     * API 不保存摘要正文，只记录本次压缩调用所属的租户、成员、会话、轮次和 Token 指标。
     *
     * @returns ChatCompactResponseEnvelope 对话摘要生成成功
     * @throws ApiError
     */
    public static chatCompact({
        requestBody,
    }: {
        requestBody: ChatCompactRequest,
    }): CancelablePromise<ChatCompactResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/chat/compact',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                422: `压缩上下文不符合 Chat 规则或超过预算`,
                502: `AI Provider 返回了无效或被截断的摘要`,
                503: `ai-service 或摘要模型暂时不可用`,
            },
        });
    }
}
