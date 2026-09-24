/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditConfigStatus } from './AICreditConfigStatus';
export type AICreditRateCardUpdateRequest = {
    tokenMultiplier?: string | null;
    creditPerToken?: string | null;
    perRequestCredits?: string | null;
    status?: AICreditConfigStatus;
    version: number;
};

