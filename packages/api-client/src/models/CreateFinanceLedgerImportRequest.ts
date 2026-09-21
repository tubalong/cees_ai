/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FinanceLedgerRow } from './FinanceLedgerRow';
export type CreateFinanceLedgerImportRequest = {
    fileName: string;
    format: CreateFinanceLedgerImportRequest.format;
    periodStart: string;
    periodEnd: string;
    rows: Array<FinanceLedgerRow>;
};
export namespace CreateFinanceLedgerImportRequest {
    export enum format {
        XLSX = 'XLSX',
        CSV = 'CSV',
    }
}

