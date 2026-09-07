import { DataScope } from '@prisma/client';

export interface PermissionResult {
    id: string;
    code: string;
    name: string;
}

export interface PermissionListResult {
    items: PermissionResult[];
}

export interface RoleResult {
    id: string;
    code: string;
    name: string;
    description: string | null;
    dataScope: DataScope;
    isSystem: boolean;
    permissions: PermissionResult[];
    memberCount: number;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface RoleListResult {
    items: RoleResult[];
    nextCursor: string | null;
}
