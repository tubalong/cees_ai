/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorkReportContent } from './WorkReportContent';
import type { WorkReportMemberIdentity } from './WorkReportMemberIdentity';
import type { WorkReportStatus } from './WorkReportStatus';
import type { WorkReportType } from './WorkReportType';
export type WorkReport = {
    id: string;
    type: WorkReportType;
    periodStart: string;
    periodEnd: string;
    content: WorkReportContent;
    status: WorkReportStatus;
    author: WorkReportMemberIdentity;
    reviewer: (WorkReportMemberIdentity | null);
    projectIds: Array<string>;
    taskIds: Array<string>;
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewComment: string | null;
    createdAt: string;
    updatedAt: string;
    version: number;
};

