import { MembershipStatus, TenantStatus } from '@prisma/client';

export interface TenantResult {
    id: string;
    code: string;
    name: string;
    timezone: string;
    status: TenantStatus;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface TenantMemberResult {
    id: string;
    account: string;
    user: {
        id: string;
        displayName: string;
    };
    departmentId: string | null;
    status: MembershipStatus;
    roles: Array<{
        id: string;
        code: string;
        name: string;
    }>;
    joinedAt: Date;
    version: number;
}

export interface TenantMemberListResult {
    items: TenantMemberResult[];
    nextCursor: string | null;
}
