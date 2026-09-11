/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorkReportContent } from './WorkReportContent';
export type CreateWeeklyWorkReportRequest = {
    /**
     * 必须是周一
     */
    weekStartDate: string;
    reviewerMembershipId: string;
    content: WorkReportContent;
    projectIds?: Array<string>;
    taskIds?: Array<string>;
};

