/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { LegalContractAmountSummary } from './LegalContractAmountSummary';
export type LegalContractSummary = {
    asOf: string;
    expiringWithinDays: number;
    totalCount: number;
    draftCount: number;
    activeCount: number;
    pendingRenewalCount: number;
    expiringCount: number;
    expiredCount: number;
    terminatedCount: number;
    archivedCount: number;
    amountsByCurrency: Array<LegalContractAmountSummary>;
};

