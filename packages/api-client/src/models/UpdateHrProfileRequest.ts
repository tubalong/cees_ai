/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrProfileStatus } from './HrProfileStatus';
/**
 * 修改员工档案。提交任一敏感字段需要 hr.profile.sensitive.manage 权限；客户端不得将服务端返回的脱敏值回写。
 */
export type UpdateHrProfileRequest = {
    employeeNo?: string | null;
    departmentId?: string | null;
    position?: string | null;
    employmentType?: string | null;
    managerMembershipId?: string | null;
    entryDate?: string | null;
    leaveDate?: string | null;
    phone?: string | null;
    email?: string | null;
    idType?: string | null;
    idNumber?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    educationLevel?: string | null;
    costCenter?: string | null;
    jobLevel?: string | null;
    probationEndDate?: string | null;
    regularDate?: string | null;
    workLocation?: string | null;
    status?: HrProfileStatus;
    version: number;
};

