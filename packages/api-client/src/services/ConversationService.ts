/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantActionDraftResolutionEnvelope } from '../models/AssistantActionDraftResolutionEnvelope';
import type { ConversationDetailResponseEnvelope } from '../models/ConversationDetailResponseEnvelope';
import type { ConversationListResponseEnvelope } from '../models/ConversationListResponseEnvelope';
import type { ConversationResponseEnvelope } from '../models/ConversationResponseEnvelope';
import type { CreateConversationRequest } from '../models/CreateConversationRequest';
import type { CreateTurnRequest } from '../models/CreateTurnRequest';
import type { DingTalkConnectorPlanRequest } from '../models/DingTalkConnectorPlanRequest';
import type { DingTalkConnectorPlanResponseEnvelope } from '../models/DingTalkConnectorPlanResponseEnvelope';
import type { GitHubConnectorPlanRequest } from '../models/GitHubConnectorPlanRequest';
import type { GitHubConnectorPlanResponseEnvelope } from '../models/GitHubConnectorPlanResponseEnvelope';
import type { TencentMeetingConnectorPlanRequest } from '../models/TencentMeetingConnectorPlanRequest';
import type { TencentMeetingConnectorPlanResponseEnvelope } from '../models/TencentMeetingConnectorPlanResponseEnvelope';
import type { TurnResponseEnvelope } from '../models/TurnResponseEnvelope';
import type { TurnStreamEvent } from '../models/TurnStreamEvent';
import type { UpdateConversationRequest } from '../models/UpdateConversationRequest';
import type { WeComConnectorPlanRequest } from '../models/WeComConnectorPlanRequest';
import type { WeComConnectorPlanResponseEnvelope } from '../models/WeComConnectorPlanResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ConversationService {
    /**
     * Plan read-only DingTalk DWS queries for the current question
     * Desktop dynamically discovers read-only tools from the locally installed DWS Schema. The API only asks the model
     * to select tools and arguments; it never stores DWS credentials or executes local commands. Before execution, Desktop
     * must reload the leaf Schema and verify effect=read, confirmation=not_required, and availability=available.
     *
     * @returns DingTalkConnectorPlanResponseEnvelope Up to three local read-only calls; calls is empty when DingTalk data is unnecessary
     * @throws ApiError
     */
    public static planDingTalkConnectorQueries({
        requestBody,
    }: {
        requestBody: DingTalkConnectorPlanRequest,
    }): CancelablePromise<DingTalkConnectorPlanResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/assistant/connectors/dingtalk/plan',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Invalid query or tool catalog`,
                401: `Authentication or tenant membership is invalid`,
                502: `AI provider returned an invalid plan`,
                503: `AI service or model is temporarily unavailable`,
            },
        });
    }
    /**
     * Plan Tencent Meeting official CLI calls for the current question
     * Desktop installs a pinned official @tencentcloud/tmeet CLI, completes browser OAuth locally, and derives the
     * version-aligned command schema from the installed CLI help. The API only asks the model to select tool names and
     * arguments; OAuth credentials remain in the CLI-owned encrypted Desktop directories and are never uploaded to
     * CEES API. Desktop must request explicit user confirmation before executing any WRITE or DESTRUCTIVE command.
     *
     * @returns TencentMeetingConnectorPlanResponseEnvelope Up to three local official-CLI calls; calls is empty when Tencent Meeting data is unnecessary
     * @throws ApiError
     */
    public static planTencentMeetingConnectorQueries({
        requestBody,
    }: {
        requestBody: TencentMeetingConnectorPlanRequest,
    }): CancelablePromise<TencentMeetingConnectorPlanResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/assistant/connectors/tencent-meeting/plan',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Invalid query or version-aligned CLI command catalog`,
                401: `Authentication or tenant membership is invalid`,
                502: `AI provider returned an invalid plan`,
                503: `AI service or model is temporarily unavailable`,
            },
        });
    }
    /**
     * Plan WeCom official CLI calls for the current question
     * Desktop installs the pinned official WeCom CLI and dynamically discovers tools after the user authorizes an
     * intelligent bot by QR code. The API only asks the model to select tool names and arguments; WeCom authorization
     * remains in the Desktop-managed CLI config directory and is never uploaded to CEES API. Desktop must request
     * explicit user confirmation before executing any tool marked as WRITE or DESTRUCTIVE.
     *
     * @returns WeComConnectorPlanResponseEnvelope Up to three local CLI calls; calls is empty when WeCom data is unnecessary
     * @throws ApiError
     */
    public static planWeComConnectorQueries({
        requestBody,
    }: {
        requestBody: WeComConnectorPlanRequest,
    }): CancelablePromise<WeComConnectorPlanResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/assistant/connectors/wecom/plan',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Invalid query or dynamic tool catalog`,
                401: `Authentication or tenant membership is invalid`,
                502: `AI provider returned an invalid plan`,
                503: `AI service or model is temporarily unavailable`,
            },
        });
    }
    /**
     * Plan GitHub official remote MCP calls for the current question
     * Desktop connects to the fixed GitHub-hosted remote MCP endpoint and sends the dynamically discovered tool
     * catalog. The API only plans tool names and arguments; GitHub OAuth credentials and MCP execution remain in
     * the Desktop Main Process. Desktop must require explicit confirmation before executing WRITE or DESTRUCTIVE tools.
     *
     * @returns GitHubConnectorPlanResponseEnvelope Up to three GitHub remote MCP calls; calls is empty when GitHub data is unnecessary
     * @throws ApiError
     */
    public static planGitHubConnectorQueries({
        requestBody,
    }: {
        requestBody: GitHubConnectorPlanRequest,
    }): CancelablePromise<GitHubConnectorPlanResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/assistant/connectors/github/plan',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Invalid query or MCP tool catalog`,
                401: `Authentication or tenant membership is invalid`,
                502: `AI provider returned an invalid plan`,
                503: `AI service or model is temporarily unavailable`,
            },
        });
    }
    /**
     * 确认并执行 AI 写操作草稿
     * 写工具（riskLevel=WRITE）在对话中不会直接执行：模型只产出参数与预览，服务端落为
     * 待确认草稿并在 tool_result 事件的 confirmation 字段里返回。用户确认后调用本接口。
     * 服务端只信任草稿内保存的参数快照，重新解析成员实时权限并重新执行参数校验，
     * 因此确认前被回收权限或停用成员都不会产生写入。PENDING_CONFIRMATION → EXECUTING
     * 通过条件更新抢占：重复确认返回同一结果，不会重复写入。
     *
     * @returns AssistantActionDraftResolutionEnvelope 草稿已执行
     * @throws ApiError
     */
    public static confirmAssistantActionDraft({
        draftId,
    }: {
        draftId: string,
    }): CancelablePromise<AssistantActionDraftResolutionEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/assistant/action-drafts/{draftId}/confirm',
            path: {
                'draftId': draftId,
            },
            errors: {
                403: `确认瞬间权限已不足`,
                404: `草稿不存在或不属于当前成员`,
                409: `草稿已过期、已取消或已被处理`,
            },
        });
    }
    /**
     * 取消 AI 写操作草稿
     * 用户拒绝执行草稿。取消后草稿进入 REJECTED 终态，不可再确认；需重新发起对话生成新草稿。
     * @returns AssistantActionDraftResolutionEnvelope 草稿已取消
     * @throws ApiError
     */
    public static cancelAssistantActionDraft({
        draftId,
    }: {
        draftId: string,
    }): CancelablePromise<AssistantActionDraftResolutionEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/assistant/action-drafts/{draftId}/cancel',
            path: {
                'draftId': draftId,
            },
            errors: {
                404: `草稿不存在或不属于当前成员`,
                409: `草稿已过期、已执行或已被处理`,
            },
        });
    }
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
     * 修改当前成员私有会话的标题
     * 使用会话版本进行乐观并发控制；版本不匹配时返回 409。
     * @returns ConversationResponseEnvelope 返回修改后的会话
     * @throws ApiError
     */
    public static updateConversation({
        conversationId,
        requestBody,
    }: {
        /**
         * 会话 ID
         */
        conversationId: string,
        requestBody: UpdateConversationRequest,
    }): CancelablePromise<ConversationResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/conversations/{conversationId}',
            path: {
                'conversationId': conversationId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态或租户成员身份无效`,
                404: `会话不存在或不属于当前成员`,
                409: `会话版本冲突`,
            },
        });
    }
    /**
     * 软删除当前成员的私有会话
     * 删除只隐藏会话；消息、工具调用、事件和审计事实保留。存在运行中轮次时返回 409。
     * @returns void
     * @throws ApiError
     */
    public static deleteConversation({
        conversationId,
        version,
    }: {
        /**
         * 会话 ID
         */
        conversationId: string,
        /**
         * 当前会话版本
         */
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/conversations/{conversationId}',
            path: {
                'conversationId': conversationId,
            },
            query: {
                'version': version,
            },
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态或租户成员身份无效`,
                404: `会话不存在或不属于当前成员`,
                409: `会话版本冲突或仍有执行中的轮次`,
            },
        });
    }
    /**
     * 发起一轮对话并以 SSE 流式返回事件
     * 客户端只提交本轮 user 消息；历史消息与摘要由服务端加载并组装上下文。
     * 成功建立流后，每个 SSE `data` 字段都是一个 `TurnStreamEvent` JSON 对象，所有事件携带递增 `seq`。
     * 事件依次为 `started`、可选 `status`、零个或多个 `content_delta`、可选 `usage` 和 `completed`；
     * `completed` 之后可能异步到达一个 `related_questions` 事件（基于本轮答复生成的后续提问建议，生成失败则不发）；
     * 流开始后的失败以 `error` 事件终止。
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
