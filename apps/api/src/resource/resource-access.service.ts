import { Injectable } from '@nestjs/common';
import { AclSubjectType, DocumentVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';

export const managedDocumentAccessInclude = {
    resource: {
        include: { acls: true },
    },
    fileObject: {
        select: { id: true, mimeType: true, objectKey: true },
    },
} satisfies Prisma.ManagedDocumentInclude;

export type ManagedDocumentWithAccess = Prisma.ManagedDocumentGetPayload<{
    include: typeof managedDocumentAccessInclude;
}>;

const DOCUMENT_PERMISSIONS = [
    'document.read',
    'document.update',
    'document.delete',
    'document.share',
] as const;

@Injectable()
export class ResourceAccessService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async resolveCurrentRoleIds(): Promise<string[]> {
        const context = this.tenantContext.require();
        const assignments = await this.prisma.membershipRole.findMany({
            where: { tenantId: context.tenantId, membershipId: context.membershipId },
            select: { roleId: true },
        });
        return assignments.map((assignment) => assignment.roleId);
    }

    documentWhere(permissionCode: string, roleIds: string[], now = new Date()): Prisma.ManagedDocumentWhereInput {
        const context = this.tenantContext.require();
        const base: Prisma.ManagedDocumentWhereInput = {
            tenantId: context.tenantId,
            deletedAt: null,
            resource: { is: { tenantId: context.tenantId, deletedAt: null } },
        };
        if (!context.permissions.includes(permissionCode)) return { id: { in: [] } };
        if (context.permissions.includes('document.manage_all')) return base;

        const access: Prisma.ManagedDocumentWhereInput[] = [
            { resource: { is: { ownerMembershipId: context.membershipId } } },
            {
                resource: {
                    is: {
                        acls: { some: this.activeAclWhere(permissionCode, roleIds, now) },
                    },
                },
            },
        ];
        if (permissionCode === 'document.read') access.push({ visibility: DocumentVisibility.TENANT });
        return { AND: [base, { OR: access }] };
    }

    canAccessDocument(
        document: ManagedDocumentWithAccess,
        permissionCode: string,
        roleIds: string[],
        now = new Date(),
    ): boolean {
        const context = this.tenantContext.require();
        if (
            document.tenantId !== context.tenantId
            || document.deletedAt
            || document.resource.tenantId !== context.tenantId
            || document.resource.deletedAt
        ) return false;
        if (!context.permissions.includes(permissionCode)) return false;
        if (context.permissions.includes('document.manage_all')) return true;
        if (document.resource.ownerMembershipId === context.membershipId) return true;
        if (permissionCode === 'document.read' && document.visibility === DocumentVisibility.TENANT) return true;
        return document.resource.acls.some((entry) => this.aclMatches(entry, permissionCode, roleIds, now));
    }

    effectiveDocumentPermissions(document: ManagedDocumentWithAccess, roleIds: string[]): string[] {
        return DOCUMENT_PERMISSIONS
            .filter((permission) => this.canAccessDocument(document, permission, roleIds))
            .sort();
    }

    private activeAclWhere(permissionCode: string, roleIds: string[], now: Date): Prisma.ResourceAclWhereInput {
        const context = this.tenantContext.require();
        const subjects: Prisma.ResourceAclWhereInput[] = [
            { subjectType: AclSubjectType.MEMBERSHIP, subjectId: context.membershipId },
        ];
        if (roleIds.length > 0) {
            subjects.push({ subjectType: AclSubjectType.ROLE, subjectId: { in: roleIds } });
        }
        return {
            tenantId: context.tenantId,
            deletedAt: null,
            permissionCodes: { has: permissionCode },
            AND: [
                { OR: subjects },
                { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            ],
        };
    }

    private aclMatches(
        entry: ManagedDocumentWithAccess['resource']['acls'][number],
        permissionCode: string,
        roleIds: string[],
        now: Date,
    ): boolean {
        if (entry.deletedAt || (entry.expiresAt && entry.expiresAt <= now)) return false;
        if (!entry.permissionCodes.includes(permissionCode)) return false;
        const context = this.tenantContext.require();
        if (entry.tenantId !== context.tenantId) return false;
        return entry.subjectType === AclSubjectType.MEMBERSHIP
            ? entry.subjectId === context.membershipId
            : roleIds.includes(entry.subjectId);
    }
}
