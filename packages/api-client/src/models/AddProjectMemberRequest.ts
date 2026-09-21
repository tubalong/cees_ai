/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AddProjectMemberRequest = {
    membershipId: string;
    role?: AddProjectMemberRequest.role;
};
export namespace AddProjectMemberRequest {
    export enum role {
        MANAGER = 'MANAGER',
        MEMBER = 'MEMBER',
    }
}
