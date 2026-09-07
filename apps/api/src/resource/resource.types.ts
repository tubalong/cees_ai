import { AclSubjectType } from '@prisma/client';

export interface ResourceAclResult {
    id: string;
    resourceId: string;
    subjectType: AclSubjectType;
    subjectId: string;
    permissionCodes: string[];
    expiresAt: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface ResourceAclListResult {
    items: ResourceAclResult[];
}
