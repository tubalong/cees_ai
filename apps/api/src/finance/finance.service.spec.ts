import { ConflictException, ForbiddenException } from '@nestjs/common';
import { FinanceExpenseStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DataScopeResolverService } from '../rbac/data-scope-resolver.service';
import { TenantContext } from '../tenant/tenant-context';
import { FinanceService } from './finance.service';

describe('FinanceService', () => {
    it('normalizes category code and writes audit', async () => {
        const prisma = createPrismaMock();
        prisma.financeExpenseCategory.create.mockResolvedValue(categoryRecord());
        const service = createService(prisma);

        const result = await service.createCategory({ code: ' travel ', name: '差旅费', enabled: true });

        expect(result).toMatchObject({ code: 'TRAVEL', name: '差旅费' });
        expect(prisma.financeExpenseCategory.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ code: 'TRAVEL', tenantId: TENANT_ID }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'FINANCE_EXPENSE_CATEGORY_CREATED' }),
        }));
    });

    it('calculates report total on the server', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue({ id: MEMBERSHIP_ID, departmentId: DEPARTMENT_ID });
        prisma.financeExpenseCategory.findMany.mockResolvedValue([{ id: CATEGORY_ID }]);
        prisma.tenant.findFirst.mockResolvedValue({ timezone: 'Asia/Shanghai' });
        prisma.financeExpenseReportSequence.upsert.mockResolvedValue({ lastNumber: 12 });
        prisma.financeExpenseReport.create.mockImplementation(async ({ data }: { data: Record<string, any> }) => reportRecord({
            reportNo: data.reportNo,
            totalAmount: data.totalAmount,
        }));
        const service = createService(prisma);

        const result = await service.createReport({
            title: '客户拜访', currency: 'cny', attachmentIds: [],
            items: [
                { categoryId: CATEGORY_ID, description: '高铁票', amount: 20.1, taxAmount: 0, occurredAt: '2026-09-16' },
                { categoryId: CATEGORY_ID, description: '地铁', amount: 10.4, taxAmount: 0, occurredAt: '2026-09-16' },
            ],
        });

        expect(result).toMatchObject({ reportNo: 'EXP-2026-000012', totalAmount: 30.5, currency: 'CNY' });
        expect(prisma.financeExpenseReport.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ totalAmount: new Prisma.Decimal('30.5') }),
        }));
    });

    it('prevents deleting a referenced category', async () => {
        const prisma = createPrismaMock();
        prisma.financeExpenseCategory.findFirst.mockResolvedValue(categoryRecord());
        prisma.financeExpenseItem.findFirst.mockResolvedValue({ id: ITEM_ID });
        const service = createService(prisma);

        await expect(service.deleteCategory(CATEGORY_ID, 1)).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.financeExpenseCategory.updateMany).not.toHaveBeenCalled();
    });

    it('prevents self approval', async () => {
        const prisma = createPrismaMock();
        prisma.financeExpenseReport.findFirst.mockResolvedValue(reportRecord({ status: FinanceExpenseStatus.SUBMITTED }));
        const service = createService(prisma);

        await expect(service.reviewReport(REPORT_ID, { decision: 'APPROVE', version: 1 })).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.financeExpenseReport.updateMany).not.toHaveBeenCalled();
    });

    it('submits a draft with optimistic locking and history', async () => {
        const prisma = createPrismaMock();
        prisma.financeExpenseReport.findFirst.mockResolvedValue(reportRecord());
        prisma.financeExpenseReport.updateMany.mockResolvedValue({ count: 1 });
        prisma.financeExpenseReport.findUniqueOrThrow.mockResolvedValue(reportRecord({ status: FinanceExpenseStatus.SUBMITTED, version: 2 }));
        const service = createService(prisma);

        const result = await service.submitReport(REPORT_ID, 1);

        expect(result).toMatchObject({ status: FinanceExpenseStatus.SUBMITTED, version: 2 });
        expect(prisma.financeExpenseStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ fromStatus: FinanceExpenseStatus.DRAFT, toStatus: FinanceExpenseStatus.SUBMITTED }),
        }));
    });

    it('applies resolved membership scope to report queries', async () => {
        const prisma = createPrismaMock();
        prisma.financeExpenseReport.findMany.mockResolvedValue([]);
        const scope = { resolve: jest.fn().mockResolvedValue({
            tenantWide: false, scopes: ['DEPARTMENT'], membershipIds: [MEMBERSHIP_ID],
            departmentIds: [DEPARTMENT_ID], projectIds: [],
        }) };
        const service = createService(prisma, ['finance.expense.read'], scope);

        await service.listReports({ limit: 20, categoryId: CATEGORY_ID });

        expect(scope.resolve).toHaveBeenCalled();
        expect(prisma.financeExpenseReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                AND: [expect.objectContaining({ OR: expect.arrayContaining([
                    { requesterMembershipId: { in: [MEMBERSHIP_ID] } },
                    { requesterDepartmentId: { in: [DEPARTMENT_ID] } },
                ]) })],
                items: { some: { categoryId: CATEGORY_ID, projectId: undefined, occurredAt: undefined, deletedAt: null } },
            }),
        }));
    });

    it('rejects project attribution when the requester is not a project member', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue({ id: MEMBERSHIP_ID, departmentId: DEPARTMENT_ID });
        prisma.financeExpenseCategory.findMany.mockResolvedValue([{ id: CATEGORY_ID }]);
        prisma.project.count.mockResolvedValue(0);
        const service = createService(prisma, ['finance.expense.request']);

        await expect(service.createReport({
            title: '项目采购',
            currency: 'CNY',
            items: [{
                categoryId: CATEGORY_ID,
                description: '测试设备',
                amount: 100,
                taxAmount: 0,
                occurredAt: '2026-09-18',
                projectId: PROJECT_ID,
            }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FINANCE_EXPENSE_PROJECT_INVALID' }) });

        expect(prisma.project.count).toHaveBeenCalledWith({ where: expect.objectContaining({
            members: { some: { membershipId: MEMBERSHIP_ID, deletedAt: null } },
        }) });
        expect(prisma.financeExpenseReport.create).not.toHaveBeenCalled();
    });

    it('uses the tenant-local calendar year in generated report numbers', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-12-31T16:30:00.000Z'));
        try {
            const prisma = createPrismaMock();
            prisma.tenantMembership.findFirst.mockResolvedValue({ id: MEMBERSHIP_ID, departmentId: DEPARTMENT_ID });
            prisma.financeExpenseCategory.findMany.mockResolvedValue([{ id: CATEGORY_ID }]);
            prisma.tenant.findFirst.mockResolvedValue({ timezone: 'Asia/Shanghai' });
            prisma.financeExpenseReportSequence.upsert.mockResolvedValue({ lastNumber: 1 });
            prisma.financeExpenseReport.create.mockImplementation(async ({ data }: { data: Record<string, any> }) => reportRecord({ reportNo: data.reportNo }));
            const service = createService(prisma);

            const result = await service.createReport({
                title: '跨年费用',
                currency: 'CNY',
                items: [{ categoryId: CATEGORY_ID, description: '云服务', amount: 10, taxAmount: 0, occurredAt: '2027-01-01' }],
            });

            expect(result.reportNo).toBe('EXP-2027-000001');
            expect(prisma.financeExpenseReportSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { tenantId_year: { tenantId: TENANT_ID, year: 2027 } },
            }));
        } finally {
            jest.useRealTimers();
        }
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const DEPARTMENT_ID = '60000000-0000-0000-0000-000000000001';
const PROJECT_ID = '60000000-0000-0000-0000-000000000002';
const CATEGORY_ID = '30000000-0000-0000-0000-000000000001';
const REPORT_ID = '40000000-0000-0000-0000-000000000001';
const ITEM_ID = '70000000-0000-0000-0000-000000000001';

function createService(
    prisma: Record<string, any>,
    permissions = ['finance.expense.read', 'finance.expense.request', 'finance.expense.approve', 'finance.expense.manage_all'],
    dataScope: Record<string, any> = { resolve: jest.fn() },
): FinanceService {
    const tenantContext = { require: jest.fn().mockReturnValue({
        tenantId: TENANT_ID, userId: USER_ID, membershipId: MEMBERSHIP_ID, requestId: 'request-id',
        roles: ['tenant_admin'], permissions,
    }) } as unknown as TenantContext;
    return new FinanceService(prisma as unknown as PrismaService, tenantContext, dataScope as unknown as DataScopeResolverService);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        financeExpenseCategory: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
        financeExpenseReport: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
        financeExpenseItem: { findFirst: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
        financeExpenseAttachment: { deleteMany: jest.fn(), createMany: jest.fn() },
        financeExpenseStatusHistory: { create: jest.fn() },
        financeExpenseReportSequence: { upsert: jest.fn() },
        tenantMembership: { findFirst: jest.fn() },
        tenant: { findFirst: jest.fn() },
        project: { count: jest.fn(), findFirst: jest.fn() },
        department: { count: jest.fn() },
        fileObject: { count: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function categoryRecord(): Record<string, any> {
    return {
        id: CATEGORY_ID, tenantId: TENANT_ID, code: 'TRAVEL', name: '差旅费', description: null,
        enabled: true, version: 1, createdAt: new Date('2026-09-17T00:00:00.000Z'), updatedAt: new Date('2026-09-17T00:00:00.000Z'),
    };
}

function reportRecord(overrides: Record<string, any> = {}): Record<string, any> {
    return {
        id: REPORT_ID, tenantId: TENANT_ID, reportNo: 'EXP-2026-000001', requesterMembershipId: MEMBERSHIP_ID,
        requesterDepartmentId: DEPARTMENT_ID, title: '差旅报销', description: null, currency: 'CNY',
        totalAmount: new Prisma.Decimal('30.50'), status: FinanceExpenseStatus.DRAFT, submittedAt: null,
        reviewedBy: null, reviewedAt: null, reviewComment: null, paidBy: null, paidAt: null,
        paymentMethod: null, paymentReference: null, paymentComment: null, cancelledAt: null, cancellationReason: null,
        items: [{
            id: ITEM_ID, tenantId: TENANT_ID, reportId: REPORT_ID, categoryId: CATEGORY_ID, description: '高铁票',
            amount: new Prisma.Decimal('30.50'), taxAmount: new Prisma.Decimal(0), occurredAt: new Date('2026-09-16T00:00:00.000Z'),
            merchantName: null, invoiceNumber: null, invoiceType: null, projectId: null, departmentId: null,
            remark: null, sortOrder: 0, version: 1, createdAt: new Date('2026-09-17T00:00:00.000Z'), updatedAt: new Date('2026-09-17T00:00:00.000Z'),
            createdBy: USER_ID, updatedBy: USER_ID, deletedAt: null,
        }],
        attachments: [], statusHistory: [], version: 1, createdAt: new Date('2026-09-17T00:00:00.000Z'),
        updatedAt: new Date('2026-09-17T00:00:00.000Z'), createdBy: USER_ID, updatedBy: USER_ID, deletedAt: null,
        ...overrides,
    };
}
