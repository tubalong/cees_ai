import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AclSubjectType, AuditOutcome, MembershipStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { CreateResourceAclDto } from './dto';
import {
    managedDocumentAccessInclude,
    ManagedDocumentWithAccess,
    ResourceAccessService,
} from './resource-access.service';
import { ResourceAclListResult, ResourceAclResult } from './resource.types';

const ALLOWED_DOCUMENT_ACL_PERMISSIONS = new Set([
    'document.read',
    'document.update',
    'document.delete',
    'document.share',
]);

@Injectable()
export class AclService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly resourceAccess: ResourceAccessService,
    ) { }

    async listAcl(resourceId: string): Promise<ResourceAclListResult> {
        await this.requireShareableDocument(resourceId);
        const { tenantId } = this.tenantContext.require();
        const entries = await this.prisma.resourceAcl.findMany({
            where: { tenantId, resourceId, deletedAt: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        return { items: entries.map(toAclResult) };
    }

    async createAcl(resourceId: string, input: CreateResourceAclDto): Promise<ResourceAclResult> {
        await this.requireShareableDocument(resourceId);
        const context = this.tenantContext.require();
        const permissionCodes = [...new Set(input.permissionCodes)].sort();
        await this.validatePermissions(permissionCodes);
        await this.validateSubject(context.tenantId, input.subjectType, input.subjectId);
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
        if (expiresAt && expiresAt <= new Date()) {
            throw new BadRequestException({ code: 'ACL_EXPIRY_INVALID', message: 'ACL 过期时间必须晚于当前时间' });
        }

        const existing = await this.prisma.resourceAcl.findUnique({
            where: {
                tenantId_resourceId_subjectType_subjectId: {
                    tenantId: context.tenantId,
                    resourceId,
                    subjectType: input.subjectType,
                    subjectId: input.subjectId,
                },
            },
        });
        if (existing && !existing.deletedAt) {
            if (sameAcl(existing.permissionCodes, permissionCodes, existing.expiresAt, expiresAt)) {
                return toAclResult(existing);
            }
            throw this.aclConflict();
        }

        try {
            const entry = await this.prisma.$transaction(async (transaction) => {
                const created = await transaction.resourceAcl.create({
                    data: {
                        tenantId: context.tenantId,
                        resourceId,
                        subjectType: input.subjectType,
                        subjectId: input.subjectId,
                        permissionCodes,
                        expiresAt,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                });
                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: 'ACL_GRANTED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'DOCUMENT',
                        resourceId,
                        requestId: context.requestId,
                        metadata: {
                            aclEntryId: created.id,
                            subjectType: input.subjectType,
                            subjectId: input.subjectId,
                            permissionCodes,
                            expiresAt: expiresAt?.toISOString() ?? null,
                        },
                    },
                });
                return created;
            });
            return toAclResult(entry);
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.aclConflict();
            throw error;
        }
    }

    async deleteAcl(resourceId: string, aclEntryId: string, version: number): Promise<void> {
        await this.requireShareableDocument(resourceId);
        const context = this.tenantContext.require();
        const entry = await this.prisma.resourceAcl.findFirst({
            where: { id: aclEntryId, tenantId: context.tenantId, resourceId, deletedAt: null },
        });
        if (!entry) throw this.aclNotFound();

        await this.prisma.$transaction(async (transaction) => {
            const deleted = await transaction.resourceAcl.deleteMany({
                where: { id: aclEntryId, tenantId: context.tenantId, resourceId, version },
            });
            if (deleted.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'ACL_REVOKED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'DOCUMENT',
                    resourceId,
                    requestId: context.requestId,
                    metadata: {
                        aclEntryId,
                        subjectType: entry.subjectType,
                        subjectId: entry.subjectId,
                        permissionCodes: entry.permissionCodes,
                    },
                },
            });
        });
    }

    private async requireShareableDocument(resourceId: string): Promise<ManagedDocumentWithAccess> {
        const roleIds = await this.resourceAccess.resolveCurrentRoleIds();
        const accessWhere = this.resourceAccess.documentWhere('document.share', roleIds);
        const document = await this.prisma.managedDocument.findFirst({
            where: { AND: [accessWhere, { id: resourceId }] },
            include: managedDocumentAccessInclude,
        });
        if (!document) {
            throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: '资源不存在或不在授权范围内' });
        }
        return document;
    }

    private async validatePermissions(permissionCodes: string[]): Promise<void> {
        if (permissionCodes.length === 0 || permissionCodes.some((code) => !ALLOWED_DOCUMENT_ACL_PERMISSIONS.has(code))) {
            throw new BadRequestException({ code: 'ACL_PERMISSION_INVALID', message: '包含不支持的资源权限编码' });
        }
        const permissions = await this.prisma.permission.findMany({
            where: { code: { in: permissionCodes } },
            select: { code: true },
        });
        if (permissions.length !== permissionCodes.length) {
            throw new BadRequestException({ code: 'ACL_PERMISSION_INVALID', message: '一个或多个权限编码不存在' });
        }
    }

    private async validateSubject(tenantId: string, subjectType: AclSubjectType, subjectId: string): Promise<void> {
        if (subjectType === AclSubjectType.MEMBERSHIP) {
            const membership = await this.prisma.tenantMembership.findFirst({
                where: { id: subjectId, tenantId, status: MembershipStatus.ACTIVE, deletedAt: null },
                select: { id: true },
            });
            if (!membership) {
                throw new NotFoundException({ code: 'ACL_SUBJECT_NOT_FOUND', message: '当前租户内有效成员不存在' });
            }
            return;
        }
        const role = await this.prisma.role.findFirst({
            where: { id: subjectId, tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!role) throw new NotFoundException({ code: 'ACL_SUBJECT_NOT_FOUND', message: '当前租户内角色不存在' });
    }

    private aclConflict(): ConflictException {
        return new ConflictException({ code: 'ACL_ENTRY_CONFLICT', message: '该资源已存在相同授权主体的 ACL' });
    }

    private aclNotFound(): NotFoundException {
        return new NotFoundException({ code: 'ACL_ENTRY_NOT_FOUND', message: '当前资源 ACL 不存在' });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }
}

function toAclResult(entry: {
    id: string;
    resourceId: string;
    subjectType: AclSubjectType;
    subjectId: string;
    permissionCodes: string[];
    expiresAt: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}): ResourceAclResult {
    return {
        id: entry.id,
        resourceId: entry.resourceId,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        permissionCodes: [...entry.permissionCodes].sort(),
        expiresAt: entry.expiresAt,
        version: entry.version,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
    };
}

function sameAcl(leftCodes: string[], rightCodes: string[], leftExpiry: Date | null, rightExpiry: Date | null): boolean {
    const codesEqual = [...leftCodes].sort().join('\u0000') === [...rightCodes].sort().join('\u0000');
    return codesEqual && leftExpiry?.getTime() === rightExpiry?.getTime();
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
