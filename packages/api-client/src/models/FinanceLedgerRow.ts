/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FinanceLedgerDirection } from './FinanceLedgerDirection';
export type FinanceLedgerRow = {
    rowNumber: number;
    occurredOn: string;
    direction: FinanceLedgerDirection;
    amount: number;
    currency: string;
    categoryCode?: string | null;
    categoryName?: string | null;
    departmentId?: string | null;
    projectId?: string | null;
    counterparty?: string | null;
    summary?: string | null;
    voucherNo: string;
};

