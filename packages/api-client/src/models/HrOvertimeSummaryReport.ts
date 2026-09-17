/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type HrOvertimeSummaryReport = {
    dateFrom: string;
    dateTo: string;
    totalHours: number;
    byMember: Array<{
        membershipId: string;
        displayName: string;
        overtimeHours: number;
    }>;
};

