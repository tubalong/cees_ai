import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { UserService } from './user.service';

describe('UserService', () => {
    it('returns the profile for the authenticated tenant membership', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(profileRecord());
        const service = createService(prisma);

        const result = await service.getCurrentProfile();

        expect(result).toEqual(expect.objectContaining({
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            tenantId: TENANT_ID,
            account: 'zhangsan',
            displayName: '张三',
            version: 1,
        }));
        expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith({
            where: { id: MEMBERSHIP_ID, tenantId: TENANT_ID, userId: USER_ID, deletedAt: null },
            select: expect.any(Object),
        });
    });

    it('updates the tenant display name with optimistic locking and writes audit', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst
            .mockResolvedValueOnce(profileRecord())
            .mockResolvedValueOnce(profileRecord({ displayName: '张小三', version: 2 }));
        prisma.tenantMembership.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        const result = await service.updateCurrentProfile({ displayName: '  张小三  ', version: 1 });

        expect(result.displayName).toBe('张小三');
        expect(result.version).toBe(2);
        expect(prisma.tenantMembership.updateMany).toHaveBeenCalledWith({
            where: {
                id: MEMBERSHIP_ID,
                tenantId: TENANT_ID,
                userId: USER_ID,
                version: 1,
                deletedAt: null,
            },
            data: {
                displayName: '张小三',
                updatedBy: USER_ID,
                version: { increment: 1 },
            },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'USER_PROFILE_UPDATED',
                resourceId: MEMBERSHIP_ID,
                metadata: {
                    before: { displayName: '张三' },
                    after: { displayName: '张小三' },
                },
            }),
        });
    });

    it('does not update or audit when the display name is unchanged', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(profileRecord());
        const service = createService(prisma);

        const result = await service.updateCurrentProfile({ displayName: ' 张三 ', version: 1 });

        expect(result.version).toBe(1);
        expect(prisma.tenantMembership.updateMany).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects a stale profile version', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(profileRecord({ version: 2 }));
        prisma.tenantMembership.updateMany.mockResolvedValue({ count: 0 });
        const service = createService(prisma);

        await expect(service.updateCurrentProfile({ displayName: '新名字', version: 1 }))
            .rejects.toBeInstanceOf(ConflictException);
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects a display name containing only whitespace', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(profileRecord());
        const service = createService(prisma);

        await expect(service.updateCurrentProfile({ displayName: '   ', version: 1 }))
            .rejects.toMatchObject({ response: { code: 'USER_PROFILE_DISPLAY_NAME_INVALID' } });
        expect(prisma.tenantMembership.updateMany).not.toHaveBeenCalled();
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const DEPARTMENT_ID = '60000000-0000-0000-0000-000000000001';

function createService(prisma: Record<string, any>): UserService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: [],
            permissions: [],
        }),
    } as unknown as TenantContext;
    return new UserService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        tenantMembership: { findFirst: jest.fn(), updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function profileRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        account: 'zhangsan',
        displayName: '张三',
        user: { displayName: '全局张三' },
        department: { id: DEPARTMENT_ID, name: '研发部' },
        version: 1,
        updatedAt: new Date('2026-09-08T00:00:00.000Z'),
        ...overrides,
    };
}
