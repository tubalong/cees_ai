/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TencentMeetingConnectorToolRisk } from './TencentMeetingConnectorToolRisk';
export type TencentMeetingConnectorTool = {
    /**
     * Official Tencent Meeting MCP tool name
     */
    toolId: string;
    name: string;
    description: string;
    /**
     * JSON Schema dynamically returned by tools/list; root must be an object
     */
    parameters: Record<string, any>;
    riskLevel: TencentMeetingConnectorToolRisk;
    /**
     * Desktop must require explicit confirmation before executing this tool
     */
    requiresConfirmation: boolean;
};

