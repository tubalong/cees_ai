import { JwtService } from '@nestjs/jwt';
import { PlatformAdministratorStatus, PlatformRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuthService } from './platform-auth.service';

describe('PlatformAuthService', () => {
    beforeEach(() => {
        process.env.JWT_PLATFORM_ACCESS_SECRET = 'test-platform-secret';
        process.env.JWT_PLATFORM_ACCESS_TTL = '15m';
        process.env.JWT_PLATFORM_REFRESH_TTL = '30d';
    });

    it('creates an independent platform session for valid credentials', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn().mockResolvedValue('platform-access-token') } as unknown as JwtService;
        prisma.platformAdministrator.findUnique.mockResolvedValue({
            id: ADMINISTRATOR_ID,
            userId: USER_ID,
            account: 'superadmin',
            normalizedAccount: 'superadmin',
            passwordHash: await argon2.hash('correct-password'),
            role: PlatformRole.SUPER_ADMIN,
            status: PlatformAdministratorStatus.ACTIVE,
            failedLoginCount: 0,
            lockedUntil: null,
            deletedAt: null,
            user: {
                id: USER_ID,
                displayName: 'Platform Administrator',
                status: UserStatus.ACTIVE,
                deletedAt: null,
            },
        });

        const service = new PlatformAuthService(prisma as unknown as PrismaService, jwtService);
        const result = await service.login(
            {
                account: 'SuperAdmin',
                password: 'correct-password',
                deviceName: 'Platform Console',
            },
            { requestId: 'request-id', ipAddress: '127.0.0.1', userAgent: 'jest' },
        );

        expect(result.accessToken).toBe('platform-access-token');
        expect(result.administrator.role).toBe(PlatformRole.SUPER_ADMIN);
        expect(result.administrator.permissions).toContain('platform.tenant.create');
        expect(prisma.platformAuthSession.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                platformAdministratorId: ADMINISTRATOR_ID,
                userId: USER_ID,
                refreshTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
        });
        expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'PLATFORM_LOGIN_SUCCEEDED' }),
        });
    });

    it('changes the current platform password and revokes other platform sessions', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn() } as unknown as JwtService;
        const passwordHash = await argon2.hash('current-password');
        prisma.platformAdministrator.findUnique.mockResolvedValue(platformAdministrator(passwordHash));
        prisma.platformAdministrator.updateMany.mockResolvedValue({ count: 1 });
        prisma.platformAuthSession.updateMany.mockResolvedValue({ count: 3 });
        const service = new PlatformAuthService(prisma as unknown as PrismaService, jwtService);

        await service.changePassword(
            platformPrincipal(),
            { currentPassword: 'current-password', newPassword: 'new-password' },
            { requestId: 'platform-password-request', ipAddress: '127.0.0.1', userAgent: 'jest' },
        );

        const update = prisma.platformAdministrator.updateMany.mock.calls[0][0];
        expect(await argon2.verify(update.data.passwordHash, 'new-password')).toBe(true);
        expect(update.where).toEqual(expect.objectContaining({ id: ADMINISTRATOR_ID, passwordHash }));
        expect(prisma.platformAuthSession.updateMany).toHaveBeenCalledWith({
            where: {
                platformAdministratorId: ADMINISTRATOR_ID,
                userId: USER_ID,
                id: { not: '30000000-0000-0000-0000-000000000001' },
                revokedAt: null,
            },
            data: { revokedAt: expect.any(Date), lastUsedAt: expect.any(Date) },
        });
        expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'PLATFORM_PASSWORD_CHANGED',
                metadata: expect.objectContaining({ revokedOtherSessionCount: 3 }),
            }),
        });
    });

    it('rejects an invalid current platform password and writes failure audit', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn() } as unknown as JwtService;
        prisma.platformAdministrator.findUnique.mockResolvedValue(platformAdministrator(await argon2.hash('current-password')));
        const service = new PlatformAuthService(prisma as unknown as PrismaService, jwtService);

        await expect(service.changePassword(
            platformPrincipal(),
            { currentPassword: 'wrong-password', newPassword: 'new-password' },
            { requestId: 'platform-password-request' },
        )).rejects.toMatchObject({ response: { code: 'AUTH_CURRENT_PASSWORD_INVALID' } });
        expect(prisma.platformAdministrator.updateMany).not.toHaveBeenCalled();
        expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'PLATFORM_PASSWORD_CHANGE_FAILED',
                outcome: 'FAILURE',
            }),
        });
    });

    it('rejects reusing the current platform password', async () => {
        const prisma = createPrismaMock();
        const jwtService = { signAsync: jest.fn() } as unknown as JwtService;
        prisma.platformAdministrator.findUnique.mockResolvedValue(platformAdministrator(await argon2.hash('same-password')));
        const service = new PlatformAuthService(prisma as unknown as PrismaService, jwtService);

        await expect(service.changePassword(
            platformPrincipal(),
            { currentPassword: 'same-password', newPassword: 'same-password' },
            { requestId: 'platform-password-request' },
        )).rejects.toMatchObject({ response: { code: 'AUTH_NEW_PASSWORD_SAME_AS_CURRENT' } });
        expect(prisma.platformAdministrator.updateMany).not.toHaveBeenCalled();
        expect(prisma.platformAuthSession.updateMany).not.toHaveBeenCalled();
    });
});

const USER_ID = '10000000-0000-0000-0000-000000000001';
const ADMINISTRATOR_ID = '20000000-0000-0000-0000-000000000001';

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        user: { findUnique: jest.fn(), update: jest.fn() },
        platformAdministrator: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        platformAuthSession: { create: jest.fn(), updateMany: jest.fn() },
        platformAuditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function platformAdministrator(passwordHash: string): Record<string, unknown> {
    return {
        id: ADMINISTRATOR_ID,
        userId: USER_ID,
        account: 'superadmin',
        normalizedAccount: 'superadmin',
        passwordHash,
        role: PlatformRole.SUPER_ADMIN,
        status: PlatformAdministratorStatus.ACTIVE,
        failedLoginCount: 0,
        lockedUntil: null,
        deletedAt: null,
        version: 1,
    };
}

function platformPrincipal() {
    return {
        id: USER_ID,
        platformAdministratorId: ADMINISTRATOR_ID,
        sessionId: '30000000-0000-0000-0000-000000000001',
        account: 'superadmin',
        displayName: 'Platform Administrator',
        role: PlatformRole.SUPER_ADMIN,
        permissions: ['platform.tenant.create'],
    };
}
