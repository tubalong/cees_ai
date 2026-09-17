/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FinanceExpenseAttachment } from './FinanceExpenseAttachment';
import type { FinanceExpenseItem } from './FinanceExpenseItem';
import type { FinanceExpenseStatus } from './FinanceExpenseStatus';
import type { FinanceExpenseStatusHistory } from './FinanceExpenseStatusHistory';
import type { FinancePaymentMethod } from './FinancePaymentMethod';
export type FinanceExpenseReport = {
    id: string;
    tenantId: string;
    reportNo: string;
    requesterMembershipId: string;
    requesterDepartmentId?: string | null;
    title: string;
    description?: string | null;
    currency: string;
    totalAmount: number;
    status: FinanceExpenseStatus;
    submittedAt?: string | null;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewComment?: string | null;
    paidBy?: string | null;
    paidAt?: string | null;
    paymentMethod?: (FinancePaymentMethod | null);
    paymentReference?: string | null;
    paymentComment?: string | null;
    cancelledAt?: string | null;
    cancellationReason?: string | null;
    items: Array<FinanceExpenseItem>;
    attachments: Array<FinanceExpenseAttachment>;
    statusHistory: Array<FinanceExpenseStatusHistory>;
    version: number;
    createdAt: string;
    updatedAt: string;
};

