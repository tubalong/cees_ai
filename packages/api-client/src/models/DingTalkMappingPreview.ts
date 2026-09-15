/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DingTalkDepartmentMappingPreview } from './DingTalkDepartmentMappingPreview';
import type { DingTalkMappingSummary } from './DingTalkMappingSummary';
import type { DingTalkUserMappingPreview } from './DingTalkUserMappingPreview';
export type DingTalkMappingPreview = {
    activationExpiresInDays: number;
    departments: Array<DingTalkDepartmentMappingPreview>;
    users: Array<DingTalkUserMappingPreview>;
    summary: DingTalkMappingSummary;
};

