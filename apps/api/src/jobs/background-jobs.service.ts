import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DraftStatus, MembershipStatus, Prisma, UserStatus, WorkReportStatus, WorkReportType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { RedisService } from '../redis/redis.service';

export interface BackgroundJobRunResult {
    skipped: boolean;
    expiredUploadSessions: number;
    expiredAiActionDrafts: number;
    workReportReminderNotifications: number;
}

const DEFAULT_INTERVAL_SECONDS = 60;
const LOCK_KEY = 'jobs:notification-center-runner';

@Injectable()
export class BackgroundJobsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(BackgroundJobsService.name);
    private timer: NodeJS.Timeout | undefined;
    private readonly intervalSeconds = readPositiveInteger(process.env.BACKGROUND_JOBS_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly notifications: NotificationService,
    ) { }

    onModuleInit(): void {
        if (process.env.BACKGROUND_JOBS_ENABLED === 'false') return;
        this.timer = setInterval(() => void this.runOnce().catch((error: unknown) => this.logger.error(error)), this.intervalSeconds * 1000);
        this.timer.unref();
    }

    onModuleDestroy(): void {
        if (this.timer) clearInterval(this.timer);
    }

    async runOnce(now = new Date()): Promise<BackgroundJobRunResult> {
        const lockToken = randomUUID();
        const acquired = await this.redis.setIfAbsent(LOCK_KEY, lockToken, Math.max(this.intervalSeconds * 2, 30));
        if (!acquired) return { skipped: true, expiredUploadSessions: 0, expiredAiActionDrafts: 0, workReportReminderNotifications: 0 };
        try {
            const expiredUploadSessions = await this.expireUploadSessions(now);
            const expiredAiActionDrafts = await this.expireAiActionDrafts(now);
            const workReportReminderNotifications = await this.createDailyReportReminders(now);
            return { skipped: false, expiredUploadSessions, expiredAiActionDrafts, workReportReminderNotifications };
        } finally {
            await this.redis.deleteIfValue(LOCK_KEY, lockToken);
        }
    }

    private async expireUploadSessions(now: Date): Promise<number> {
        const result = await this.prisma.uploadSession.updateMany({
            where: { status: 'PENDING', expiresAt: { lte: now } },
            data: { status: 'EXPIRED', failureCode: 'UPLOAD_SESSION_EXPIRED' },
        });
        return result.count;
    }

    private async expireAiActionDrafts(now: Date): Promise<number> {
        const result = await this.prisma.aIActionDraft.updateMany({
            where: { status: DraftStatus.PENDING_CONFIRMATION, expiresAt: { lte: now }, deletedAt: null },
            data: { status: DraftStatus.EXPIRED },
        });
        return result.count;
    }

    private async createDailyReportReminders(now: Date): Promise<number> {
        const periodStart = utcStartOfDay(addDays(now, -1));
        const periodEnd = addDays(periodStart, 1);
        const memberships = await this.prisma.tenantMembership.findMany({
            where: {
                status: MembershipStatus.ACTIVE,
                deletedAt: null,
                user: { status: UserStatus.ACTIVE, deletedAt: null },
            },
            select: { id: true, tenantId: true, userId: true },
        });
        if (memberships.length === 0) return 0;
        const submittedReports = await this.prisma.workReport.findMany({
            where: {
                type: WorkReportType.DAILY,
                status: { in: [WorkReportStatus.SUBMITTED, WorkReportStatus.APPROVED] },
                deletedAt: null,
                periodStart: { gte: periodStart, lt: periodEnd },
                authorMembershipId: { in: memberships.map((membership) => membership.id) },
            },
            select: { authorMembershipId: true },
        });
        const submittedMembershipIds = new Set(submittedReports.map((report) => report.authorMembershipId));
        const recipientsByTenant = new Map<string, string[]>();
        for (const membership of memberships) {
            if (submittedMembershipIds.has(membership.id)) continue;
            const recipients = recipientsByTenant.get(membership.tenantId) ?? [];
            recipients.push(membership.userId);
            recipientsByTenant.set(membership.tenantId, recipients);
        }
        let created = 0;
        for (const [tenantId, recipientUserIds] of recipientsByTenant) {
            await this.notifications.createForUsers({
                tenantId,
                title: '\u65e5\u62a5\u63d0\u4ea4\u63d0\u9192',
                content: `\u60a8\u5c1a\u672a\u63d0\u4ea4 ${formatDate(periodStart)} \u7684\u65e5\u62a5\uff0c\u8bf7\u53ca\u65f6\u8865\u5145\u3002`,
                relationType: 'WORK_REPORT',
                dedupKey: `WORK_REPORT_DAILY_REMINDER:${formatDate(periodStart)}`,
                recipientUserIds,
            });
            created += 1;
        }
        return created;
    }
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function utcStartOfDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}
