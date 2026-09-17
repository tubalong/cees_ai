/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrEmployeeChangeType } from './HrEmployeeChangeType';
export type CreateHrEmployeeChangeRequest = {
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
};

