/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TencentMeetingConnectorToolRisk } from './TencentMeetingConnectorToolRisk';
export type TencentMeetingConnectorTool = {
    /**
     * Version-aligned Tencent Meeting CLI command ID, for example meeting.list
     */
    toolId: string;
    name: string;
    description: string;
    /**
     * JSON Schema derived from the pinned official CLI command help; root must be an object
     */
    parameters: Record<string, any>;
    riskLevel: TencentMeetingConnectorToolRisk;
    /**
     * Desktop must require explicit confirmation before executing this tool
     */
    requiresConfirmation: boolean;
};

