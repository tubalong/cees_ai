/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrLeaveRequestStatus } from './HrLeaveRequestStatus';
export type HrLeaveRequest = {
    id: string;
    tenantId: string;
    membershipId: string;
    leaveTypeId: string;
    startAt: string;
    endAt: string;
    durationDays: number;
    reason?: string | null;
    status: HrLeaveRequestStatus;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewComment?: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};

