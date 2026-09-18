/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrOvertimeRequestStatus } from './HrOvertimeRequestStatus';
export type HrOvertimeRequest = {
    id: string;
    tenantId: string;
    membershipId: string;
    startAt: string;
    endAt: string;
    /**
     * 客户端一致性校验值；正式时长由服务端按起止时间折算
     */
    durationHours: number;
    reason: string;
    status: HrOvertimeRequestStatus;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewComment?: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};

