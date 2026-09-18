/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FinanceExpenseItemInput } from './FinanceExpenseItemInput';
export type UpdateFinanceExpenseReportRequest = {
    title: string;
    description?: string | null;
    currency?: string;
    items: Array<FinanceExpenseItemInput>;
    attachmentIds?: Array<string>;
    version: number;
};

