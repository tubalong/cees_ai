import { DocumentVisibility } from '@prisma/client';

export interface DocumentSummaryResult {
    id: string;
    resourceId: string;
    title: string;
    visibility: DocumentVisibility;
    ownerMembershipId: string;
    effectivePermissions: string[];
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface DocumentResult extends DocumentSummaryResult {
    content: string;
}

export interface DocumentListResult {
    items: DocumentSummaryResult[];
    nextCursor: string | null;
}
