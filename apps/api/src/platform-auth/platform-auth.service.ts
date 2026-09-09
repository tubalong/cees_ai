import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditOutcome, PlatformAdministratorStatus, PlatformRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
    parseDurationSeconds,
    platformJwtAudience,
    platformJwtIssuer,
    requirePlatformAccessTokenSecret,
} from '../auth/auth.config';
import { ChangePasswordDto } from '../auth/dto';
import { PrismaService } from '../database/prisma.service';
import { normalizeAccount } from '../auth/account';
import { PlatformLoginDto, PlatformRefreshTokenDto } from './dto';
import {
    PlatformAccessTokenPayload,
    PlatformAdministratorIdentity,
    PlatformAuthenticatedPrincipal,
    PlatformAuthTokenPair,
    PlatformLoginResult,
    PlatformMeResult,
} from './platform-auth.types';
import { resolvePlatformPermissions } from './platform-permissions';

export interface PlatformRequestMetadata {
    requestId: string;
    ipAddress?: string;
    userAgent?: string;
}

interface IssuedPlatformTokenPair extends PlatformAuthTokenPair {
    refreshTokenHash: string;
    refreshTokenExpiresAt: Date;
}

const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_SECONDS = 15 * 60;

@Injectable()
export class PlatformAuthService {
    private readonly logger = new Logger(PlatformAuthService.name);
    private readonly dummyPasswordHash = argon2.hash('cees-invalid-platform-login-password');

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
    ) { }

    async login(input: PlatformLoginDto, metadata: PlatformRequestMetadata): Promise<PlatformLoginResult> {
        const account = normalizeAccount(input.account);
        let administrator = await this.prisma.platformAdministrator.findUnique({
            where: { normalizedAccount: account },
            include: { user: true },
        });

        if (!administrator || administrator.deletedAt || administrator.user.deletedAt) {
            await this.verifyDummyPassword(input.password);
            await this.writeLoginFailure(undefined, undefined, metadata, 'INVALID_CREDENTIALS');
            throw this.invalidCredentials();
        }

        const user = administrator.user;
        if (administrator.status !== PlatformAdministratorStatus.ACTIVE || user.status === UserStatus.DISABLED) {
            await this.verifyPassword(administrator.passwordHash, input.password);
            await this.writeLoginFailure(user.id, administrator.id, metadata, 'ACCOUNT_UNAVAILABLE');
            throw this.invalidCredentials();
        }

        const now = new Date();
        if (administrator.lockedUntil && administrator.lockedUntil > now) {
            await this.verifyPassword(administrator.passwordHash, input.password);
            await this.writeLoginFailure(user.id, administrator.id, metadata, 'ACCOUNT_LOCKED');
            throw this.invalidCredentials();
        }

        if (administrator.lockedUntil) {
            administrator = await this.prisma.platformAdministrator.update({
                where: { id: administrator.id },
                data: { failedLoginCount: 0, lockedUntil: null },
                include: { user: true },
            });
        }

        if (!await this.verifyPassword(administrator.passwordHash, input.password)) {
            await this.recordPasswordFailure(administrator.id, administrator.failedLoginCount, now);
            await this.writeLoginFailure(user.id, administrator.id, metadata, 'INVALID_CREDENTIALS');
            throw this.invalidCredentials();
        }

        const sessionId = randomUUID();
        const tokens = await this.issueTokenPair(user.id, administrator.id, sessionId, now);
        await this.prisma.$transaction(async (transaction) => {
            await transaction.platformAdministrator.update({
                where: { id: administrator.id },
                data: {
                    failedLoginCount: 0,
                    lockedUntil: null,
                    lastLoginAt: now,
                },
            });
            await transaction.platformAuthSession.create({
                data: {
                    id: sessionId,
                    platformAdministratorId: administrator.id,
                    userId: user.id,
                    refreshTokenHash: tokens.refreshTokenHash,
                    deviceName: input.deviceName,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    expiresAt: tokens.refreshTokenExpiresAt,
                },
            });
            await transaction.platformAuditLog.create({
                data: {
                    actorUserId: user.id,
                    actorPlatformAdministratorId: administrator.id,
                    action: 'PLATFORM_LOGIN_SUCCEEDED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'PLATFORM_AUTH_SESSION',
                    resourceId: sessionId,
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    metadata: { deviceName: input.deviceName ?? null },
                },
            });
        });

        return {
            ...toPublicTokenPair(tokens),
            administrator: toAdministratorIdentity(administrator, user),
        };
    }

    async refresh(input: PlatformRefreshTokenDto, metadata: PlatformRequestMetadata): Promise<PlatformAuthTokenPair> {
        const currentTokenHash = hashRefreshToken(input.refreshToken);
        const session = await this.prisma.platformAuthSession.findUnique({
            where: { refreshTokenHash: currentTokenHash },
        });
        const now = new Date();
        if (!session || session.revokedAt || session.expiresAt <= now) throw this.invalidRefreshToken();

        const [administrator, user] = await Promise.all([
            this.prisma.platformAdministrator.findUnique({ where: { id: session.platformAdministratorId } }),
            this.prisma.user.findUnique({ where: { id: session.userId } }),
        ]);
        if (
            !administrator || administrator.deletedAt || administrator.status !== PlatformAdministratorStatus.ACTIVE
            || !user || user.deletedAt || user.status !== UserStatus.ACTIVE
        ) {
            await this.prisma.platformAuthSession.updateMany({
                where: { id: session.id, revokedAt: null },
                data: { revokedAt: now },
            });
            throw this.invalidRefreshToken();
        }

        const tokens = await this.issueTokenPair(user.id, administrator.id, session.id, now);
        const rotated = await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.platformAuthSession.updateMany({
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
            if (updated.count !== 1) return false;
            await transaction.platformAuditLog.create({
                data: {
                    actorUserId: user.id,
                    actorPlatformAdministratorId: administrator.id,
                    action: 'PLATFORM_TOKEN_REFRESHED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'PLATFORM_AUTH_SESSION',
                    resourceId: session.id,
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                },
            });
            return true;
        });
        if (!rotated) throw this.invalidRefreshToken();
        return toPublicTokenPair(tokens);
    }

    async validateAccessToken(payload: PlatformAccessTokenPayload): Promise<PlatformAuthenticatedPrincipal> {
        if (!isPlatformAccessTokenPayload(payload)) throw this.unauthorized();
        const now = new Date();
        const session = await this.prisma.platformAuthSession.findUnique({ where: { id: payload.sid } });
        if (
            !session || session.revokedAt || session.expiresAt <= now
            || session.userId !== payload.sub || session.platformAdministratorId !== payload.pid
        ) throw this.unauthorized();

        const [administrator, user] = await Promise.all([
            this.prisma.platformAdministrator.findUnique({ where: { id: payload.pid } }),
            this.prisma.user.findUnique({ where: { id: payload.sub } }),
        ]);
        if (
            !administrator || administrator.deletedAt || administrator.status !== PlatformAdministratorStatus.ACTIVE
            || !user || user.deletedAt || user.status !== UserStatus.ACTIVE
        ) throw this.unauthorized();

        return {
            id: user.id,
            platformAdministratorId: administrator.id,
            sessionId: session.id,
            account: administrator.account,
            displayName: user.displayName,
            role: administrator.role,
            permissions: resolvePlatformPermissions(administrator.role),
        };
    }

    async logout(principal: PlatformAuthenticatedPrincipal, metadata: PlatformRequestMetadata): Promise<void> {
        const now = new Date();
        await this.prisma.$transaction(async (transaction) => {
            await transaction.platformAuthSession.updateMany({
                where: { id: principal.sessionId, revokedAt: null },
                data: { revokedAt: now },
            });
            await transaction.platformAuditLog.create({
                data: {
                    actorUserId: principal.id,
                    actorPlatformAdministratorId: principal.platformAdministratorId,
                    action: 'PLATFORM_LOGOUT',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'PLATFORM_AUTH_SESSION',
                    resourceId: principal.sessionId,
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                },
            });
        });
    }

    async changePassword(
        principal: PlatformAuthenticatedPrincipal,
        input: ChangePasswordDto,
        metadata: PlatformRequestMetadata,
    ): Promise<void> {
        const administrator = await this.prisma.platformAdministrator.findUnique({
            where: { id: principal.platformAdministratorId },
        });
        if (
            !administrator || administrator.deletedAt || administrator.status !== PlatformAdministratorStatus.ACTIVE
            || administrator.userId !== principal.id
        ) throw this.unauthorized();

        if (!await this.verifyPassword(administrator.passwordHash, input.currentPassword)) {
            await this.writePasswordChangeFailure(principal, metadata, 'CURRENT_PASSWORD_INVALID');
            throw this.invalidCurrentPassword();
        }
        if (await this.verifyPassword(administrator.passwordHash, input.newPassword)) {
            throw this.samePassword();
        }

        const passwordHash = await argon2.hash(input.newPassword);
        const now = new Date();
        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.platformAdministrator.updateMany({
                where: {
                    id: principal.platformAdministratorId,
                    userId: principal.id,
                    passwordHash: administrator.passwordHash,
                    status: PlatformAdministratorStatus.ACTIVE,
                    deletedAt: null,
                },
                data: {
                    passwordHash,
                    failedLoginCount: 0,
                    lockedUntil: null,
                    updatedBy: principal.id,
                    version: { increment: 1 },
                },
            });
            if (updated.count !== 1) throw this.invalidCurrentPassword();

            const revoked = await transaction.platformAuthSession.updateMany({
                where: {
                    platformAdministratorId: principal.platformAdministratorId,
                    userId: principal.id,
                    id: { not: principal.sessionId },
                    revokedAt: null,
                },
                data: { revokedAt: now, lastUsedAt: now },
            });
            await transaction.platformAuditLog.create({
                data: {
                    actorUserId: principal.id,
                    actorPlatformAdministratorId: principal.platformAdministratorId,
                    action: 'PLATFORM_PASSWORD_CHANGED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'PLATFORM_ADMINISTRATOR',
                    resourceId: principal.platformAdministratorId,
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    metadata: {
                        currentSessionId: principal.sessionId,
                        revokedOtherSessionCount: revoked.count,
                    },
                },
            });
        });
    }

    me(principal: PlatformAuthenticatedPrincipal): PlatformMeResult {
        return {
            administrator: {
                id: principal.platformAdministratorId,
                account: principal.account,
                user: {
                    id: principal.id,
                    displayName: principal.displayName,
                },
                role: principal.role,
                permissions: principal.permissions,
            },
        };
    }

    private async issueTokenPair(
        userId: string,
        platformAdministratorId: string,
        sessionId: string,
        now: Date,
    ): Promise<IssuedPlatformTokenPair> {
        const accessTokenExpiresIn = parseDurationSeconds(
            process.env.JWT_PLATFORM_ACCESS_TTL ?? process.env.JWT_ACCESS_TTL,
            15 * 60,
        );
        const refreshTokenExpiresIn = parseDurationSeconds(
            process.env.JWT_PLATFORM_REFRESH_TTL ?? process.env.JWT_REFRESH_TTL,
            30 * 24 * 60 * 60,
        );
        const refreshToken = randomBytes(48).toString('base64url');
        const accessToken = await this.jwtService.signAsync(
            { scope: 'PLATFORM', sub: userId, pid: platformAdministratorId, sid: sessionId },
            {
                secret: requirePlatformAccessTokenSecret(),
                expiresIn: accessTokenExpiresIn,
                issuer: platformJwtIssuer(),
                audience: platformJwtAudience(),
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

    private async recordPasswordFailure(administratorId: string, currentFailures: number, now: Date): Promise<void> {
        const nextFailures = currentFailures + 1;
        await this.prisma.platformAdministrator.update({
            where: { id: administratorId },
            data: nextFailures >= MAX_LOGIN_FAILURES
                ? {
                    failedLoginCount: nextFailures,
                    lockedUntil: new Date(now.getTime() + LOGIN_LOCK_SECONDS * 1000),
                }
                : { failedLoginCount: nextFailures },
        });
    }

    private async writeLoginFailure(
        actorUserId: string | undefined,
        actorPlatformAdministratorId: string | undefined,
        metadata: PlatformRequestMetadata,
        reason: string,
    ): Promise<void> {
        try {
            await this.prisma.platformAuditLog.create({
                data: {
                    actorUserId,
                    actorPlatformAdministratorId,
                    action: 'PLATFORM_LOGIN_FAILED',
                    outcome: AuditOutcome.FAILURE,
                    resourceType: 'PLATFORM_AUTH_SESSION',
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    metadata: { reason },
                },
            });
        } catch (error) {
            this.logger.error('Failed to write platform login audit event', error instanceof Error ? error.stack : undefined);
        }
    }

    private async writePasswordChangeFailure(
        principal: PlatformAuthenticatedPrincipal,
        metadata: PlatformRequestMetadata,
        reason: string,
    ): Promise<void> {
        try {
            await this.prisma.platformAuditLog.create({
                data: {
                    actorUserId: principal.id,
                    actorPlatformAdministratorId: principal.platformAdministratorId,
                    action: 'PLATFORM_PASSWORD_CHANGE_FAILED',
                    outcome: AuditOutcome.FAILURE,
                    resourceType: 'PLATFORM_ADMINISTRATOR',
                    resourceId: principal.platformAdministratorId,
                    requestId: metadata.requestId,
                    ipAddress: metadata.ipAddress,
                    userAgent: metadata.userAgent,
                    metadata: { reason },
                },
            });
        } catch (error) {
            this.logger.error('Failed to write platform password change audit event', error instanceof Error ? error.stack : undefined);
        }
    }

    private async verifyDummyPassword(password: string): Promise<void> {
        await argon2.verify(await this.dummyPasswordHash, password).catch(() => false);
    }

    private async verifyPassword(passwordHash: string, password: string): Promise<boolean> {
        return argon2.verify(passwordHash, password).catch(() => false);
    }

    private invalidCredentials(): UnauthorizedException {
        return new UnauthorizedException({
            code: 'PLATFORM_AUTH_INVALID_CREDENTIALS',
            message: '账号或密码错误',
        });
    }

    private invalidRefreshToken(): UnauthorizedException {
        return new UnauthorizedException({
            code: 'PLATFORM_AUTH_INVALID_REFRESH_TOKEN',
            message: '平台刷新令牌无效或已过期',
        });
    }

    private invalidCurrentPassword(): UnauthorizedException {
        return new UnauthorizedException({
            code: 'AUTH_CURRENT_PASSWORD_INVALID',
            message: '当前密码错误',
        });
    }

    private samePassword(): BadRequestException {
        return new BadRequestException({
            code: 'AUTH_NEW_PASSWORD_SAME_AS_CURRENT',
            message: '新密码不能与当前密码相同',
        });
    }

    private unauthorized(): UnauthorizedException {
        return new UnauthorizedException({
            code: 'PLATFORM_AUTH_UNAUTHORIZED',
            message: '平台登录状态无效或已过期',
        });
    }
}

function toAdministratorIdentity(
    administrator: { id: string; account: string; role: PlatformRole },
    user: { id: string; displayName: string },
): PlatformAdministratorIdentity {
    return {
        id: administrator.id,
        account: administrator.account,
        user: { id: user.id, displayName: user.displayName },
        role: administrator.role,
        permissions: resolvePlatformPermissions(administrator.role),
    };
}

function hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function toPublicTokenPair(tokens: IssuedPlatformTokenPair): PlatformAuthTokenPair {
    return {
        accessToken: tokens.accessToken,
        accessTokenExpiresIn: tokens.accessTokenExpiresIn,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
    };
}

function isPlatformAccessTokenPayload(payload: PlatformAccessTokenPayload): boolean {
    return Boolean(
        payload
        && payload.scope === 'PLATFORM'
        && typeof payload.sub === 'string'
        && typeof payload.pid === 'string'
        && typeof payload.sid === 'string',
    );
}
