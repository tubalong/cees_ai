/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DingTalkUserMappingResolution = {
    dingtalkUserId: string;
    action: DingTalkUserMappingResolution.action;
    membershipId?: string | null;
    account?: string | null;
};
export namespace DingTalkUserMappingResolution {
    export enum action {
        BIND_EXISTING = 'BIND_EXISTING',
        CREATE = 'CREATE',
        SKIP = 'SKIP',
    }
}

