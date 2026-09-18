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
    /**
     * 仅由人事异动写入；请求中携带时返回 400 HR_PROFILE_LEAVE_DATE_REQUIRES_CHANGE
     */
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
    /**
     * 不能设置为 TERMINATED（返回 400 HR_PROFILE_TERMINATION_REQUIRES_CHANGE）；离职与解除必须通过人事异动审批
     */
    status?: HrProfileStatus;
    version: number;
};

