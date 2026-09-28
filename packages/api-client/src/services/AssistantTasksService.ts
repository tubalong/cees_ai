/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskCancelRequest } from '../models/AssistantTaskCancelRequest';
import type { AssistantTaskConfirmRequest } from '../models/AssistantTaskConfirmRequest';
import type { AssistantTaskDetailResponseEnvelope } from '../models/AssistantTaskDetailResponseEnvelope';
import type { AssistantTaskListResponseEnvelope } from '../models/AssistantTaskListResponseEnvelope';
import type { AssistantTaskStatus } from '../models/AssistantTaskStatus';
import type { AssistantTaskStreamEvent } from '../models/AssistantTaskStreamEvent';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AssistantTasksService {
    /**
     * 查询当前成员发起的 AI 任务列表
     * 按创建时间倒序返回当前成员发起的任务，支持按状态与会话过滤；仅返回本人发起的任务。
     * 需具备 ai.task.read 权限（默认角色已包含）。
     *
     * @returns AssistantTaskListResponseEnvelope 任务列表
     * @throws ApiError
     */
    public static listAssistantTasks({
        status,
        conversationId,
        limit = 20,
        cursor,
    }: {
        /**
         * 按任务状态过滤；省略时返回全部状态
         */
        status?: AssistantTaskStatus,
        /**
         * 按发起会话过滤（对话内任务卡片的定位方式）
         */
        conversationId?: string,
        /**
         * 每页数量，默认 20，最大 100
         */
        limit?: number,
        /**
         * 分页游标，上一页返回的 nextCursor
         */
        cursor?: string,
    }): CancelablePromise<AssistantTaskListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/assistant/tasks',
            query: {
                'status': status,
                'conversationId': conversationId,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                403: `缺少任务查看权限`,
            },
        });
    }
    /**
     * 查询任务详情
     * 返回任务、当前最新计划版本（待确认时为草案）与运行时步骤；仅任务发起人可以访问。
     *
     * @returns AssistantTaskDetailResponseEnvelope 任务详情
     * @throws ApiError
     */
    public static getAssistantTask({
        taskId,
    }: {
        /**
         * 任务 ID
         */
        taskId: string,
    }): CancelablePromise<AssistantTaskDetailResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/assistant/tasks/{taskId}',
            path: {
                'taskId': taskId,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                403: `缺少任务查看权限`,
                404: `任务不存在或不属于当前成员`,
            },
        });
    }
    /**
     * 以 SSE 重放并继续接收任务事件
     * 从 afterSeq 之后按序重放任务事件并继续接收增量，直到任务进入终态且事件全部消费。
     * 断线重连按 (taskId, seq) 去重补拉；事件 payload 只含展示字段，不含内部权限与敏感参数。
     *
     * @returns AssistantTaskStreamEvent 任务事件流
     * @throws ApiError
     */
    public static replayAssistantTaskEvents({
        taskId,
        afterSeq,
    }: {
        /**
         * 任务 ID
         */
        taskId: string,
        /**
         * 只返回该序号之后的事件；默认 0（从头重放）
         */
        afterSeq?: number,
    }): CancelablePromise<AssistantTaskStreamEvent> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/assistant/tasks/{taskId}/events',
            path: {
                'taskId': taskId,
            },
            query: {
                'afterSeq': afterSeq,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                403: `缺少任务查看权限`,
                404: `任务不存在或不属于当前成员`,
            },
        });
    }
    /**
     * 确认或调整计划（派发前确认）
     * decision=start：携带全部关键待定项答复，确认计划生效并开始执行——确认前不派发任何步骤；
     * decision=revise：保留当前草案并记录调整意图，随后在对话中提出调整要求生成新草案。
     * 幂等：重复提交返回当前状态而不是报错。
     *
     * @returns AssistantTaskDetailResponseEnvelope 返回更新后的任务详情
     * @throws ApiError
     */
    public static confirmAssistantTaskPlan({
        taskId,
        requestBody,
    }: {
        /**
         * 任务 ID
         */
        taskId: string,
        requestBody: AssistantTaskConfirmRequest,
    }): CancelablePromise<AssistantTaskDetailResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/assistant/tasks/{taskId}/confirm',
            path: {
                'taskId': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败或关键待定项答复不完整`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                403: `缺少任务查看权限`,
                404: `任务不存在或不属于当前成员`,
                409: `任务不在待确认状态（或已进入终态）`,
            },
        });
    }
    /**
     * 取消任务
     * 取消是显式动作：任务进入 CANCELLED 终态并关闭未决挂起事项；已产生的正式业务数据不回滚。
     * 幂等：重复提交返回当前状态而不是报错。
     *
     * @returns AssistantTaskDetailResponseEnvelope 返回更新后的任务详情
     * @throws ApiError
     */
    public static cancelAssistantTask({
        taskId,
        requestBody,
    }: {
        /**
         * 任务 ID
         */
        taskId: string,
        requestBody?: AssistantTaskCancelRequest,
    }): CancelablePromise<AssistantTaskDetailResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/assistant/tasks/{taskId}/cancel',
            path: {
                'taskId': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效、已过期或缺少有效租户成员身份`,
                403: `缺少任务查看权限`,
                404: `任务不存在或不属于当前成员`,
                409: `任务已处于终态，不能取消`,
            },
        });
    }
}
