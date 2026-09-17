/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AdjustHrLeaveBalanceRequest } from '../models/AdjustHrLeaveBalanceRequest';
import type { CancelHrEmployeeChangeRequest } from '../models/CancelHrEmployeeChangeRequest';
import type { CancelHrLeaveRequestRequest } from '../models/CancelHrLeaveRequestRequest';
import type { CancelHrOvertimeRequestRequest } from '../models/CancelHrOvertimeRequestRequest';
import type { CreateHrAttendanceRecordRequest } from '../models/CreateHrAttendanceRecordRequest';
import type { CreateHrEmployeeChangeRequest } from '../models/CreateHrEmployeeChangeRequest';
import type { CreateHrLeaveRequestRequest } from '../models/CreateHrLeaveRequestRequest';
import type { CreateHrLeaveTypeRequest } from '../models/CreateHrLeaveTypeRequest';
import type { CreateHrOvertimeRequestRequest } from '../models/CreateHrOvertimeRequestRequest';
import type { CreateHrProfileRequest } from '../models/CreateHrProfileRequest';
import type { HrAttendanceImportResultResponseEnvelope } from '../models/HrAttendanceImportResultResponseEnvelope';
import type { HrAttendanceRecordListResponseEnvelope } from '../models/HrAttendanceRecordListResponseEnvelope';
import type { HrAttendanceRecordResponseEnvelope } from '../models/HrAttendanceRecordResponseEnvelope';
import type { HrAttendanceStatus } from '../models/HrAttendanceStatus';
import type { HrAttendanceSummaryReportResponseEnvelope } from '../models/HrAttendanceSummaryReportResponseEnvelope';
import type { HrEmployeeChangeListResponseEnvelope } from '../models/HrEmployeeChangeListResponseEnvelope';
import type { HrEmployeeChangeResponseEnvelope } from '../models/HrEmployeeChangeResponseEnvelope';
import type { HrEmployeeChangeStatus } from '../models/HrEmployeeChangeStatus';
import type { HrEmployeeChangeType } from '../models/HrEmployeeChangeType';
import type { HrHeadcountReportResponseEnvelope } from '../models/HrHeadcountReportResponseEnvelope';
import type { HrLeaveBalanceListResponseEnvelope } from '../models/HrLeaveBalanceListResponseEnvelope';
import type { HrLeaveBalanceResponseEnvelope } from '../models/HrLeaveBalanceResponseEnvelope';
import type { HrLeaveRequestListResponseEnvelope } from '../models/HrLeaveRequestListResponseEnvelope';
import type { HrLeaveRequestResponseEnvelope } from '../models/HrLeaveRequestResponseEnvelope';
import type { HrLeaveRequestStatus } from '../models/HrLeaveRequestStatus';
import type { HrLeaveSummaryReportResponseEnvelope } from '../models/HrLeaveSummaryReportResponseEnvelope';
import type { HrLeaveTypeListResponseEnvelope } from '../models/HrLeaveTypeListResponseEnvelope';
import type { HrLeaveTypeResponseEnvelope } from '../models/HrLeaveTypeResponseEnvelope';
import type { HrOvertimeRequestListResponseEnvelope } from '../models/HrOvertimeRequestListResponseEnvelope';
import type { HrOvertimeRequestResponseEnvelope } from '../models/HrOvertimeRequestResponseEnvelope';
import type { HrOvertimeRequestStatus } from '../models/HrOvertimeRequestStatus';
import type { HrOvertimeSummaryReportResponseEnvelope } from '../models/HrOvertimeSummaryReportResponseEnvelope';
import type { HrProfileListResponseEnvelope } from '../models/HrProfileListResponseEnvelope';
import type { HrProfileResponseEnvelope } from '../models/HrProfileResponseEnvelope';
import type { ImportHrAttendanceRecordsRequest } from '../models/ImportHrAttendanceRecordsRequest';
import type { ReviewHrAttendanceRecordRequest } from '../models/ReviewHrAttendanceRecordRequest';
import type { ReviewHrEmployeeChangeRequest } from '../models/ReviewHrEmployeeChangeRequest';
import type { ReviewHrLeaveRequestRequest } from '../models/ReviewHrLeaveRequestRequest';
import type { ReviewHrOvertimeRequestRequest } from '../models/ReviewHrOvertimeRequestRequest';
import type { UpdateHrAttendanceRecordRequest } from '../models/UpdateHrAttendanceRecordRequest';
import type { UpdateHrLeaveTypeRequest } from '../models/UpdateHrLeaveTypeRequest';
import type { UpdateHrProfileRequest } from '../models/UpdateHrProfileRequest';
import type { WithdrawHrLeaveRequestRequest } from '../models/WithdrawHrLeaveRequestRequest';
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
    /**
     * 修改请假类型
     * @returns HrLeaveTypeResponseEnvelope 修改后的请假类型
     * @throws ApiError
     */
    public static updateHrLeaveType({
        leaveTypeId,
        requestBody,
    }: {
        /**
         * 请假类型 ID
         */
        leaveTypeId: string,
        requestBody: UpdateHrLeaveTypeRequest,
    }): CancelablePromise<HrLeaveTypeResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/hr/leave-types/{leaveTypeId}',
            path: {
                'leaveTypeId': leaveTypeId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.manage_all 权限`,
                404: `请假类型不存在`,
                409: `请假类型编码已存在或乐观锁版本冲突`,
            },
        });
    }
    /**
     * 删除请假类型
     * @returns void
     * @throws ApiError
     */
    public static deleteHrLeaveType({
        leaveTypeId,
        version,
    }: {
        /**
         * 请假类型 ID
         */
        leaveTypeId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/hr/leave-types/{leaveTypeId}',
            path: {
                'leaveTypeId': leaveTypeId,
            },
            query: {
                'version': version,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.manage_all 权限`,
                404: `请假类型不存在`,
                409: `请假类型已被使用或乐观锁版本冲突`,
            },
        });
    }
    /**
     * 调整请假余额
     * @returns HrLeaveBalanceResponseEnvelope 调整后的请假余额
     * @throws ApiError
     */
    public static adjustHrLeaveBalance({
        requestBody,
    }: {
        requestBody: AdjustHrLeaveBalanceRequest,
    }): CancelablePromise<HrLeaveBalanceResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/leave-balances/adjust',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.manage_all 权限或数据范围不足`,
                404: `请假余额不存在`,
            },
        });
    }
    /**
     * 查询请假申请详情
     * @returns HrLeaveRequestResponseEnvelope 请假申请详情
     * @throws ApiError
     */
    public static getHrLeaveRequest({
        leaveRequestId,
    }: {
        /**
         * 请假申请 ID
         */
        leaveRequestId: string,
    }): CancelablePromise<HrLeaveRequestResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/leave-requests/{leaveRequestId}',
            path: {
                'leaveRequestId': leaveRequestId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.read 权限或数据范围不足`,
                404: `请假申请不存在`,
            },
        });
    }
    /**
     * 撤销请假申请
     * @returns HrLeaveRequestResponseEnvelope 撤销后的请假申请
     * @throws ApiError
     */
    public static cancelHrLeaveRequest({
        leaveRequestId,
        requestBody,
    }: {
        /**
         * 请假申请 ID
         */
        leaveRequestId: string,
        requestBody: CancelHrLeaveRequestRequest,
    }): CancelablePromise<HrLeaveRequestResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/leave-requests/{leaveRequestId}/cancel',
            path: {
                'leaveRequestId': leaveRequestId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.request 权限或数据范围不足`,
                404: `请假申请不存在`,
                409: `请假申请状态或版本冲突`,
            },
        });
    }
    /**
     * 撤回已提交的请假申请
     * @returns HrLeaveRequestResponseEnvelope 撤回后的请假申请
     * @throws ApiError
     */
    public static withdrawHrLeaveRequest({
        leaveRequestId,
        requestBody,
    }: {
        /**
         * 请假申请 ID
         */
        leaveRequestId: string,
        requestBody: WithdrawHrLeaveRequestRequest,
    }): CancelablePromise<HrLeaveRequestResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/leave-requests/{leaveRequestId}/withdraw',
            path: {
                'leaveRequestId': leaveRequestId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.leave.request 权限或数据范围不足`,
                404: `请假申请不存在`,
                409: `请假申请状态或版本冲突`,
            },
        });
    }
    /**
     * 查询考勤记录
     * @returns HrAttendanceRecordListResponseEnvelope 考勤记录列表
     * @throws ApiError
     */
    public static listHrAttendanceRecords({
        membershipId,
        dateFrom,
        dateTo,
        status,
        limit = 20,
        cursor,
    }: {
        membershipId?: string,
        dateFrom?: string,
        dateTo?: string,
        status?: HrAttendanceStatus,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<HrAttendanceRecordListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/attendance-records',
            query: {
                'membershipId': membershipId,
                'dateFrom': dateFrom,
                'dateTo': dateTo,
                'status': status,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.attendance.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 手工创建考勤记录
     * @returns HrAttendanceRecordResponseEnvelope 考勤记录已创建
     * @throws ApiError
     */
    public static createHrAttendanceRecord({
        requestBody,
    }: {
        requestBody: CreateHrAttendanceRecordRequest,
    }): CancelablePromise<HrAttendanceRecordResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/attendance-records',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.attendance.manage 权限`,
                409: `同一成员同一日期已存在考勤记录`,
            },
        });
    }
    /**
     * 批量导入考勤记录
     * @returns HrAttendanceImportResultResponseEnvelope 考勤导入结果
     * @throws ApiError
     */
    public static importHrAttendanceRecords({
        requestBody,
    }: {
        requestBody: ImportHrAttendanceRecordsRequest,
    }): CancelablePromise<HrAttendanceImportResultResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/attendance-records/import',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.attendance.manage 权限`,
            },
        });
    }
    /**
     * 查询考勤记录详情
     * @returns HrAttendanceRecordResponseEnvelope 考勤记录详情
     * @throws ApiError
     */
    public static getHrAttendanceRecord({
        attendanceRecordId,
    }: {
        /**
         * 考勤记录 ID
         */
        attendanceRecordId: string,
    }): CancelablePromise<HrAttendanceRecordResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/attendance-records/{attendanceRecordId}',
            path: {
                'attendanceRecordId': attendanceRecordId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.attendance.read 权限或数据范围不足`,
                404: `考勤记录不存在`,
            },
        });
    }
    /**
     * 修改考勤记录
     * @returns HrAttendanceRecordResponseEnvelope 修改后的考勤记录
     * @throws ApiError
     */
    public static updateHrAttendanceRecord({
        attendanceRecordId,
        requestBody,
    }: {
        /**
         * 考勤记录 ID
         */
        attendanceRecordId: string,
        requestBody: UpdateHrAttendanceRecordRequest,
    }): CancelablePromise<HrAttendanceRecordResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/hr/attendance-records/{attendanceRecordId}',
            path: {
                'attendanceRecordId': attendanceRecordId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.attendance.manage 权限或数据范围不足`,
                404: `考勤记录不存在`,
                409: `考勤记录状态或版本冲突`,
            },
        });
    }
    /**
     * 审批考勤修正
     * @returns HrAttendanceRecordResponseEnvelope 审批后的考勤记录
     * @throws ApiError
     */
    public static reviewHrAttendanceRecord({
        attendanceRecordId,
        requestBody,
    }: {
        /**
         * 考勤记录 ID
         */
        attendanceRecordId: string,
        requestBody: ReviewHrAttendanceRecordRequest,
    }): CancelablePromise<HrAttendanceRecordResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/attendance-records/{attendanceRecordId}/review',
            path: {
                'attendanceRecordId': attendanceRecordId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.attendance.approve 权限或数据范围不足`,
                404: `考勤记录不存在`,
                409: `考勤记录状态或版本冲突`,
            },
        });
    }
    /**
     * 查询加班申请
     * @returns HrOvertimeRequestListResponseEnvelope 加班申请列表
     * @throws ApiError
     */
    public static listHrOvertimeRequests({
        membershipId,
        status,
        limit = 20,
        cursor,
    }: {
        membershipId?: string,
        status?: HrOvertimeRequestStatus,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<HrOvertimeRequestListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/overtime-requests',
            query: {
                'membershipId': membershipId,
                'status': status,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.overtime.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 创建加班申请
     * @returns HrOvertimeRequestResponseEnvelope 加班申请已创建
     * @throws ApiError
     */
    public static createHrOvertimeRequest({
        requestBody,
    }: {
        requestBody: CreateHrOvertimeRequestRequest,
    }): CancelablePromise<HrOvertimeRequestResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/overtime-requests',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.overtime.request 权限`,
            },
        });
    }
    /**
     * 查询加班申请详情
     * @returns HrOvertimeRequestResponseEnvelope 加班申请详情
     * @throws ApiError
     */
    public static getHrOvertimeRequest({
        overtimeRequestId,
    }: {
        /**
         * 加班申请 ID
         */
        overtimeRequestId: string,
    }): CancelablePromise<HrOvertimeRequestResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/overtime-requests/{overtimeRequestId}',
            path: {
                'overtimeRequestId': overtimeRequestId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.overtime.read 权限或数据范围不足`,
                404: `加班申请不存在`,
            },
        });
    }
    /**
     * 撤销加班申请
     * @returns HrOvertimeRequestResponseEnvelope 撤销后的加班申请
     * @throws ApiError
     */
    public static cancelHrOvertimeRequest({
        overtimeRequestId,
        requestBody,
    }: {
        /**
         * 加班申请 ID
         */
        overtimeRequestId: string,
        requestBody: CancelHrOvertimeRequestRequest,
    }): CancelablePromise<HrOvertimeRequestResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/overtime-requests/{overtimeRequestId}/cancel',
            path: {
                'overtimeRequestId': overtimeRequestId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.overtime.request 权限或数据范围不足`,
                404: `加班申请不存在`,
                409: `加班申请状态或版本冲突`,
            },
        });
    }
    /**
     * 审批加班申请
     * @returns HrOvertimeRequestResponseEnvelope 审批后的加班申请
     * @throws ApiError
     */
    public static reviewHrOvertimeRequest({
        overtimeRequestId,
        requestBody,
    }: {
        /**
         * 加班申请 ID
         */
        overtimeRequestId: string,
        requestBody: ReviewHrOvertimeRequestRequest,
    }): CancelablePromise<HrOvertimeRequestResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/overtime-requests/{overtimeRequestId}/review',
            path: {
                'overtimeRequestId': overtimeRequestId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.overtime.approve 权限或数据范围不足`,
                404: `加班申请不存在`,
                409: `加班申请状态或版本冲突`,
            },
        });
    }
    /**
     * 查询人事异动
     * @returns HrEmployeeChangeListResponseEnvelope 人事异动列表
     * @throws ApiError
     */
    public static listHrEmployeeChanges({
        membershipId,
        type,
        status,
        limit = 20,
        cursor,
    }: {
        membershipId?: string,
        type?: HrEmployeeChangeType,
        status?: HrEmployeeChangeStatus,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<HrEmployeeChangeListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/employee-changes',
            query: {
                'membershipId': membershipId,
                'type': type,
                'status': status,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.employee_change.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 创建人事异动
     * @returns HrEmployeeChangeResponseEnvelope 人事异动已创建
     * @throws ApiError
     */
    public static createHrEmployeeChange({
        requestBody,
    }: {
        requestBody: CreateHrEmployeeChangeRequest,
    }): CancelablePromise<HrEmployeeChangeResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/employee-changes',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.employee_change.manage 权限`,
            },
        });
    }
    /**
     * 查询人事异动详情
     * @returns HrEmployeeChangeResponseEnvelope 人事异动详情
     * @throws ApiError
     */
    public static getHrEmployeeChange({
        employeeChangeId,
    }: {
        /**
         * 人事异动 ID
         */
        employeeChangeId: string,
    }): CancelablePromise<HrEmployeeChangeResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/employee-changes/{employeeChangeId}',
            path: {
                'employeeChangeId': employeeChangeId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.employee_change.read 权限或数据范围不足`,
                404: `人事异动不存在`,
            },
        });
    }
    /**
     * 撤销人事异动
     * @returns HrEmployeeChangeResponseEnvelope 撤销后的人事异动
     * @throws ApiError
     */
    public static cancelHrEmployeeChange({
        employeeChangeId,
        requestBody,
    }: {
        /**
         * 人事异动 ID
         */
        employeeChangeId: string,
        requestBody: CancelHrEmployeeChangeRequest,
    }): CancelablePromise<HrEmployeeChangeResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/employee-changes/{employeeChangeId}/cancel',
            path: {
                'employeeChangeId': employeeChangeId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.employee_change.manage 权限或数据范围不足`,
                404: `人事异动不存在`,
                409: `人事异动状态或版本冲突`,
            },
        });
    }
    /**
     * 审批人事异动
     * @returns HrEmployeeChangeResponseEnvelope 审批后的人事异动
     * @throws ApiError
     */
    public static reviewHrEmployeeChange({
        employeeChangeId,
        requestBody,
    }: {
        /**
         * 人事异动 ID
         */
        employeeChangeId: string,
        requestBody: ReviewHrEmployeeChangeRequest,
    }): CancelablePromise<HrEmployeeChangeResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/hr/employee-changes/{employeeChangeId}/review',
            path: {
                'employeeChangeId': employeeChangeId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                401: `登录状态无效或已过期`,
                403: `缺少 hr.employee_change.approve 权限或数据范围不足`,
                404: `人事异动不存在`,
                409: `人事异动状态或版本冲突`,
            },
        });
    }
    /**
     * 查询 HR 在职人数报表
     * @returns HrHeadcountReportResponseEnvelope 在职人数报表
     * @throws ApiError
     */
    public static getHrHeadcountReport({
        departmentId,
        asOf,
    }: {
        departmentId?: string,
        asOf?: string,
    }): CancelablePromise<HrHeadcountReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/reports/headcount',
            query: {
                'departmentId': departmentId,
                'asOf': asOf,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.report.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 查询请假汇总报表
     * @returns HrLeaveSummaryReportResponseEnvelope 请假汇总报表
     * @throws ApiError
     */
    public static getHrLeaveSummaryReport({
        year,
        departmentId,
        leaveTypeId,
    }: {
        year: number,
        departmentId?: string,
        leaveTypeId?: string,
    }): CancelablePromise<HrLeaveSummaryReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/reports/leave-summary',
            query: {
                'year': year,
                'departmentId': departmentId,
                'leaveTypeId': leaveTypeId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.report.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 查询考勤汇总报表
     * @returns HrAttendanceSummaryReportResponseEnvelope 考勤汇总报表
     * @throws ApiError
     */
    public static getHrAttendanceSummaryReport({
        dateFrom,
        dateTo,
        departmentId,
    }: {
        dateFrom: string,
        dateTo: string,
        departmentId?: string,
    }): CancelablePromise<HrAttendanceSummaryReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/reports/attendance-summary',
            query: {
                'dateFrom': dateFrom,
                'dateTo': dateTo,
                'departmentId': departmentId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.report.read 权限或数据范围不足`,
            },
        });
    }
    /**
     * 查询加班汇总报表
     * @returns HrOvertimeSummaryReportResponseEnvelope 加班汇总报表
     * @throws ApiError
     */
    public static getHrOvertimeSummaryReport({
        dateFrom,
        dateTo,
        departmentId,
    }: {
        dateFrom: string,
        dateTo: string,
        departmentId?: string,
    }): CancelablePromise<HrOvertimeSummaryReportResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/hr/reports/overtime-summary',
            query: {
                'dateFrom': dateFrom,
                'dateTo': dateTo,
                'departmentId': departmentId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 hr.report.read 权限或数据范围不足`,
            },
        });
    }
}
