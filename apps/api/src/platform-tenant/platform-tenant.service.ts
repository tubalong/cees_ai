import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    AuditOutcome,
    DataScope,
    MembershipStatus,
    Prisma,
    TenantInvitationStatus,
    TenantStatus,
    UserStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { generateAccountFromDisplayName, normalizeAccount } from '../auth/account';
import { parseDurationSeconds } from '../auth/auth.config';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuthenticatedPrincipal } from '../platform-auth/platform-auth.types';
import { PlatformRequestMetadata } from '../platform-auth/platform-auth.service';
import { TENANT_ADMIN_ROLE_CODE, TENANT_PERMISSION_DEFINITIONS } from '../rbac/permission-catalog';
import {
    TenantInvitationCreatedResult,
    TenantInvitationResult,
} from '../tenant-invitation/tenant-invitation.types';
import {
    AssignPlatformTenantAdministratorDto,
    CreatePlatformTenantDto,
    ListPlatformAuditEventsQueryDto,
    ListPlatformTenantsQueryDto,
    SuspendPlatformTenantDto,
    UpdatePlatformTenantDto,
    VersionDto,
} from './dto';
import {
    PlatformAuditEventListResult,
    PlatformAuditEventResult,
    PlatformTenantAdministratorAssignmentResult,
    PlatformTenantAdministratorResult,
    PlatformTenantListResult,
    PlatformTenantProvisioningResult,
    PlatformTenantResult,
} from './platform-tenant.types';

const administratorMemberInclude = {
    user: true,
    membershipRoles: {
        where: { role: { deletedAt: null } },
        include: { role: true },
    },
} satisfies Prisma.TenantMembershipInclude;

type AdministratorMember = Prisma.TenantMembershipGetPayload<{ include: typeof administratorMemberInclude }>;
type InvitationWithRoles = Prisma.TenantInvitationGetPayload<{ include: { roles: true } }>;

@Injectable()
export class PlatformTenantService {
    constructor(private readonly prisma: PrismaService) { }

    async listTenants(query: ListPlatformTenantsQueryDto): Promise<PlatformTenantListResult> {
        if (query.cursor) {
            const cursorExists = await this.prisma.tenant.findFirst({
                where: { id: query.cursor, deletedAt: null },
                select: { id: true },
            });
            if (!cursorExists) throw this.invalidCursor();
        }
        const keyword = query.keyword?.trim();
        const tenants = await this.prisma.tenant.findMany({
            where: {
                deletedAt: null,
                status: query.status,
                OR: keyword
                    ? [
                        { code: { contains: keyword.toLowerCase(), mode: 'insensitive' } },
                        { name: { contains: keyword, mode: 'insensitive' } },
                    ]
                    : undefined,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = tenants.length > query.limit;
        const page = hasNextPage ? tenants.slice(0, query.limit) : tenants;
        return {
            items: await Promise.all(page.map((tenant) => this.toTenantResult(tenant))),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async getTenant(tenantId: string): Promise<PlatformTenantResult> {
        return this.toTenantResult(await this.requireTenant(tenantId));
    }

    async createTenant(
        input: CreatePlatformTenantDto,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<PlatformTenantProvisioningResult> {
        const code = input.code.trim().toLowerCase();
        const name = input.name.trim();
        const displayName = input.initialAdministrator.displayName.trim();
        const account = normalizeAccount(
            input.initialAdministrator.account ?? generateAccountFromDisplayName(displayName),
        );

        const existingTenant = await this.prisma.tenant.findUnique({ where: { code } });
        if (existingTenant) throw this.tenantCodeConflict();

        let result: { tenantId: string; assignment: PlatformTenantAdministratorAssignmentResult };
        try {
            result = await this.prisma.$transaction(async (transaction) => {
                const tenant = await transaction.tenant.create({
                    data: { code, name, status: TenantStatus.PENDING_ACTIVATION },
                });
                const administratorRole = await this.ensureTenantAdministratorRole(transaction, tenant.id, principal.id);
                const invitation = await this.createInvitation(
                    transaction,
                    tenant.id,
                    account,
                    displayName,
                    [administratorRole.id],
                    principal.id,
                    true,
                );
                const assignment: PlatformTenantAdministratorAssignmentResult = {
                    status: 'INVITED',
                    invitation: toInvitationResult(invitation.record),
                    invitationToken: invitation.token,
                };

                await transaction.platformAuditLog.create({
                    data: {
                        actorUserId: principal.id,
                        actorPlatformAdministratorId: principal.platformAdministratorId,
                        action: 'TENANT_CREATED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'TENANT',
                        resourceId: tenant.id,
                        requestId: metadata.requestId,
                        ipAddress: metadata.ipAddress,
                        userAgent: metadata.userAgent,
                        metadata: { code, name, initialAdministratorAccount: account, assignmentStatus: assignment.status },
                    },
                });
                await transaction.auditLog.create({
                    data: {
                        tenantId: tenant.id,
                        actorUserId: principal.id,
                        action: 'TENANT_CREATED_BY_PLATFORM',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'TENANT',
                        resourceId: tenant.id,
                        requestId: metadata.requestId,
                        ipAddress: metadata.ipAddress,
                        userAgent: metadata.userAgent,
                        metadata: { platformAdministratorId: principal.platformAdministratorId, assignmentStatus: assignment.status },
                    },
                });
                return { tenantId: tenant.id, assignment };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.tenantCodeConflict();
            throw error;
        }

        return { tenant: await this.getTenant(result.tenantId), administratorAssignment: result.assignment };
    }

    async updateTenant(
        tenantId: string,
        input: UpdatePlatformTenantDto,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<PlatformTenantResult> {
        const current = await this.requireTenant(tenantId);
        const name = input.name.trim();
        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.tenant.updateMany({
                where: { id: tenantId, version: input.version, deletedAt: null },
                data: { name, version: { increment: 1 } },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await this.writeTenantMutationAudit(transaction, principal, metadata, tenantId, 'TENANT_UPDATED', {
                before: { name: current.name, version: current.version },
                after: { name, version: current.version + 1 },
            });
        });
        return this.getTenant(tenantId);
    }

    async suspendTenant(
        tenantId: string,
        input: SuspendPlatformTenantDto,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<PlatformTenantResult> {
        const current = await this.requireTenant(tenantId);
        if (current.status === TenantStatus.SUSPENDED) return this.getTenant(tenantId);
        const now = new Date();
        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.tenant.updateMany({
                where: { id: tenantId, version: input.version, deletedAt: null },
                data: { status: TenantStatus.SUSPENDED, version: { increment: 1 } },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await transaction.authSession.updateMany({
                where: { tenantId, revokedAt: null },
                data: { revokedAt: now },
            });
            await this.writeTenantMutationAudit(transaction, principal, metadata, tenantId, 'TENANT_SUSPENDED', {
                reason: input.reason.trim(),
                beforeStatus: current.status,
            });
        });
        return this.getTenant(tenantId);
    }

    async restoreTenant(
        tenantId: string,
        input: VersionDto,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<PlatformTenantResult> {
        const current = await this.requireTenant(tenantId);
        if (current.status === TenantStatus.ACTIVE) return this.getTenant(tenantId);
        const administratorCount = await this.countActiveAdministrators(tenantId);
        if (administratorCount === 0) {
            throw new ConflictException({
                code: 'PLATFORM_TENANT_ADMIN_REQUIRED',
                message: '租户至少需要一名有效管理员才能恢复',
            });
        }
        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.tenant.updateMany({
                where: { id: tenantId, version: input.version, deletedAt: null },
                data: { status: TenantStatus.ACTIVE, version: { increment: 1 } },
            });
            if (updated.count !== 1) throw this.versionConflict();
            await this.writeTenantMutationAudit(transaction, principal, metadata, tenantId, 'TENANT_RESTORED', {
                beforeStatus: current.status,
            });
        });
        return this.getTenant(tenantId);
    }

    async listAdministrators(tenantId: string): Promise<{ items: PlatformTenantAdministratorResult[] }> {
        await this.requireTenant(tenantId);
        const members = await this.prisma.tenantMembership.findMany({
            where: {
                tenantId,
                deletedAt: null,
                membershipRoles: { some: { role: { code: TENANT_ADMIN_ROLE_CODE, deletedAt: null } } },
            },
            include: administratorMemberInclude,
            orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        });
        return { items: members.map(toAdministratorResult) };
    }

    async assignAdministrator(
        tenantId: string,
        input: AssignPlatformTenantAdministratorDto,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<PlatformTenantAdministratorAssignmentResult> {
        const tenant = await this.requireTenant(tenantId);
        const account = normalizeAccount(input.account);
        const displayName = input.displayName?.trim();

        return this.prisma.$transaction(async (transaction) => {
            const administratorRole = await this.ensureTenantAdministratorRole(transaction, tenantId, principal.id);
            const membership = await transaction.tenantMembership.findUnique({
                where: { tenantId_normalizedAccount: { tenantId, normalizedAccount: account } },
                include: administratorMemberInclude,
            });

            if (membership) {
                if (membership.deletedAt || membership.user.deletedAt || membership.user.status === UserStatus.DISABLED) {
                    throw this.userUnavailable();
                }
                const nextStatus = membership.passwordHash
                    ? MembershipStatus.ACTIVE
                    : MembershipStatus.PENDING_ACTIVATION;
                const updatedMembership = await transaction.tenantMembership.update({
                    where: { id: membership.id },
                    data: {
                        displayName,
                        status: nextStatus,
                        deletedAt: null,
                        updatedBy: principal.id,
                        version: { increment: 1 },
                    },
                    include: administratorMemberInclude,
                });
                await transaction.membershipRole.upsert({
                    where: {
                        tenantId_membershipId_roleId: {
                            tenantId,
                            membershipId: updatedMembership.id,
                            roleId: administratorRole.id,
                        },
                    },
                    update: {},
                    create: { tenantId, membershipId: updatedMembership.id, roleId: administratorRole.id },
                });
                await transaction.tenantInvitation.updateMany({
                    where: { tenantId, normalizedAccount: account, status: TenantInvitationStatus.PENDING },
                    data: { status: TenantInvitationStatus.REVOKED, revokedAt: new Date() },
                });
                if (nextStatus === MembershipStatus.ACTIVE && tenant.status === TenantStatus.PENDING_ACTIVATION) {
                    await transaction.tenant.update({
                        where: { id: tenantId },
                        data: { status: TenantStatus.ACTIVE, version: { increment: 1 } },
                    });
                }
                await this.writeTenantMutationAudit(transaction, principal, metadata, tenantId, 'TENANT_ADMIN_ASSIGNED', {
                    membershipId: updatedMembership.id,
                    account,
                });
                return { status: 'ASSIGNED', administrator: toAdministratorResult(updatedMembership) };
            }

            const pendingInvitation = await transaction.tenantInvitation.findFirst({
                where: {
                    tenantId,
                    normalizedAccount: account,
                    status: TenantInvitationStatus.PENDING,
                    expiresAt: { gt: new Date() },
                },
            });
            if (pendingInvitation) throw this.invitationConflict();
            const isInitialAdministrator = await this.countActiveAdministrators(tenantId, transaction) === 0;
            const invitation = await this.createInvitation(
                transaction,
                tenantId,
                account,
                displayName ?? account,
                [administratorRole.id],
                principal.id,
                isInitialAdministrator,
            );
            await this.writeTenantMutationAudit(transaction, principal, metadata, tenantId, 'TENANT_ADMIN_INVITED', {
                invitationId: invitation.record.id,
                account,
            });
            return {
                status: 'INVITED',
                invitation: toInvitationResult(invitation.record),
                invitationToken: invitation.token,
            };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async resetAdministratorCredential(
        tenantId: string,
        membershipId: string,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<TenantInvitationCreatedResult> {
        await this.requireTenant(tenantId);

        return this.prisma.$transaction(async (transaction) => {
            const member = await transaction.tenantMembership.findFirst({
                where: { id: membershipId, tenantId, deletedAt: null },
                include: administratorMemberInclude,
            });
            if (!member || member.user.deletedAt || member.user.status === UserStatus.DISABLED) {
                throw this.administratorNotFound();
            }
            if (!member.membershipRoles.some((assignment) => assignment.role.code === TENANT_ADMIN_ROLE_CODE)) {
                throw this.administratorNotFound();
            }

            const now = new Date();
            const roleIds = member.membershipRoles.map((assignment) => assignment.roleId);
            await transaction.authSession.updateMany({
                where: { tenantId, membershipId, revokedAt: null },
                data: { revokedAt: now },
            });
            await transaction.tenantInvitation.updateMany({
                where: { tenantId, normalizedAccount: member.normalizedAccount, status: TenantInvitationStatus.PENDING },
                data: { status: TenantInvitationStatus.REVOKED, revokedAt: now },
            });
            await transaction.tenantMembership.update({
                where: { id: membershipId },
                data: {
                    status: MembershipStatus.PENDING_ACTIVATION,
                    passwordHash: null,
                    failedLoginCount: 0,
                    lockedUntil: null,
                    updatedBy: principal.id,
                    version: { increment: 1 },
                },
            });

            const invitation = await this.createInvitation(
                transaction,
                tenantId,
                member.account,
                member.displayName ?? member.user.displayName,
                roleIds,
                principal.id,
                false,
                membershipId,
            );
            await this.writeTenantMutationAudit(
                transaction,
                principal,
                metadata,
                tenantId,
                'TENANT_ADMIN_CREDENTIAL_RESET',
                {
                    membershipId,
                    account: member.account,
                    activationExpiresAt: invitation.record.expiresAt.toISOString(),
                },
                'TENANT_MEMBERSHIP',
                membershipId,
            );
            return { invitation: toInvitationResult(invitation.record), invitationToken: invitation.token };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async removeAdministrator(
        tenantId: string,
        membershipId: string,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
    ): Promise<void> {
        await this.prisma.$transaction(async (transaction) => {
            const tenant = await transaction.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
            if (!tenant) throw new NotFoundException({ code: 'PLATFORM_TENANT_NOT_FOUND', message: '租户不存在' });
            const member = await transaction.tenantMembership.findFirst({
                where: { id: membershipId, tenantId, deletedAt: null },
                include: {
                    user: true,
                    membershipRoles: { include: { role: true } },
                },
            });
            if (!member) throw this.administratorNotFound();
            const administratorRole = member.membershipRoles.find(
                (assignment) => assignment.role.code === TENANT_ADMIN_ROLE_CODE,
            );
            if (!administratorRole) throw this.administratorNotFound();
            if (member.status === MembershipStatus.ACTIVE && await this.countActiveAdministrators(tenantId, transaction) <= 1) {
                throw this.lastAdministratorConflict();
            }
            await transaction.membershipRole.deleteMany({
                where: { tenantId, membershipId, roleId: administratorRole.roleId },
            });
            await this.writeTenantMutationAudit(transaction, principal, metadata, tenantId, 'TENANT_ADMIN_REMOVED', {
                membershipId,
                account: member.account,
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    async listAuditEvents(query: ListPlatformAuditEventsQueryDto): Promise<PlatformAuditEventListResult> {
        if (query.cursor) {
            const cursorExists = await this.prisma.platformAuditLog.findUnique({
                where: { id: query.cursor },
                select: { id: true },
            });
            if (!cursorExists) throw this.invalidCursor();
        }
        const events = await this.prisma.platformAuditLog.findMany({
            where: { action: query.action?.trim() || undefined, outcome: query.outcome },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = events.length > query.limit;
        const page = hasNextPage ? events.slice(0, query.limit) : events;
        return {
            items: page.map(toPlatformAuditResult),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async getAuditEvent(auditEventId: string): Promise<PlatformAuditEventResult> {
        const event = await this.prisma.platformAuditLog.findUnique({ where: { id: auditEventId } });
        if (!event) {
            throw new NotFoundException({
                code: 'PLATFORM_AUDIT_EVENT_NOT_FOUND',
                message: '平台审计事件不存在',
            });
        }
        return toPlatformAuditResult(event);
    }

    private async ensureTenantAdministratorRole(
        transaction: Prisma.TransactionClient,
        tenantId: string,
        actorUserId: string,
    ): Promise<{ id: string }> {
        const permissionIds: string[] = [];
        for (const [code, name] of TENANT_PERMISSION_DEFINITIONS) {
            const permission = await transaction.permission.upsert({
                where: { code },
                update: { name },
                create: { code, name },
                select: { id: true },
            });
            permissionIds.push(permission.id);
        }
        const role = await transaction.role.upsert({
            where: { tenantId_code: { tenantId, code: TENANT_ADMIN_ROLE_CODE } },
            update: {
                name: '租户管理员',
                description: '租户内置管理员角色',
                isSystem: true,
                dataScope: DataScope.TENANT,
                deletedAt: null,
                updatedBy: actorUserId,
            },
            create: {
                tenantId,
                code: TENANT_ADMIN_ROLE_CODE,
                name: '租户管理员',
                description: '租户内置管理员角色',
                isSystem: true,
                dataScope: DataScope.TENANT,
                createdBy: actorUserId,
            },
            select: { id: true },
        });
        await transaction.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ tenantId, roleId: role.id, permissionId })),
            skipDuplicates: true,
        });
        return role;
    }

    private async createInvitation(
        transaction: Prisma.TransactionClient,
        tenantId: string,
        account: string,
        displayName: string,
        roleIds: string[],
        invitedByUserId: string,
        isInitialAdministrator: boolean,
        targetMembershipId?: string,
    ): Promise<{ record: InvitationWithRoles; token: string }> {
        const token = randomBytes(48).toString('base64url');
        const expiresIn = parseDurationSeconds(process.env.TENANT_INVITATION_TTL, 24 * 60 * 60);
        const record = await transaction.tenantInvitation.create({
            data: {
                tenantId,
                account,
                normalizedAccount: account,
                displayName,
                targetMembershipId,
                tokenHash: hashToken(token),
                isInitialAdministrator,
                expiresAt: new Date(Date.now() + expiresIn * 1000),
                invitedByUserId,
                roles: { create: roleIds.map((roleId) => ({ roleId })) },
            },
            include: { roles: true },
        });
        return { record, token };
    }

    private async writeTenantMutationAudit(
        transaction: Prisma.TransactionClient,
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
        tenantId: string,
        action: string,
        details: Record<string, unknown>,
        resourceType = 'TENANT',
        resourceId = tenantId,
    ): Promise<void> {
        await transaction.platformAuditLog.create({
            data: {
                actorUserId: principal.id,
                actorPlatformAdministratorId: principal.platformAdministratorId,
                action,
                outcome: AuditOutcome.SUCCESS,
                resourceType,
                resourceId,
                requestId: metadata.requestId,
                ipAddress: metadata.ipAddress,
                userAgent: metadata.userAgent,
                metadata: details as Prisma.InputJsonValue,
            },
        });
        await transaction.auditLog.create({
            data: {
                tenantId,
                actorUserId: principal.id,
                action: `${action}_BY_PLATFORM`,
                outcome: AuditOutcome.SUCCESS,
                resourceType,
                resourceId,
                requestId: metadata.requestId,
                ipAddress: metadata.ipAddress,
                userAgent: metadata.userAgent,
                metadata: {
                    platformAdministratorId: principal.platformAdministratorId,
                    ...details,
                } as Prisma.InputJsonValue,
            },
        });
    }

    private async requireTenant(tenantId: string) {
        const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
        if (!tenant) throw new NotFoundException({ code: 'PLATFORM_TENANT_NOT_FOUND', message: '租户不存在' });
        return tenant;
    }

    private async toTenantResult(tenant: {
        id: string;
        code: string;
        name: string;
        status: TenantStatus;
        version: number;
        createdAt: Date;
        updatedAt: Date;
    }): Promise<PlatformTenantResult> {
        const [activeAdministratorCount, pendingInvitationCount] = await Promise.all([
            this.countActiveAdministrators(tenant.id),
            this.prisma.tenantInvitation.count({
                where: {
                    tenantId: tenant.id,
                    status: TenantInvitationStatus.PENDING,
                    expiresAt: { gt: new Date() },
                },
            }),
        ]);
        return { ...tenant, activeAdministratorCount, pendingInvitationCount };
    }

    private countActiveAdministrators(
        tenantId: string,
        client: PrismaService | Prisma.TransactionClient = this.prisma,
    ): Promise<number> {
        return client.tenantMembership.count({
            where: {
                tenantId,
                status: MembershipStatus.ACTIVE,
                deletedAt: null,
                membershipRoles: {
                    some: { role: { code: TENANT_ADMIN_ROLE_CODE, deletedAt: null } },
                },
            },
        });
    }

    private invalidCursor(): BadRequestException {
        return new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
    }

    private tenantCodeConflict(): ConflictException {
        return new ConflictException({ code: 'PLATFORM_TENANT_CODE_CONFLICT', message: '租户编码已存在' });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }

    private userUnavailable(): ConflictException {
        return new ConflictException({ code: 'PLATFORM_TENANT_ADMIN_USER_UNAVAILABLE', message: '管理员用户不可用' });
    }

    private invitationConflict(): ConflictException {
        return new ConflictException({ code: 'TENANT_INVITATION_CONFLICT', message: '该账号已存在有效邀请' });
    }

    private administratorNotFound(): NotFoundException {
        return new NotFoundException({ code: 'PLATFORM_TENANT_ADMIN_NOT_FOUND', message: '租户管理员不存在' });
    }

    private lastAdministratorConflict(): ConflictException {
        return new ConflictException({ code: 'TENANT_LAST_ADMIN', message: '不能取消最后一名有效租户管理员' });
    }
}

function toAdministratorResult(member: AdministratorMember): PlatformTenantAdministratorResult {
    return {
        membershipId: member.id,
        account: member.account,
        user: {
            id: member.user.id,
            displayName: member.displayName ?? member.user.displayName,
        },
        status: member.status,
        joinedAt: member.joinedAt,
    };
}

function toInvitationResult(invitation: InvitationWithRoles): TenantInvitationResult {
    return {
        id: invitation.id,
        tenantId: invitation.tenantId,
        account: invitation.account,
        displayName: invitation.displayName,
        status: effectiveInvitationStatus(invitation.status, invitation.expiresAt),
        isInitialAdministrator: invitation.isInitialAdministrator,
        roleIds: invitation.roles.map((assignment) => assignment.roleId),
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
    };
}

function effectiveInvitationStatus(status: TenantInvitationStatus, expiresAt: Date): TenantInvitationStatus {
    return status === TenantInvitationStatus.PENDING && expiresAt <= new Date()
        ? TenantInvitationStatus.EXPIRED
        : status;
}

function toPlatformAuditResult(event: {
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
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
}): PlatformAuditEventResult {
    return {
        id: event.id,
        action: event.action,
        outcome: event.outcome,
        actorUserId: event.actorUserId,
        actorPlatformAdministratorId: event.actorPlatformAdministratorId,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        requestId: event.requestId,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: event.metadata,
        createdAt: event.createdAt,
    };
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
