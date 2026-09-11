/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConversationDetailResponseEnvelope } from '../models/ConversationDetailResponseEnvelope';
import type { ConversationListResponseEnvelope } from '../models/ConversationListResponseEnvelope';
import type { ConversationResponseEnvelope } from '../models/ConversationResponseEnvelope';
import type { CreateConversationRequest } from '../models/CreateConversationRequest';
import type { CreateTurnRequest } from '../models/CreateTurnRequest';
import type { TurnResponseEnvelope } from '../models/TurnResponseEnvelope';
import type { TurnStreamEvent } from '../models/TurnStreamEvent';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ConversationService {
    /**
     * 创建当前成员的私有 AI 会话
     * 创建属于当前租户成员的私有会话。标题可省略，服务端在首轮完成后根据首条消息自动生成。
     *
     * @returns ConversationResponseEnvelope 会话创建成功
     * @throws ApiError
     */
    public static createConversation({
        requestBody,
    }: {
        requestBody: CreateConversationRequest,
    }): CancelablePromise<ConversationResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/conversations',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
            },
        });
    }
    /**
     * 查询当前成员的会话列表
     * 按更新时间倒序返回当前成员的私有会话。
     * @returns ConversationListResponseEnvelope 会话列表
     * @throws ApiError
     */
    public static listConversations({
        limit = 20,
        cursor,
    }: {
        /**
         * 每页数量，默认 20，最大 100
         */
        limit?: number,
        /**
         * 分页游标，上一页返回的 nextCursor
         */
        cursor?: string,
    }): CancelablePromise<ConversationListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/conversations',
            query: {
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
            },
        });
    }
    /**
     * 查询会话详情与最近消息
     * 返回会话元数据与最近消息（按时间升序，最多 100 条）。只有会话所属成员可以访问。
     *
     * @returns ConversationDetailResponseEnvelope 会话详情
     * @throws ApiError
     */
    public static getConversation({
        conversationId,
    }: {
        /**
         * 会话 ID
         */
        conversationId: string,
    }): CancelablePromise<ConversationDetailResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/conversations/{conversationId}',
            path: {
                'conversationId': conversationId,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                404: `会话不存在或不属于当前成员`,
            },
        });
    }
    /**
     * 发起一轮对话并以 SSE 流式返回事件
     * 客户端只提交本轮 user 消息；历史消息与摘要由服务端加载并组装上下文。
     * 成功建立流后，每个 SSE `data` 字段都是一个 `TurnStreamEvent` JSON 对象，所有事件携带递增 `seq`。
     * 事件依次为 `started`、可选 `status`、零个或多个 `content_delta`、可选 `usage` 和 `completed`；流开始后的失败以 `error` 事件终止。
     * 客户端断开连接只解除订阅，不取消执行；重连后通过事件重放接口继续接收。
     * 重复提交同一 `Idempotency-Key` 时返回原 Turn 的事件流，不重新生成。
     *
     * @returns TurnStreamEvent 对话事件流
     * @throws ApiError
     */
    public static createTurn({
        conversationId,
        idempotencyKey,
        requestBody,
    }: {
        /**
         * 会话 ID
         */
        conversationId: string,
        /**
         * 客户端生成的幂等键；同一键重复提交返回原 Turn
         */
        idempotencyKey: string,
        requestBody: CreateTurnRequest,
    }): CancelablePromise<TurnStreamEvent> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/conversations/{conversationId}/turns',
            path: {
                'conversationId': conversationId,
            },
            headers: {
                'Idempotency-Key': idempotencyKey,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                404: `会话不存在或不属于当前成员`,
                409: `同一幂等键对应不同请求内容`,
                422: `对话上下文不符合规则或超过预算`,
                502: `AI Provider 返回了无效结果`,
                503: `ai-service、对话模式或模型暂时不可用`,
            },
        });
    }
    /**
     * 以 SSE 重放并继续接收轮次事件
     * 客户端携带已收到的最后事件序号 `afterSeq` 重新订阅；服务端先重放该序号之后的已持久化事件，
     * 再继续实时推送后续事件直到轮次终态。轮次已结束时，重放全部剩余事件后正常结束。
     *
     * @returns TurnStreamEvent 轮次事件流
     * @throws ApiError
     */
    public static replayTurnEvents({
        conversationId,
        turnId,
        afterSeq,
    }: {
        /**
         * 会话 ID
         */
        conversationId: string,
        /**
         * 轮次 ID
         */
        turnId: string,
        /**
         * 已收到的最后事件序号；省略时从首个事件开始重放
         */
        afterSeq?: number,
    }): CancelablePromise<TurnStreamEvent> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/conversations/{conversationId}/turns/{turnId}/events',
            path: {
                'conversationId': conversationId,
                'turnId': turnId,
            },
            query: {
                'afterSeq': afterSeq,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                404: `会话或轮次不存在，或不属于当前成员`,
            },
        });
    }
    /**
     * 取消正在执行的轮次
     * 取消是显式动作，不是断线副作用。仅 RUNNING 状态的轮次可取消；
     * 取消后服务端尽力停止后续模型调用，已写入的正式业务数据不回滚。
     *
     * @returns TurnResponseEnvelope 轮次已取消
     * @throws ApiError
     */
    public static cancelTurn({
        conversationId,
        turnId,
    }: {
        /**
         * 会话 ID
         */
        conversationId: string,
        /**
         * 轮次 ID
         */
        turnId: string,
    }): CancelablePromise<TurnResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/conversations/{conversationId}/turns/{turnId}/cancel',
            path: {
                'conversationId': conversationId,
                'turnId': turnId,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                404: `会话或轮次不存在，或不属于当前成员`,
                409: `轮次已结束，不能取消`,
            },
        });
    }
}
