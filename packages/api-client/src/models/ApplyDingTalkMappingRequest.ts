/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DingTalkDepartmentMappingResolution } from './DingTalkDepartmentMappingResolution';
import type { DingTalkUserMappingResolution } from './DingTalkUserMappingResolution';
import type { PreviewDingTalkMappingRequest } from './PreviewDingTalkMappingRequest';
export type ApplyDingTalkMappingRequest = (PreviewDingTalkMappingRequest & {
    departmentResolutions?: Array<DingTalkDepartmentMappingResolution>;
    userResolutions?: Array<DingTalkUserMappingResolution>;
});

