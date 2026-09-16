/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrProfileStatus } from './HrProfileStatus';
export type HrProfile = {
    id: string;
    tenantId: string;
    membershipId: string;
    employeeNo?: string | null;
    displayName: string;
    departmentId?: string | null;
    position?: string | null;
    employmentType?: string | null;
    managerMembershipId?: string | null;
    entryDate?: string | null;
    leaveDate?: string | null;
    status: HrProfileStatus;
    version: number;
    createdAt: string;
    updatedAt: string;
};

