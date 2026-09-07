import { MembershipStatus, TenantInvitationStatus, TenantStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { TenantInvitationService } from './tenant-invitation.service';

describe('TenantInvitationService', () => {
    it('creates a tenant-scoped account and activates a pending tenant', async () => {
        const prisma = createPrismaMock();
        prisma.tenantInvitation.findUnique.mockResolvedValue(invitationRecord());
        prisma.tenantMembership.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(memberRecordWithRoles());
        prisma.user.create.mockResolvedValue(userRecord());
        prisma.tenantMembership.create.mockResolvedValue(memberRecord());
        prisma.tenantInvitation.updateMany.mockResolvedValue({ count: 1 });
        prisma.tenant.findUnique.mockResolvedValue(tenantRecord(TenantStatus.ACTIVE));

        const service = new TenantInvitationService(
            prisma as unknown as PrismaService,
            { require: jest.fn() } as unknown as TenantContext,
        );
        const result = await service.acceptInvitation(
            {
                tenantCode: 'Company-A',
                account: 'CompanyAdmin',
                invitationToken: 'x'.repeat(64),
                password: 'new-password',
            },
            { requestId: 'request-id', ipAddress: '127.0.0.1', userAgent: 'jest' },
        );

        expect(result.tenant.code).toBe('company-a');
        expect(result.membership.account).toBe('companyadmin');
        expect(prisma.tenantMembership.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                account: 'companyadmin',
                normalizedAccount: 'companyadmin',
                passwordHash: expect.any(String),
            }),
        });
        expect(prisma.tenant.update).toHaveBeenCalledWith({
            where: { id: TENANT_ID },
            data: { status: TenantStatus.ACTIVE, version: { increment: 1 } },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'TENANT_ACCOUNT_ACTIVATED' }),
        });
    });

    it('generates lowercase pinyin account suggestions', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findMany.mockResolvedValue([]);
        prisma.tenantInvitation.findMany.mockResolvedValue([]);
        const service = new TenantInvitationService(
            prisma as unknown as PrismaService,
            tenantContext() as unknown as TenantContext,
        );

        await expect(service.suggestAccount('张三')).resolves.toEqual({
            suggestedAccount: 'zhangsan',
            available: true,
            alternatives: ['zhangsan2', 'zhangsan3', 'zhangsan4'],
        });
    });

    it('resets a member credential and issues a new activation token', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(memberRecordWithRoles({
            membershipRoles: [{ roleId: ROLE_ID, role: { id: ROLE_ID, code: 'member', name: '普通成员' } }],
        }));
        prisma.tenantInvitation.create.mockResolvedValue({
            ...invitationRecord(),
            targetMembershipId: MEMBERSHIP_ID,
            isInitialAdministrator: false,
        });
        const service = new TenantInvitationService(
            prisma as unknown as PrismaService,
            tenantContext() as unknown as TenantContext,
        );

        const result = await service.resetCredential(MEMBERSHIP_ID);

        expect(result.invitationToken).toEqual(expect.any(String));
        expect(prisma.tenantMembership.update).toHaveBeenCalledWith({
            where: { id: MEMBERSHIP_ID },
            data: expect.objectContaining({
                status: MembershipStatus.PENDING_ACTIVATION,
                passwordHash: null,
            }),
        });
        expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT_ID, membershipId: MEMBERSHIP_ID, revokedAt: null },
            data: { revokedAt: expect.any(Date) },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'TENANT_MEMBER_CREDENTIAL_RESET' }),
        });
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '20000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '30000000-0000-0000-0000-000000000001';
const INVITATION_ID = '40000000-0000-0000-0000-000000000001';
const ROLE_ID = '50000000-0000-0000-0000-000000000001';

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        tenantInvitation: {
            create: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            updateMany: jest.fn(),
        },
        user: { create: jest.fn() },
        tenantMembership: {
            create: jest.fn(),
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            count: jest.fn(),
        },
        authSession: { updateMany: jest.fn() },
        membershipRole: { createMany: jest.fn() },
        tenant: { update: jest.fn(), findUnique: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function tenantContext(): Record<string, jest.Mock> {
    return {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: '30000000-0000-0000-0000-000000000099',
            requestId: 'request-id',
        }),
    };
}

function invitationRecord(): Record<string, unknown> {
    return {
        id: INVITATION_ID,
        tenantId: TENANT_ID,
        account: 'companyadmin',
        normalizedAccount: 'companyadmin',
        displayName: 'Company Administrator',
        targetMembershipId: null,
        status: TenantInvitationStatus.PENDING,
        isInitialAdministrator: true,
        expiresAt: new Date(Date.now() + 60_000),
        invitedByUserId: '60000000-0000-0000-0000-000000000001',
        tenant: tenantRecord(TenantStatus.PENDING_ACTIVATION),
        roles: [{ roleId: ROLE_ID, role: { id: ROLE_ID, code: 'tenant_admin', name: '租户管理员' } }],
    };
}

function tenantRecord(status: TenantStatus): Record<string, unknown> {
    return { id: TENANT_ID, code: 'company-a', name: 'Company A', status, deletedAt: null };
}

function userRecord(): Record<string, unknown> {
    return { id: USER_ID, displayName: 'Company Administrator', status: UserStatus.ACTIVE };
}

function memberRecord(): Record<string, unknown> {
    return { id: MEMBERSHIP_ID, tenantId: TENANT_ID, userId: USER_ID };
}

function memberRecordWithRoles(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        account: 'companyadmin',
        normalizedAccount: 'companyadmin',
        departmentId: null,
        displayName: 'Company Administrator',
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date('2026-09-07T00:00:00.000Z'),
        version: 1,
        user: userRecord(),
        membershipRoles: [{ roleId: ROLE_ID, role: { id: ROLE_ID, code: 'tenant_admin', name: '租户管理员' } }],
        ...overrides,
    };
}
