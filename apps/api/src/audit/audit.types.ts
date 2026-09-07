import { AuditOutcome, Prisma } from '@prisma/client';

export interface AuditEventResult {
    id: string;
    action: string;
    outcome: AuditOutcome;
    actorUserId: string | null;
    actorMembershipId: string | null;
    resourceType: string;
    resourceId: string | null;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
}

export interface AuditEventListResult {
    items: AuditEventResult[];
    nextCursor: string | null;
}
