import { TenantInvitationStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuthenticatedPrincipal } from '../platform-auth/platform-auth.types';
import { PlatformTenantService } from './platform-tenant.service';

describe('PlatformTenantService', () => {
    it('creates a tenant, initializes tenant_admin and creates an account activation invitation', async () => {
        const prisma = createPrismaMock();
        prisma.tenant.findUnique.mockResolvedValue(null);
        prisma.tenant.create.mockResolvedValue(tenantRecord());
        prisma.tenant.findFirst.mockResolvedValue(tenantRecord());
        prisma.permission.upsert.mockResolvedValue({ id: PERMISSION_ID });
        prisma.role.upsert.mockResolvedValue({ id: ROLE_ID });
        prisma.tenantMembership.count.mockResolvedValue(1);
        prisma.tenantInvitation.create.mockResolvedValue(invitationRecord());
        prisma.tenantInvitation.count.mockResolvedValue(0);

        const service = new PlatformTenantService(prisma as unknown as PrismaService);
        const result = await service.createTenant(
            {
                code: 'Company-A',
                name: 'Company A',
                initialAdministrator: {
                    account: 'CompanyAdmin',
                    displayName: 'Company Administrator',
                },
            },
            principal(),
            { requestId: 'request-id' },
        );

        expect(result.tenant.code).toBe('company-a');
        expect(result.administratorAssignment.status).toBe('INVITED');
        expect(result.administratorAssignment.invitation?.account).toBe('companyadmin');
        expect(prisma.role.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId_code: { tenantId: TENANT_ID, code: 'tenant_admin' } },
        }));
        expect(prisma.tenantInvitation.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ account: 'companyadmin', normalizedAccount: 'companyadmin' }),
        }));
        expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'TENANT_CREATED' }),
        });
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '30000000-0000-0000-0000-000000000001';
const ROLE_ID = '40000000-0000-0000-0000-000000000001';
const PERMISSION_ID = '50000000-0000-0000-0000-000000000001';

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        tenant: { findUnique: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
        permission: { upsert: jest.fn() },
        role: { upsert: jest.fn() },
        rolePermission: { createMany: jest.fn() },
        tenantMembership: { count: jest.fn() },
        tenantInvitation: { create: jest.fn(), count: jest.fn() },
        platformAuditLog: { create: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function tenantRecord(): Record<string, unknown> {
    return {
        id: TENANT_ID,
        code: 'company-a',
        name: 'Company A',
        status: TenantStatus.ACTIVE,
        version: 1,
        createdAt: new Date('2026-09-07T00:00:00.000Z'),
        updatedAt: new Date('2026-09-07T00:00:00.000Z'),
        deletedAt: null,
    };
}

function invitationRecord(): Record<string, unknown> {
    return {
        id: '90000000-0000-0000-0000-000000000001',
        tenantId: TENANT_ID,
        account: 'companyadmin',
        normalizedAccount: 'companyadmin',
        displayName: 'Company Administrator',
        status: TenantInvitationStatus.PENDING,
        isInitialAdministrator: true,
        expiresAt: new Date('2026-09-08T00:00:00.000Z'),
        createdAt: new Date('2026-09-07T00:00:00.000Z'),
        roles: [{ roleId: ROLE_ID }],
    };
}

function principal(): PlatformAuthenticatedPrincipal {
    return {
        id: '60000000-0000-0000-0000-000000000001',
        platformAdministratorId: '70000000-0000-0000-0000-000000000001',
        sessionId: '80000000-0000-0000-0000-000000000001',
        account: 'superadmin',
        displayName: 'Platform Administrator',
        role: 'SUPER_ADMIN',
        permissions: ['platform.tenant.create'],
    };
}
