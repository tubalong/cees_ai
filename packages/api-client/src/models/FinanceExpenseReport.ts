/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FinanceExpenseItem } from './FinanceExpenseItem';
import type { FinanceExpenseStatus } from './FinanceExpenseStatus';
export type FinanceExpenseReport = {
    id: string;
    tenantId: string;
    requesterMembershipId: string;
    title: string;
    description?: string | null;
    currency: string;
    totalAmount: number;
    status: FinanceExpenseStatus;
    submittedAt?: string | null;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewComment?: string | null;
    items: Array<FinanceExpenseItem>;
    version: number;
    createdAt: string;
    updatedAt: string;
};

