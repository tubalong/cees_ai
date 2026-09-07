import { NotFoundException } from '@nestjs/common';
import { DocumentVisibility, ResourceType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ManagedDocumentWithAccess, ResourceAccessService } from '../resource/resource-access.service';
import { TenantContext } from '../tenant/tenant-context';
import { DocumentService } from './document.service';

describe('DocumentService', () => {
    it('creates Resource, Document and audit in one transaction', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord());
        const access = createAccessMock();
        const service = createService(prisma, access);

        const result = await service.createDocument({
            title: ' Project plan ',
            content: 'content',
            visibility: DocumentVisibility.PRIVATE,
        });

        expect(result.title).toBe('Project plan');
        expect(prisma.resource.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                type: ResourceType.DOCUMENT,
                ownerMembershipId: MEMBERSHIP_ID,
            }),
        });
        expect(prisma.managedDocument.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ title: 'Project plan', content: 'content' }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'DOCUMENT_CREATED' }),
        });
    });

    it('lists only SQL-filtered accessible documents and returns a cursor', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findMany.mockResolvedValue([
            documentRecord({ id: DOCUMENT_ID }),
            documentRecord({ id: SECOND_DOCUMENT_ID, title: 'Second' }),
        ]);
        const access = createAccessMock();
        const service = createService(prisma, access);

        const result = await service.listDocuments({ limit: 1, keyword: 'plan' });

        expect(result.items).toHaveLength(1);
        expect(result.nextCursor).toBe(DOCUMENT_ID);
        expect(access.documentWhere).toHaveBeenCalledWith('document.read', [ROLE_ID]);
        expect(prisma.managedDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    });

    it('returns not found when the document is outside the access scope', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(null);
        const service = createService(prisma, createAccessMock());

        await expect(service.getDocument(DOCUMENT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates an accessible document with optimistic locking and audit', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst
            .mockResolvedValueOnce(documentRecord())
            .mockResolvedValueOnce(documentRecord({ title: 'Updated', version: 2 }));
        prisma.managedDocument.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma, createAccessMock());

        const result = await service.updateDocument(DOCUMENT_ID, { title: 'Updated', version: 1 });

        expect(result.version).toBe(2);
        expect(prisma.managedDocument.updateMany).toHaveBeenCalledWith({
            where: { id: DOCUMENT_ID, tenantId: TENANT_ID, version: 1, deletedAt: null },
            data: expect.objectContaining({ title: 'Updated', version: { increment: 1 } }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'DOCUMENT_UPDATED' }),
        });
    });

    it('soft deletes the document, resource and ACL entries', async () => {
        const prisma = createPrismaMock();
        prisma.managedDocument.findFirst.mockResolvedValue(documentRecord());
        prisma.managedDocument.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma, createAccessMock());

        await service.deleteDocument(DOCUMENT_ID, 1);

        expect(prisma.resource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: DOCUMENT_ID, tenantId: TENANT_ID, deletedAt: null },
        }));
        expect(prisma.resourceAcl.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: TENANT_ID, resourceId: DOCUMENT_ID, deletedAt: null },
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'DOCUMENT_DELETED' }),
        });
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const ROLE_ID = '20000000-0000-0000-0000-000000000001';
const DOCUMENT_ID = '70000000-0000-0000-0000-000000000001';
const SECOND_DOCUMENT_ID = '70000000-0000-0000-0000-000000000002';
const NOW = new Date('2026-09-07T00:00:00.000Z');

function createService(prisma: Record<string, any>, access: Record<string, any>): DocumentService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: ['tenant_admin'],
            permissions: [
                'document.create',
                'document.read',
                'document.update',
                'document.delete',
                'document.share',
                'document.manage_all',
            ],
        }),
    } as unknown as TenantContext;
    return new DocumentService(
        prisma as unknown as PrismaService,
        tenantContext,
        access as unknown as ResourceAccessService,
    );
}

function createAccessMock(): Record<string, any> {
    return {
        resolveCurrentRoleIds: jest.fn().mockResolvedValue([ROLE_ID]),
        documentWhere: jest.fn().mockReturnValue({ tenantId: TENANT_ID, deletedAt: null }),
        effectiveDocumentPermissions: jest.fn().mockReturnValue(['document.read', 'document.update']),
    };
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        resource: { create: jest.fn(), updateMany: jest.fn() },
        managedDocument: {
            create: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            updateMany: jest.fn(),
        },
        resourceAcl: { updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function documentRecord(overrides: Record<string, unknown> = {}): ManagedDocumentWithAccess {
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
        ...overrides,
    } as ManagedDocumentWithAccess;
}
