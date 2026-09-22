/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TencentMeetingToolId } from './TencentMeetingToolId';
export type TencentMeetingConnectorPlannedCall = {
    toolId: TencentMeetingToolId;
    /**
     * 必须通过对应工具 parameters Schema 校验的结构化参数
     */
    arguments: Record<string, any>;
};

