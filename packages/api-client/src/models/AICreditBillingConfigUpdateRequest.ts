/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditSubscriptionDuration } from './AICreditSubscriptionDuration';
export type AICreditBillingConfigUpdateRequest = {
    minCreditUnit?: string;
    resetDay?: number;
    resetTimezoneMode?: AICreditBillingConfigUpdateRequest.resetTimezoneMode;
    rejectUnconfiguredRate?: boolean;
    subscriptionDurations?: Array<AICreditSubscriptionDuration>;
    halfYearlyDiscountRate?: string;
    yearlyDiscountRate?: string;
    maxSubscriptionUnits?: number;
    version: number;
};
export namespace AICreditBillingConfigUpdateRequest {
    export enum resetTimezoneMode {
        TENANT_LOCAL = 'TENANT_LOCAL',
    }
}

