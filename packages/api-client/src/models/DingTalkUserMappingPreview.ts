/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DingTalkUserMappingPreview = {
    dingtalkUserId: string;
    externalUserId: string;
    name: string;
    departmentPaths: Array<string>;
    action: DingTalkUserMappingPreview.action;
    membershipId: string | null;
    candidateMembershipIds: Array<string>;
    suggestedAccount: string;
    reason: string;
};
export namespace DingTalkUserMappingPreview {
    export enum action {
        MATCH_EXISTING = 'MATCH_EXISTING',
        CREATE = 'CREATE',
        CONFLICT = 'CONFLICT',
        SKIP = 'SKIP',
    }
}

