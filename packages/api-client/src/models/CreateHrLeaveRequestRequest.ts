/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 创建请假申请。durationDays 为可选一致性校验值，服务端按申请时间与假期单位折算后以服务端结果为准。
 */
export type CreateHrLeaveRequestRequest = {
    leaveTypeId: string;
    startAt: string;
    endAt: string;
    /**
     * 可选；与服务端折算结果不一致时返回 400 HR_LEAVE_DURATION_MISMATCH
     */
    durationDays?: number;
    reason?: string | null;
};

