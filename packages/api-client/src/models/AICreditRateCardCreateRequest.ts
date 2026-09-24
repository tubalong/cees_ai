/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditRateDimension } from './AICreditRateDimension';
export type AICreditRateCardCreateRequest = {
    capabilityId: string;
    modelGroup?: string;
    dimension: AICreditRateDimension;
    tokenMultiplier?: string | null;
    creditPerToken?: string | null;
    perRequestCredits?: string | null;
};

