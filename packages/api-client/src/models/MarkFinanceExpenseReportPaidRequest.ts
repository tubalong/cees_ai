/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FinancePaymentMethod } from './FinancePaymentMethod';
export type MarkFinanceExpenseReportPaidRequest = {
    paidAt: string;
    paymentMethod: FinancePaymentMethod;
    paymentReference: string;
    comment?: string | null;
    version: number;
};

