import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { RedisService } from '../redis/redis.service';
import { BackgroundJobsService } from './background-jobs.service';

const TENANT_ID = '20000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000002';
const USER_ID = '20000000-0000-0000-0000-000000000003';
const NOW = new Date('2026-09-11T08:00:00.000Z');

describe('BackgroundJobsService', () => {
    afterEach(() => {
        delete process.env.BACKGROUND_JOBS_ENABLED;
        delete process.env.BACKGROUND_JOBS_INTERVAL_SECONDS;
    });

    it('skips execution when another instance owns the Redis lock', async () => {
        const prisma = createPrismaMock();
        const redis = createRedisMock({ setIfAbsent: jest.fn().mockResolvedValue(false) });
        const notifications = createNotificationMock();
        const auditRetention = createAuditRetentionMock();
        const service = createService(prisma, redis, notifications, auditRetention);

        await expect(service.runOnce(NOW)).resolves.toEqual({
            skipped: true,
            expiredUploadSessions: 0,
            expiredAiActionDrafts: 0,
            workReportReminderNotifications: 0,
            legalContractTransitions: 0,
            hrEmployeeChangesApplied: 0,
            purgedConnectorReadEvents: 0,
            archivedAuditEvents: 0,
        });
        expect(prisma.uploadSession.updateMany).not.toHaveBeenCalled();
        expect(auditRetention.runOnce).not.toHaveBeenCalled();
    });

    it('expires upload sessions and AI action drafts under the lock', async () => {
        const prisma = createPrismaMock();
        prisma.uploadSession.updateMany.mockResolvedValue({ count: 2 });
        prisma.aIActionDraft.updateMany.mockResolvedValue({ count: 1 });
        prisma.tenantMembership.findMany.mockResolvedValue([]);
        const redis = createRedisMock();
        const auditRetention = createAuditRetentionMock();
        const service = createService(prisma, redis, createNotificationMock(), auditRetention);

        await expect(service.runOnce(NOW)).resolves.toEqual(expect.objectContaining({
            skipped: false,
            expiredUploadSessions: 2,
            expiredAiActionDrafts: 1,
            workReportReminderNotifications: 0,
            purgedConnectorReadEvents: 0,
            archivedAuditEvents: 0,
        }));
        expect(auditRetention.runOnce).toHaveBeenCalledWith(NOW);
        expect(prisma.uploadSession.updateMany).toHaveBeenCalledWith({
            where: { status: 'PENDING', expiresAt: { lte: NOW } },
            data: { status: 'EXPIRED', failureCode: 'UPLOAD_SESSION_EXPIRED' },
        });
        expect(prisma.aIActionDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: 'PENDING_CONFIRMATION', expiresAt: { lte: NOW }, deletedAt: null }),
            data: { status: 'EXPIRED' },
        }));
        expect(redis.deleteIfValue).toHaveBeenCalledWith('jobs:notification-center-runner', expect.any(String));
    });

    it('notifies only members without a submitted or approved report', async () => {
        const prisma = createPrismaMock();
        prisma.uploadSession.updateMany.mockResolvedValue({ count: 0 });
        prisma.aIActionDraft.updateMany.mockResolvedValue({ count: 0 });
        prisma.tenantMembership.findMany.mockResolvedValue([
            { id: MEMBERSHIP_ID, tenantId: TENANT_ID, userId: USER_ID },
            { id: '20000000-0000-0000-0000-000000000004', tenantId: TENANT_ID, userId: '20000000-0000-0000-0000-000000000005' },
        ]);
        prisma.workReport.findMany.mockResolvedValue([{ authorMembershipId: MEMBERSHIP_ID }]);
        const notifications = createNotificationMock();
        const service = createService(prisma, createRedisMock(), notifications);

        await expect(service.runOnce(NOW)).resolves.toEqual(expect.objectContaining({
            workReportReminderNotifications: 1,
        }));
        expect(notifications.createForUsers).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: TENANT_ID,
            relationType: 'WORK_REPORT',
            dedupKey: 'WORK_REPORT_DAILY_REMINDER:2026-09-10',
            recipientUserIds: ['20000000-0000-0000-0000-000000000005'],
        }));
    });

    it('does not create a reminder when all members submitted reports', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findMany.mockResolvedValue([{ id: MEMBERSHIP_ID, tenantId: TENANT_ID, userId: USER_ID }]);
        prisma.workReport.findMany.mockResolvedValue([{ authorMembershipId: MEMBERSHIP_ID }]);
        const notifications = createNotificationMock();
        const service = createService(prisma, createRedisMock(), notifications);

        await expect(service.runOnce(NOW)).resolves.toEqual(expect.objectContaining({ workReportReminderNotifications: 0 }));
        expect(notifications.createForUsers).not.toHaveBeenCalled();
    });

    it('resolves the reminder day boundary per tenant time zone', async () => {
        const otherTenantId = '20000000-0000-0000-0000-000000000009';
        const otherMembershipId = '20000000-0000-0000-0000-000000000010';
        const otherUserId = '20000000-0000-0000-0000-000000000011';
        const prisma = createPrismaMock();
        prisma.tenantMembership.findMany.mockResolvedValue([
            { id: MEMBERSHIP_ID, tenantId: TENANT_ID, userId: USER_ID },
            { id: otherMembershipId, tenantId: otherTenantId, userId: otherUserId },
        ]);
        prisma.tenant.findMany.mockResolvedValue([
            { id: TENANT_ID, timezone: 'Asia/Shanghai' },
            { id: otherTenantId, timezone: 'UTC' },
        ]);
        const notifications = createNotificationMock();
        const service = createService(prisma, createRedisMock(), notifications);

        // 2026-09-11T23:30Z 在东八区已经是 9 月 12 日 07:30，因此“昨天”分别是 09-11 与 09-10。
        const result = await service.runOnce(new Date('2026-09-11T23:30:00.000Z'));

        expect(result.workReportReminderNotifications).toBe(2);
        expect(notifications.createForUsers).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: TENANT_ID,
            dedupKey: 'WORK_REPORT_DAILY_REMINDER:2026-09-11',
        }));
        expect(notifications.createForUsers).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: otherTenantId,
            dedupKey: 'WORK_REPORT_DAILY_REMINDER:2026-09-10',
        }));
        expect(prisma.workReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: expect.arrayContaining([
                    expect.objectContaining({
                        periodStart: {
                            gte: new Date('2026-09-11T00:00:00.000Z'),
                            lt: new Date('2026-09-12T00:00:00.000Z'),
                        },
                    }),
                    expect.objectContaining({
                        periodStart: {
                            gte: new Date('2026-09-10T00:00:00.000Z'),
                            lt: new Date('2026-09-11T00:00:00.000Z'),
                        },
                    }),
                ]),
            }),
        }));
    });
});

function createPrismaMock(): Record<string, any> {
    return {
        uploadSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        aIActionDraft: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
        tenant: { findMany: jest.fn().mockResolvedValue([{ id: TENANT_ID, timezone: 'Asia/Shanghai' }]) },
        workReport: { findMany: jest.fn().mockResolvedValue([]) },
    };
}

function createRedisMock(overrides: Record<string, jest.Mock> = {}): Record<string, any> {
    return {
        setIfAbsent: jest.fn().mockResolvedValue(true),
        deleteIfValue: jest.fn().mockResolvedValue(true),
        delete: jest.fn().mockResolvedValue(1),
        ...overrides,
    };
}

function createNotificationMock(): Record<string, any> {
    return { createForUsers: jest.fn().mockResolvedValue('notification-id') };
}

function createAuditRetentionMock(): Record<string, any> {
    return { runOnce: jest.fn().mockResolvedValue({ purgedConnectorReadEvents: 0, archivedAuditEvents: 0 }) };
}

function createService(
    prisma: Record<string, any>,
    redis: Record<string, any>,
    notifications = createNotificationMock(),
    auditRetention = createAuditRetentionMock(),
): BackgroundJobsService {
    const legalService = { processLifecycle: jest.fn().mockResolvedValue(0) };
    const hrService = { processApprovedEmployeeChanges: jest.fn().mockResolvedValue(0) };
    return new BackgroundJobsService(
        prisma as unknown as PrismaService,
        redis as unknown as RedisService,
        notifications as unknown as NotificationService,
        legalService as any,
        hrService as any,
        auditRetention as any,
    );
}
