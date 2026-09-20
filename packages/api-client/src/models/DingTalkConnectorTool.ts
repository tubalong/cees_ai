/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type DingTalkConnectorTool = {
    toolId: string;
    /**
     * DWS canonical_path
     */
    name: string;
    /**
     * Read-only tool purpose extracted from the current DWS Schema
     */
    description: string;
    /**
     * JSON Schema used by the model to produce arguments; root must be an object
     */
    parameters: Record<string, any>;
};

