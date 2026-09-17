/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type FinanceExpenseSummary = {
    currency: string;
    reportCount: number;
    submittedAmount: number;
    approvedAmount: number;
    paidAmount: number;
    pendingApprovalCount: number;
    pendingApprovalAmount: number;
    pendingPaymentCount: number;
    pendingPaymentAmount: number;
    byCategory: Array<{
        categoryId: string;
        categoryName: string;
        amount: number;
    }>;
};

