import { AuditOutcome, MembershipStatus, TenantStatus } from '@prisma/client';
import { TenantInvitationResult } from '../tenant-invitation/tenant-invitation.types';

export interface PlatformTenantResult {
    id: string;
    code: string;
    name: string;
    status: TenantStatus;
    activeAdministratorCount: number;
    pendingInvitationCount: number;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface PlatformTenantListResult {
    items: PlatformTenantResult[];
    nextCursor: string | null;
}

export interface PlatformTenantAdministratorResult {
    membershipId: string;
    account: string;
    user: {
        id: string;
        displayName: string;
    };
    status: MembershipStatus;
    joinedAt: Date;
}

export interface PlatformTenantAdministratorAssignmentResult {
    status: 'ASSIGNED' | 'INVITED';
    administrator?: PlatformTenantAdministratorResult;
    invitation?: TenantInvitationResult;
    invitationToken?: string;
}

export interface PlatformTenantProvisioningResult {
    tenant: PlatformTenantResult;
    administratorAssignment: PlatformTenantAdministratorAssignmentResult;
}

export interface PlatformAuditEventResult {
    id: string;
    action: string;
    outcome: AuditOutcome;
    actorUserId: string | null;
    actorPlatformAdministratorId: string | null;
    resourceType: string;
    resourceId: string | null;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: unknown;
    createdAt: Date;
}

export interface PlatformAuditEventListResult {
    items: PlatformAuditEventResult[];
    nextCursor: string | null;
}
