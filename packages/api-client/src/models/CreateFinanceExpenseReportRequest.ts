/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FinanceExpenseItemInput } from './FinanceExpenseItemInput';
export type CreateFinanceExpenseReportRequest = {
    title: string;
    description?: string | null;
    currency: string;
    totalAmount: number;
    items: Array<FinanceExpenseItemInput>;
};

