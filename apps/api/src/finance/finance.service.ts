import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditOutcome, FilePurpose, FinanceExpenseStatus, MembershipStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { calendarYear, DEFAULT_TENANT_TIMEZONE } from '../common/tenant-time';
import { DataScopeResolverService } from '../rbac/data-scope-resolver.service';
import { TenantContext } from '../tenant/tenant-context';
import {
    CreateFinanceExpenseCategoryDto, CreateFinanceExpenseReportDto, FinanceExpenseActionDto,
    FinanceExpenseItemDto, FinanceExpenseSummaryQueryDto, FinanceProjectSpendQueryDto,
    ListFinanceExpenseReportsQueryDto, MarkFinanceExpenseReportPaidDto, ReviewFinanceExpenseReportDto,
    UpdateFinanceExpenseCategoryDto, UpdateFinanceExpenseReportDto,
} from './dto';

type DbClient = PrismaService | Prisma.TransactionClient;
type JsonRecord = Record<string, unknown>;

const reportInclude = {
    items: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] },
    attachments: { include: { fileObject: true }, orderBy: { createdAt: 'asc' as const } },
    statusHistory: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.FinanceExpenseReportInclude;

const EDITABLE_STATUSES = new Set<FinanceExpenseStatus>([
    FinanceExpenseStatus.DRAFT, FinanceExpenseStatus.REJECTED, FinanceExpenseStatus.WITHDRAWN,
]);

@Injectable()
export class FinanceService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly dataScopeResolver: DataScopeResolverService,
    ) { }

    async listCategories(): Promise<JsonRecord> {
        const { tenantId } = this.tenantContext.require();
        const items = await this.prisma.financeExpenseCategory.findMany({
            where: { tenantId, deletedAt: null }, orderBy: [{ enabled: 'desc' }, { code: 'asc' }],
        });
        return { items: items.map(toCategory) };
    }

    async createCategory(input: CreateFinanceExpenseCategoryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        try {
            const category = await this.prisma.$transaction(async (transaction) => {
                const created = await transaction.financeExpenseCategory.create({ data: {
                    tenantId: context.tenantId, code: normalizeCode(input.code), name: input.name.trim(),
                    description: normalizeNullable(input.description), enabled: input.enabled,
                    createdBy: context.userId, updatedBy: context.userId,
                } });
                await this.audit(transaction, 'FINANCE_EXPENSE_CATEGORY_CREATED', 'FINANCE_EXPENSE_CATEGORY', created.id, { code: created.code });
                return created;
            });
            return toCategory(category);
        } catch (error) {
            this.handleUniqueConflict(error, 'FINANCE_EXPENSE_CATEGORY_CONFLICT', '报销类别编码已存在');
        }
    }

    async updateCategory(categoryId: string, input: UpdateFinanceExpenseCategoryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        await this.requireCategory(categoryId);
        try {
            const category = await this.prisma.$transaction(async (transaction) => {
                const changed = await transaction.financeExpenseCategory.updateMany({
                    where: { id: categoryId, tenantId: context.tenantId, deletedAt: null, version: input.version },
                    data: {
                        code: input.code === undefined ? undefined : normalizeCode(input.code),
                        name: input.name === undefined ? undefined : input.name.trim(),
                        description: input.description === undefined ? undefined : normalizeNullable(input.description),
                        enabled: input.enabled, updatedBy: context.userId, version: { increment: 1 },
                    },
                });
                if (changed.count !== 1) throw this.versionConflict();
                await this.audit(transaction, 'FINANCE_EXPENSE_CATEGORY_UPDATED', 'FINANCE_EXPENSE_CATEGORY', categoryId);
                return transaction.financeExpenseCategory.findUniqueOrThrow({ where: { id: categoryId } });
            });
            return toCategory(category);
        } catch (error) {
            this.handleUniqueConflict(error, 'FINANCE_EXPENSE_CATEGORY_CONFLICT', '报销类别编码已存在');
        }
    }

    async deleteCategory(categoryId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        await this.requireCategory(categoryId);
        const referenced = await this.prisma.financeExpenseItem.findFirst({
            where: { tenantId: context.tenantId, categoryId, deletedAt: null }, select: { id: true },
        });
        if (referenced) throw new ConflictException({ code: 'FINANCE_EXPENSE_CATEGORY_IN_USE', message: '报销类别已被费用明细使用，请改为停用' });
        await this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.financeExpenseCategory.updateMany({
                where: { id: categoryId, tenantId: context.tenantId, deletedAt: null, version },
                data: { deletedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await this.audit(transaction, 'FINANCE_EXPENSE_CATEGORY_DELETED', 'FINANCE_EXPENSE_CATEGORY', categoryId);
        });
    }

    async listReports(query: ListFinanceExpenseReportsQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        await this.validateCursor(query.cursor);
        const reports = await this.prisma.financeExpenseReport.findMany({
            where: {
                tenantId: context.tenantId, deletedAt: null, AND: [await this.reportScopeWhere()],
                status: query.status, requesterMembershipId: query.requesterMembershipId,
                requesterDepartmentId: query.departmentId,
                items: query.projectId || query.categoryId || query.dateFrom || query.dateTo ? { some: {
                    projectId: query.projectId, categoryId: query.categoryId,
                    occurredAt: optionalDateRange(query.dateFrom, query.dateTo), deletedAt: null,
                } } : undefined,
                OR: query.keyword?.trim() ? [
                    { reportNo: { contains: query.keyword.trim(), mode: 'insensitive' } },
                    { title: { contains: query.keyword.trim(), mode: 'insensitive' } },
                    { description: { contains: query.keyword.trim(), mode: 'insensitive' } },
                ] : undefined,
            },
            include: reportInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined, skip: query.cursor ? 1 : 0, take: query.limit + 1,
        });
        const hasNext = reports.length > query.limit;
        const page = hasNext ? reports.slice(0, query.limit) : reports;
        return { items: page.map(toReport), nextCursor: hasNext ? page.at(-1)?.id ?? null : null };
    }

    async createReport(input: CreateFinanceExpenseReportDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const membership = await this.requireActiveMembership(context.membershipId);
        const prepared = await this.prepareReportInput(input);
        const attachmentIds = input.attachmentIds ?? [];
        const report = await this.prisma.$transaction(async (transaction) => {
            const reportNo = await this.nextReportNo(transaction);
            const created = await transaction.financeExpenseReport.create({
                data: {
                    tenantId: context.tenantId, reportNo, requesterMembershipId: context.membershipId,
                    requesterDepartmentId: membership.departmentId, title: input.title.trim(),
                    description: normalizeNullable(input.description), currency: normalizeCurrency(input.currency),
                    totalAmount: prepared.totalAmount, createdBy: context.userId, updatedBy: context.userId,
                    items: { create: prepared.items.map((item, index) => this.itemCreateData(item, index)) },
                    attachments: { create: attachmentIds.map((fileObjectId) => ({ tenantId: context.tenantId, fileObjectId })) },
                    statusHistory: { create: {
                        tenantId: context.tenantId, toStatus: FinanceExpenseStatus.DRAFT,
                        actorMembershipId: context.membershipId,
                    } },
                },
                include: reportInclude,
            });
            await this.audit(transaction, 'FINANCE_EXPENSE_REPORT_CREATED', 'FINANCE_EXPENSE_REPORT', created.id, {
                reportNo, totalAmount: prepared.totalAmount.toString(), currency: created.currency,
            });
            return created;
        });
        return toReport(report);
    }

    async getReport(reportId: string): Promise<JsonRecord> {
        return toReport(await this.requireScopedReport(reportId));
    }

    async updateReport(reportId: string, input: UpdateFinanceExpenseReportDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const existing = await this.requireOwnedReport(reportId);
        this.assertEditable(existing.status);
        const prepared = await this.prepareReportInput(input);
        const attachmentIds = input.attachmentIds ?? [];
        const report = await this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.financeExpenseReport.updateMany({
                where: { id: reportId, tenantId: context.tenantId, deletedAt: null, version: input.version, status: existing.status },
                data: {
                    title: input.title.trim(), description: normalizeNullable(input.description),
                    currency: normalizeCurrency(input.currency), totalAmount: prepared.totalAmount,
                    status: FinanceExpenseStatus.DRAFT, reviewedBy: null, reviewedAt: null,
                    reviewComment: null, submittedAt: null, updatedBy: context.userId, version: { increment: 1 },
                },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await transaction.financeExpenseAttachment.deleteMany({ where: { tenantId: context.tenantId, reportId } });
            await transaction.financeExpenseItem.deleteMany({ where: { tenantId: context.tenantId, reportId } });
            await transaction.financeExpenseItem.createMany({ data: prepared.items.map((item, index) => ({
                reportId, ...this.itemCreateData(item, index),
            })) });
            if (attachmentIds.length > 0) await transaction.financeExpenseAttachment.createMany({
                data: attachmentIds.map((fileObjectId) => ({ tenantId: context.tenantId, reportId, fileObjectId })),
            });
            if (existing.status !== FinanceExpenseStatus.DRAFT) await this.addHistory(
                transaction, reportId, existing.status, FinanceExpenseStatus.DRAFT, '修改后重新进入草稿',
            );
            await this.audit(transaction, 'FINANCE_EXPENSE_REPORT_UPDATED', 'FINANCE_EXPENSE_REPORT', reportId, {
                totalAmount: prepared.totalAmount.toString(), currency: normalizeCurrency(input.currency),
            });
            return transaction.financeExpenseReport.findUniqueOrThrow({ where: { id: reportId }, include: reportInclude });
        });
        return toReport(report);
    }

    async deleteReport(reportId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        const existing = await this.requireOwnedReport(reportId);
        this.assertEditable(existing.status);
        await this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.financeExpenseReport.updateMany({
                where: { id: reportId, tenantId: context.tenantId, deletedAt: null, version, status: existing.status },
                data: {
                    status: FinanceExpenseStatus.CANCELLED, cancelledAt: new Date(), deletedAt: new Date(),
                    updatedBy: context.userId, version: { increment: 1 },
                },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await this.addHistory(transaction, reportId, existing.status, FinanceExpenseStatus.CANCELLED, '申请人删除');
            await this.audit(transaction, 'FINANCE_EXPENSE_REPORT_DELETED', 'FINANCE_EXPENSE_REPORT', reportId);
        });
    }

    async submitReport(reportId: string, version: number): Promise<JsonRecord> {
        const existing = await this.requireOwnedReport(reportId);
        if (existing.status !== FinanceExpenseStatus.DRAFT) throw this.stateConflict('只有草稿报销单可以提交');
        if (existing.items.length === 0 || existing.totalAmount.lte(0)) {
            throw new BadRequestException({ code: 'FINANCE_EXPENSE_REPORT_EMPTY', message: '报销单必须包含有效费用明细' });
        }
        return this.transition(reportId, version, FinanceExpenseStatus.DRAFT, FinanceExpenseStatus.SUBMITTED,
            'FINANCE_EXPENSE_REPORT_SUBMITTED', { submittedAt: new Date() });
    }

    async withdrawReport(reportId: string, input: FinanceExpenseActionDto): Promise<JsonRecord> {
        await this.requireOwnedReport(reportId);
        return this.transition(reportId, input.version, FinanceExpenseStatus.SUBMITTED, FinanceExpenseStatus.WITHDRAWN,
            'FINANCE_EXPENSE_REPORT_WITHDRAWN', {}, input.reason);
    }

    async cancelReport(reportId: string, input: FinanceExpenseActionDto): Promise<JsonRecord> {
        const existing = await this.requireReport(reportId);
        if (existing.status === FinanceExpenseStatus.APPROVED
            || existing.status === FinanceExpenseStatus.PAID
            || existing.status === FinanceExpenseStatus.CANCELLED) {
            throw this.stateConflict('当前报销单状态不允许取消');
        }
        return this.transition(reportId, input.version, existing.status, FinanceExpenseStatus.CANCELLED,
            'FINANCE_EXPENSE_REPORT_CANCELLED', {
                cancelledAt: new Date(), cancellationReason: normalizeNullable(input.reason),
            }, input.reason);
    }

    async reviewReport(reportId: string, input: ReviewFinanceExpenseReportDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const existing = await this.requireScopedReport(reportId);
        if (existing.requesterMembershipId === context.membershipId) {
            throw new ForbiddenException({ code: 'FINANCE_EXPENSE_SELF_REVIEW_FORBIDDEN', message: '不能审批自己的报销单' });
        }
        if (existing.status !== FinanceExpenseStatus.SUBMITTED) throw this.stateConflict('只有待审批报销单可以审批');
        if (input.decision === 'REJECT' && !input.comment?.trim()) {
            throw new BadRequestException({ code: 'FINANCE_EXPENSE_REJECT_COMMENT_REQUIRED', message: '拒绝报销时必须填写审批意见' });
        }
        const target = input.decision === 'APPROVE' ? FinanceExpenseStatus.APPROVED : FinanceExpenseStatus.REJECTED;
        return this.transition(reportId, input.version, FinanceExpenseStatus.SUBMITTED, target,
            'FINANCE_EXPENSE_REPORT_REVIEWED', {
                reviewedBy: context.membershipId, reviewedAt: new Date(), reviewComment: normalizeNullable(input.comment),
            }, input.comment, { decision: input.decision });
    }

    async markPaid(reportId: string, input: MarkFinanceExpenseReportPaidDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const existing = await this.requireReport(reportId);
        if (existing.status !== FinanceExpenseStatus.APPROVED) throw this.stateConflict('只有已批准报销单可以确认付款');
        try {
            return await this.transition(reportId, input.version, FinanceExpenseStatus.APPROVED, FinanceExpenseStatus.PAID,
                'FINANCE_EXPENSE_REPORT_PAID', {
                    paidBy: context.membershipId, paidAt: parseDate(input.paidAt), paymentMethod: input.paymentMethod,
                    paymentReference: input.paymentReference.trim(), paymentComment: normalizeNullable(input.comment),
                }, input.comment, { paymentReference: input.paymentReference.trim() });
        } catch (error) {
            this.handleUniqueConflict(error, 'FINANCE_PAYMENT_REFERENCE_CONFLICT', '付款流水号已存在');
        }
    }

    async expenseSummary(query: FinanceExpenseSummaryQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const occurredAt = requiredDateRange(query.dateFrom, query.dateTo);
        const currency = normalizeCurrency(query.currency);
        const reports = await this.prisma.financeExpenseReport.findMany({
            where: {
                tenantId: context.tenantId, deletedAt: null, currency, AND: [await this.reportScopeWhere()],
                requesterDepartmentId: query.departmentId,
                items: { some: { deletedAt: null, occurredAt, projectId: query.projectId } },
                status: { in: [FinanceExpenseStatus.SUBMITTED, FinanceExpenseStatus.APPROVED, FinanceExpenseStatus.PAID] },
            },
            include: { items: { where: { deletedAt: null, occurredAt, projectId: query.projectId }, include: { category: true } } },
        });
        const pendingApproval = reports.filter((report) => report.status === FinanceExpenseStatus.SUBMITTED);
        const approved = reports.filter((report) => report.status === FinanceExpenseStatus.APPROVED || report.status === FinanceExpenseStatus.PAID);
        const paid = reports.filter((report) => report.status === FinanceExpenseStatus.PAID);
        const pendingPayment = reports.filter((report) => report.status === FinanceExpenseStatus.APPROVED);
        const categoryTotals = new Map<string, { categoryName: string; amount: Prisma.Decimal }>();
        for (const report of reports) for (const item of report.items) {
            const current = categoryTotals.get(item.categoryId) ?? { categoryName: item.category.name, amount: new Prisma.Decimal(0) };
            current.amount = current.amount.add(item.amount);
            categoryTotals.set(item.categoryId, current);
        }
        return {
            currency, reportCount: reports.length, submittedAmount: sumReportItems(reports), approvedAmount: sumReportItems(approved),
            paidAmount: sumReportItems(paid), pendingApprovalCount: pendingApproval.length,
            pendingApprovalAmount: sumReportItems(pendingApproval), pendingPaymentCount: pendingPayment.length,
            pendingPaymentAmount: sumReportItems(pendingPayment),
            byCategory: [...categoryTotals.entries()].map(([categoryId, value]) => ({
                categoryId, categoryName: value.categoryName, amount: value.amount.toNumber(),
            })),
        };
    }

    async projectSpend(query: FinanceProjectSpendQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        await this.requireProject(query.projectId);
        const currency = normalizeCurrency(query.currency);
        const items = await this.prisma.financeExpenseItem.findMany({
            where: {
                tenantId: context.tenantId, deletedAt: null, projectId: query.projectId,
                occurredAt: optionalDateRange(query.dateFrom, query.dateTo),
                report: {
                    deletedAt: null, currency, AND: [await this.reportScopeWhere()],
                    status: { in: [FinanceExpenseStatus.SUBMITTED, FinanceExpenseStatus.APPROVED, FinanceExpenseStatus.PAID] },
                },
            },
            include: { report: { select: { status: true } } },
        });
        const amountFor = (statuses: FinanceExpenseStatus[]): number => items
            .filter((item) => statuses.includes(item.report.status))
            .reduce((total, item) => total.add(item.amount), new Prisma.Decimal(0)).toNumber();
        return {
            projectId: query.projectId, currency,
            submittedAmount: amountFor([FinanceExpenseStatus.SUBMITTED, FinanceExpenseStatus.APPROVED, FinanceExpenseStatus.PAID]),
            approvedAmount: amountFor([FinanceExpenseStatus.APPROVED, FinanceExpenseStatus.PAID]),
            paidAmount: amountFor([FinanceExpenseStatus.PAID]),
        };
    }

    private async transition(
        reportId: string, version: number, fromStatus: FinanceExpenseStatus, toStatus: FinanceExpenseStatus,
        auditAction: string, data: Prisma.FinanceExpenseReportUncheckedUpdateManyInput = {},
        comment?: string | null, metadata?: Prisma.InputJsonObject,
    ): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const report = await this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.financeExpenseReport.updateMany({
                where: { id: reportId, tenantId: context.tenantId, deletedAt: null, version, status: fromStatus },
                data: { ...data, status: toStatus, updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.stateConflict('报销单状态或版本已变化，请刷新后重试');
            await this.addHistory(transaction, reportId, fromStatus, toStatus, comment, metadata);
            await this.audit(transaction, auditAction, 'FINANCE_EXPENSE_REPORT', reportId, { fromStatus, toStatus, ...metadata });
            return transaction.financeExpenseReport.findUniqueOrThrow({ where: { id: reportId }, include: reportInclude });
        });
        return toReport(report);
    }

    private async prepareReportInput(input: CreateFinanceExpenseReportDto): Promise<{ items: FinanceExpenseItemDto[]; totalAmount: Prisma.Decimal }> {
        if (input.items.length === 0) throw new BadRequestException({ code: 'FINANCE_EXPENSE_ITEMS_REQUIRED', message: '至少需要一条报销明细' });
        const context = this.tenantContext.require();
        const categoryIds = unique(input.items.map((item) => item.categoryId));
        const categories = await this.prisma.financeExpenseCategory.findMany({
            where: { tenantId: context.tenantId, id: { in: categoryIds }, deletedAt: null, enabled: true }, select: { id: true },
        });
        if (categories.length !== categoryIds.length) {
            throw new BadRequestException({ code: 'FINANCE_EXPENSE_CATEGORY_INVALID', message: '报销明细包含不存在或已停用的费用类别' });
        }
        await this.validateReferences(input.items, input.attachmentIds ?? []);
        const totalAmount = input.items.reduce((total, item) => total.add(new Prisma.Decimal(item.amount)), new Prisma.Decimal(0));
        if (totalAmount.lte(0)) throw new BadRequestException({ code: 'FINANCE_EXPENSE_AMOUNT_INVALID', message: '报销总金额必须大于零' });
        return { items: input.items, totalAmount };
    }

    private async validateReferences(items: FinanceExpenseItemDto[], attachmentIds: string[]): Promise<void> {
        const context = this.tenantContext.require();
        const projectIds = unique(items.flatMap((item) => item.projectId ? [item.projectId] : []));
        const departmentIds = unique(items.flatMap((item) => item.departmentId ? [item.departmentId] : []));
        if (projectIds.length > 0) {
            const unrestricted = context.permissions.includes('finance.expense.manage_all')
                || context.permissions.includes('project.manage_all');
            const count = await this.prisma.project.count({ where: {
                tenantId: context.tenantId, id: { in: projectIds }, deletedAt: null,
                members: unrestricted ? undefined : { some: { membershipId: context.membershipId, deletedAt: null } },
            } });
            if (count !== projectIds.length) throw new BadRequestException({ code: 'FINANCE_EXPENSE_PROJECT_INVALID', message: '费用明细包含无效项目' });
        }
        if (departmentIds.length > 0) {
            const count = await this.prisma.department.count({ where: { tenantId: context.tenantId, id: { in: departmentIds }, deletedAt: null } });
            if (count !== departmentIds.length) throw new BadRequestException({ code: 'FINANCE_EXPENSE_DEPARTMENT_INVALID', message: '费用明细包含无效部门' });
        }
        if (attachmentIds.length > 0) {
            const count = await this.prisma.fileObject.count({ where: {
                tenantId: context.tenantId, id: { in: attachmentIds }, purpose: FilePurpose.ATTACHMENT, deletedAt: null,
            } });
            if (count !== attachmentIds.length) {
                throw new BadRequestException({ code: 'FINANCE_EXPENSE_ATTACHMENT_INVALID', message: '附件不存在、未完成上传或不属于当前租户' });
            }
        }
    }

    private itemCreateData(item: FinanceExpenseItemDto, index: number): Prisma.FinanceExpenseItemUncheckedCreateWithoutReportInput {
        const context = this.tenantContext.require();
        return {
            tenantId: context.tenantId,
            categoryId: item.categoryId, description: item.description.trim(), amount: new Prisma.Decimal(item.amount),
            taxAmount: new Prisma.Decimal(item.taxAmount), occurredAt: parseDateOnly(item.occurredAt),
            merchantName: normalizeNullable(item.merchantName), invoiceNumber: normalizeNullable(item.invoiceNumber),
            invoiceType: normalizeNullable(item.invoiceType), projectId: item.projectId ?? null,
            departmentId: item.departmentId ?? null, remark: normalizeNullable(item.remark), sortOrder: index,
            createdBy: context.userId, updatedBy: context.userId,
        };
    }

    private async reportScopeWhere(): Promise<Prisma.FinanceExpenseReportWhereInput> {
        const context = this.tenantContext.require();
        if (context.permissions.includes('finance.expense.manage_all')) return {};
        const scope = await this.dataScopeResolver.resolve();
        if (scope.tenantWide) return {};
        const filters: Prisma.FinanceExpenseReportWhereInput[] = [];
        if (scope.membershipIds.length > 0) filters.push({ requesterMembershipId: { in: scope.membershipIds } });
        if (scope.departmentIds.length > 0) filters.push({ requesterDepartmentId: { in: scope.departmentIds } });
        if (scope.projectIds.length > 0) filters.push({ items: { some: { projectId: { in: scope.projectIds }, deletedAt: null } } });
        return filters.length > 0 ? { OR: filters } : { id: { in: [] } };
    }

    private async requireScopedReport(reportId: string) {
        const context = this.tenantContext.require();
        const report = await this.prisma.financeExpenseReport.findFirst({
            where: { id: reportId, tenantId: context.tenantId, deletedAt: null, AND: [await this.reportScopeWhere()] },
            include: reportInclude,
        });
        if (!report) throw new NotFoundException({ code: 'FINANCE_EXPENSE_REPORT_NOT_FOUND', message: '报销单不存在或无权访问' });
        return report;
    }

    private async requireOwnedReport(reportId: string) {
        const context = this.tenantContext.require();
        const report = await this.prisma.financeExpenseReport.findFirst({
            where: { id: reportId, tenantId: context.tenantId, requesterMembershipId: context.membershipId, deletedAt: null },
            include: reportInclude,
        });
        if (!report) throw new ForbiddenException({ code: 'FINANCE_EXPENSE_REPORT_OWNERSHIP_REQUIRED', message: '只能操作自己的报销单' });
        return report;
    }

    private async requireReport(reportId: string) {
        const { tenantId } = this.tenantContext.require();
        const report = await this.prisma.financeExpenseReport.findFirst({
            where: { id: reportId, tenantId, deletedAt: null }, include: reportInclude,
        });
        if (!report) throw new NotFoundException({ code: 'FINANCE_EXPENSE_REPORT_NOT_FOUND', message: '报销单不存在' });
        return report;
    }

    private async requireCategory(categoryId: string) {
        const { tenantId } = this.tenantContext.require();
        const category = await this.prisma.financeExpenseCategory.findFirst({ where: { id: categoryId, tenantId, deletedAt: null } });
        if (!category) throw new NotFoundException({ code: 'FINANCE_EXPENSE_CATEGORY_NOT_FOUND', message: '报销类别不存在' });
        return category;
    }

    private async requireActiveMembership(membershipId: string) {
        const { tenantId } = this.tenantContext.require();
        const membership = await this.prisma.tenantMembership.findFirst({
            where: { id: membershipId, tenantId, status: MembershipStatus.ACTIVE, deletedAt: null },
            select: { id: true, departmentId: true },
        });
        if (!membership) throw new BadRequestException({ code: 'FINANCE_EXPENSE_REQUESTER_INVALID', message: '当前租户成员不可用' });
        return membership;
    }

    private async requireProject(projectId: string): Promise<void> {
        const { tenantId } = this.tenantContext.require();
        const project = await this.prisma.project.findFirst({ where: { id: projectId, tenantId, deletedAt: null }, select: { id: true } });
        if (!project) throw new NotFoundException({ code: 'FINANCE_PROJECT_NOT_FOUND', message: '项目不存在' });
    }

    private async nextReportNo(transaction: Prisma.TransactionClient): Promise<string> {
        const context = this.tenantContext.require();
        const tenant = await transaction.tenant.findFirst({
            where: { id: context.tenantId, deletedAt: null }, select: { timezone: true },
        });
        if (!tenant) throw new BadRequestException({ code: 'TENANT_NOT_FOUND', message: '当前租户不存在' });
        const year = calendarYear(tenant.timezone || DEFAULT_TENANT_TIMEZONE, new Date());
        const sequence = await transaction.financeExpenseReportSequence.upsert({
            where: { tenantId_year: { tenantId: context.tenantId, year } },
            create: { tenantId: context.tenantId, year, lastNumber: 1 },
            update: { lastNumber: { increment: 1 } },
        });
        return `EXP-${year}-${String(sequence.lastNumber).padStart(6, '0')}`;
    }

    private async addHistory(
        transaction: Prisma.TransactionClient, reportId: string, fromStatus: FinanceExpenseStatus | null,
        toStatus: FinanceExpenseStatus, comment?: string | null, metadata?: Prisma.InputJsonObject,
    ): Promise<void> {
        const context = this.tenantContext.require();
        await transaction.financeExpenseStatusHistory.create({ data: {
            tenantId: context.tenantId, reportId, fromStatus, toStatus, actorMembershipId: context.membershipId,
            comment: normalizeNullable(comment), metadata,
        } });
    }

    private async audit(
        transaction: DbClient, action: string, resourceType: string, resourceId: string,
        metadata?: Prisma.InputJsonObject,
    ): Promise<void> {
        const context = this.tenantContext.require();
        await transaction.auditLog.create({ data: {
            tenantId: context.tenantId, actorUserId: context.userId, actorMembershipId: context.membershipId,
            action, outcome: AuditOutcome.SUCCESS, resourceType, resourceId, requestId: context.requestId, metadata,
        } });
    }

    private async validateCursor(cursor?: string): Promise<void> {
        if (!cursor) return;
        const { tenantId } = this.tenantContext.require();
        const exists = await this.prisma.financeExpenseReport.findFirst({
            where: { id: cursor, tenantId, deletedAt: null }, select: { id: true },
        });
        if (!exists) throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
    }

    private assertEditable(status: FinanceExpenseStatus): void {
        if (!EDITABLE_STATUSES.has(status)) throw this.stateConflict('当前报销单状态不允许修改或删除');
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'FINANCE_EXPENSE_VERSION_CONFLICT', message: '数据版本已变化，请刷新后重试' });
    }

    private stateConflict(message: string): ConflictException {
        return new ConflictException({ code: 'FINANCE_EXPENSE_STATE_CONFLICT', message });
    }

    private handleUniqueConflict(error: unknown, code: string, message: string): never {
        if (error instanceof ConflictException) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new ConflictException({ code, message });
        }
        throw error;
    }
}

function toCategory(category: {
    id: string; tenantId: string; code: string; name: string; description: string | null; enabled: boolean;
    version: number; createdAt: Date; updatedAt: Date;
}): JsonRecord {
    return { ...category, createdAt: category.createdAt.toISOString(), updatedAt: category.updatedAt.toISOString() };
}

function toReport(report: Prisma.FinanceExpenseReportGetPayload<{ include: typeof reportInclude }>): JsonRecord {
    return {
        id: report.id, tenantId: report.tenantId, reportNo: report.reportNo,
        requesterMembershipId: report.requesterMembershipId, requesterDepartmentId: report.requesterDepartmentId,
        title: report.title, description: report.description, currency: report.currency,
        totalAmount: report.totalAmount.toNumber(), status: report.status, submittedAt: iso(report.submittedAt),
        reviewedBy: report.reviewedBy, reviewedAt: iso(report.reviewedAt), reviewComment: report.reviewComment,
        paidBy: report.paidBy, paidAt: iso(report.paidAt), paymentMethod: report.paymentMethod,
        paymentReference: report.paymentReference, paymentComment: report.paymentComment,
        cancelledAt: iso(report.cancelledAt), cancellationReason: report.cancellationReason,
        items: report.items.map((item) => ({
            id: item.id, reportId: item.reportId, categoryId: item.categoryId, description: item.description,
            amount: item.amount.toNumber(), taxAmount: item.taxAmount.toNumber(),
            occurredAt: item.occurredAt.toISOString().slice(0, 10), merchantName: item.merchantName,
            invoiceNumber: item.invoiceNumber, invoiceType: item.invoiceType, projectId: item.projectId,
            departmentId: item.departmentId, remark: item.remark, sortOrder: item.sortOrder,
            version: item.version, createdAt: item.createdAt.toISOString(),
        })),
        attachments: report.attachments.map((attachment) => ({
            id: attachment.id, reportId: attachment.reportId, itemId: attachment.itemId,
            fileObjectId: attachment.fileObjectId, originalName: attachment.fileObject.originalName,
            mimeType: attachment.fileObject.mimeType, sizeBytes: Number(attachment.fileObject.sizeBytes),
            createdAt: attachment.createdAt.toISOString(),
        })),
        statusHistory: report.statusHistory.map((history) => ({
            id: history.id, reportId: history.reportId, fromStatus: history.fromStatus,
            toStatus: history.toStatus, actorMembershipId: history.actorMembershipId,
            comment: history.comment, createdAt: history.createdAt.toISOString(),
        })),
        version: report.version, createdAt: report.createdAt.toISOString(), updatedAt: report.updatedAt.toISOString(),
    };
}

function normalizeCode(value: string): string { return value.trim().toUpperCase(); }
function normalizeCurrency(value: string): string {
    const currency = value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new BadRequestException({ code: 'FINANCE_CURRENCY_INVALID', message: '币种必须为 ISO 4217 三字母代码' });
    }
    return currency;
}
function normalizeNullable(value?: string | null): string | null { const normalized = value?.trim(); return normalized ? normalized : null; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }
function parseDate(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException({ code: 'FINANCE_DATE_INVALID', message: '日期格式无效' });
    return parsed;
}
function parseDateOnly(value: string): Date { return parseDate(`${value}T00:00:00.000Z`); }
function optionalDateRange(dateFrom?: string, dateTo?: string): Prisma.DateTimeFilter | undefined {
    if (!dateFrom && !dateTo) return undefined;
    const range: Prisma.DateTimeFilter = {};
    if (dateFrom) range.gte = parseDateOnly(dateFrom);
    if (dateTo) { const end = parseDateOnly(dateTo); end.setUTCDate(end.getUTCDate() + 1); range.lt = end; }
    return range;
}
function requiredDateRange(dateFrom: string, dateTo: string): Prisma.DateTimeFilter {
    const range = optionalDateRange(dateFrom, dateTo)!;
    if ((range.gte as Date) >= (range.lt as Date)) {
        throw new BadRequestException({ code: 'FINANCE_DATE_RANGE_INVALID', message: '结束日期必须不早于开始日期' });
    }
    return range;
}
function sumReportItems(reports: Array<{ items: Array<{ amount: Prisma.Decimal }> }>): number {
    return reports.reduce((reportTotal, report) => report.items.reduce(
        (itemTotal, item) => itemTotal.add(item.amount), reportTotal,
    ), new Prisma.Decimal(0)).toNumber();
}
