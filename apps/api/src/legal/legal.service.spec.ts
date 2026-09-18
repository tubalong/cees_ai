import { BadRequestException, ConflictException } from '@nestjs/common';
import { LegalContractStatus, LegalContractType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { DataScopeResolverService } from '../rbac/data-scope-resolver.service';
import { TenantContext } from '../tenant/tenant-context';
import { LegalService } from './legal.service';

describe('LegalService', () => {
    it('applies owner, department and project data scope to list queries', async () => {
        const prisma = createPrismaMock();
        prisma.legalContract.findMany.mockResolvedValue([]);
        const scope = { resolve: jest.fn().mockResolvedValue({
            tenantWide: false, scopes: ['DEPARTMENT'], membershipIds: [MEMBERSHIP_ID],
            departmentIds: [DEPARTMENT_ID], projectIds: [PROJECT_ID],
        }) };
        const service = createService(prisma, ['legal.contract.read'], scope);

        await service.listContracts({ limit: 20 });

        expect(prisma.legalContract.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ AND: [expect.objectContaining({ OR: [
                { ownerMembershipId: { in: [MEMBERSHIP_ID] } },
                { departmentId: { in: [DEPARTMENT_ID] } },
                { projectId: { in: [PROJECT_ID] } },
            ] })] }),
        }));
    });

    it('creates a draft with automatic number, history and audit', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue({ id: MEMBERSHIP_ID });
        prisma.department.findFirst.mockResolvedValue({ id: DEPARTMENT_ID });
        prisma.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
        prisma.tenant.findFirst.mockResolvedValue({ timezone: 'Asia/Shanghai' });
        prisma.legalContractSequence.upsert.mockResolvedValue({ lastNumber: 7 });
        prisma.legalContract.create.mockImplementation(async ({ data }: { data: Record<string, any> }) => contractRecord({ contractNo: data.contractNo }));
        const service = createService(prisma);

        const result = await service.createContract({
            name: '年度服务合同', counterparty: '示例客户', type: LegalContractType.SERVICE,
            currency: 'cny', startDate: '2026-09-17', ownerMembershipId: MEMBERSHIP_ID,
            departmentId: DEPARTMENT_ID, projectId: PROJECT_ID, renewalReminderDays: 30, attachmentIds: [],
        });

        expect(result).toMatchObject({ contractNo: 'HT-2026-000007', status: LegalContractStatus.DRAFT, currency: 'CNY' });
        expect(prisma.legalContract.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                contractNo: 'HT-2026-000007',
                statusHistory: { create: expect.objectContaining({ toStatus: LegalContractStatus.DRAFT }) },
            }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'LEGAL_CONTRACT_CREATED' }),
        }));
    });

    it('intersects expiring and explicit end-date filters', async () => {
        const prisma = createPrismaMock();
        prisma.legalContract.findMany.mockResolvedValue([]);
        const service = createService(prisma);

        await service.listContracts({
            limit: 20,
            expiringWithinDays: 30,
            endDateFrom: '2026-09-20',
            endDateTo: '2026-10-01',
        });

        expect(prisma.legalContract.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                AND: expect.arrayContaining([
                    expect.objectContaining({ endDate: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }) }),
                    { endDate: { gte: new Date('2026-09-20T00:00:00.000Z'), lte: new Date('2026-10-01T00:00:00.000Z') } },
                ]),
            }),
        }));
    });

    it('returns an empty page when expiring is combined with an inactive status', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma);

        await expect(service.listContracts({
            limit: 20,
            status: LegalContractStatus.DRAFT,
            expiringWithinDays: 30,
        })).resolves.toEqual({ items: [], nextCursor: null });
        expect(prisma.legalContract.findMany).not.toHaveBeenCalled();
    });

    it('rejects renewal dates before the current tenant date', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-18T08:00:00.000Z'));
        try {
            const prisma = createPrismaMock();
            prisma.legalContract.findFirst.mockResolvedValue(contractRecord({
                status: LegalContractStatus.EXPIRED,
                endDate: new Date('2026-09-16T00:00:00.000Z'),
            }));
            const service = createService(prisma);

            await expect(service.renewContract(CONTRACT_ID, {
                version: 1,
                newEndDate: '2026-09-17',
            })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'LEGAL_CONTRACT_RENEWAL_DATE_INVALID' }) });
            expect(prisma.legalContract.updateMany).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it('rejects activation when signed date is missing', async () => {
        const prisma = createPrismaMock();
        prisma.legalContract.findFirst.mockResolvedValue(contractRecord({ signedAt: null }));
        const service = createService(prisma);

        await expect(service.activateContract(CONTRACT_ID, { version: 1 })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.legalContract.updateMany).not.toHaveBeenCalled();
    });

    it('rejects stale versions during a state transition', async () => {
        const prisma = createPrismaMock();
        prisma.legalContract.findFirst.mockResolvedValue(contractRecord({ signedAt: new Date('2026-09-16T00:00:00.000Z') }));
        prisma.legalContract.updateMany.mockResolvedValue({ count: 0 });
        const service = createService(prisma);

        await expect(service.activateContract(CONTRACT_ID, { version: 1 })).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.legalContractStatusHistory.create).not.toHaveBeenCalled();
    });

    it('automatically marks contracts pending renewal and expired', async () => {
        const prisma = createPrismaMock();
        prisma.legalContract.findMany.mockResolvedValue([
            lifecycleContract(),
            lifecycleContract({
                id: SECOND_CONTRACT_ID, status: LegalContractStatus.PENDING_RENEWAL, version: 2,
                endDate: new Date('2026-09-16T00:00:00.000Z'),
            }),
        ]);
        prisma.legalContract.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        await expect(service.processLifecycle(new Date('2026-09-17T08:00:00.000Z'))).resolves.toBe(2);
        expect(prisma.legalContractStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ toStatus: LegalContractStatus.PENDING_RENEWAL, actorMembershipId: null }),
        }));
        expect(prisma.legalContractStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ toStatus: LegalContractStatus.EXPIRED, actorMembershipId: null }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
    });

    it('notifies the contract owner when the contract enters the renewal window or expires', async () => {
        const prisma = createPrismaMock();
        prisma.legalContract.findMany.mockResolvedValue([lifecycleContract()]);
        prisma.legalContract.updateMany.mockResolvedValue({ count: 1 });
        const notifications = createNotificationsMock();
        const service = createService(prisma, undefined, undefined, notifications);

        await expect(service.processLifecycle(new Date('2026-09-17T08:00:00.000Z'))).resolves.toBe(1);

        expect(notifications.createForUsers).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: TENANT_ID,
            title: '合同续签提醒',
            relationType: 'LEGAL_CONTRACT',
            relationId: CONTRACT_ID,
            dedupKey: `LEGAL_CONTRACT_RENEWAL_REMINDER:${CONTRACT_ID}:2026-09-30`,
            recipientUserIds: [USER_ID],
        }), expect.anything());
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ metadata: expect.objectContaining({ notificationId: NOTIFICATION_ID }) }),
        }));
    });

    it('keeps the lifecycle transition when the owner is no longer an active member', async () => {
        const prisma = createPrismaMock();
        prisma.legalContract.findMany.mockResolvedValue([lifecycleContract()]);
        prisma.legalContract.updateMany.mockResolvedValue({ count: 1 });
        prisma.tenantMembership.findFirst.mockResolvedValue(null);
        const notifications = createNotificationsMock();
        const service = createService(prisma, undefined, undefined, notifications);

        await expect(service.processLifecycle(new Date('2026-09-17T08:00:00.000Z'))).resolves.toBe(1);
        expect(notifications.createForUsers).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ metadata: expect.objectContaining({ notificationId: null }) }),
        }));
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const DEPARTMENT_ID = '60000000-0000-0000-0000-000000000001';
const PROJECT_ID = '70000000-0000-0000-0000-000000000001';
const CONTRACT_ID = '80000000-0000-0000-0000-000000000001';
const SECOND_CONTRACT_ID = '80000000-0000-0000-0000-000000000002';
const NOTIFICATION_ID = '80000000-0000-0000-0000-0000000000f1';

function createNotificationsMock(): Record<string, any> {
    return { createForUsers: jest.fn().mockResolvedValue(NOTIFICATION_ID) };
}

function createService(
    prisma: Record<string, any>,
    permissions = ['legal.contract.read', 'legal.contract.create', 'legal.contract.update', 'legal.contract.delete', 'legal.contract.manage_all'],
    dataScope: Record<string, any> = { resolve: jest.fn() },
    notifications: Record<string, any> = createNotificationsMock(),
): LegalService {
    const tenantContext = { require: jest.fn().mockReturnValue({
        tenantId: TENANT_ID, userId: USER_ID, membershipId: MEMBERSHIP_ID, requestId: 'request-id',
        roles: ['tenant_admin'], permissions,
    }) } as unknown as TenantContext;
    return new LegalService(prisma as unknown as PrismaService, tenantContext, dataScope as unknown as DataScopeResolverService,
        notifications as unknown as NotificationService);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        legalContract: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
        legalContractSequence: { upsert: jest.fn() },
        legalContractAttachment: { deleteMany: jest.fn(), createMany: jest.fn() },
        legalContractStatusHistory: { create: jest.fn() },
        tenantMembership: { findFirst: jest.fn().mockResolvedValue({ id: MEMBERSHIP_ID, userId: USER_ID }) },
        department: { findFirst: jest.fn().mockResolvedValue({ id: DEPARTMENT_ID }) },
        project: { findFirst: jest.fn().mockResolvedValue({ id: PROJECT_ID }) },
        fileObject: { count: jest.fn() },
        tenant: { findFirst: jest.fn().mockResolvedValue({ timezone: 'Asia/Shanghai' }) },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function lifecycleContract(overrides: Record<string, any> = {}): Record<string, any> {
    return {
        id: CONTRACT_ID, tenantId: TENANT_ID, status: LegalContractStatus.ACTIVE, version: 1,
        endDate: new Date('2026-09-30T00:00:00.000Z'), renewalReminderDays: 30,
        contractNo: 'HT-2026-000001', name: '年度服务合同', ownerMembershipId: MEMBERSHIP_ID,
        tenant: { timezone: 'Asia/Shanghai' }, ...overrides,
    };
}

function contractRecord(overrides: Record<string, any> = {}): Record<string, any> {
    return {
        id: CONTRACT_ID, tenantId: TENANT_ID, contractNo: 'HT-2026-000001', name: '年度服务合同',
        counterparty: '示例客户', type: LegalContractType.SERVICE, amount: new Prisma.Decimal('1000.00'), currency: 'CNY',
        startDate: new Date('2026-09-17T00:00:00.000Z'), endDate: new Date('2027-09-16T00:00:00.000Z'), signedAt: null,
        status: LegalContractStatus.DRAFT, description: null, ownerMembershipId: MEMBERSHIP_ID,
        departmentId: DEPARTMENT_ID, projectId: PROJECT_ID, renewalReminderDays: 30, activatedAt: null,
        terminatedAt: null, terminationReason: null, archivedAt: null, attachments: [], statusHistory: [],
        version: 1, createdAt: new Date('2026-09-17T00:00:00.000Z'), updatedAt: new Date('2026-09-17T00:00:00.000Z'),
        createdBy: USER_ID, updatedBy: USER_ID, deletedAt: null, ...overrides,
    };
}
