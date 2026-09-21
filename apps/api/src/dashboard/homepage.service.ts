import { Injectable } from '@nestjs/common';
import { DashboardSnapshotPeriod, FinanceExpenseStatus, LegalContractStatus, Prisma, TaskStatus } from '@prisma/client';
import { addLocalDays, dateKeyToUtcMidnight, shiftLocalDateKey, startOfLocalDay } from '../common/tenant-time';
import { PrismaService } from '../database/prisma.service';
import { DataScopeResolverService } from '../rbac/data-scope-resolver.service';
import { TenantContext } from '../tenant/tenant-context';
import { DashboardTrendsQueryDto } from './dto';
import { DashboardService } from './dashboard.service';
import { DashboardCardSpan, DashboardDomain, DashboardHomepageCard, DashboardHomepageResult, DashboardSkeleton, DashboardTrendsResult } from './homepage.types';

const GLOBAL_DOMAIN_PERMISSIONS = [
    'project.manage_all', 'meeting.manage_all', 'work_report.manage_all',
    'hr.leave.manage_all', 'finance.expense.manage_all', 'legal.contract.manage_all',
];
const APPROVAL_PERMISSIONS = [
    'work_report.review', 'hr.leave.approve', 'hr.overtime.approve', 'hr.attendance.approve',
    'hr.employee_change.approve', 'finance.expense.approve',
];

@Injectable()
export class DashboardHomepageService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly dataScopeResolver: DataScopeResolverService,
        private readonly dashboard: DashboardService,
    ) { }

    async home(): Promise<DashboardHomepageResult> {
        const context = this.tenantContext.require();
        const skeleton = this.skeleton(context.permissions);
        const domains = this.domains(context.permissions);
        const cards: DashboardHomepageCard[] = [];
        const alerts: DashboardHomepageResult['alerts'] = [];
        const overview = await this.dashboard.overview();

        if (skeleton === 'EMPLOYEE') {
            const [todos, meetings] = await Promise.all([
                this.dashboard.todos({ taskLimit: 6, reportLimit: 6, meetingLimit: 6 }),
                context.permissions.includes('meeting.read') ? this.dashboard.upcomingMeetings({ limit: 6 }) : Promise.resolve({ items: [] }),
            ]);
            cards.push(card('employee.focus', 'HALF', { tasks: todos.tasks, reports: todos.reports }), card('employee.timeline', 'HALF', { meetings: meetings.items }));
            if (context.permissions.includes('work_report.read')) cards.push(card('employee.dailyReport', 'THIRD', overview.report));
            if (context.permissions.includes('notification.read')) cards.push(card('employee.notifications', 'THIRD', overview.notification, '/notifications'));
        } else {
            cards.push(card('overview.keyMetrics', 'FULL', { project: overview.project, task: overview.task, report: overview.report, meeting: overview.meeting }));
            if (context.permissions.includes('project.read')) cards.push(...await this.projectCards(skeleton));
            if (skeleton === 'MANAGER') cards.push(card('manager.approvals', 'HALF', { pendingReports: overview.report.pendingReview }));
        }
        if (domains.includes('FINANCE')) cards.push(...await this.financeCards(alerts));
        if (domains.includes('LEGAL')) cards.push(...await this.legalCards(alerts));
        return {
            archetype: { skeleton, domains, reason: this.reasons(context.permissions, skeleton, domains) },
            cards, alerts: alerts.slice(0, 5), generatedAt: new Date(),
        };
    }

    async trends(query: DashboardTrendsQueryDto): Promise<DashboardTrendsResult> {
        const { tenantId } = this.tenantContext.require();
        const items = await this.prisma.dashboardMetricSnapshot.findMany({
            where: {
                tenantId, metricKey: { in: query.metrics }, period: query.period,
                periodStart: { gte: dateKeyToUtcMidnight(query.from), lte: dateKeyToUtcMidnight(query.to) },
            },
            orderBy: [{ periodStart: 'asc' }, { metricKey: 'asc' }],
        });
        return { period: query.period, items: items.map((item) => ({ ...item, value: item.value.toString(), meta: item.meta })) };
    }

    private skeleton(permissions: string[]): DashboardSkeleton {
        if (GLOBAL_DOMAIN_PERMISSIONS.filter((permission) => permissions.includes(permission)).length >= 3) return 'EXECUTIVE';
        if (permissions.includes('department.read') && APPROVAL_PERMISSIONS.some((permission) => permissions.includes(permission))) return 'MANAGER';
        return 'EMPLOYEE';
    }

    private domains(permissions: string[]): DashboardDomain[] {
        const domains: DashboardDomain[] = [];
        if (permissions.includes('finance.expense.manage_all') || permissions.includes('finance.ledger.read') || permissions.includes('finance.ledger.manage')) domains.push('FINANCE');
        if (permissions.includes('legal.contract.manage_all')) domains.push('LEGAL');
        if (permissions.includes('hr.profile.manage') || permissions.includes('hr.report.read')) domains.push('HR');
        if (permissions.includes('project.manage_all')) domains.push('PROJECT');
        return domains;
    }

    private reasons(permissions: string[], skeleton: DashboardSkeleton, domains: DashboardDomain[]): string[] {
        const candidates = [...GLOBAL_DOMAIN_PERMISSIONS, ...APPROVAL_PERMISSIONS, 'department.read', 'finance.ledger.read', 'finance.ledger.manage', 'hr.profile.manage', 'hr.report.read'];
        return candidates.filter((permission) => permissions.includes(permission)).concat(`skeleton:${skeleton}`, ...domains.map((domain) => `domain:${domain}`));
    }

    private async projectCards(skeleton: DashboardSkeleton): Promise<DashboardHomepageCard[]> {
        const context = this.tenantContext.require();
        const scope = await this.dataScopeResolver.resolveFor(context);
        const projectWhere: Prisma.ProjectWhereInput = {
            tenantId: context.tenantId, deletedAt: null,
            ...(scope.tenantWide ? {} : { OR: [
                scope.projectIds.length ? { id: { in: scope.projectIds } } : undefined,
                scope.departmentIds.length ? { departmentId: { in: scope.departmentIds } } : undefined,
                scope.membershipIds.length ? { members: { some: { membershipId: { in: scope.membershipIds }, deletedAt: null } } } : undefined,
            ].filter(Boolean) as Prisma.ProjectWhereInput[] }),
        };
        const projects = await this.prisma.project.findMany({ where: projectWhere, select: { id: true, name: true, status: true, tasks: { where: { deletedAt: null }, select: { status: true, dueDate: true, updatedAt: true } }, _count: { select: { members: { where: { deletedAt: null } } } } } });
        const now = new Date();
        const rows = projects.map((project) => {
            const active = project.tasks.filter((task) => task.status !== TaskStatus.CANCELLED);
            const done = active.filter((task) => task.status === TaskStatus.DONE).length;
            const overdue = active.filter((task) => task.dueDate && task.dueDate < now && task.status !== TaskStatus.DONE).length;
            return { id: project.id, name: project.name, status: project.status, completionRate: active.length ? done / active.length : 0, overdueRate: active.length ? overdue / active.length : 0, memberCount: project._count.members };
        });
        return [card('project.health', skeleton === 'EXECUTIVE' ? 'FULL' : 'HALF', { items: rows })];
    }

    private async financeCards(alerts: DashboardHomepageResult['alerts']): Promise<DashboardHomepageCard[]> {
        const { tenantId } = this.tenantContext.require();
        const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId }, select: { timezone: true } });
        const dateKey = shiftLocalDateKey(tenant?.timezone ?? 'Asia/Shanghai', new Date(), -1);
        const yesterday = dateKeyToUtcMidnight(dateKey);
        const monthStart = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth() - 1, 1));
        const [snapshots, pending, oldest, upload] = await Promise.all([
            this.prisma.dashboardMetricSnapshot.findMany({ where: { tenantId, periodStart: { in: [yesterday, monthStart] }, metricKey: { in: ['finance.income.amount', 'finance.expense.amount'] } } }),
            this.prisma.financeExpenseReport.aggregate({ where: { tenantId, deletedAt: null, status: FinanceExpenseStatus.APPROVED }, _count: true, _sum: { totalAmount: true } }),
            this.prisma.financeExpenseReport.findFirst({ where: { tenantId, deletedAt: null, status: FinanceExpenseStatus.APPROVED }, orderBy: { reviewedAt: 'asc' }, select: { reviewedAt: true } }),
            this.prisma.financeLedgerImport.findFirst({ where: { tenantId, deletedAt: null, periodStart: { lte: yesterday }, periodEnd: { gte: yesterday } }, orderBy: { createdAt: 'desc' } }),
        ]);
        const value = (period: DashboardSnapshotPeriod, key: string): string => snapshots.find((item) => item.period === period && item.metricKey === key)?.value.toString() ?? '0';
        const yesterdayIncome = value(DashboardSnapshotPeriod.DAY, 'finance.income.amount');
        const yesterdayExpense = value(DashboardSnapshotPeriod.DAY, 'finance.expense.amount');
        const monthIncome = value(DashboardSnapshotPeriod.MONTH, 'finance.income.amount');
        const monthExpense = value(DashboardSnapshotPeriod.MONTH, 'finance.expense.amount');
        if (!upload) alerts.push({ code: 'FINANCE_LEDGER_MISSING', severity: 'HIGH', title: '昨日收支台账未上传', detail: `${dateKey} 尚无财务台账`, link: '/finance' });
        return [
            card('finance.yesterdayLedger', 'HALF', { date: dateKey, income: yesterdayIncome, expense: yesterdayExpense, net: new Prisma.Decimal(yesterdayIncome).minus(yesterdayExpense).toString(), uploaded: Boolean(upload) }, '/finance'),
            card('finance.monthLedger', 'HALF', { month: monthStart.toISOString().slice(0, 7), income: monthIncome, expense: monthExpense, net: new Prisma.Decimal(monthIncome).minus(monthExpense).toString() }, '/finance'),
            card('finance.pendingPayment', 'THIRD', { count: pending._count, amount: pending._sum.totalAmount?.toString() ?? '0', oldestReviewedAt: oldest?.reviewedAt ?? null }, '/finance'),
        ];
    }

    private async legalCards(alerts: DashboardHomepageResult['alerts']): Promise<DashboardHomepageCard[]> {
        const { tenantId } = this.tenantContext.require();
        const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId }, select: { timezone: true } });
        const timeZone = tenant?.timezone ?? 'Asia/Shanghai';
        const now = startOfLocalDay(timeZone, new Date());
        const in90Days = addLocalDays(timeZone, now, 90);
        const contracts = await this.prisma.legalContract.findMany({ where: { tenantId, deletedAt: null }, select: { id: true, name: true, status: true, endDate: true, renewalReminderDays: true, amount: true, currency: true } });
        const status = Object.values(LegalContractStatus).reduce<Record<string, number>>((result, item) => ({ ...result, [item]: contracts.filter((contract) => contract.status === item).length }), {});
        const expiring = contracts.filter((contract) => contract.status === LegalContractStatus.ACTIVE && contract.endDate && contract.endDate <= in90Days).sort((a, b) => (a.endDate?.getTime() ?? 0) - (b.endDate?.getTime() ?? 0));
        if (expiring.some((contract) => contract.endDate && contract.endDate <= addLocalDays(timeZone, now, 15))) alerts.push({ code: 'LEGAL_CONTRACT_EXPIRING', severity: 'HIGH', title: '合同即将到期', detail: '15 天内存在待处理合同', link: '/legal' });
        return [card('legal.funnel', 'HALF', { status }, '/legal'), card('legal.expiring', 'HALF', { items: expiring.slice(0, 8) }, '/legal')];
    }
}

function card(key: string, span: DashboardCardSpan, payload: unknown, link?: string): DashboardHomepageCard {
    return { key, span, payload, ...(link ? { link } : {}) };
}