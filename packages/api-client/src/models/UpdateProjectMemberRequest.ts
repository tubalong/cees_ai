/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type UpdateProjectMemberRequest = {
    role: UpdateProjectMemberRequest.role;
    version: number;
};
export namespace UpdateProjectMemberRequest {
    export enum role {
        MANAGER = 'MANAGER',
        MEMBER = 'MEMBER',
    }
}
