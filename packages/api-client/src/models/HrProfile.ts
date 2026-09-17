/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HrProfileStatus } from './HrProfileStatus';
/**
 * 员工档案。phone、email、idType、idNumber、emergencyContactName、emergencyContactPhone 为敏感字段；缺少 hr.profile.sensitive.read 时返回脱敏值或 null。
 */
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
    /**
     * 敏感字段；无 hr.profile.sensitive.read 时返回脱敏值
     */
    phone?: string | null;
    /**
     * 敏感字段；无 hr.profile.sensitive.read 时返回脱敏值
     */
    email?: string | null;
    /**
     * 敏感字段；无 hr.profile.sensitive.read 时返回脱敏值
     */
    idType?: string | null;
    /**
     * 敏感字段；无 hr.profile.sensitive.read 时返回脱敏值
     */
    idNumber?: string | null;
    /**
     * 敏感字段；无 hr.profile.sensitive.read 时返回脱敏值
     */
    emergencyContactName?: string | null;
    /**
     * 敏感字段；无 hr.profile.sensitive.read 时返回脱敏值
     */
    emergencyContactPhone?: string | null;
    educationLevel?: string | null;
    costCenter?: string | null;
    jobLevel?: string | null;
    probationEndDate?: string | null;
    regularDate?: string | null;
    workLocation?: string | null;
    status: HrProfileStatus;
    version: number;
    createdAt: string;
    updatedAt: string;
};

