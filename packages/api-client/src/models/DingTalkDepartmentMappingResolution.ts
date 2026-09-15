/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DingTalkDepartmentMappingResolution = {
    dingtalkDepartmentId: string;
    action: DingTalkDepartmentMappingResolution.action;
    departmentId?: string | null;
};
export namespace DingTalkDepartmentMappingResolution {
    export enum action {
        BIND_EXISTING = 'BIND_EXISTING',
        CREATE = 'CREATE',
        SKIP = 'SKIP',
    }
}

