import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import {
    AuditOutcome,
    MembershipStatus,
    Prisma,
    TenantInvitationStatus,
    TenantStatus,
    UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import {
    appendAccountSuffix,
    generateAccountFromDisplayName,
    normalizeAccount,
} from '../auth/account';
import { parseDurationSeconds } from '../auth/auth.config';
import { PrismaService } from '../database/prisma.service';
import { TENANT_ADMIN_ROLE_CODE } from '../rbac/permission-catalog';
import { TenantContext } from '../tenant/tenant-context';
import { TenantMemberResult } from '../tenant/tenant.types';
import { AcceptTenantInvitationDto, CreateTenantInvitationDto, ListTenantInvitationsQueryDto } from './dto';
import {
    AccountSuggestionResult,
    TenantInvitationAcceptanceResult,
    TenantInvitationCreatedResult,
    TenantInvitationListResult,
    TenantInvitationResult,
} from './tenant-invitation.types';

const invitationInclude = { roles: true } satisfies Prisma.TenantInvitationInclude;
const memberInclude = {
    user: true,
    membershipRoles: {
        where: { role: { deletedAt: null } },
        include: { role: true },
    },
} satisfies Prisma.TenantMembershipInclude;

type InvitationWithRoles = Prisma.TenantInvitationGetPayload<{ include: typeof invitationInclude }>;
type MemberWithRoles = Prisma.TenantMembershipGetPayload<{ include: typeof memberInclude }>;

export interface InvitationRequestMetadata {
    requestId: string;
    ipAddress?: string;
    userAgent?: string;
}

@Injectable()
export class TenantInvitationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async listInvitations(query: ListTenantInvitationsQueryDto): Promise<TenantInvitationListResult> {
        const { tenantId } = this.tenantContext.require();
        const now = new Date();
        await this.prisma.tenantInvitation.updateMany({
            where: { tenantId, status: TenantInvitationStatus.PENDING, expiresAt: { lte: now } },
            data: { status: TenantInvitationStatus.EXPIRED },
        });
        if (query.cursor) {
            const cursorExists = await this.prisma.tenantInvitation.findFirst({
                where: { id: query.cursor, tenantId },
                select: { id: true },
            });
            if (!cursorExists) throw this.invalidCursor();
        }
        const invitations = await this.prisma.tenantInvitation.findMany({
            where: { tenantId, status: query.status },
            include: invitationInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = invitations.length > query.limit;
        const page = hasNextPage ? invitations.slice(0, query.limit) : invitations;
        return {
            items: page.map(toInvitationResult),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async suggestAccount(displayName: string): Promise<AccountSuggestionResult> {
        const { tenantId } = this.tenantContext.require();
        return this.buildAccountSuggestion(tenantId, displayName);
    }

    async createInvitation(input: CreateTenantInvitationDto): Promise<TenantInvitationCreatedResult> {
        const context = this.tenantContext.require();
        const displayName = input.displayName.trim();
        const account = normalizeAccount(input.account ?? generateAccountFromDisplayName(displayName));
        const roleIds = [...new Set(input.roleIds)];

        await this.assertAccountAvailable(context.tenantId, account);
        await this.assertRolesExist(context.tenantId, roleIds);

        const now = new Date();
        const token = randomBytes(48).toString('base64url');
        const expiresIn = parseDurationSeconds(process.env.TENANT_INVITATION_TTL, 24 * 60 * 60);
        const invitation = await this.prisma.$transaction(async (transaction) => {
            const created = await transaction.tenantInvitation.create({
                data: {
                    tenantId: context.tenantId,
                    account,
                    normalizedAccount: account,
                    displayName,
                    tokenHash: hashToken(token),
                    expiresAt: new Date(now.getTime() + expiresIn * 1000),
                    invitedByUserId: context.userId,
                    roles: { create: roleIds.map((roleId) => ({ roleId })) },
                },
                include: invitationInclude,
            });
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'TENANT_ACCOUNT_INVITATION_CREATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'TENANT_INVITATION',
                    resourceId: created.id,
                    requestId: context.requestId,
                    metadata: { account, roleIds, expiresAt: created.expiresAt.toISOString() },
                },
            });
            return created;
        });
        return { invitation: toInvitationResult(invitation), invitationToken: token };
    }

    async resetCredential(membershipId: string): Promise<TenantInvitationCreatedResult> {
        const context = this.tenantContext.require();
        if (membershipId === context.membershipId) {
            throw new ConflictException({
                code: 'TENANT_MEMBER_SELF_CREDENTIAL_RESET',
                message: '不能重置当前登录成员自己的凭证',
            });
        }
        const member = await this.prisma.tenantMembership.findFirst({
            where: { id: membershipId, tenantId: context.tenantId, deletedAt: null },
            include: memberInclude,
        });
        if (!member) throw new NotFoundException({ code: 'TENANT_MEMBER_NOT_FOUND', message: '当前租户内成员不存在' });
        if (member.membershipRoles.some((assignment) => assignment.role.code === TENANT_ADMIN_ROLE_CODE)) {
            await this.assertAnotherActiveAdmin(context.tenantId, member.id);
        }

        const now = new Date();
        const token = randomBytes(48).toString('base64url');
        const expiresIn = parseDurationSeconds(process.env.TENANT_INVITATION_TTL, 24 * 60 * 60);
        const roleIds = member.membershipRoles.map((assignment) => assignment.roleId);
        const invitation = await this.prisma.$transaction(async (transaction) => {
            await transaction.authSession.updateMany({
                where: { tenantId: context.tenantId, membershipId, revokedAt: null },
                data: { revokedAt: now },
            });
            await transaction.tenantInvitation.updateMany({
                where: {
                    tenantId: context.tenantId,
                    normalizedAccount: member.normalizedAccount,
                    status: TenantInvitationStatus.PENDING,
                },
                data: { status: TenantInvitationStatus.REVOKED, revokedAt: now },
            });
            await transaction.tenantMembership.update({
                where: { id: member.id },
                data: {
                    status: MembershipStatus.PENDING_ACTIVATION,
                    passwordHash: null,
                    failedLoginCount: 0,
                    lockedUntil: null,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            const created = await transaction.tenantInvitation.create({
                data: {
                    tenantId: context.tenantId,
                    account: member.account,
                    normalizedAccount: member.normalizedAccount,
                    displayName: member.displayName ?? member.user.displayName,
                    targetMembershipId: member.id,
                    tokenHash: hashToken(token),
                    expiresAt: new Date(now.getTime() + expiresIn * 1000),
                    invitedByUserId: context.userId,
                    roles: { create: roleIds.map((roleId) => ({ roleId })) },
                },
                include: invitationInclude,
            });
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'TENANT_MEMBER_CREDENTIAL_RESET',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'TENANT_MEMBERSHIP',
                    resourceId: member.id,
                    requestId: context.requestId,
                    metadata: { account: member.account, activationExpiresAt: created.expiresAt.toISOString() },
                },
            });
            return created;
        });
        return { invitation: toInvitationResult(invitation), invitationToken: token };
    }

    async revokeInvitation(invitationId: string): Promise<void> {
        const context = this.tenantContext.require();
        const invitation = await this.prisma.tenantInvitation.findFirst({
            where: { id: invitationId, tenantId: context.tenantId },
        });
        if (!invitation) throw this.invitationNotFound();
        if (invitation.status !== TenantInvitationStatus.PENDING) {
            throw new ConflictException({ code: 'TENANT_INVITATION_NOT_PENDING', message: '只有待激活邀请可以撤销' });
        }
        const now = new Date();
        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.tenantInvitation.updateMany({
                where: { id: invitationId, tenantId: context.tenantId, status: TenantInvitationStatus.PENDING },
                data: { status: TenantInvitationStatus.REVOKED, revokedAt: now },
            });
            if (updated.count !== 1) throw this.invitationNotFound();
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'TENANT_ACCOUNT_INVITATION_REVOKED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'TENANT_INVITATION',
                    resourceId: invitationId,
                    requestId: context.requestId,
                    metadata: { account: invitation.account },
                },
            });
        });
    }

    async acceptInvitation(
        input: AcceptTenantInvitationDto,
        metadata: InvitationRequestMetadata,
    ): Promise<TenantInvitationAcceptanceResult> {
        const tokenHash = hashToken(input.invitationToken);
        const tenantCode = input.tenantCode.trim().toLowerCase();
        const account = normalizeAccount(input.account);
        const invitation = await this.prisma.tenantInvitation.findUnique({
            where: { tokenHash },
            include: { tenant: true, roles: { include: { role: true } } },
        });
        const now = new Date();
        if (
            !invitation
            || invitation.status !== TenantInvitationStatus.PENDING
            || invitation.tenant.code !== tenantCode
            || invitation.normalizedAccount !== account
        ) throw this.invalidInvitation();
        if (invitation.expiresAt <= now) {
            await this.prisma.tenantInvitation.updateMany({
                where: { id: invitation.id, status: TenantInvitationStatus.PENDING },
                data: { status: TenantInvitationStatus.EXPIRED },
            });
            throw this.invalidInvitation();
        }
        if (invitation.tenant.deletedAt || invitation.tenant.status === TenantStatus.SUSPENDED) {
            throw this.invalidInvitation();
        }

        const passwordHash = await argon2.hash(input.password);
        const result = await this.prisma.$transaction(async (transaction) => {
            let userId: string;
            let membershipId: string;
            if (invitation.targetMembershipId) {
                const membership = await transaction.tenantMembership.findFirst({
                    where: {
                        id: invitation.targetMembershipId,
                        tenantId: invitation.tenantId,
                        normalizedAccount: account,
                        deletedAt: null,
                    },
                    include: { user: true },
                });
                if (!membership || membership.user.deletedAt || membership.user.status !== UserStatus.ACTIVE) {
                    throw this.invalidInvitation();
                }
                await transaction.tenantMembership.update({
                    where: { id: membership.id },
                    data: {
                        passwordHash,
                        status: MembershipStatus.ACTIVE,
                        failedLoginCount: 0,
                        lockedUntil: null,
                        updatedBy: membership.userId,
                        version: { increment: 1 },
                    },
                });
                userId = membership.userId;
                membershipId = membership.id;
            } else {
                const accountExists = await transaction.tenantMembership.findUnique({
                    where: {
                        tenantId_normalizedAccount: {
                            tenantId: invitation.tenantId,
                            normalizedAccount: account,
                        },
                    },
                });
                if (accountExists) throw this.accountConflict(account, []);
                const user = await transaction.user.create({
                    data: {
                        displayName: invitation.displayName,
                        status: UserStatus.ACTIVE,
                        createdBy: invitation.invitedByUserId,
                    },
                });
                const membership = await transaction.tenantMembership.create({
                    data: {
                        tenantId: invitation.tenantId,
                        userId: user.id,
                        account: invitation.account,
                        normalizedAccount: account,
                        passwordHash,
                        displayName: invitation.displayName,
                        status: MembershipStatus.ACTIVE,
                        createdBy: invitation.invitedByUserId,
                    },
                });
                if (invitation.roles.length > 0) {
                    await transaction.membershipRole.createMany({
                        data: invitation.roles.map((assignment) => ({
                            tenantId: invitation.tenantId,
                            membershipId: membership.id,
                            roleId: assignment.roleId,
                        })),
                        skipDuplicates: true,
                    });
                }
                userId = user.id;
                membershipId = membership.id;
            }

            const accepted = await transaction.tenantInvitation.updateMany({
                where: { id: invitation.id, status: TenantInvitationStatus.PENDING, expiresAt: { gt: now } },
                data: { status: TenantInvitationStatus.ACCEPTED, acceptedAt: now, acceptedByUserId: userId },
            });
            if (accepted.count !== 1) throw this.invalidInvitation();
            if (invitation.isInitialAdministrator && invitation.tenant.status === TenantStatus.PENDING_ACTIVATION) {
                await transaction.tenant.update({
                    where: { id: invitation.tenantId },
                    data: { status: TenantStatus.ACTIVE, version: { increment: 1 } },
                });
            }
            await transaction.auditLog.create({
                data: {
                    tenantId: invitation.tenantId,
                    actorUserId: userId,
                    actorMembershipId: membershipId,
                    action: invitation.targetMembershipId
                        ? 'TENANT_MEMBER_CREDENTIAL_ACTIVATED'
                        : 'TENANT_ACCOUNT_ACTIVATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'TENANT_MEMBERSHIP',
                    resourceId: membershipId,
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    metadata: {
                        account: invitation.account,
                        roleIds: invitation.roles.map((assignment) => assignment.roleId),
                        isInitialAdministrator: invitation.isInitialAdministrator,
                    },
                },
            });
            return { membershipId };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        const [tenant, membership] = await Promise.all([
            this.prisma.tenant.findUnique({ where: { id: invitation.tenantId } }),
            this.prisma.tenantMembership.findUnique({ where: { id: result.membershipId }, include: memberInclude }),
        ]);
        if (!tenant || !membership) throw this.invalidInvitation();
        return {
            tenant: { id: tenant.id, code: tenant.code, name: tenant.name },
            membership: toMemberResult(membership),
        };
    }

    private async buildAccountSuggestion(tenantId: string, displayName: string): Promise<AccountSuggestionResult> {
        const suggestedAccount = generateAccountFromDisplayName(displayName);
        const candidates = [suggestedAccount];
        for (let suffix = 2; candidates.length < 50; suffix += 1) {
            candidates.push(appendAccountSuffix(suggestedAccount, suffix));
        }
        const [memberships, invitations] = await Promise.all([
            this.prisma.tenantMembership.findMany({
                where: { tenantId, normalizedAccount: { in: candidates } },
                select: { normalizedAccount: true },
            }),
            this.prisma.tenantInvitation.findMany({
                where: {
                    tenantId,
                    normalizedAccount: { in: candidates },
                    status: TenantInvitationStatus.PENDING,
                    expiresAt: { gt: new Date() },
                },
                select: { normalizedAccount: true },
            }),
        ]);
        const occupied = new Set([
            ...memberships.map((item) => item.normalizedAccount),
            ...invitations.map((item) => item.normalizedAccount),
        ]);
        return {
            suggestedAccount,
            available: !occupied.has(suggestedAccount),
            alternatives: candidates.slice(1).filter((candidate) => !occupied.has(candidate)).slice(0, 3),
        };
    }

    private async assertAccountAvailable(tenantId: string, account: string): Promise<void> {
        const now = new Date();
        await this.prisma.tenantInvitation.updateMany({
            where: {
                tenantId,
                normalizedAccount: account,
                status: TenantInvitationStatus.PENDING,
                expiresAt: { lte: now },
            },
            data: { status: TenantInvitationStatus.EXPIRED },
        });
        const [membership, pendingInvitation] = await Promise.all([
            this.prisma.tenantMembership.findUnique({
                where: { tenantId_normalizedAccount: { tenantId, normalizedAccount: account } },
                select: { id: true },
            }),
            this.prisma.tenantInvitation.findFirst({
                where: {
                    tenantId,
                    normalizedAccount: account,
                    status: TenantInvitationStatus.PENDING,
                    expiresAt: { gt: now },
                },
                select: { id: true },
            }),
        ]);
        if (membership || pendingInvitation) {
            const suggestion = await this.buildAccountSuggestion(tenantId, account);
            throw this.accountConflict(account, suggestion.alternatives);
        }
    }

    private async assertRolesExist(tenantId: string, roleIds: string[]): Promise<void> {
        if (roleIds.length === 0) return;
        const roles = await this.prisma.role.findMany({
            where: { tenantId, id: { in: roleIds }, deletedAt: null },
            select: { id: true },
        });
        if (roles.length !== roleIds.length) {
            throw new NotFoundException({ code: 'TENANT_ROLE_NOT_FOUND', message: '当前租户内角色不存在' });
        }
    }

    private async assertAnotherActiveAdmin(tenantId: string, excludedMembershipId: string): Promise<void> {
        const otherAdminCount = await this.prisma.tenantMembership.count({
            where: {
                tenantId,
                id: { not: excludedMembershipId },
                status: MembershipStatus.ACTIVE,
                deletedAt: null,
                membershipRoles: { some: { role: { code: TENANT_ADMIN_ROLE_CODE, deletedAt: null } } },
            },
        });
        if (otherAdminCount === 0) {
            throw new ConflictException({
                code: 'TENANT_LAST_ADMIN',
                message: '不能重置最后一名有效租户管理员的凭证',
            });
        }
    }

    private accountConflict(account: string, suggestions: string[]): ConflictException {
        return new ConflictException({
            code: 'TENANT_ACCOUNT_ALREADY_EXISTS',
            message: `账号 ${account} 已被当前租户使用，请由租户管理员指定其他账号`,
            suggestions,
        });
    }

    private invalidCursor(): BadRequestException {
        return new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
    }

    private invitationNotFound(): NotFoundException {
        return new NotFoundException({ code: 'TENANT_INVITATION_NOT_FOUND', message: '当前租户内邀请不存在' });
    }

    private invalidInvitation(): UnauthorizedException {
        return new UnauthorizedException({
            code: 'TENANT_INVITATION_INVALID',
            message: '激活令牌无效、已过期或已使用',
        });
    }
}

function toInvitationResult(invitation: InvitationWithRoles): TenantInvitationResult {
    return {
        id: invitation.id,
        tenantId: invitation.tenantId,
        account: invitation.account,
        displayName: invitation.displayName,
        status: invitation.status,
        isInitialAdministrator: invitation.isInitialAdministrator,
        roleIds: invitation.roles.map((assignment) => assignment.roleId),
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
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

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
