/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreateProjectRequest = {
    code: string;
    name: string;
    description?: string | null;
    departmentId?: string | null;
    /**
     * 不传时默认当前租户成员；指定其他成员需要 project.manage_all
     */
    ownerMembershipId?: string;
    startsAt?: string | null;
    endsAt?: string | null;
};

