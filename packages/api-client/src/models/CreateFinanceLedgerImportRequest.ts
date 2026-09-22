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
    /**
     * 可选；原始上传文件的文件对象 ID，只有勾选「留档原文件」时才携带
     */
    sourceFileObjectId?: string;
    rows: Array<FinanceLedgerRow>;
};
export namespace CreateFinanceLedgerImportRequest {
    export enum format {
        XLSX = 'XLSX',
        CSV = 'CSV',
    }
}

