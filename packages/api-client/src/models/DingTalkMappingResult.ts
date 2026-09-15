/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DingTalkMappingCredential } from './DingTalkMappingCredential';
import type { DingTalkMappingPreview } from './DingTalkMappingPreview';
import type { DingTalkMappingSummary } from './DingTalkMappingSummary';
export type DingTalkMappingResult = {
    preview: DingTalkMappingPreview;
    credentials: Array<DingTalkMappingCredential>;
    summary: (DingTalkMappingSummary & {
        departmentSkippedCount: number;
        userSkippedCount: number;
    });
};

