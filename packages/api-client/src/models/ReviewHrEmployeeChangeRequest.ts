/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ReviewHrEmployeeChangeRequest = {
    decision: ReviewHrEmployeeChangeRequest.decision;
    comment?: string | null;
    version: number;
};
export namespace ReviewHrEmployeeChangeRequest {
    export enum decision {
        APPROVE = 'APPROVE',
        REJECT = 'REJECT',
    }
}

