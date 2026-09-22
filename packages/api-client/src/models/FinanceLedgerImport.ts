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
    /**
     * 原始上传文件的文件对象 ID；未留档时为 null
     */
    sourceFileObjectId?: string | null;
    /**
     * 批次创建时间；导入历史按此倒序
     */
    createdAt?: string;
    /**
     * 批次处理完成时间
     */
    finishedAt?: string | null;
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

