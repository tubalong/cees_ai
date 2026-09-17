/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FinanceExpenseStatus } from './FinanceExpenseStatus';
export type FinanceExpenseStatusHistory = {
    id: string;
    reportId: string;
    fromStatus?: (FinanceExpenseStatus | null);
    toStatus: FinanceExpenseStatus;
    actorMembershipId: string;
    comment?: string | null;
    createdAt: string;
};

