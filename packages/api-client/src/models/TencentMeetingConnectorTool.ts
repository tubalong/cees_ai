/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TencentMeetingToolId } from './TencentMeetingToolId';
export type TencentMeetingConnectorTool = {
    toolId: TencentMeetingToolId;
    name: string;
    description: string;
    /**
     * CEES 固定只读工具的 JSON Schema；根节点必须为 object 且禁止未声明业务参数
     */
    parameters: Record<string, any>;
};

