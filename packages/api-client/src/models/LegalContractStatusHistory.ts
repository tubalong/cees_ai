/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { LegalContractStatus } from './LegalContractStatus';
export type LegalContractStatusHistory = {
    id: string;
    fromStatus?: (LegalContractStatus | null);
    toStatus: LegalContractStatus;
    actorMembershipId: string | null;
    comment?: string | null;
    createdAt: string;
};

