/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateHrLeaveRequestRequest } from '../models/CreateHrLeaveRequestRequest';
import type { CreateHrLeaveTypeRequest } from '../models/CreateHrLeaveTypeRequest';
import type { CreateHrProfileRequest } from '../models/CreateHrProfileRequest';
import type { HrLeaveBalanceListResponseEnvelope } from '../models/HrLeaveBalanceListResponseEnvelope';
import type { HrLeaveRequestListResponseEnvelope } from '../models/HrLeaveRequestListResponseEnvelope';
import type { HrLeaveRequestResponseEnvelope } from '../models/HrLeaveRequestResponseEnvelope';
import type { HrLeaveRequestStatus } from '../models/HrLeaveRequestStatus';
import type { HrLeaveTypeListResponseEnvelope } from '../models/HrLeaveTypeListResponseEnvelope';
import type { HrLeaveTypeResponseEnvelope } from '../models/HrLeaveTypeResponseEnvelope';
import type { HrProfileListResponseEnvelope } from '../models/HrProfileListResponseEnvelope';
import type { HrProfileResponseEnvelope } from '../models/HrProfileResponseEnvelope';
import type { ReviewHrLeaveRequestRequest } from '../models/ReviewHrLeaveRequestRequest';
import type { UpdateHrProfileRequest } from '../models/UpdateHrProfileRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class HrService {
    /**
     * 查询员工档案
     * @returns HrProfileListResponseEnvelope 员工档案列表
     * @throws ApiError
     */
    public static listHrProfiles({
        keyword,
        departmentId,
        limit = 20,
        cursor,
    }: {
        keyword?: string,
        departmentId?: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<HrProfileListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/profiles',
            query: {
                'keyword': keyword,
                'departmentId': departmentId,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.profile.read 权限`,
            },
        });
    }
    /**
     * 创建员工档案
     * @returns HrProfileResponseEnvelope 员工档案已创建
     * @throws ApiError
     */
    public static createHrProfile({
        requestBody,
    }: {
        requestBody: CreateHrProfileRequest,
    }): CancelablePromise<HrProfileResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/profiles',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.profile.manage 权限`,
                409: `该成员已有员工档案`,
            },
        });
    }
    /**
     * 查询员工档案详情
     * @returns HrProfileResponseEnvelope 员工档案详情
     * @throws ApiError
     */
    public static getHrProfile({
        membershipId,
    }: {
        /**
         * 租户成员 ID
         */
        membershipId: string,
    }): CancelablePromise<HrProfileResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/profiles/{membershipId}',
            path: {
                'membershipId': membershipId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.profile.read 权限或数据范围不足`,
                404: `员工档案不存在`,
            },
        });
    }
    /**
     * 修改员工档案
     * @returns HrProfileResponseEnvelope 修改后的员工档案
     * @throws ApiError
     */
    public static updateHrProfile({
        membershipId,
        requestBody,
    }: {
        /**
         * 租户成员 ID
         */
        membershipId: string,
        requestBody: UpdateHrProfileRequest,
    }): CancelablePromise<HrProfileResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/hr/profiles/{membershipId}',
            path: {
                'membershipId': membershipId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.profile.manage 权限或数据范围不足`,
                404: `员工档案不存在`,
                409: `乐观锁版本冲突`,
            },
        });
    }
    /**
     * 查询请假类型
     * @returns HrLeaveTypeListResponseEnvelope 请假类型列表
     * @throws ApiError
     */
    public static listHrLeaveTypes(): CancelablePromise<HrLeaveTypeListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/leave-types',
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.read 权限`,
            },
        });
    }
    /**
     * 创建请假类型
     * @returns HrLeaveTypeResponseEnvelope 请假类型已创建
     * @throws ApiError
     */
    public static createHrLeaveType({
        requestBody,
    }: {
        requestBody: CreateHrLeaveTypeRequest,
    }): CancelablePromise<HrLeaveTypeResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/leave-types',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.manage_all 权限`,
                409: `请假类型编码已存在`,
            },
        });
    }
    /**
     * 查询请假余额
     * @returns HrLeaveBalanceListResponseEnvelope 请假余额列表
     * @throws ApiError
     */
    public static listHrLeaveBalances({
        membershipId,
        year,
    }: {
        membershipId?: string,
        year?: number,
    }): CancelablePromise<HrLeaveBalanceListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/leave-balances',
            query: {
                'membershipId': membershipId,
                'year': year,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 查询请假申请
     * @returns HrLeaveRequestListResponseEnvelope 请假申请列表
     * @throws ApiError
     */
    public static listHrLeaveRequests({
        status,
        membershipId,
        limit = 20,
        cursor,
    }: {
        status?: HrLeaveRequestStatus,
        membershipId?: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<HrLeaveRequestListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/leave-requests',
            query: {
                'status': status,
                'membershipId': membershipId,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 创建请假申请
     * @returns HrLeaveRequestResponseEnvelope 请假申请已创建
     * @throws ApiError
     */
    public static createHrLeaveRequest({
        requestBody,
    }: {
        requestBody: CreateHrLeaveRequestRequest,
    }): CancelablePromise<HrLeaveRequestResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/leave-requests',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.request 权限`,
            },
        });
    }
    /**
     * 审批请假申请
     * @returns HrLeaveRequestResponseEnvelope 审批后的请假申请
     * @throws ApiError
     */
    public static reviewHrLeaveRequest({
        leaveRequestId,
        requestBody,
    }: {
        /**
         * 请假申请 ID
         */
        leaveRequestId: string,
        requestBody: ReviewHrLeaveRequestRequest,
    }): CancelablePromise<HrLeaveRequestResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/leave-requests/{leaveRequestId}/review',
            path: {
                'leaveRequestId': leaveRequestId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.approve 权限或数据范围不足`,
                404: `请假申请不存在`,
                409: `请假申请状态或版本冲突`,
            },
        });
    }
}
