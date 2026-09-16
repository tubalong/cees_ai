/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ReviewFinanceExpenseReportRequest = {
    decision: ReviewFinanceExpenseReportRequest.decision;
    comment?: string | null;
    version: number;
};
export namespace ReviewFinanceExpenseReportRequest {
    export enum decision {
        APPROVE = 'APPROVE',
        REJECT = 'REJECT',
    }
}

