import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkReportStatus, WorkReportType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { WorkReportService } from './work-report.service';

describe('WorkReportService', () => {
    it('limits normal members to authored or assigned non-draft reports', async () => {
        const prisma = createPrismaMock();
        prisma.workReport.findMany.mockResolvedValue([]);
        const service = createService(prisma);

        await service.list({ limit: 20 });

        expect(prisma.workReport.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: TENANT_ID,
                AND: expect.arrayContaining([expect.objectContaining({
                    OR: [
                        { authorMembershipId: MEMBERSHIP_ID },
                        { reviewerMembershipId: MEMBERSHIP_ID, status: { not: WorkReportStatus.DRAFT } },
                    ],
                })]),
            }),
        }));
    });

    it('allows manage_all members to query the whole tenant scope', async () => {
        const prisma = createPrismaMock();
        prisma.workReport.findMany.mockResolvedValue([]);
        const service = createService(prisma, ['work_report.manage_all']);

        await service.list({ limit: 20 });

        const where = prisma.workReport.findMany.mock.calls[0][0].where;
        expect(where.tenantId).toBe(TENANT_ID);
        expect(where.AND[0]).toEqual({});
    });

    it('requires weekly reports to start on Monday', async () => {
        const service = createService(createPrismaMock());

        await expect(service.createWeekly(createInput({ weekStartDate: '2026-09-10' }) as any))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a rejection comment', async () => {
        const service = createService(createPrismaMock());

        await expect(service.review(REPORT_ID, { decision: 'REJECTED', version: 1, comment: ' ' }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'WORK_REPORT_REVIEW_COMMENT_REQUIRED' }) });
    });

    it('does not allow a reviewer to see another member draft', async () => {
        const prisma = createPrismaMock();
        prisma.workReport.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.get(REPORT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000001';
const REPORT_ID = '30000000-0000-0000-0000-000000000001';

function createService(prisma: Record<string, any>, permissions: string[] = []): WorkReportService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID, userId: USER_ID, membershipId: MEMBERSHIP_ID,
            requestId: 'request-id', roles: [], permissions,
        }),
    } as unknown as TenantContext;
    return new WorkReportService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        workReport: { findMany: jest.fn(), findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
        workReportProject: { deleteMany: jest.fn(), createMany: jest.fn() },
        workReportTask: { deleteMany: jest.fn(), createMany: jest.fn() },
        project: { findMany: jest.fn() },
        task: { findMany: jest.fn() },
        tenantMembership: { findFirst: jest.fn() },
        auditLog: { create: jest.fn() },
        $queryRaw: jest.fn().mockResolvedValue([{ id: REPORT_ID }]),
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function createInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        weekStartDate: '2026-09-07', reviewerMembershipId: '20000000-0000-0000-0000-000000000003',
        content: { completedItems: ['Completed API'], plannedItems: ['Add tests'], blockers: [], remarks: null },
        projectIds: [], taskIds: [], ...overrides,
    };
}
