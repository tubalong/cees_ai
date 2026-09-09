import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditOutcome, DepartmentStatus, MembershipStatus, Prisma } from '@prisma/client';
import { normalizeAccount } from '../auth/account';
import { PrismaService } from '../database/prisma.service';
import { TENANT_ADMIN_ROLE_CODE } from '../rbac/permission-catalog';
import {
    ListTenantMembersQueryDto,
    ReplaceTenantMemberRolesDto,
    UpdateTenantDto,
    UpdateTenantMemberDto,
    UpdateTenantMemberAccountDto,
} from './dto';
import { TenantContext } from './tenant-context';
import { TenantMemberListResult, TenantMemberResult, TenantResult } from './tenant.types';

const memberInclude = {
    user: true,
    membershipRoles: {
        where: { role: { deletedAt: null } },
        include: { role: true },
    },
} satisfies Prisma.TenantMembershipInclude;

type MemberWithRoles = Prisma.TenantMembershipGetPayload<{ include: typeof memberInclude }>;

@Injectable()
export class TenantService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async getCurrentTenant(): Promise<TenantResult> {
        const { tenantId } = this.tenantContext.require();
        const tenant = await this.prisma.tenant.findFirst({
            where: { id: tenantId, deletedAt: null },
        });
        if (!tenant) throw this.tenantNotFound();
        return toTenantResult(tenant);
    }

    async updateCurrentTenant(input: UpdateTenantDto): Promise<TenantResult> {
        const context = this.tenantContext.require();
        const current = await this.prisma.tenant.findFirst({
            where: { id: context.tenantId, deletedAt: null },
        });
        if (!current) throw this.tenantNotFound();

        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.tenant.updateMany({
                where: { id: context.tenantId, version: input.version, deletedAt: null },
                data: { name: input.name.trim(), version: { increment: 1 } },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'TENANT_UPDATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'TENANT',
                    resourceId: context.tenantId,
                    requestId: context.requestId,
                    metadata: {
                        actorMembershipId: context.membershipId,
                        before: { name: current.name, version: current.version },
                        after: { name: input.name.trim(), version: current.version + 1 },
                    },
                },
            });
        });
        return this.getCurrentTenant();
    }

    async listMembers(query: ListTenantMembersQueryDto, departmentId?: string): Promise<TenantMemberListResult> {
        const { tenantId } = this.tenantContext.require();
        if (query.cursor) {
            const cursorExists = await this.prisma.tenantMembership.findFirst({
                where: { id: query.cursor, tenantId, departmentId, deletedAt: null },
                select: { id: true },
            });
            if (!cursorExists) {
                throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
            }
        }

        const keyword = query.keyword?.trim();
        const members = await this.prisma.tenantMembership.findMany({
            where: {
                tenantId,
                departmentId,
                deletedAt: null,
                status: query.status,
                membershipRoles: query.roleId ? { some: { roleId: query.roleId } } : undefined,
                OR: keyword
                    ? [
                        { displayName: { contains: keyword, mode: 'insensitive' } },
                        { account: { contains: keyword, mode: 'insensitive' } },
                        { user: { displayName: { contains: keyword, mode: 'insensitive' } } },
                    ]
                    : undefined,
            },
            include: memberInclude,
            orderBy: { id: 'asc' },
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = members.length > query.limit;
        const page = hasNextPage ? members.slice(0, query.limit) : members;
        return {
            items: page.map(toMemberResult),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async getMember(membershipId: string): Promise<TenantMemberResult> {
        const { tenantId } = this.tenantContext.require();
        return toMemberResult(await this.requireMember(tenantId, membershipId));
    }

    async updateMember(membershipId: string, input: UpdateTenantMemberDto): Promise<TenantMemberResult> {
        const context = this.tenantContext.require();
        if (input.displayName === undefined && input.departmentId === undefined && input.status === undefined) {
            throw new BadRequestException({ code: 'MEMBER_UPDATE_EMPTY', message: '至少提供一个需要修改的字段' });
        }
        const member = await this.requireMember(context.tenantId, membershipId);
        if (input.status === MembershipStatus.PENDING_ACTIVATION) {
            throw new BadRequestException({
                code: 'TENANT_MEMBER_STATUS_INVALID',
                message: '待激活状态只能通过凭证重置流程设置',
            });
        }
        if (input.status === MembershipStatus.DISABLED && membershipId === context.membershipId) {
            throw this.selfOperationConflict();
        }
        if (input.departmentId !== undefined && !context.permissions.includes('department.member.assign')) {
            throw new ForbiddenException({
                code: 'AUTH_PERMISSION_DENIED',
                message: '权限不足',
                details: { required: ['department.member.assign'] },
            });
        }
        if (input.departmentId) await this.requireActiveDepartment(context.tenantId, input.departmentId);
        if (input.status === MembershipStatus.DISABLED && isTenantAdmin(member)) {
            await this.assertAnotherActiveAdmin(context.tenantId, membershipId);
        }

        const data: Prisma.TenantMembershipUncheckedUpdateManyInput = {
            version: { increment: 1 },
            updatedBy: context.userId,
        };
        if (input.displayName !== undefined) data.displayName = input.displayName.trim();
        if (input.departmentId !== undefined) data.departmentId = input.departmentId;
        if (input.status !== undefined) data.status = input.status;

        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.tenantMembership.updateMany({
                where: {
                    id: membershipId,
                    tenantId: context.tenantId,
                    version: input.version,
                    deletedAt: null,
                },
                data,
            });
            if (updated.count !== 1) throw this.versionConflict();
            if (input.status === MembershipStatus.DISABLED) {
                await transaction.authSession.updateMany({
                    where: { tenantId: context.tenantId, membershipId, revokedAt: null },
                    data: { revokedAt: new Date() },
                });
            }
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: input.status === MembershipStatus.DISABLED
                        ? 'MEMBER_DISABLED'
                        : input.departmentId !== undefined && input.displayName === undefined && input.status === undefined
                            ? 'MEMBER_DEPARTMENT_CHANGED'
                            : 'MEMBER_UPDATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'TENANT_MEMBERSHIP',
                    resourceId: membershipId,
                    requestId: context.requestId,
                    metadata: {
                        actorMembershipId: context.membershipId,
                        before: memberSnapshot(member),
                        changes: {
                            displayName: input.displayName ?? null,
                            departmentId: input.departmentId === undefined ? null : input.departmentId,
                            status: input.status ?? null,
                        },
                    },
                },
            });
        });
        return this.getMember(membershipId);
    }

    async updateMemberAccount(
        membershipId: string,
        input: UpdateTenantMemberAccountDto,
    ): Promise<TenantMemberResult> {
        const context = this.tenantContext.require();
        const member = await this.requireMember(context.tenantId, membershipId);
        const account = normalizeAccount(input.account);
        if (member.normalizedAccount === account) return toMemberResult(member);

        const conflict = await this.prisma.tenantMembership.findUnique({
            where: { tenantId_normalizedAccount: { tenantId: context.tenantId, normalizedAccount: account } },
            select: { id: true },
        });
        if (conflict) {
            throw new ConflictException({
                code: 'TENANT_ACCOUNT_ALREADY_EXISTS',
                message: `账号 ${account} 已被当前租户使用`,
            });
        }

        const now = new Date();
        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.tenantMembership.updateMany({
                where: {
                    id: membershipId,
                    tenantId: context.tenantId,
                    version: input.version,
                    deletedAt: null,
                },
                data: {
                    account,
                    normalizedAccount: account,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.authSession.updateMany({
                where: { tenantId: context.tenantId, membershipId, revokedAt: null },
                data: { revokedAt: now },
            });
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'TENANT_MEMBER_ACCOUNT_CHANGED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'TENANT_MEMBERSHIP',
                    resourceId: membershipId,
                    requestId: context.requestId,
                    metadata: { before: { account: member.account }, after: { account } },
                },
            });
        });
        return this.getMember(membershipId);
    }

    async removeMember(membershipId: string): Promise<void> {
        const context = this.tenantContext.require();
        if (membershipId === context.membershipId) throw this.selfOperationConflict();
        const member = await this.requireMember(context.tenantId, membershipId);
        if (isTenantAdmin(member)) await this.assertAnotherActiveAdmin(context.tenantId, membershipId);
        const now = new Date();

        await this.prisma.$transaction(async (transaction) => {
            const removed = await transaction.tenantMembership.updateMany({
                where: { id: membershipId, tenantId: context.tenantId, deletedAt: null },
                data: {
                    status: MembershipStatus.DISABLED,
                    deletedAt: now,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (removed.count !== 1) throw this.memberNotFound();
            await transaction.authSession.updateMany({
                where: { tenantId: context.tenantId, membershipId, revokedAt: null },
                data: { revokedAt: now },
            });
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'MEMBER_REMOVED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'TENANT_MEMBERSHIP',
                    resourceId: membershipId,
                    requestId: context.requestId,
                    metadata: {
                        actorMembershipId: context.membershipId,
                        before: memberSnapshot(member),
                    },
                },
            });
        });
    }

    async replaceMemberRoles(
        membershipId: string,
        input: ReplaceTenantMemberRolesDto,
    ): Promise<TenantMemberResult> {
        const context = this.tenantContext.require();
        const member = await this.requireMember(context.tenantId, membershipId);
        const roleIds = [...new Set(input.roleIds)];
        const roles = roleIds.length === 0
            ? []
            : await this.prisma.role.findMany({
                where: { tenantId: context.tenantId, id: { in: roleIds }, deletedAt: null },
                select: { id: true, code: true, name: true },
            });
        if (roles.length !== roleIds.length) {
            throw new NotFoundException({ code: 'TENANT_ROLE_NOT_FOUND', message: '当前租户内角色不存在' });
        }
        const keepsAdminRole = roles.some((role) => role.code === TENANT_ADMIN_ROLE_CODE);
        if (isTenantAdmin(member) && !keepsAdminRole) {
            await this.assertAnotherActiveAdmin(context.tenantId, membershipId);
        }

        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.tenantMembership.updateMany({
                where: {
                    id: membershipId,
                    tenantId: context.tenantId,
                    version: input.version,
                    deletedAt: null,
                },
                data: { updatedBy: context.userId, version: { increment: 1 } },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.membershipRole.deleteMany({
                where: { tenantId: context.tenantId, membershipId },
            });
            if (roleIds.length > 0) {
                await transaction.membershipRole.createMany({
                    data: roleIds.map((roleId) => ({ tenantId: context.tenantId, membershipId, roleId })),
                });
            }
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'MEMBER_ROLES_REPLACED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'TENANT_MEMBERSHIP',
                    resourceId: membershipId,
                    requestId: context.requestId,
                    metadata: {
                        actorMembershipId: context.membershipId,
                        beforeRoleIds: member.membershipRoles.map((assignment) => assignment.roleId),
                        afterRoleIds: roleIds,
                    },
                },
            });
        });
        return this.getMember(membershipId);
    }

    private async requireMember(tenantId: string, membershipId: string): Promise<MemberWithRoles> {
        const member = await this.prisma.tenantMembership.findFirst({
            where: { id: membershipId, tenantId, deletedAt: null },
            include: memberInclude,
        });
        if (!member) throw this.memberNotFound();
        return member;
    }

    private async requireActiveDepartment(tenantId: string, departmentId: string): Promise<void> {
        const department = await this.prisma.department.findFirst({
            where: { id: departmentId, tenantId, deletedAt: null },
            select: { id: true, status: true },
        });
        if (!department) {
            throw new NotFoundException({ code: 'TENANT_DEPARTMENT_NOT_FOUND', message: '当前租户内部门不存在' });
        }
        if (department.status !== DepartmentStatus.ACTIVE) {
            throw new BadRequestException({ code: 'DEPARTMENT_DISABLED', message: '不能向已停用部门分配成员' });
        }
    }

    private async assertAnotherActiveAdmin(tenantId: string, excludedMembershipId: string): Promise<void> {
        const otherAdminCount = await this.prisma.tenantMembership.count({
            where: {
                tenantId,
                id: { not: excludedMembershipId },
                status: MembershipStatus.ACTIVE,
                deletedAt: null,
                membershipRoles: {
                    some: { role: { code: TENANT_ADMIN_ROLE_CODE, deletedAt: null } },
                },
            },
        });
        if (otherAdminCount === 0) {
            throw new ConflictException({
                code: 'TENANT_LAST_ADMIN',
                message: '不能停用、移除或取消最后一名有效租户管理员',
            });
        }
    }

    private tenantNotFound(): NotFoundException {
        return new NotFoundException({ code: 'TENANT_NOT_FOUND', message: '当前租户不存在' });
    }

    private memberNotFound(): NotFoundException {
        return new NotFoundException({ code: 'TENANT_MEMBER_NOT_FOUND', message: '当前租户内成员不存在' });
    }

    private selfOperationConflict(): ConflictException {
        return new ConflictException({
            code: 'TENANT_MEMBER_SELF_OPERATION',
            message: '不能停用或移除当前登录成员',
        });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }
}

function toTenantResult(tenant: {
    id: string;
    code: string;
    name: string;
    status: TenantResult['status'];
    version: number;
    createdAt: Date;
    updatedAt: Date;
}): TenantResult {
    return {
        id: tenant.id,
        code: tenant.code,
        name: tenant.name,
        status: tenant.status,
        version: tenant.version,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
    };
}

function toMemberResult(member: MemberWithRoles): TenantMemberResult {
    return {
        id: member.id,
        account: member.account,
        user: {
            id: member.user.id,
            displayName: member.displayName ?? member.user.displayName,
        },
        departmentId: member.departmentId,
        status: member.status,
        roles: member.membershipRoles
            .map((assignment) => ({
                id: assignment.role.id,
                code: assignment.role.code,
                name: assignment.role.name,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        joinedAt: member.joinedAt,
        version: member.version,
    };
}

function isTenantAdmin(member: MemberWithRoles): boolean {
    return member.membershipRoles.some((assignment) => assignment.role.code === TENANT_ADMIN_ROLE_CODE);
}

function memberSnapshot(member: MemberWithRoles): Prisma.InputJsonObject {
    return {
        membershipId: member.id,
        account: member.account,
        displayName: member.displayName,
        departmentId: member.departmentId,
        status: member.status,
        roleIds: member.membershipRoles.map((assignment) => assignment.roleId),
        version: member.version,
    };
}
