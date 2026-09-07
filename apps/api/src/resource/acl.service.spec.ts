import { ConflictException, NotFoundException } from '@nestjs/common';
import { AclSubjectType, DocumentVisibility, ResourceType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { AclService } from './acl.service';
import { ResourceAccessService } from './resource-access.service';

describe('AclService', () => {
    it('lists ACL entries only for a shareable resource in the current tenant', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord());
        prisma.resourceAcl.findMany.mockResolvedValue([aclRecord()]);
        const service = createService(prisma);

        const result = await service.listAcl(DOCUMENT_ID);

        expect(result.items).toEqual([expect.objectContaining({ id: ACL_ID, resourceId: DOCUMENT_ID })]);
        expect(prisma.resourceAcl.findMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT_ID, resourceId: DOCUMENT_ID, deletedAt: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
    });

    it('creates a membership ACL and writes audit', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord());
        prisma.permission.findMany.mockResolvedValue([
            { code: 'document.read' },
            { code: 'document.update' },
        ]);
        prisma.tenantMembership.findFirst.mockResolvedValue({ id: TARGET_MEMBERSHIP_ID });
        prisma.resourceAcl.findUnique.mockResolvedValue(null);
        prisma.resourceAcl.create.mockResolvedValue(aclRecord({
            subjectId: TARGET_MEMBERSHIP_ID,
            permissionCodes: ['document.read', 'document.update'],
            expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        }));
        const service = createService(prisma);

        const result = await service.createAcl(DOCUMENT_ID, {
            subjectType: AclSubjectType.MEMBERSHIP,
            subjectId: TARGET_MEMBERSHIP_ID,
            permissionCodes: ['document.update', 'document.read'],
            expiresAt: '2030-01-01T00:00:00.000Z',
        });

        expect(result.permissionCodes).toEqual(['document.read', 'document.update']);
        expect(prisma.resourceAcl.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                resourceId: DOCUMENT_ID,
                subjectId: TARGET_MEMBERSHIP_ID,
                permissionCodes: ['document.read', 'document.update'],
            }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'ACL_GRANTED', resourceId: DOCUMENT_ID }),
        });
    });

    it('returns an identical existing ACL idempotently', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord());
        prisma.permission.findMany.mockResolvedValue([{ code: 'document.read' }]);
        prisma.tenantMembership.findFirst.mockResolvedValue({ id: TARGET_MEMBERSHIP_ID });
        prisma.resourceAcl.findUnique.mockResolvedValue(aclRecord({
            subjectId: TARGET_MEMBERSHIP_ID,
            permissionCodes: ['document.read'],
        }));
        const service = createService(prisma);

        const result = await service.createAcl(DOCUMENT_ID, {
            subjectType: AclSubjectType.MEMBERSHIP,
            subjectId: TARGET_MEMBERSHIP_ID,
            permissionCodes: ['document.read'],
        });

        expect(result.id).toBe(ACL_ID);
        expect(prisma.resourceAcl.create).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects a conflicting ACL for the same subject', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord());
        prisma.permission.findMany.mockResolvedValue([{ code: 'document.update' }]);
        prisma.tenantMembership.findFirst.mockResolvedValue({ id: TARGET_MEMBERSHIP_ID });
        prisma.resourceAcl.findUnique.mockResolvedValue(aclRecord({
            subjectId: TARGET_MEMBERSHIP_ID,
            permissionCodes: ['document.read'],
        }));
        const service = createService(prisma);

        await expect(service.createAcl(DOCUMENT_ID, {
            subjectType: AclSubjectType.MEMBERSHIP,
            subjectId: TARGET_MEMBERSHIP_ID,
            permissionCodes: ['document.update'],
        })).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects subjects outside the current tenant', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord());
        prisma.permission.findMany.mockResolvedValue([{ code: 'document.read' }]);
        prisma.tenantMembership.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.createAcl(DOCUMENT_ID, {
            subjectType: AclSubjectType.MEMBERSHIP,
            subjectId: TARGET_MEMBERSHIP_ID,
            permissionCodes: ['document.read'],
        })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('revokes an ACL with optimistic locking and audit', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord());
        prisma.resourceAcl.findFirst.mockResolvedValue(aclRecord());
        prisma.resourceAcl.deleteMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        await service.deleteAcl(DOCUMENT_ID, ACL_ID, 1);

        expect(prisma.resourceAcl.deleteMany).toHaveBeenCalledWith({
            where: { id: ACL_ID, tenantId: TENANT_ID, resourceId: DOCUMENT_ID, version: 1 },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'ACL_REVOKED', resourceId: DOCUMENT_ID }),
        });
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const TARGET_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000002';
const ROLE_ID = '20000000-0000-0000-0000-000000000001';
const DOCUMENT_ID = '70000000-0000-0000-0000-000000000001';
const ACL_ID = '80000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-09-07T00:00:00.000Z');

function createService(prisma: Record<string, any>): AclService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: ['tenant_admin'],
            permissions: ['document.share', 'document.manage_all'],
        }),
    } as unknown as TenantContext;
    const resourceAccess = {
        resolveCurrentRoleIds: jest.fn().mockResolvedValue([ROLE_ID]),
        documentWhere: jest.fn().mockReturnValue({ tenantId: TENANT_ID, deletedAt: null }),
    } as unknown as ResourceAccessService;
    return new AclService(prisma as unknown as PrismaService, tenantContext, resourceAccess);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        managedDocument: { findFirst: jest.fn() },
        permission: { findMany: jest.fn() },
        tenantMembership: { findFirst: jest.fn() },
        role: { findFirst: jest.fn() },
        resourceAcl: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            deleteMany: jest.fn(),
        },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function documentRecord(): Record<string, unknown> {
    return {
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        title: 'Project plan',
        content: 'content',
        visibility: DocumentVisibility.PRIVATE,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: USER_ID,
        updatedBy: USER_ID,
        deletedAt: null,
        version: 1,
        resource: {
            id: DOCUMENT_ID,
            tenantId: TENANT_ID,
            type: ResourceType.DOCUMENT,
            ownerMembershipId: MEMBERSHIP_ID,
            createdAt: NOW,
            updatedAt: NOW,
            createdBy: USER_ID,
            updatedBy: USER_ID,
            deletedAt: null,
            version: 1,
            acls: [],
        },
    };
}

function aclRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: ACL_ID,
        tenantId: TENANT_ID,
        resourceId: DOCUMENT_ID,
        subjectType: AclSubjectType.MEMBERSHIP,
        subjectId: MEMBERSHIP_ID,
        permissionCodes: ['document.read'],
        expiresAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: USER_ID,
        updatedBy: USER_ID,
        deletedAt: null,
        version: 1,
        ...overrides,
    };
}
