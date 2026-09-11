import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { CreateNotificationInput, NotificationListResult, NotificationResult } from './notification.types';
import { ListNotificationsQueryDto } from './dto';

const notificationSelect = {
    id: true,
    title: true,
    content: true,
    channel: true,
    relationType: true,
    relationId: true,
    createdAt: true,
    recipients: {
        select: { readAt: true },
    },
} satisfies Prisma.NotificationSelect;

type NotificationRecord = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;
type NotificationDb = PrismaService | Prisma.TransactionClient;

@Injectable()
export class NotificationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async list(query: ListNotificationsQueryDto): Promise<NotificationListResult> {
        const context = this.tenantContext.require();
        const recipientWhere = {
            tenantId: context.tenantId,
            userId: context.userId,
            notification: { tenantId: context.tenantId, deletedAt: null },
            readAt: query.unreadOnly ? null : undefined,
        } satisfies Prisma.NotificationRecipientWhereInput;
        let cursorId: string | undefined;
        if (query.cursor) {
            const cursor = await this.prisma.notificationRecipient.findFirst({
                where: { ...recipientWhere, id: query.cursor },
                select: { id: true },
            });
            if (!cursor) throw this.invalidCursor();
            cursorId = cursor.id;
        }
        const recipients = await this.prisma.notificationRecipient.findMany({
            where: recipientWhere,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: cursorId ? { id: cursorId } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
            include: { notification: { select: notificationSelect } },
        });
        const hasNextPage = recipients.length > query.limit;
        const page = hasNextPage ? recipients.slice(0, query.limit) : recipients;
        const unreadCount = await this.prisma.notificationRecipient.count({ where: { ...recipientWhere, readAt: null } });
        return {
            items: page.map((recipient) => toNotificationResult(recipient.notification, recipient.readAt)),
            nextCursor: hasNextPage ? page.at(-1)?.id ?? null : null,
            unreadCount,
        };
    }

    async unreadCount(): Promise<{ unreadCount: number }> {
        const { tenantId, userId } = this.tenantContext.require();
        const unreadCount = await this.prisma.notificationRecipient.count({
            where: { tenantId, userId, readAt: null, notification: { tenantId, deletedAt: null } },
        });
        return { unreadCount };
    }

    async markRead(notificationId: string): Promise<NotificationResult> {
        const context = this.tenantContext.require();
        const recipient = await this.prisma.notificationRecipient.findFirst({
            where: { tenantId: context.tenantId, userId: context.userId, notificationId, notification: { tenantId: context.tenantId, deletedAt: null } },
            include: { notification: { select: notificationSelect } },
        });
        if (!recipient) throw this.notFound();
        if (!recipient.readAt) {
            await this.prisma.$transaction(async (transaction) => {
                await transaction.notificationRecipient.update({ where: { id: recipient.id }, data: { readAt: new Date() } });
                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: 'NOTIFICATION_READ',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'NOTIFICATION',
                        resourceId: notificationId,
                        requestId: context.requestId,
                        metadata: {},
                    },
                });
            });
        }
        return toNotificationResult(recipient.notification, recipient.readAt ?? new Date());
    }

    async markAllRead(): Promise<{ updatedCount: number }> {
        const context = this.tenantContext.require();
        const result = await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.notificationRecipient.updateMany({
                where: { tenantId: context.tenantId, userId: context.userId, readAt: null, notification: { tenantId: context.tenantId, deletedAt: null } },
                data: { readAt: new Date() },
            });
            if (updated.count > 0) {
                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: 'NOTIFICATIONS_READ_ALL',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'NOTIFICATION',
                        resourceId: null,
                        requestId: context.requestId,
                        metadata: { updatedCount: updated.count },
                    },
                });
            }
            return updated.count;
        });
        return { updatedCount: result };
    }

    async createForUsers(input: CreateNotificationInput, db: NotificationDb = this.prisma): Promise<string> {
        const recipientUserIds = [...new Set(input.recipientUserIds)];
        if (recipientUserIds.length === 0) throw new BadRequestException({ code: 'NOTIFICATION_RECIPIENT_REQUIRED', message: '\u901a\u77e5\u5fc5\u987b\u81f3\u5c11\u5305\u542b\u4e00\u4e2a\u63a5\u6536\u4eba' });
        const notification = input.dedupKey
            ? await db.notification.upsert({
                where: { tenantId_dedupKey: { tenantId: input.tenantId, dedupKey: input.dedupKey } },
                update: {},
                create: notificationCreateData(input),
                select: { id: true },
            })
            : await db.notification.create({ data: notificationCreateData(input), select: { id: true } });
        await db.notificationRecipient.createMany({
            data: recipientUserIds.map((userId) => ({ tenantId: input.tenantId, notificationId: notification.id, userId })),
            skipDuplicates: true,
        });
        return notification.id;
    }

    private invalidCursor(): BadRequestException { return new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '\u5206\u9875\u6e38\u6807\u65e0\u6548' }); }
    private notFound(): NotFoundException { return new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: '\u901a\u77e5\u4e0d\u5b58\u5728\u6216\u5f53\u524d\u6210\u5458\u4e0d\u53ef\u89c1' }); }
}

function notificationCreateData(input: CreateNotificationInput): Prisma.NotificationUncheckedCreateInput {
    return {
        tenantId: input.tenantId,
        title: input.title.trim(),
        content: input.content.trim(),
        channel: input.channel ?? 'IN_APP',
        relationType: input.relationType ?? null,
        relationId: input.relationId ?? null,
        dedupKey: input.dedupKey ?? null,
        createdBy: input.createdBy ?? null,
        updatedBy: input.createdBy ?? null,
    };
}

function toNotificationResult(record: NotificationRecord, readAt: Date | null): NotificationResult {
    return {
        id: record.id,
        title: record.title,
        content: record.content,
        channel: record.channel,
        relationType: record.relationType,
        relationId: record.relationId,
        readAt,
        createdAt: record.createdAt,
    };
}
