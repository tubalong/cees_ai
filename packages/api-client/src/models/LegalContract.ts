/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { LegalContractAttachment } from './LegalContractAttachment';
import type { LegalContractStatus } from './LegalContractStatus';
import type { LegalContractStatusHistory } from './LegalContractStatusHistory';
import type { LegalContractType } from './LegalContractType';
export type LegalContract = {
    id: string;
    tenantId: string;
    contractNo: string;
    name: string;
    counterparty: string;
    type: LegalContractType;
    amount?: number | null;
    currency: string;
    startDate: string;
    endDate?: string | null;
    signedAt?: string | null;
    status: LegalContractStatus;
    description?: string | null;
    ownerMembershipId: string;
    departmentId?: string | null;
    projectId?: string | null;
    renewalReminderDays: number;
    activatedAt?: string | null;
    terminatedAt?: string | null;
    terminationReason?: string | null;
    archivedAt?: string | null;
    attachments: Array<LegalContractAttachment>;
    statusHistory: Array<LegalContractStatusHistory>;
    version: number;
    createdAt: string;
    updatedAt: string;
};

