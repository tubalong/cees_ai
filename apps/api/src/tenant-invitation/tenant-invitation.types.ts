import { TenantInvitationStatus } from '@prisma/client';
import { TenantMemberResult } from '../tenant/tenant.types';

export interface TenantInvitationResult {
    id: string;
    tenantId: string;
    account: string;
    displayName: string;
    status: TenantInvitationStatus;
    isInitialAdministrator: boolean;
    roleIds: string[];
    expiresAt: Date;
    createdAt: Date;
}

export interface TenantInvitationCreatedResult {
    invitation: TenantInvitationResult;
    invitationToken: string;
}

export interface TenantInvitationListResult {
    items: TenantInvitationResult[];
    nextCursor: string | null;
}

export interface AccountSuggestionResult {
    suggestedAccount: string;
    available: boolean;
    alternatives: string[];
}

export interface TenantInvitationAcceptanceResult {
    tenant: {
        id: string;
        code: string;
        name: string;
    };
    membership: TenantMemberResult;
}
