/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrEmployeeChangeStatus } from './HrEmployeeChangeStatus';
import type { HrEmployeeChangeType } from './HrEmployeeChangeType';
export type HrEmployeeChange = {
    id: string;
    tenantId: string;
    membershipId: string;
    type: HrEmployeeChangeType;
    effectiveDate: string;
    fromDepartmentId?: string | null;
    toDepartmentId?: string | null;
    fromPosition?: string | null;
    toPosition?: string | null;
    fromManagerMembershipId?: string | null;
    toManagerMembershipId?: string | null;
    reason?: string | null;
    status: HrEmployeeChangeStatus;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewComment?: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};

