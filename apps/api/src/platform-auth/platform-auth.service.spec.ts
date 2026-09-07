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
});

const USER_ID = '10000000-0000-0000-0000-000000000001';
const ADMINISTRATOR_ID = '20000000-0000-0000-0000-000000000001';

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        user: { findUnique: jest.fn(), update: jest.fn() },
        platformAdministrator: { findUnique: jest.fn(), update: jest.fn() },
        platformAuthSession: { create: jest.fn() },
        platformAuditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}
