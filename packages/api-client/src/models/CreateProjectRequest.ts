/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreateProjectRequest = {
    name: string;
    description?: string | null;
    /**
     * 归属部门，仅用于归属、筛选和统计，不授予任何访问权限
     */
    departmentId?: string | null;
    /**
     * 不传时默认当前租户成员；指定其他成员需要 project.manage_all
     */
    ownerMembershipId?: string;
    /**
     * 初始项目成员；负责人由服务端自动加入，可不传或由服务端去重；需要 project.member.manage
     */
    memberMembershipIds?: Array<string>;
};
