import { Prisma, WorkReportStatus, WorkReportType } from '@prisma/client';

export interface WorkReportContentResult { completedItems: string[]; plannedItems: string[]; blockers: string[]; remarks: string | null; }
export interface WorkReportMemberIdentityResult { membershipId: string; account: string; displayName: string; departmentId: string | null; }
export interface WorkReportResult {
    id: string; type: WorkReportType; periodStart: Date; periodEnd: Date; content: WorkReportContentResult;
    status: WorkReportStatus; author: WorkReportMemberIdentityResult; reviewer: WorkReportMemberIdentityResult | null;
    projectIds: string[]; taskIds: string[]; submittedAt: Date | null; reviewedAt: Date | null;
    reviewComment: string | null; createdAt: Date; updatedAt: Date; version: number;
}
export interface WorkReportListResult { items: WorkReportResult[]; nextCursor: string | null; }
export interface WorkReportStatisticsResult { total: number; draft: number; submitted: number; approved: number; rejected: number; }
export type WorkReportJson = Prisma.InputJsonValue;
