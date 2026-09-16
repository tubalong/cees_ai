/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { LegalContractStatus } from './LegalContractStatus';
import type { LegalContractType } from './LegalContractType';
export type UpdateLegalContractRequest = {
    contractNo?: string;
    name?: string;
    counterparty?: string;
    type?: LegalContractType;
    amount?: number | null;
    currency?: string;
    startDate?: string;
    endDate?: string;
    signedAt?: string | null;
    status?: LegalContractStatus;
    description?: string | null;
    ownerMembershipId?: string | null;
    version: number;
};

