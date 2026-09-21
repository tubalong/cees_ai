import { Injectable } from '@nestjs/common';
import { DashboardSnapshotPeriod, FinanceLedgerDirection, FinanceExpenseStatus, Prisma, TaskStatus } from '@prisma/client';
import { addLocalDays, dateKeyToUtcMidnight, shiftLocalDateKey, startOfLocalDate } from '../common/tenant-time';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DashboardSnapshotService {
    constructor(private readonly prisma: PrismaService) { }

    async rebuildTenantDay(tenantId: string, dateKey: string): Promise<{ periodStart: Date; count: number }> {
        const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { timezone: true } });
        const timeZone = tenant?.timezone ?? 'Asia/Shanghai';
        const periodStart = dateKeyToUtcMidnight(dateKey);
        const dayStart = startOfLocalDate(timeZone, dateKey);
        const dayEnd = addLocalDays(timeZone, dayStart, 1);
        const [taskCreated, taskDone, overdue, meetings, meetingDuration, reports, income, expense, reimbursePending] = await Promise.all([
            this.prisma.task.count({ where: { tenantId, deletedAt: null, createdAt: { gte: dayStart, lt: dayEnd } } }),
            this.prisma.task.count({ where: { tenantId, deletedAt: null, completedAt: { gte: dayStart, lt: dayEnd } } }),
            this.prisma.task.count({ where: { tenantId, deletedAt: null, dueDate: { lt: dayEnd }, status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED] } } }),
            this.prisma.meeting.count({ where: { tenantId, deletedAt: null, startsAt: { gte: dayStart, lt: dayEnd }, status: { not: 'CANCELLED' } } }),
            this.prisma.meeting.aggregate({ where: { tenantId, deletedAt: null, startsAt: { gte: dayStart, lt: dayEnd }, status: { not: 'CANCELLED' } }, _sum: { durationMinutes: true } }),
            this.prisma.workReport.count({ where: { tenantId, deletedAt: null, type: 'DAILY', periodStart, status: { in: ['SUBMITTED', 'APPROVED'] } } }),
            this.prisma.financeLedgerEntry.aggregate({ where: { tenantId, deletedAt: null, occurredOn: periodStart, direction: FinanceLedgerDirection.INCOME }, _sum: { amount: true } }),
            this.prisma.financeLedgerEntry.aggregate({ where: { tenantId, deletedAt: null, occurredOn: periodStart, direction: FinanceLedgerDirection.EXPENSE }, _sum: { amount: true } }),
            this.prisma.financeExpenseReport.aggregate({ where: { tenantId, deletedAt: null, status: FinanceExpenseStatus.APPROVED }, _sum: { totalAmount: true } }),
        ]);
        const values: Array<[string, Prisma.Decimal | number]> = [
            ['task.created.count', taskCreated], ['task.done.count', taskDone], ['task.overdue.count', overdue],
            ['meeting.held.count', meetings], ['meeting.duration.minutes', meetingDuration._sum.durationMinutes ?? 0],
            ['report.daily.submitted.count', reports], ['finance.income.amount', income._sum.amount ?? 0],
            ['finance.expense.amount', expense._sum.amount ?? 0], ['finance.reimburse.pending.amount', reimbursePending._sum.totalAmount ?? 0],
        ];
        for (const [metricKey, value] of values) {
            await this.prisma.dashboardMetricSnapshot.upsert({
                where: { tenantId_metricKey_period_periodStart_scopeKey: { tenantId, metricKey, period: DashboardSnapshotPeriod.DAY, periodStart, scopeKey: 'TENANT' } },
                create: { tenantId, metricKey, period: DashboardSnapshotPeriod.DAY, periodStart, value: String(value), meta: { gauge: metricKey.includes('overdue') || metricKey.includes('pending') } },
                update: { value: String(value), computedAt: new Date(), meta: { gauge: metricKey.includes('overdue') || metricKey.includes('pending') } },
            });
        }
        await this.rebuildTenantMonth(tenantId, dateKey.slice(0, 7));
        return { periodStart, count: values.length };
    }

    async rebuildTenantMonth(tenantId: string, monthKey: string): Promise<void> {
        const [year, month] = monthKey.split('-').map(Number);
        const periodStart = new Date(Date.UTC(year, month - 1, 1));
        const next = new Date(Date.UTC(year, month, 1));
        const metrics = await this.prisma.dashboardMetricSnapshot.findMany({ where: { tenantId, period: DashboardSnapshotPeriod.DAY, periodStart: { gte: periodStart, lt: next }, scopeKey: 'TENANT' }, orderBy: { periodStart: 'asc' } });
        const aggregates = new Map<string, { value: Prisma.Decimal; gauge: boolean }>();
        for (const item of metrics) {
            const gauge = Boolean((item.meta as { gauge?: boolean } | null)?.gauge);
            const current = aggregates.get(item.metricKey);
            aggregates.set(item.metricKey, { value: gauge ? item.value : (current?.value ?? new Prisma.Decimal(0)).plus(item.value), gauge });
        }
        for (const [metricKey, aggregate] of aggregates) {
            const { value, gauge } = aggregate;
            await this.prisma.dashboardMetricSnapshot.upsert({
                where: { tenantId_metricKey_period_periodStart_scopeKey: { tenantId, metricKey, period: DashboardSnapshotPeriod.MONTH, periodStart, scopeKey: 'TENANT' } },
                create: { tenantId, metricKey, period: DashboardSnapshotPeriod.MONTH, periodStart, value, meta: { derivedFrom: 'DAY', gauge } },
                update: { value, computedAt: new Date(), meta: { derivedFrom: 'DAY', gauge } },
            });
        }
    }
}