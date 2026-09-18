/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type HrLeaveSummaryReport = {
    year: number;
    totalRequestedDays: number;
    totalApprovedDays: number;
    byLeaveType: Array<{
        leaveTypeId: string;
        leaveTypeName: string;
        requestedDays: number;
        approvedDays: number;
    }>;
};

