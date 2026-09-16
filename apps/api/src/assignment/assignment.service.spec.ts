import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
    AssignmentPolicyDomain,
    AssignmentPolicyFallbackMode,
    AssignmentPolicyLevel,
    MembershipStatus,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { AssignmentService } from './assignment.service';
import { CreateAssignmentPolicyDto, ResolveAssignmentPolicyDto, UpdateAssignmentPolicyDto } from './dto';

describe('AssignmentService', () => {
    it('creates a tenant default policy and writes audit', async () => {
        const prisma = createPrismaMock();
        prisma.assignmentPolicy.findFirst.mockResolvedValue(null);
        prisma.assignmentPolicy.create.mockResolvedValue(policyRecord());
        const service = createService(prisma);

        const result = await service.createPolicy(createInput());

        expect(result.level).toBe(AssignmentPolicyLevel.TENANT);
        expect(prisma.assignmentPolicy.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                domain: AssignmentPolicyDomain.TASK,
                level: AssignmentPolicyLevel.TENANT,
                projectId: null,
                name: '默认任务分配策略',
            }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'ASSIGNMENT_POLICY_CREATED', resourceId: POLICY_ID }),
        });
    });

    it('creates a project override policy and validates the project exists', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
        prisma.assignmentPolicy.findFirst.mockResolvedValue(null);
        prisma.assignmentPolicy.create.mockResolvedValue(policyRecord({ level: AssignmentPolicyLevel.PROJECT, projectId: PROJECT_ID }));
        const service = createService(prisma);

        const result = await service.createPolicy(createInput({ level: AssignmentPolicyLevel.PROJECT, projectId: PROJECT_ID }));

        expect(result.projectId).toBe(PROJECT_ID);
        expect(prisma.project.findFirst).toHaveBeenCalledWith({
            where: { id: PROJECT_ID, tenantId: TENANT_ID, deletedAt: null },
            select: { id: true },
        });
    });

    it('rejects invalid level/project combinations', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma);

        await expect(service.createPolicy(createInput({ level: AssignmentPolicyLevel.PROJECT })))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.createPolicy(createInput({ projectId: PROJECT_ID })))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.assignmentPolicy.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate policy for the same tenant/domain/level/project', async () => {
        const prisma = createPrismaMock();
        prisma.assignmentPolicy.findFirst.mockResolvedValue({ id: POLICY_ID });
        const service = createService(prisma);

        await expect(service.createPolicy(createInput())).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates a policy with optimistic locking and audit', async () => {
        const prisma = createPrismaMock();
        prisma.assignmentPolicy.findFirst.mockResolvedValueOnce(policyRecord());
        prisma.assignmentPolicy.updateMany.mockResolvedValue({ count: 1 });
        prisma.assignmentPolicy.findFirst.mockResolvedValueOnce(policyRecord({ name: '新策略名', version: 2 }));
        const service = createService(prisma);

        const result = await service.updatePolicy(POLICY_ID, {
            name: '新策略名',
            skipOnLeave: true,
            version: 1,
        } satisfies UpdateAssignmentPolicyDto);

        expect(result.version).toBe(2);
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'ASSIGNMENT_POLICY_UPDATED' }),
        });
    });

    it('resolves project override before tenant default', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
        prisma.assignmentPolicy.findFirst
            .mockResolvedValueOnce(policyRecord({ level: AssignmentPolicyLevel.PROJECT, projectId: PROJECT_ID }));
        prisma.tenantMembership.findMany.mockResolvedValue([{ id: MEMBERSHIP_ID }]);
        prisma.projectMember.findMany.mockResolvedValue([]);
        const service = createService(prisma);

        const result = await service.resolvePolicy(resolveInput());

        expect(result.matchedPolicyId).toBe(POLICY_ID);
        expect(result.level).toBe(AssignmentPolicyLevel.PROJECT);
        expect(result.candidates).toEqual([MEMBERSHIP_ID]);
    });

    it('expands candidate pool from members, departments and projects', async () => {
        const prisma = createPrismaMock();
        prisma.assignmentPolicy.findFirst.mockResolvedValue(policyRecord({
            candidatePool: {
                membershipIds: [MEMBERSHIP_ID],
                departmentIds: [DEPARTMENT_ID],
                projectIds: [PROJECT_ID],
            },
        }));
        prisma.tenantMembership.findMany
            .mockResolvedValueOnce([{ id: MEMBERSHIP_ID }])
            .mockResolvedValueOnce([{ id: SECOND_MEMBERSHIP_ID }]);
        prisma.projectMember.findMany.mockResolvedValue([{ membershipId: THIRD_MEMBERSHIP_ID }]);
        const service = createService(prisma);

        const result = await service.resolvePolicy(resolveInput());

        expect(result.candidates).toEqual([MEMBERSHIP_ID, SECOND_MEMBERSHIP_ID, THIRD_MEMBERSHIP_ID]);
    });

    it('applies fallback when candidate pool is empty', async () => {
        const prisma = createPrismaMock();
        prisma.assignmentPolicy.findFirst.mockResolvedValue(policyRecord({
            fallbackMode: AssignmentPolicyFallbackMode.TENANT_MEMBERS,
        }));
        prisma.tenantMembership.findMany.mockResolvedValue([{ id: MEMBERSHIP_ID }, { id: SECOND_MEMBERSHIP_ID }]);
        const service = createService(prisma);

        const result = await service.resolvePolicy(resolveInput());

        expect(result.candidates).toEqual([MEMBERSHIP_ID, SECOND_MEMBERSHIP_ID]);
        expect(result.fallbackMode).toBe(AssignmentPolicyFallbackMode.TENANT_MEMBERS);
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const SECOND_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000002';
const THIRD_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000003';
const POLICY_ID = '40000000-0000-0000-0000-000000000001';
const PROJECT_ID = '70000000-0000-0000-0000-000000000001';
const DEPARTMENT_ID = '60000000-0000-0000-0000-000000000001';

function createService(prisma: Record<string, any>): AssignmentService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: ['tenant_admin'],
            permissions: ['assignment.policy.read', 'assignment.policy.manage'],
        }),
    } as unknown as TenantContext;
    return new AssignmentService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        assignmentPolicy: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
        },
        project: { findFirst: jest.fn() },
        tenantMembership: { findMany: jest.fn() },
        projectMember: { findMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function createInput(overrides: Partial<CreateAssignmentPolicyDto> = {}): CreateAssignmentPolicyDto {
    return {
        domain: AssignmentPolicyDomain.TASK,
        level: AssignmentPolicyLevel.TENANT,
        name: '默认任务分配策略',
        candidatePool: { membershipIds: [MEMBERSHIP_ID], departmentIds: [], projectIds: [] },
        skipOnLeave: false,
        fallbackMode: AssignmentPolicyFallbackMode.NONE,
        enabled: true,
        ...overrides,
    };
}

function resolveInput(): ResolveAssignmentPolicyDto {
    return { domain: AssignmentPolicyDomain.TASK };
}

function policyRecord(overrides: Record<string, any> = {}): Record<string, any> {
    return {
        id: POLICY_ID,
        tenantId: TENANT_ID,
        projectId: null,
        domain: AssignmentPolicyDomain.TASK,
        level: AssignmentPolicyLevel.TENANT,
        name: '默认任务分配策略',
        description: null,
        candidatePool: { membershipIds: [MEMBERSHIP_ID], departmentIds: [], projectIds: [] },
        skipOnLeave: false,
        fallbackMode: AssignmentPolicyFallbackMode.NONE,
        enabled: true,
        createdAt: new Date('2026-09-16T00:00:00.000Z'),
        updatedAt: new Date('2026-09-16T00:00:00.000Z'),
        deletedAt: null,
        version: 1,
        ...overrides,
    };
}