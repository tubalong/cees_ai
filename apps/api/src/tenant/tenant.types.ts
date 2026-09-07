import { MembershipStatus, TenantStatus } from '@prisma/client';

export interface TenantResult {
    id: string;
    code: string;
    name: string;
    status: TenantStatus;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface TenantMemberResult {
    id: string;
    user: {
        id: string;
        email: string;
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
