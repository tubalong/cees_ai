/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ReviewHrAttendanceRecordRequest = {
    decision: ReviewHrAttendanceRecordRequest.decision;
    comment?: string | null;
    version: number;
};
export namespace ReviewHrAttendanceRecordRequest {
    export enum decision {
        APPROVE = 'APPROVE',
        REJECT = 'REJECT',
    }
}

