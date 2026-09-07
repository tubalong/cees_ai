/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type UpdateTenantMemberRequest = {
    displayName?: string;
    departmentId?: string | null;
    status?: UpdateTenantMemberRequest.status;
    version: number;
};
export namespace UpdateTenantMemberRequest {
    export enum status {
        ACTIVE = 'ACTIVE',
        DISABLED = 'DISABLED',
    }
}

