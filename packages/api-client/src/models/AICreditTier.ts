/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditConfigStatus } from './AICreditConfigStatus';
import type { AICreditTierPrice } from './AICreditTierPrice';
export type AICreditTier = {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    monthlyBaseCredits: string;
    status: AICreditConfigStatus;
    prices: Array<AICreditTierPrice>;
    capabilityCodes: Array<string>;
    version: number;
    createdAt: string;
    updatedAt: string;
};

