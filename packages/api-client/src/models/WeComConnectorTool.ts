/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WeComConnectorToolRisk } from './WeComConnectorToolRisk';
export type WeComConnectorTool = {
    /**
     * Official WeCom CLI method name discovered from schema list/get
     */
    toolId: string;
    name: string;
    description: string;
    /**
     * JSON Schema dynamically returned by the official CLI; root must be an object
     */
    parameters: Record<string, any>;
    riskLevel: WeComConnectorToolRisk;
    /**
     * Desktop must require explicit confirmation before executing this tool
     */
    requiresConfirmation: boolean;
};

