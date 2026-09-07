/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AuditOutcome } from './AuditOutcome';
export type AuditEvent = {
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
    metadata: any | null;
    createdAt: string;
};

