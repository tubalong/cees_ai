/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type FinanceLedgerImport = {
    id: string;
    fileName: string;
    format: string;
    periodStart: string;
    periodEnd: string;
    status: FinanceLedgerImport.status;
    rowCount: number;
    importedCount: number;
    skippedCount: number;
    errorCount: number;
    errors?: Array<Record<string, any>>;
};
export namespace FinanceLedgerImport {
    export enum status {
        PENDING = 'PENDING',
        PARSING = 'PARSING',
        SUCCEEDED = 'SUCCEEDED',
        PARTIAL = 'PARTIAL',
        FAILED = 'FAILED',
    }
}

