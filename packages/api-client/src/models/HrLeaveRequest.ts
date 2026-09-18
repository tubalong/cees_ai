/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrLeaveRequestStatus } from './HrLeaveRequestStatus';
import type { HrLeaveYearAllocation } from './HrLeaveYearAllocation';
/**
 * 请假申请。durationDays 由服务端按申请时间与假期单位折算，yearAllocations 为按租户本地年度拆分的额度占用明细。
 */
export type HrLeaveRequest = {
    id: string;
    tenantId: string;
    membershipId: string;
    leaveTypeId: string;
    startAt: string;
    endAt: string;
    durationDays: number;
    /**
     * 按租户本地年度拆分的额度占用；跨年度申请会占用多个年度余额
     */
    yearAllocations?: Array<HrLeaveYearAllocation>;
    reason?: string | null;
    status: HrLeaveRequestStatus;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewComment?: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};

