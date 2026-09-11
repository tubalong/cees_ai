/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorkReportContent } from './WorkReportContent';
export type UpdateWorkReportRequest = {
    version: number;
    reviewerMembershipId: string;
    content: WorkReportContent;
    projectIds: Array<string>;
    taskIds: Array<string>;
};

