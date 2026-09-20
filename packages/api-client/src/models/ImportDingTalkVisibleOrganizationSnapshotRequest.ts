/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DingTalkVisibleDepartmentSnapshot } from './DingTalkVisibleDepartmentSnapshot';
import type { DingTalkVisibleUserSnapshot } from './DingTalkVisibleUserSnapshot';
export type ImportDingTalkVisibleOrganizationSnapshotRequest = {
    corpId: string;
    externalUserId: string;
    externalUserName: string;
    profile: string;
    fetchedAt: string;
    capabilities: Array<string>;
    departments: Array<DingTalkVisibleDepartmentSnapshot>;
    users: Array<DingTalkVisibleUserSnapshot>;
};

