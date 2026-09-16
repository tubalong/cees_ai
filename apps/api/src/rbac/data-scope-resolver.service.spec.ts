import { BadRequestException } from '@nestjs/common';
import { DataScope, MembershipStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { DataScopeResolverService } from './data-scope-resolver.service';

describe('DataScopeResolverService', () => {
    it('resolves a tenant-wide scope without collecting members or departments', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(membershipRecord());
        prisma.membershipRole.findMany.mockResolvedValue([
            roleScopeRecord(DataScope.TENANT),
        ]);
        const service = createService(prisma);

        const result = await service.resolve();

        expect(result.tenantWide).toBe(true);
        expect(result.scopes).toEqual([DataScope.TENANT]);
        expect(prisma.department.findMany).not.toHaveBeenCalled();
        expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
    });

    it('falls back to self when the membership has no roles', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(membershipRecord());
        prisma.membershipRole.findMany.mockResolvedValue([]);
        const service = createService(prisma);

        const result = await service.resolve();

        expect(result).toEqual({
            scopes: [DataScope.SELF],
            tenantWide: false,
            membershipIds: [MEMBERSHIP_ID],
            departmentIds: [DEPARTMENT_ID],
            projectIds: [],
        });
    });

    it('collects a department tree and its active members', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(membershipRecord());
        prisma.membershipRole.findMany.mockResolvedValue([
            roleScopeRecord(DataScope.DEPARTMENT_TREE),
        ]);
        prisma.department.findMany.mockResolvedValue([
            { id: DEPARTMENT_ID, parentId: null },
            { id: CHILD_DEPARTMENT_ID, parentId: DEPARTMENT_ID },
        ]);
        prisma.tenantMembership.findMany.mockResolvedValue([
            { id: MEMBERSHIP_ID },
            { id: SECOND_MEMBERSHIP_ID },
        ]);
        const service = createService(prisma);

        const result = await service.resolve();

        expect(result.departmentIds).toEqual([DEPARTMENT_ID, CHILD_DEPARTMENT_ID]);
        expect(result.membershipIds).toEqual([MEMBERSHIP_ID, SECOND_MEMBERSHIP_ID]);
        expect(result.tenantWide).toBe(false);
    });

    it('resolves participating projects for project scope', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(membershipRecord());
        prisma.membershipRole.findMany.mockResolvedValue([
            roleScopeRecord(DataScope.PROJECT),
        ]);
        prisma.projectMember.findMany.mockResolvedValue([
            { projectId: PROJECT_ID },
            { projectId: SECOND_PROJECT_ID },
        ]);
        const service = createService(prisma);

        const result = await service.resolve();

        expect(result.projectIds).toEqual([PROJECT_ID, SECOND_PROJECT_ID]);
        expect(result.tenantWide).toBe(false);
    });

    it('rejects unsupported custom scope', async () => {
        const prisma = createPrismaMock();
        prisma.tenantMembership.findFirst.mockResolvedValue(membershipRecord());
        prisma.membershipRole.findMany.mockResolvedValue([
            roleScopeRecord(DataScope.CUSTOM),
        ]);
        const service = createService(prisma);

        await expect(service.resolve()).rejects.toBeInstanceOf(BadRequestException);
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const SECOND_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000002';
const DEPARTMENT_ID = '60000000-0000-0000-0000-000000000001';
const CHILD_DEPARTMENT_ID = '60000000-0000-0000-0000-000000000002';
const PROJECT_ID = '70000000-0000-0000-0000-000000000001';
const SECOND_PROJECT_ID = '70000000-0000-0000-0000-000000000002';

function createService(prisma: Record<string, any>): DataScopeResolverService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: '10000000-0000-0000-0000-000000000002',
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: [],
            permissions: [],
        }),
    } as unknown as TenantContext;
    return new DataScopeResolverService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    return {
        tenantMembership: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
        },
        membershipRole: {
            findMany: jest.fn(),
        },
        department: {
            findMany: jest.fn(),
        },
        projectMember: {
            findMany: jest.fn(),
        },
    };
}

function membershipRecord(): Record<string, unknown> {
    return {
        id: MEMBERSHIP_ID,
        departmentId: DEPARTMENT_ID,
        status: MembershipStatus.ACTIVE,
    };
}

function roleScopeRecord(dataScope: DataScope): Record<string, unknown> {
    return {
        role: { dataScope },
    };
}
