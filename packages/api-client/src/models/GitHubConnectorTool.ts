/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { GitHubConnectorToolRisk } from './GitHubConnectorToolRisk';
export type GitHubConnectorTool = {
    /**
     * GitHub remote MCP tool name discovered from tools/list
     */
    toolId: string;
    name: string;
    description: string;
    /**
     * JSON Schema dynamically returned by GitHub MCP; root must be an object
     */
    parameters: Record<string, any>;
    riskLevel: GitHubConnectorToolRisk;
    /**
     * Desktop must require explicit confirmation before executing this tool
     */
    requiresConfirmation: boolean;
};

