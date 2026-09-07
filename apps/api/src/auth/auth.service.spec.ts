import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MembershipStatus, TenantStatus, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { AuthService } from './auth.service';
import { AuthenticatedPrincipal } from './auth.types';

describe('AuthService', () => {
    beforeEach(() => {
        process.env.JWT_ACCESS_SECRET = 'test-access-secret';
        process.env.JWT_ACCESS_TTL = '15m';
        process.env.JWT_REFRESH_TTL = '30d';
    });

    it('creates a session and returns tokens for valid credentials', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn().mockResolvedValue('access-token') } as unknown as JwtService;
        const passwordHash = await argon2.hash('correct-password');
        prisma.tenant.findUnique.mockResolvedValue(activeTenant());
        prisma.tenantMembership.findFirst.mockResolvedValue({
            ...activeMembership(),
            user: activeUser(passwordHash),
        });
        prisma.membershipRole.findMany.mockResolvedValue([{ roleId: '20000000-0000-0000-0000-000000000001' }]);
        prisma.role.findMany.mockResolvedValue([
            { id: '20000000-0000-0000-0000-000000000001', code: 'tenant_admin' },
        ]);
        prisma.rolePermission.findMany.mockResolvedValue([]);

        const service = new AuthService(prisma as unknown as PrismaService, jwtService);
        const result = await service.login(
            {
                tenantCode: 'CEES',
                email: 'Admin@Example.com',
                password: 'correct-password',
                deviceName: 'Test Device',
            },
            { requestId: 'request-id', ipAddress: '127.0.0.1', userAgent: 'jest' },
        );

        expect(result.accessToken).toBe('access-token');
        expect(result.refreshToken).toEqual(expect.any(String));
        expect(result.membership).toEqual({
            id: '50000000-0000-0000-0000-000000000001',
            status: 'ACTIVE',
            roles: ['tenant_admin'],
        });
        expect(prisma.authSession.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: '10000000-0000-0000-0000-000000000001',
                userId: '10000000-0000-0000-0000-000000000002',
                membershipId: '50000000-0000-0000-0000-000000000001',
                refreshTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                deviceName: 'Test Device',
            }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'AUTH_LOGIN_SUCCEEDED' }),
        });
    });

    it('returns a generic error and records a failed password attempt', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn() } as unknown as JwtService;
        prisma.tenant.findUnique.mockResolvedValue(activeTenant());
        prisma.tenantMembership.findFirst.mockResolvedValue({
            ...activeMembership(),
            user: activeUser(await argon2.hash('different-password')),
        });

        const service = new AuthService(prisma as unknown as PrismaService, jwtService);
        await expect(service.login(
            { tenantCode: 'cees', email: 'admin@example.com', password: 'wrong-password' },
            { requestId: 'request-id' },
        )).rejects.toBeInstanceOf(UnauthorizedException);

        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { id: '10000000-0000-0000-0000-000000000002' },
            data: { failedLoginCount: 1 },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'AUTH_LOGIN_FAILED' }),
        });
    });

    it('locks the account after the fifth failed password attempt', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn() } as unknown as JwtService;
        prisma.tenant.findUnique.mockResolvedValue(activeTenant());
        prisma.tenantMembership.findFirst.mockResolvedValue({
            ...activeMembership(),
            user: {
                ...activeUser(await argon2.hash('different-password')),
                failedLoginCount: 4,
            },
        });

        const service = new AuthService(prisma as unknown as PrismaService, jwtService);
        await expect(service.login(
            { tenantCode: 'cees', email: 'admin@example.com', password: 'wrong-password' },
            { requestId: 'request-id' },
        )).rejects.toBeInstanceOf(UnauthorizedException);

        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { id: '10000000-0000-0000-0000-000000000002' },
            data: {
                status: UserStatus.LOCKED,
                failedLoginCount: 5,
                lockedUntil: expect.any(Date),
            },
        });
    });

    it('rotates a refresh token exactly once and writes an audit event', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn().mockResolvedValue('refreshed-access-token') } as unknown as JwtService;
        const currentRefreshToken = 'r'.repeat(64);
        prisma.authSession.findUnique.mockResolvedValue(activeSession(hashToken(currentRefreshToken)));
        prisma.tenant.findUnique.mockResolvedValue(activeTenant());
        prisma.user.findUnique.mockResolvedValue(activeUser('password-hash'));
        prisma.tenantMembership.findUnique.mockResolvedValue(activeMembership());
        prisma.authSession.updateMany.mockResolvedValue({ count: 1 });

        const service = new AuthService(prisma as unknown as PrismaService, jwtService);
        const result = await service.refresh(
            { refreshToken: currentRefreshToken },
            { requestId: 'refresh-request', ipAddress: '127.0.0.1', userAgent: 'jest' },
        );

        expect(result.accessToken).toBe('refreshed-access-token');
        expect(result.refreshToken).not.toBe(currentRefreshToken);
        expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
            where: {
                id: '30000000-0000-0000-0000-000000000001',
                refreshTokenHash: hashToken(currentRefreshToken),
                revokedAt: null,
                expiresAt: { gt: expect.any(Date) },
            },
            data: expect.objectContaining({
                refreshTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                lastUsedAt: expect.any(Date),
            }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'AUTH_TOKEN_REFRESHED' }),
        });
    });

    it('rejects a refresh token that loses the rotation race', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn().mockResolvedValue('access-token') } as unknown as JwtService;
        const currentRefreshToken = 'r'.repeat(64);
        prisma.authSession.findUnique.mockResolvedValue(activeSession(hashToken(currentRefreshToken)));
        prisma.tenant.findUnique.mockResolvedValue(activeTenant());
        prisma.user.findUnique.mockResolvedValue(activeUser('password-hash'));
        prisma.tenantMembership.findUnique.mockResolvedValue(activeMembership());
        prisma.authSession.updateMany.mockResolvedValue({ count: 0 });

        const service = new AuthService(prisma as unknown as PrismaService, jwtService);
        await expect(service.refresh(
            { refreshToken: currentRefreshToken },
            { requestId: 'refresh-request' },
        )).rejects.toMatchObject({ response: { code: 'AUTH_INVALID_REFRESH_TOKEN' } });
    });

    it('validates the session and reloads current roles and permissions', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn() } as unknown as JwtService;
        prisma.authSession.findUnique.mockResolvedValue(activeSession('refresh-hash'));
        prisma.tenant.findUnique.mockResolvedValue(activeTenant());
        prisma.user.findUnique.mockResolvedValue(activeUser('password-hash'));
        prisma.tenantMembership.findUnique.mockResolvedValue(activeMembership());
        prisma.membershipRole.findMany.mockResolvedValue([{ roleId: '20000000-0000-0000-0000-000000000001' }]);
        prisma.role.findMany.mockResolvedValue([
            { id: '20000000-0000-0000-0000-000000000001', code: 'tenant_admin' },
        ]);
        prisma.rolePermission.findMany.mockResolvedValue([
            { permissionId: '40000000-0000-0000-0000-000000000001' },
        ]);
        prisma.permission.findMany.mockResolvedValue([{ code: 'tenant.read' }]);

        const service = new AuthService(prisma as unknown as PrismaService, jwtService);
        const principal = await service.validateAccessToken({
            sub: '10000000-0000-0000-0000-000000000002',
            tid: '10000000-0000-0000-0000-000000000001',
            mid: '50000000-0000-0000-0000-000000000001',
            sid: '30000000-0000-0000-0000-000000000001',
        });

        expect(principal).toEqual(expect.objectContaining({
            id: '10000000-0000-0000-0000-000000000002',
            tenantId: '10000000-0000-0000-0000-000000000001',
            membershipId: '50000000-0000-0000-0000-000000000001',
            sessionId: '30000000-0000-0000-0000-000000000001',
            roles: ['tenant_admin'],
            permissions: ['tenant.read'],
        }));
    });

    it('revokes the current session during logout', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn() } as unknown as JwtService;
        prisma.authSession.updateMany.mockResolvedValue({ count: 1 });

        const service = new AuthService(prisma as unknown as PrismaService, jwtService);
        await service.logout(authenticatedPrincipal(), {
            requestId: 'logout-request',
            ipAddress: '127.0.0.1',
            userAgent: 'jest',
        });

        expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
            where: {
                id: '30000000-0000-0000-0000-000000000001',
                tenantId: '10000000-0000-0000-0000-000000000001',
                userId: '10000000-0000-0000-0000-000000000002',
                revokedAt: null,
            },
            data: { revokedAt: expect.any(Date), lastUsedAt: expect.any(Date) },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'AUTH_LOGOUT' }),
        });
    });

    it('returns the authenticated user context for me', () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn() } as unknown as JwtService;
        const service = new AuthService(prisma as unknown as PrismaService, jwtService);

        expect(service.me(authenticatedPrincipal())).toEqual({
            user: {
                id: '10000000-0000-0000-0000-000000000002',
                email: 'admin@example.com',
                displayName: 'Administrator',
            },
            tenant: {
                id: '10000000-0000-0000-0000-000000000001',
                code: 'cees',
                name: 'CEES',
            },
            membership: {
                id: '50000000-0000-0000-0000-000000000001',
                status: 'ACTIVE',
                roles: ['tenant_admin'],
            },
            permissions: ['tenant.read'],
        });
    });
});

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        tenant: { findUnique: jest.fn() },
        user: { findUnique: jest.fn(), update: jest.fn() },
        tenantMembership: { findFirst: jest.fn(), findUnique: jest.fn() },
        membershipRole: { findMany: jest.fn() },
        role: { findMany: jest.fn() },
        rolePermission: { findMany: jest.fn() },
        permission: { findMany: jest.fn() },
        authSession: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function activeTenant(): Record<string, unknown> {
    return {
        id: '10000000-0000-0000-0000-000000000001',
        code: 'cees',
        name: 'CEES',
        status: TenantStatus.ACTIVE,
        deletedAt: null,
    };
}

function activeUser(passwordHash: string): Record<string, unknown> {
    return {
        id: '10000000-0000-0000-0000-000000000002',
        email: 'admin@example.com',
        normalizedEmail: 'admin@example.com',
        passwordHash,
        displayName: 'Administrator',
        status: UserStatus.ACTIVE,
        failedLoginCount: 0,
        lockedUntil: null,
        deletedAt: null,
    };
}

function activeSession(refreshTokenHash: string): Record<string, unknown> {
    return {
        id: '30000000-0000-0000-0000-000000000001',
        tenantId: '10000000-0000-0000-0000-000000000001',
        userId: '10000000-0000-0000-0000-000000000002',
        membershipId: '50000000-0000-0000-0000-000000000001',
        refreshTokenHash,
        deviceName: 'Test Device',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        expiresAt: new Date(Date.now() + 60_000),
        lastUsedAt: null,
        revokedAt: null,
    };
}

function authenticatedPrincipal(): AuthenticatedPrincipal {
    return {
        id: '10000000-0000-0000-0000-000000000002',
        tenantId: '10000000-0000-0000-0000-000000000001',
        membershipId: '50000000-0000-0000-0000-000000000001',
        sessionId: '30000000-0000-0000-0000-000000000001',
        email: 'admin@example.com',
        displayName: 'Administrator',
        tenantCode: 'cees',
        tenantName: 'CEES',
        roles: ['tenant_admin'],
        permissions: ['tenant.read'],
    };
}

function activeMembership(): Record<string, unknown> {
    return {
        id: '50000000-0000-0000-0000-000000000001',
        tenantId: '10000000-0000-0000-0000-000000000001',
        userId: '10000000-0000-0000-0000-000000000002',
        departmentId: null,
        displayName: 'Tenant Administrator',
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date('2026-09-04T00:00:00.000Z'),
        deletedAt: null,
        version: 1,
    };
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
