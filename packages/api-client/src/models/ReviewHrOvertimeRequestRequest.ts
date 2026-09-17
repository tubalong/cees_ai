/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ReviewHrOvertimeRequestRequest = {
    decision: ReviewHrOvertimeRequestRequest.decision;
    comment?: string | null;
    version: number;
};
export namespace ReviewHrOvertimeRequestRequest {
    export enum decision {
        APPROVE = 'APPROVE',
        REJECT = 'REJECT',
    }
}

