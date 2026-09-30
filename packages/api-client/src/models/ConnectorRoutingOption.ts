/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConnectorRoutingProvider } from './ConnectorRoutingProvider';
export type ConnectorRoutingOption = {
    provider: ConnectorRoutingProvider;
    displayName: string;
    state: ConnectorRoutingOption.state;
    capabilitySummary: string;
};
export namespace ConnectorRoutingOption {
    export enum state {
        NOT_INSTALLED = 'NOT_INSTALLED',
        AUTH_REQUIRED = 'AUTH_REQUIRED',
        PROFILE_REQUIRED = 'PROFILE_REQUIRED',
        READY = 'READY',
        ERROR = 'ERROR',
    }
}

