import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { ListNotificationsQueryDto } from './dto';
import { NotificationService } from './notification.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const OTHER_USER_ID = '10000000-0000-0000-0000-000000000003';
const MEMBERSHIP_ID = '10000000-0000-0000-0000-000000000004';
const NOTIFICATION_ID = '10000000-0000-0000-0000-000000000005';
const RECIPIENT_ID = '10000000-0000-0000-0000-000000000006';
const NOW = new Date('2026-09-11T00:00:00.000Z');

describe('NotificationService', () => {
    it('limits notification lists to the current tenant and user', async () => {
        const prisma = createPrismaMock();
        prisma.notificationRecipient.findMany.mockResolvedValue([]);
        prisma.notificationRecipient.count.mockResolvedValue(0);
        const service = createService(prisma);

        await service.list({ unreadOnly: true, limit: 20 } as ListNotificationsQueryDto);

        expect(prisma.notificationRecipient.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: TENANT_ID,
                userId: USER_ID,
                readAt: null,
                notification: { tenantId: TENANT_ID, deletedAt: null },
            }),
        }));
        expect(prisma.notificationRecipient.count).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID, readAt: null }),
        }));
    });

    it('rejects a cursor outside the current member scope', async () => {
        const prisma = createPrismaMock();
        prisma.notificationRecipient.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.list({ unreadOnly: false, limit: 20, cursor: RECIPIENT_ID } as ListNotificationsQueryDto))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.notificationRecipient.findMany).not.toHaveBeenCalled();
    });

    it('returns a cursor and the total unread count', async () => {
        const prisma = createPrismaMock();
        prisma.notificationRecipient.findMany.mockResolvedValue([
            recipientRecord({ id: RECIPIENT_ID, readAt: null }),
            recipientRecord({ id: '10000000-0000-0000-0000-000000000007', readAt: NOW }),
        ]);
        prisma.notificationRecipient.count.mockResolvedValue(3);
        const service = createService(prisma);

        await expect(service.list({ unreadOnly: false, limit: 1 } as ListNotificationsQueryDto)).resolves.toEqual(expect.objectContaining({
            items: [expect.objectContaining({ id: NOTIFICATION_ID, readAt: null })],
            nextCursor: RECIPIENT_ID,
            unreadCount: 3,
        }));
    });

    it('marks a visible notification read and audits the action', async () => {
        const prisma = createPrismaMock();
        prisma.notificationRecipient.findFirst.mockResolvedValue(recipientRecord({ readAt: null }));
        const service = createService(prisma);

        const result = await service.markRead(NOTIFICATION_ID);

        expect(result.readAt).toEqual(expect.any(Date));
        expect(prisma.notificationRecipient.update).toHaveBeenCalledWith({
            where: { id: RECIPIENT_ID },
            data: { readAt: expect.any(Date) },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'NOTIFICATION_READ', resourceId: NOTIFICATION_ID }),
        }));
    });

    it('keeps repeated read requests idempotent', async () => {
        const prisma = createPrismaMock();
        prisma.notificationRecipient.findFirst.mockResolvedValue(recipientRecord({ readAt: NOW }));
        const service = createService(prisma);

        const result = await service.markRead(NOTIFICATION_ID);

        expect(result.readAt).toEqual(NOW);
        expect(prisma.notificationRecipient.update).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('does not reveal an unread state for another user', async () => {
        const prisma = createPrismaMock();
        prisma.notificationRecipient.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.markRead(NOTIFICATION_ID)).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.notificationRecipient.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID }),
        }));
    });

    it('marks all visible unread notifications and audits the batch', async () => {
        const prisma = createPrismaMock();
        prisma.notificationRecipient.updateMany.mockResolvedValue({ count: 2 });
        const service = createService(prisma);

        await expect(service.markAllRead()).resolves.toEqual({ updatedCount: 2 });
        expect(prisma.notificationRecipient.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID, readAt: null }),
            data: { readAt: expect.any(Date) },
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'NOTIFICATIONS_READ_ALL', metadata: { updatedCount: 2 } }),
        }));
    });

    it('uses a tenant-scoped deduplication key when creating notifications', async () => {
        const prisma = createPrismaMock();
        prisma.notification.upsert.mockResolvedValue({ id: NOTIFICATION_ID });
        const service = createService(prisma);

        await expect(service.createForUsers({
            tenantId: TENANT_ID,
            title: ' 日报提醒 ',
            content: ' 请提交日报 ',
            dedupKey: 'WORK_REPORT_DAILY_REMINDER:2026-09-10',
            recipientUserIds: [USER_ID, USER_ID, OTHER_USER_ID],
        })).resolves.toBe(NOTIFICATION_ID);

        expect(prisma.notification.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId_dedupKey: { tenantId: TENANT_ID, dedupKey: 'WORK_REPORT_DAILY_REMINDER:2026-09-10' } },
        }));
        expect(prisma.notificationRecipient.createMany).toHaveBeenCalledWith({
            data: [
                { tenantId: TENANT_ID, notificationId: NOTIFICATION_ID, userId: USER_ID },
                { tenantId: TENANT_ID, notificationId: NOTIFICATION_ID, userId: OTHER_USER_ID },
            ],
            skipDuplicates: true,
        });
    });
});

function createService(prisma: Record<string, any>): NotificationService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: [],
            permissions: ['notification.read'],
        }),
    } as unknown as TenantContext;
    return new NotificationService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        notification: { create: jest.fn(), upsert: jest.fn() },
        notificationRecipient: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            createMany: jest.fn(),
        },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function recipientRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: RECIPIENT_ID,
        tenantId: TENANT_ID,
        notificationId: NOTIFICATION_ID,
        userId: USER_ID,
        readAt: null,
        createdAt: NOW,
        notification: {
            id: NOTIFICATION_ID,
            title: '日报提交提醒',
            content: '请提交日报',
            channel: 'IN_APP',
            relationType: 'WORK_REPORT',
            relationId: null,
            createdAt: NOW,
            recipients: [],
        },
        ...overrides,
    };
}
