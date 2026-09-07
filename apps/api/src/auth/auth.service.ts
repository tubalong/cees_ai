import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditOutcome, MembershipStatus, TenantStatus, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { normalizeAccount } from './account';
import { jwtAudience, jwtIssuer, parseDurationSeconds, requireAccessTokenSecret } from './auth.config';
import {
    AccessTokenPayload,
    AuthContextResult,
    AuthenticatedPrincipal,
    AuthTokenPair,
    MeResult,
} from './auth.types';
import { LoginDto, RefreshTokenDto } from './dto';

export interface LoginRequestMetadata {
    requestId: string;
    ipAddress?: string;
    userAgent?: string;
}

export interface LoginResult extends AuthContextResult, AuthTokenPair { }

interface IssuedTokenPair extends AuthTokenPair {
    refreshTokenHash: string;
    refreshTokenExpiresAt: Date;
}

const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private readonly dummyPasswordHash = argon2.hash('cees-invalid-login-password');

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
    ) { }

    async login(input: LoginDto, metadata: LoginRequestMetadata): Promise<LoginResult> {
        const tenantCode = input.tenantCode.trim().toLowerCase();
        const account = normalizeAccount(input.account);
        const tenant = await this.prisma.tenant.findUnique({ where: { code: tenantCode } });

        if (!tenant || tenant.deletedAt || tenant.status !== TenantStatus.ACTIVE) {
            await this.verifyDummyPassword(input.password);
            throw this.invalidCredentials();
        }

        let membership = await this.prisma.tenantMembership.findUnique({
            where: { tenantId_normalizedAccount: { tenantId: tenant.id, normalizedAccount: account } },
            include: { user: true },
        });

        if (!membership || membership.deletedAt || membership.user.deletedAt) {
            await this.verifyDummyPassword(input.password);
            await this.writeLoginFailure(tenant.id, undefined, undefined, metadata, 'INVALID_CREDENTIALS');
            throw this.invalidCredentials();
        }

        const user = membership.user;
        if (membership.status !== MembershipStatus.ACTIVE) {
            await this.verifyPassword(membership.passwordHash, input.password);
            await this.writeLoginFailure(tenant.id, user.id, membership.id, metadata, 'MEMBERSHIP_UNAVAILABLE');
            throw this.invalidCredentials();
        }

        const now = new Date();
        if (user.status !== UserStatus.ACTIVE) {
            await this.verifyPassword(membership.passwordHash, input.password);
            await this.writeLoginFailure(tenant.id, user.id, membership.id, metadata, 'ACCOUNT_UNAVAILABLE');
            throw this.invalidCredentials();
        }

        if (membership.lockedUntil && membership.lockedUntil > now) {
            await this.verifyPassword(membership.passwordHash, input.password);
            await this.writeLoginFailure(tenant.id, user.id, membership.id, metadata, 'ACCOUNT_LOCKED');
            throw this.invalidCredentials();
        }

        if (membership.lockedUntil) {
            membership = await this.prisma.tenantMembership.update({
                where: { id: membership.id },
                data: { failedLoginCount: 0, lockedUntil: null },
                include: { user: true },
            });
        }

        const passwordValid = await this.verifyPassword(membership.passwordHash, input.password);
        if (!passwordValid) {
            await this.recordPasswordFailure(membership.id, membership.failedLoginCount, now);
            await this.writeLoginFailure(tenant.id, user.id, membership.id, metadata, 'INVALID_CREDENTIALS');
            throw this.invalidCredentials();
        }

        const { roles } = await this.resolveAuthorization(tenant.id, membership.id);
        const sessionId = randomUUID();
        const tokens = await this.issueTokenPair(user.id, tenant.id, membership.id, sessionId, now);

        await this.prisma.$transaction(async (transaction) => {
            await transaction.tenantMembership.update({
                where: { id: membership.id },
                data: {
                    failedLoginCount: 0,
                    lockedUntil: null,
                    lastLoginAt: now,
                },
            });
            await transaction.authSession.create({
                data: {
                    id: sessionId,
                    tenantId: tenant.id,
                    userId: user.id,
                    membershipId: membership.id,
                    refreshTokenHash: tokens.refreshTokenHash,
                    deviceName: input.deviceName,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    expiresAt: tokens.refreshTokenExpiresAt,
                },
            });
            await transaction.auditLog.create({
                data: {
                    tenantId: tenant.id,
                    actorUserId: user.id,
                    actorMembershipId: membership.id,
                    action: 'AUTH_LOGIN_SUCCEEDED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'AUTH_SESSION',
                    resourceId: sessionId,
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    metadata: { membershipId: membership.id, deviceName: input.deviceName ?? null },
                },
            });
        });

        return {
            ...toPublicTokenPair(tokens),
            user: {
                id: user.id,
                displayName: membership.displayName ?? user.displayName,
            },
            tenant: { id: tenant.id, code: tenant.code, name: tenant.name },
            membership: { id: membership.id, account: membership.account, status: 'ACTIVE', roles },
        };
    }

    async refresh(input: RefreshTokenDto, metadata: LoginRequestMetadata): Promise<AuthTokenPair> {
        const currentTokenHash = hashRefreshToken(input.refreshToken);
        const session = await this.prisma.authSession.findUnique({
            where: { refreshTokenHash: currentTokenHash },
        });
        const now = new Date();

        if (!session || session.revokedAt || session.expiresAt <= now) {
            throw this.invalidRefreshToken();
        }

        const [tenant, user, membership] = await Promise.all([
            this.prisma.tenant.findUnique({ where: { id: session.tenantId } }),
            this.prisma.user.findUnique({ where: { id: session.userId } }),
            this.prisma.tenantMembership.findUnique({ where: { id: session.membershipId } }),
        ]);
        if (
            !tenant || tenant.deletedAt || tenant.status !== TenantStatus.ACTIVE
            || !user || user.deletedAt || user.status !== UserStatus.ACTIVE
            || !membership || membership.deletedAt || membership.status !== MembershipStatus.ACTIVE
            || membership.tenantId !== tenant.id || membership.userId !== user.id
        ) {
            await this.prisma.authSession.updateMany({
                where: { id: session.id, revokedAt: null },
                data: { revokedAt: now },
            });
            throw this.invalidRefreshToken();
        }

        const tokens = await this.issueTokenPair(user.id, tenant.id, membership.id, session.id, now);
        await this.prisma.$transaction(async (transaction) => {
            const rotation = await transaction.authSession.updateMany({
                where: {
                    id: session.id,
                    refreshTokenHash: currentTokenHash,
                    revokedAt: null,
                    expiresAt: { gt: now },
                },
                data: {
                    refreshTokenHash: tokens.refreshTokenHash,
                    expiresAt: tokens.refreshTokenExpiresAt,
                    lastUsedAt: now,
                    ipAddress: metadata.ipAddress ?? session.ipAddress,
                    userAgent: metadata.userAgent ?? session.userAgent,
                },
            });
            if (rotation.count !== 1) throw this.invalidRefreshToken();

            await transaction.auditLog.create({
                data: {
                    tenantId: tenant.id,
                    actorUserId: user.id,
                    actorMembershipId: membership.id,
                    action: 'AUTH_TOKEN_REFRESHED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'AUTH_SESSION',
                    resourceId: session.id,
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    metadata: { membershipId: membership.id },
                },
            });
        });

        return toPublicTokenPair(tokens);
    }

    async validateAccessToken(payload: AccessTokenPayload): Promise<AuthenticatedPrincipal> {
        if (!isAccessTokenPayload(payload)) throw this.unauthorized();

        const now = new Date();
        const session = await this.prisma.authSession.findUnique({ where: { id: payload.sid } });
        if (
            !session || session.revokedAt || session.expiresAt <= now
            || session.userId !== payload.sub || session.tenantId !== payload.tid
            || session.membershipId !== payload.mid
        ) {
            throw this.unauthorized();
        }

        const [tenant, user, membership] = await Promise.all([
            this.prisma.tenant.findUnique({ where: { id: payload.tid } }),
            this.prisma.user.findUnique({ where: { id: payload.sub } }),
            this.prisma.tenantMembership.findUnique({ where: { id: payload.mid } }),
        ]);
        if (
            !tenant || tenant.deletedAt || tenant.status !== TenantStatus.ACTIVE
            || !user || user.deletedAt || user.status !== UserStatus.ACTIVE
            || !membership || membership.deletedAt || membership.status !== MembershipStatus.ACTIVE
            || membership.tenantId !== tenant.id || membership.userId !== user.id
        ) {
            throw this.unauthorized();
        }

        const { roles, permissions } = await this.resolveAuthorization(tenant.id, membership.id);
        return {
            id: user.id,
            tenantId: tenant.id,
            membershipId: membership.id,
            sessionId: session.id,
            account: membership.account,
            displayName: membership.displayName ?? user.displayName,
            tenantCode: tenant.code,
            tenantName: tenant.name,
            roles,
            permissions,
        };
    }

    async logout(principal: AuthenticatedPrincipal, metadata: LoginRequestMetadata): Promise<void> {
        const now = new Date();
        await this.prisma.$transaction(async (transaction) => {
            const revoked = await transaction.authSession.updateMany({
                where: {
                    id: principal.sessionId,
                    tenantId: principal.tenantId,
                    userId: principal.id,
                    revokedAt: null,
                },
                data: { revokedAt: now, lastUsedAt: now },
            });
            if (revoked.count !== 1) throw this.unauthorized();

            await transaction.auditLog.create({
                data: {
                    tenantId: principal.tenantId,
                    actorUserId: principal.id,
                    actorMembershipId: principal.membershipId,
                    action: 'AUTH_LOGOUT',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'AUTH_SESSION',
                    resourceId: principal.sessionId,
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    metadata: { membershipId: principal.membershipId },
                },
            });
        });
    }

    me(principal: AuthenticatedPrincipal): MeResult {
        return {
            user: {
                id: principal.id,
                displayName: principal.displayName,
            },
            tenant: {
                id: principal.tenantId,
                code: principal.tenantCode,
                name: principal.tenantName,
            },
            membership: {
                id: principal.membershipId,
                account: principal.account,
                status: 'ACTIVE',
                roles: principal.roles,
            },
            permissions: principal.permissions,
        };
    }

    private async issueTokenPair(
        userId: string,
        tenantId: string,
        membershipId: string,
        sessionId: string,
        now: Date,
    ): Promise<IssuedTokenPair> {
        const accessTokenExpiresIn = parseDurationSeconds(process.env.JWT_ACCESS_TTL, 15 * 60);
        const refreshTokenExpiresIn = parseDurationSeconds(process.env.JWT_REFRESH_TTL, 30 * 24 * 60 * 60);
        const refreshToken = randomBytes(48).toString('base64url');
        const accessToken = await this.jwtService.signAsync(
            { sub: userId, tid: tenantId, mid: membershipId, sid: sessionId },
            {
                secret: requireAccessTokenSecret(),
                expiresIn: accessTokenExpiresIn,
                issuer: jwtIssuer(),
                audience: jwtAudience(),
                jwtid: randomUUID(),
            },
        );
        return {
            accessToken,
            accessTokenExpiresIn,
            refreshToken,
            refreshTokenExpiresIn,
            refreshTokenHash: hashRefreshToken(refreshToken),
            refreshTokenExpiresAt: new Date(now.getTime() + refreshTokenExpiresIn * 1000),
        };
    }

    private async resolveAuthorization(tenantId: string, membershipId: string): Promise<{ roles: string[]; permissions: string[] }> {
        const assignments = await this.prisma.membershipRole.findMany({
            where: { tenantId, membershipId },
            select: { roleId: true },
        });
        const roleIds = assignments.map((assignment) => assignment.roleId);
        if (roleIds.length === 0) return { roles: [], permissions: [] };

        const roles = await this.prisma.role.findMany({
            where: { tenantId, id: { in: roleIds }, deletedAt: null },
            select: { id: true, code: true },
        });
        const activeRoleIds = roles.map((role) => role.id);
        const rolePermissions = activeRoleIds.length === 0
            ? []
            : await this.prisma.rolePermission.findMany({
                where: { tenantId, roleId: { in: activeRoleIds } },
                select: { permissionId: true },
            });
        const permissionIds = [...new Set(rolePermissions.map((entry) => entry.permissionId))];
        const permissions = permissionIds.length === 0
            ? []
            : (await this.prisma.permission.findMany({
                where: { id: { in: permissionIds } },
                select: { code: true },
            })).map((permission) => permission.code);

        return {
            roles: roles.map((role) => role.code).sort(),
            permissions: [...new Set(permissions)].sort(),
        };
    }

    private async recordPasswordFailure(membershipId: string, currentFailures: number, now: Date): Promise<void> {
        const nextFailures = currentFailures + 1;
        const shouldLock = nextFailures >= MAX_LOGIN_FAILURES;
        await this.prisma.tenantMembership.update({
            where: { id: membershipId },
            data: shouldLock
                ? {
                    failedLoginCount: nextFailures,
                    lockedUntil: new Date(now.getTime() + LOGIN_LOCK_SECONDS * 1000),
                }
                : { failedLoginCount: nextFailures },
        });
    }

    private async writeLoginFailure(
        tenantId: string,
        actorUserId: string | undefined,
        actorMembershipId: string | undefined,
        metadata: LoginRequestMetadata,
        reason: string,
    ): Promise<void> {
        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    actorUserId,
                    actorMembershipId,
                    action: 'AUTH_LOGIN_FAILED',
                    outcome: AuditOutcome.FAILURE,
                    resourceType: 'AUTH_SESSION',
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    metadata: { reason },
                },
            });
        } catch (error) {
            this.logger.error('Failed to write login audit event', error instanceof Error ? error.stack : undefined);
        }
    }

    private async verifyDummyPassword(password: string): Promise<void> {
        await argon2.verify(await this.dummyPasswordHash, password).catch(() => false);
    }

    private async verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
        if (!passwordHash) return false;
        return argon2.verify(passwordHash, password).catch(() => false);
    }

    private invalidCredentials(): UnauthorizedException {
        return new UnauthorizedException({
            code: 'AUTH_INVALID_CREDENTIALS',
            message: '账号或密码错误',
        });
    }

    private invalidRefreshToken(): UnauthorizedException {
        return new UnauthorizedException({
            code: 'AUTH_INVALID_REFRESH_TOKEN',
            message: '刷新令牌无效或已过期',
        });
    }

    private unauthorized(): UnauthorizedException {
        return new UnauthorizedException({
            code: 'AUTH_UNAUTHORIZED',
            message: '登录状态无效或已过期',
        });
    }
}

function hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function toPublicTokenPair(tokens: IssuedTokenPair): AuthTokenPair {
    return {
        accessToken: tokens.accessToken,
        accessTokenExpiresIn: tokens.accessTokenExpiresIn,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
    };
}

function isAccessTokenPayload(payload: AccessTokenPayload): boolean {
    return Boolean(
        payload
        && typeof payload.sub === 'string'
        && typeof payload.tid === 'string'
        && typeof payload.mid === 'string'
        && typeof payload.sid === 'string',
    );
}
