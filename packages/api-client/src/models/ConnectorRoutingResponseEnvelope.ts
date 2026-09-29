/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConnectorRoutingResult } from './ConnectorRoutingResult';
export type ConnectorRoutingResponseEnvelope = {
    success: boolean;
    data: ConnectorRoutingResult;
    /**
     * Public API request trace ID
     */
    requestId?: string | null;
};

