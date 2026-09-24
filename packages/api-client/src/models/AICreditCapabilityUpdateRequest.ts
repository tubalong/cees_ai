/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditCapabilityKind } from './AICreditCapabilityKind';
import type { AICreditConfigStatus } from './AICreditConfigStatus';
import type { AICreditMeterType } from './AICreditMeterType';
export type AICreditCapabilityUpdateRequest = {
    code?: string;
    name?: string;
    description?: string | null;
    meterType?: AICreditMeterType;
    capabilityKind?: AICreditCapabilityKind;
    permissionCode?: string | null;
    sortOrder?: number;
    status?: AICreditConfigStatus;
    version: number;
};

