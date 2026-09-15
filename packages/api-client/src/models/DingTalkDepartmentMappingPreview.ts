/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DingTalkDepartmentMappingPreview = {
    dingtalkDepartmentId: string;
    externalDepartmentId: string;
    name: string;
    path: string;
    action: DingTalkDepartmentMappingPreview.action;
    departmentId: string | null;
    candidateDepartmentIds: Array<string>;
    reason: string;
};
export namespace DingTalkDepartmentMappingPreview {
    export enum action {
        MATCH_EXISTING = 'MATCH_EXISTING',
        CREATE = 'CREATE',
        CONFLICT = 'CONFLICT',
        SKIP = 'SKIP',
    }
}

