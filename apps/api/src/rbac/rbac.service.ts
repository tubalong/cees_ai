import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { CreateRoleDto, ListRolesQueryDto, ReplaceRolePermissionsDto, UpdateRoleDto } from './dto';
import { DEFAULT_ROLE_PERMISSION_CODES } from './permission-catalog';
import { PermissionListResult, RoleListResult, RoleResult } from './rbac.types';

const roleInclude = {
    rolePermissions: {
        include: { permission: true },
    },
    _count: {
        select: { membershipRoles: true },
    },
} satisfies Prisma.RoleInclude;

type RoleWithPermissions = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

@Injectable()
export class RbacService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async listPermissions(): Promise<PermissionListResult> {
        this.tenantContext.require();
        const permissions = await this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
        return {
            items: permissions.map((permission) => ({
                id: permission.id,
                code: permission.code,
                name: permission.name,
            })),
        };
    }

    async listRoles(query: ListRolesQueryDto): Promise<RoleListResult> {
        const { tenantId } = this.tenantContext.require();
        if (query.cursor) {
            const cursorExists = await this.prisma.role.findFirst({
                where: { id: query.cursor, tenantId, deletedAt: null },
                select: { id: true },
            });
            if (!cursorExists) {
                throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
            }
        }

        const keyword = query.keyword?.trim();
        const roles = await this.prisma.role.findMany({
            where: {
                tenantId,
                deletedAt: null,
                OR: keyword
                    ? [
                        { code: { contains: keyword, mode: 'insensitive' } },
                        { name: { contains: keyword, mode: 'insensitive' } },
                    ]
                    : undefined,
            },
            include: roleInclude,
            orderBy: { id: 'asc' },
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = roles.length > query.limit;
        const page = hasNextPage ? roles.slice(0, query.limit) : roles;
        return {
            items: page.map(toRoleResult),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async createRole(input: CreateRoleDto): Promise<RoleResult> {
        const context = this.tenantContext.require();
        const code = input.code.trim().toLowerCase();
        const existing = await this.prisma.role.findUnique({
            where: { tenantId_code: { tenantId: context.tenantId, code } },
            select: { id: true },
        });
        if (existing) throw this.roleCodeConflict();

        let roleId: string;
        try {
            roleId = await this.prisma.$transaction(async (transaction) => {
                const role = await transaction.role.create({
                    data: {
                        tenantId: context.tenantId,
                        code,
                        name: input.name.trim(),
                        description: normalizeDescription(input.description),
                        dataScope: input.dataScope,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                    select: { id: true },
                });
                // 新角色默认拥有图片/文档的生成与查看权限，管理员可在角色编辑中调整。
                const defaultPermissions = await transaction.permission.findMany({
                    where: { code: { in: [...DEFAULT_ROLE_PERMISSION_CODES] } },
                    select: { id: true },
                });
                if (defaultPermissions.length > 0) {
                    await transaction.rolePermission.createMany({
                        data: defaultPermissions.map((permission) => ({
                            tenantId: context.tenantId,
                            roleId: role.id,
                            permissionId: permission.id,
                        })),
                    });
                }
                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: 'ROLE_CREATED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'ROLE',
                        resourceId: role.id,
                        requestId: context.requestId,
                        metadata: {
                            actorMembershipId: context.membershipId,
                            code,
                            name: input.name.trim(),
                            dataScope: input.dataScope,
                        },
                    },
                });
                return role.id;
            });
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.roleCodeConflict();
            throw error;
        }
        return this.getRole(roleId);
    }

    async getRole(roleId: string): Promise<RoleResult> {
        const { tenantId } = this.tenantContext.require();
        return toRoleResult(await this.requireRole(tenantId, roleId));
    }

    async updateRole(roleId: string, input: UpdateRoleDto): Promise<RoleResult> {
        const context = this.tenantContext.require();
        if (input.name === undefined && input.description === undefined && input.dataScope === undefined) {
            throw new BadRequestException({ code: 'ROLE_UPDATE_EMPTY', message: '至少提供一个需要修改的字段' });
        }
        const role = await this.requireRole(context.tenantId, roleId);
        if (role.isSystem) throw this.systemRoleConflict();

        const data: Prisma.RoleUpdateManyMutationInput = {
            version: { increment: 1 },
            updatedBy: context.userId,
        };
        if (input.name !== undefined) data.name = input.name.trim();
        if (input.description !== undefined) data.description = normalizeDescription(input.description);
        if (input.dataScope !== undefined) data.dataScope = input.dataScope;

        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.role.updateMany({
                where: { id: roleId, tenantId: context.tenantId, version: input.version, deletedAt: null },
                data,
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'ROLE_UPDATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'ROLE',
                    resourceId: roleId,
                    requestId: context.requestId,
                    metadata: {
                        actorMembershipId: context.membershipId,
                        before: roleSnapshot(role),
                        changes: {
                            name: input.name ?? null,
                            description: input.description === undefined ? null : input.description,
                            dataScope: input.dataScope ?? null,
                        },
                    },
                },
            });
        });
        return this.getRole(roleId);
    }

    async deleteRole(roleId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        const role = await this.requireRole(context.tenantId, roleId);
        if (role.isSystem) throw this.systemRoleConflict();

        try {
            await this.prisma.$transaction(async (transaction) => {
                const [memberCount, aclCount] = await Promise.all([
                    transaction.membershipRole.count({
                        where: { tenantId: context.tenantId, roleId },
                    }),
                    transaction.resourceAcl.count({
                        where: {
                            tenantId: context.tenantId,
                            subjectType: 'ROLE',
                            subjectId: roleId,
                            deletedAt: null,
                        },
                    }),
                ]);
                if (memberCount > 0 || aclCount > 0) throw this.roleInUse(memberCount, aclCount);

                await transaction.rolePermission.deleteMany({
                    where: { tenantId: context.tenantId, roleId },
                });
                const deleted = await transaction.role.deleteMany({
                    where: { id: roleId, tenantId: context.tenantId, version, isSystem: false },
                });
                if (deleted.count !== 1) throw this.versionConflict();
                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: 'ROLE_DELETED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'ROLE',
                        resourceId: roleId,
                        requestId: context.requestId,
                        metadata: {
                            actorMembershipId: context.membershipId,
                            before: roleSnapshot(role),
                        },
                    },
                });
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (isPrismaError(error, 'P2003')) throw this.roleInUse();
            throw error;
        }
    }

    async replaceRolePermissions(roleId: string, input: ReplaceRolePermissionsDto): Promise<RoleResult> {
        const context = this.tenantContext.require();
        const role = await this.requireRole(context.tenantId, roleId);
        if (role.isSystem) throw this.systemRoleConflict();

        const permissionIds = [...new Set(input.permissionIds)];
        const permissions = permissionIds.length === 0
            ? []
            : await this.prisma.permission.findMany({
                where: { id: { in: permissionIds } },
                select: { id: true, code: true },
            });
        if (permissions.length !== permissionIds.length) {
            throw new NotFoundException({ code: 'RBAC_PERMISSION_NOT_FOUND', message: '一个或多个权限不存在' });
        }

        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.role.updateMany({
                where: { id: roleId, tenantId: context.tenantId, version: input.version, deletedAt: null },
                data: { version: { increment: 1 }, updatedBy: context.userId },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.rolePermission.deleteMany({
                where: { tenantId: context.tenantId, roleId },
            });
            if (permissionIds.length > 0) {
                await transaction.rolePermission.createMany({
                    data: permissionIds.map((permissionId) => ({
                        tenantId: context.tenantId,
                        roleId,
                        permissionId,
                    })),
                });
            }
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'ROLE_PERMISSIONS_REPLACED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'ROLE',
                    resourceId: roleId,
                    requestId: context.requestId,
                    metadata: {
                        actorMembershipId: context.membershipId,
                        beforePermissionIds: role.rolePermissions.map((entry) => entry.permissionId),
                        afterPermissionIds: permissionIds,
                    },
                },
            });
        });
        return this.getRole(roleId);
    }

    private async requireRole(tenantId: string, roleId: string): Promise<RoleWithPermissions> {
        const role = await this.prisma.role.findFirst({
            where: { id: roleId, tenantId, deletedAt: null },
            include: roleInclude,
        });
        if (!role) throw this.roleNotFound();
        return role;
    }

    private roleNotFound(): NotFoundException {
        return new NotFoundException({ code: 'RBAC_ROLE_NOT_FOUND', message: '当前租户内角色不存在' });
    }

    private roleCodeConflict(): ConflictException {
        return new ConflictException({ code: 'RBAC_ROLE_CODE_CONFLICT', message: '当前租户内角色编码已存在' });
    }

    private systemRoleConflict(): ConflictException {
        return new ConflictException({ code: 'RBAC_SYSTEM_ROLE_PROTECTED', message: '系统角色不允许修改或删除' });
    }

    private roleInUse(memberCount?: number, aclCount?: number): ConflictException {
        return new ConflictException({
            code: 'RBAC_ROLE_IN_USE',
            message: '角色仍被成员或资源授权使用，不能删除',
            details: memberCount === undefined ? undefined : { memberCount, aclCount },
        });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }
}

function toRoleResult(role: RoleWithPermissions): RoleResult {
    return {
        id: role.id,
        code: role.code,
        name: role.name,
        description: role.description,
        dataScope: role.dataScope,
        isSystem: role.isSystem,
        permissions: role.rolePermissions
            .map((entry) => ({
                id: entry.permission.id,
                code: entry.permission.code,
                name: entry.permission.name,
            }))
            .sort((left, right) => left.code.localeCompare(right.code)),
        memberCount: role._count.membershipRoles,
        version: role.version,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
    };
}

function normalizeDescription(description: string | null | undefined): string | null {
    const normalized = description?.trim();
    return normalized ? normalized : null;
}

function roleSnapshot(role: RoleWithPermissions): Prisma.InputJsonObject {
    return {
        roleId: role.id,
        code: role.code,
        name: role.name,
        description: role.description,
        dataScope: role.dataScope,
        isSystem: role.isSystem,
        permissionIds: role.rolePermissions.map((entry) => entry.permissionId),
        version: role.version,
    };
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
