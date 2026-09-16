/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrLeaveUnit } from './HrLeaveUnit';
export type HrLeaveBalance = {
    id: string;
    tenantId: string;
    membershipId: string;
    leaveTypeId: string;
    year: number;
    totalDays: number;
    usedDays: number;
    pendingDays: number;
    remainingDays: number;
    unit: HrLeaveUnit;
    version: number;
    createdAt: string;
    updatedAt: string;
};

