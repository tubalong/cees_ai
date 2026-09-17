/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { LegalContractType } from './LegalContractType';
export type UpdateLegalContractRequest = {
    contractNo?: string;
    name?: string;
    counterparty?: string;
    type?: LegalContractType;
    amount?: number | null;
    currency?: string;
    startDate?: string;
    endDate?: string | null;
    signedAt?: string | null;
    description?: string | null;
    ownerMembershipId?: string;
    departmentId?: string | null;
    projectId?: string | null;
    renewalReminderDays?: number;
    attachmentIds?: Array<string>;
    version: number;
};

