/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditConfigStatus } from './AICreditConfigStatus';
import type { AICreditTierPriceInput } from './AICreditTierPriceInput';
export type AICreditTierUpdateRequest = {
    name?: string;
    description?: string | null;
    monthlyBaseCredits?: string;
    status?: AICreditConfigStatus;
    prices?: Array<AICreditTierPriceInput>;
    capabilityCodes?: Array<string>;
    version: number;
};

