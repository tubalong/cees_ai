/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AddMeetingParticipantRequest } from '../models/AddMeetingParticipantRequest';
import type { CreateMeetingRequest } from '../models/CreateMeetingRequest';
import type { MeetingListResponseEnvelope } from '../models/MeetingListResponseEnvelope';
import type { MeetingMinutesResponseEnvelope } from '../models/MeetingMinutesResponseEnvelope';
import type { MeetingMinutesVersionRequest } from '../models/MeetingMinutesVersionRequest';
import type { MeetingParticipantListResponseEnvelope } from '../models/MeetingParticipantListResponseEnvelope';
import type { MeetingParticipantResponseEnvelope } from '../models/MeetingParticipantResponseEnvelope';
import type { MeetingResponseEnvelope } from '../models/MeetingResponseEnvelope';
import type { MeetingStatus } from '../models/MeetingStatus';
import type { MeetingTransitionRequest } from '../models/MeetingTransitionRequest';
import type { NullableMeetingMinutesResponseEnvelope } from '../models/NullableMeetingMinutesResponseEnvelope';
import type { RespondMeetingParticipantRequest } from '../models/RespondMeetingParticipantRequest';
import type { UpdateMeetingParticipantRequest } from '../models/UpdateMeetingParticipantRequest';
import type { UpdateMeetingRequest } from '../models/UpdateMeetingRequest';
import type { UpsertMeetingMinutesRequest } from '../models/UpsertMeetingMinutesRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class MeetingService {
    /**
     * 查询当前成员可见会议
     * @returns MeetingListResponseEnvelope 当前成员可见会议
     * @throws ApiError
     */
    public static meetingList({
        keyword,
        status,
        projectId,
        departmentId,
        startsFrom,
        startsTo,
        includeCancelled = false,
        limit = 20,
        cursor,
    }: {
        keyword?: string,
        status?: MeetingStatus,
        projectId?: string,
        departmentId?: string,
        startsFrom?: string,
        startsTo?: string,
        includeCancelled?: boolean,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<MeetingListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/meetings',
            query: {
                'keyword': keyword,
                'status': status,
                'projectId': projectId,
                'departmentId': departmentId,
                'startsFrom': startsFrom,
                'startsTo': startsTo,
                'includeCancelled': includeCancelled,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                403: `缺少 meeting.read 权限`,
            },
        });
    }
    /**
     * 创建会议草稿
     * @returns MeetingResponseEnvelope 会议草稿已创建，当前成员自动成为组织者和主持人
     * @throws ApiError
     */
    public static meetingCreate({
        requestBody,
    }: {
        requestBody: CreateMeetingRequest,
    }): CancelablePromise<MeetingResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/meetings',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `时间、部门或项目无效`,
                403: `缺少 meeting.create 权限或无权关联项目`,
            },
        });
    }
    /**
     * 查询会议详情
     * @returns MeetingResponseEnvelope 会议详情
     * @throws ApiError
     */
    public static meetingGet({
        meetingId,
    }: {
        meetingId: string,
    }): CancelablePromise<MeetingResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/meetings/{meetingId}',
            path: {
                'meetingId': meetingId,
            },
            errors: {
                403: `缺少 meeting.read 权限`,
                404: `会议不存在或当前成员不是组织者、参会人且无全局管理权限`,
            },
        });
    }
    /**
     * 修改草稿或已安排会议
     * @returns MeetingResponseEnvelope 会议资料已修改
     * @throws ApiError
     */
    public static meetingUpdate({
        meetingId,
        requestBody,
    }: {
        meetingId: string,
        requestBody: UpdateMeetingRequest,
    }): CancelablePromise<MeetingResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/meetings/{meetingId}',
            path: {
                'meetingId': meetingId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `字段、部门或项目无效`,
                403: `缺少 meeting.update 权限或不是会议管理者`,
                404: `会议不存在`,
                409: `会议状态或版本冲突`,
            },
        });
    }
    /**
     * 删除会议草稿
     * @returns void
     * @throws ApiError
     */
    public static meetingDelete({
        meetingId,
        version,
    }: {
        meetingId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/meetings/{meetingId}',
            path: {
                'meetingId': meetingId,
            },
            query: {
                'version': version,
            },
            errors: {
                403: `缺少 meeting.delete 权限或不是会议组织者`,
                404: `会议不存在`,
                409: `会议不是草稿或版本冲突`,
            },
        });
    }
    /**
     * 变更会议状态
     * @returns MeetingResponseEnvelope 会议状态已变更
     * @throws ApiError
     */
    public static meetingTransition({
        meetingId,
        requestBody,
    }: {
        meetingId: string,
        requestBody: MeetingTransitionRequest,
    }): CancelablePromise<MeetingResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/meetings/{meetingId}/transitions',
            path: {
                'meetingId': meetingId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `取消会议时未填写原因`,
                403: `缺少 meeting.status.update 权限或不是会议管理者`,
                404: `会议不存在`,
                409: `状态流转或版本冲突`,
            },
        });
    }
    /**
     * 查询会议参会人
     * @returns MeetingParticipantListResponseEnvelope 会议参会人列表
     * @throws ApiError
     */
    public static meetingParticipantList({
        meetingId,
    }: {
        meetingId: string,
    }): CancelablePromise<MeetingParticipantListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/meetings/{meetingId}/participants',
            path: {
                'meetingId': meetingId,
            },
            errors: {
                403: `缺少 meeting.read 权限`,
                404: `会议不存在或不可见`,
            },
        });
    }
    /**
     * 添加会议参会人
     * @returns MeetingParticipantResponseEnvelope 参会人已添加
     * @throws ApiError
     */
    public static meetingParticipantAdd({
        meetingId,
        requestBody,
    }: {
        meetingId: string,
        requestBody: AddMeetingParticipantRequest,
    }): CancelablePromise<MeetingParticipantResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/meetings/{meetingId}/participants',
            path: {
                'meetingId': meetingId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `目标成员不是当前租户有效成员`,
                403: `缺少 meeting.participant.manage 权限或不是会议管理者`,
                404: `会议不存在`,
                409: `会议状态不允许修改参与人或成员已经存在`,
            },
        });
    }
    /**
     * 修改参会角色或出席状态
     * @returns MeetingParticipantResponseEnvelope 参会人已修改
     * @throws ApiError
     */
    public static meetingParticipantUpdate({
        meetingId,
        membershipId,
        requestBody,
    }: {
        meetingId: string,
        membershipId: string,
        requestBody: UpdateMeetingParticipantRequest,
    }): CancelablePromise<MeetingParticipantResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/meetings/{meetingId}/participants/{membershipId}',
            path: {
                'meetingId': meetingId,
                'membershipId': membershipId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `修改字段组合无效`,
                403: `缺少 meeting.participant.manage 权限或不是会议管理者`,
                404: `会议或参会人不存在`,
                409: `组织者角色、会议状态或版本冲突`,
            },
        });
    }
    /**
     * 移除会议参会人
     * @returns void
     * @throws ApiError
     */
    public static meetingParticipantRemove({
        meetingId,
        membershipId,
        version,
    }: {
        meetingId: string,
        membershipId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/meetings/{meetingId}/participants/{membershipId}',
            path: {
                'meetingId': meetingId,
                'membershipId': membershipId,
            },
            query: {
                'version': version,
            },
            errors: {
                403: `缺少 meeting.participant.manage 权限或不是会议管理者`,
                404: `会议或参会人不存在`,
                409: `不能移除组织者、会议状态不允许或版本冲突`,
            },
        });
    }
    /**
     * 当前参会人回应会议邀请
     * @returns MeetingParticipantResponseEnvelope 邀请应答已更新
     * @throws ApiError
     */
    public static meetingParticipantRespond({
        meetingId,
        requestBody,
    }: {
        meetingId: string,
        requestBody: RespondMeetingParticipantRequest,
    }): CancelablePromise<MeetingParticipantResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/meetings/{meetingId}/participants/me/response',
            path: {
                'meetingId': meetingId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                403: `缺少 meeting.read 权限`,
                404: `当前成员不是会议参会人`,
                409: `会议状态或版本冲突`,
            },
        });
    }
    /**
     * 查询会议纪要
     * @returns NullableMeetingMinutesResponseEnvelope 会议纪要；尚未创建时 data 为 null
     * @throws ApiError
     */
    public static meetingMinutesGet({
        meetingId,
    }: {
        meetingId: string,
    }): CancelablePromise<NullableMeetingMinutesResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/meetings/{meetingId}/minutes',
            path: {
                'meetingId': meetingId,
            },
            errors: {
                403: `草稿纪要仅组织者、主持人、记录人或全局管理者可见`,
                404: `会议不存在或不可见`,
            },
        });
    }
    /**
     * 创建或修改会议纪要草稿
     * @returns MeetingMinutesResponseEnvelope 会议纪要草稿已保存
     * @throws ApiError
     */
    public static meetingMinutesUpsert({
        meetingId,
        requestBody,
    }: {
        meetingId: string,
        requestBody: UpsertMeetingMinutesRequest,
    }): CancelablePromise<MeetingMinutesResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/meetings/{meetingId}/minutes',
            path: {
                'meetingId': meetingId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `纪要内容或版本参数无效`,
                403: `缺少 meeting.minutes.manage 权限或不是组织者、主持人、记录人`,
                404: `会议不存在`,
                409: `会议未开始、纪要已发布或版本冲突`,
            },
        });
    }
    /**
     * 发布会议纪要
     * @returns MeetingMinutesResponseEnvelope 会议纪要已发布
     * @throws ApiError
     */
    public static meetingMinutesPublish({
        meetingId,
        requestBody,
    }: {
        meetingId: string,
        requestBody: MeetingMinutesVersionRequest,
    }): CancelablePromise<MeetingMinutesResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/meetings/{meetingId}/minutes/publish',
            path: {
                'meetingId': meetingId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                403: `缺少 meeting.minutes.manage 权限或不是组织者、主持人`,
                404: `会议或纪要不存在`,
                409: `会议未完成、纪要状态或版本冲突`,
            },
        });
    }
    /**
     * 将已发布会议纪要重新打开为草稿
     * @returns MeetingMinutesResponseEnvelope 会议纪要已重新打开
     * @throws ApiError
     */
    public static meetingMinutesReopen({
        meetingId,
        requestBody,
    }: {
        meetingId: string,
        requestBody: MeetingMinutesVersionRequest,
    }): CancelablePromise<MeetingMinutesResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/meetings/{meetingId}/minutes/reopen',
            path: {
                'meetingId': meetingId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                403: `缺少 meeting.minutes.manage 权限或不是组织者、主持人`,
                404: `会议或纪要不存在`,
                409: `纪要状态或版本冲突`,
            },
        });
    }
}
