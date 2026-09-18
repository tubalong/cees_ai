/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ReviewHrLeaveRequestRequest = {
    decision: ReviewHrLeaveRequestRequest.decision;
    comment?: string | null;
    version: number;
};
export namespace ReviewHrLeaveRequestRequest {
    export enum decision {
        APPROVE = 'APPROVE',
        REJECT = 'REJECT',
    }
}

