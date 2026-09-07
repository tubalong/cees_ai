import { AclSubjectType, DocumentVisibility } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { ManagedDocumentWithAccess, ResourceAccessService } from './resource-access.service';

describe('ResourceAccessService', () => {
    it('builds tenant-scoped SQL filtering for readable documents', () => {
        const service = createService(['document.read']);

        const where = service.documentWhere('document.read', [ROLE_ID], NOW);

        expect(where).toEqual(expect.objectContaining({ AND: expect.any(Array) }));
        expect(JSON.stringify(where)).toContain(TENANT_ID);
        expect(JSON.stringify(where)).toContain(MEMBERSHIP_ID);
        expect(JSON.stringify(where)).toContain('TENANT');
        expect(JSON.stringify(where)).toContain('document.read');
    });

    it('returns an impossible filter when RBAC permission is missing', () => {
        const service = createService([]);

        expect(service.documentWhere('document.read', [], NOW)).toEqual({ id: { in: [] } });
    });

    it('allows tenant visibility for read but not update', () => {
        const service = createService(['document.read', 'document.update']);
        const document = documentRecord({ visibility: DocumentVisibility.TENANT });

        expect(service.canAccessDocument(document, 'document.read', [], NOW)).toBe(true);
        expect(service.canAccessDocument(document, 'document.update', [], NOW)).toBe(false);
    });

    it('allows active role ACL permissions and rejects expired grants', () => {
        const service = createService(['document.update']);
        const active = documentRecord({
            resource: resourceRecord({
                acls: [aclRecord({ subjectType: AclSubjectType.ROLE, subjectId: ROLE_ID })],
            }),
        });
        const expired = documentRecord({
            resource: resourceRecord({
                acls: [aclRecord({
                    subjectType: AclSubjectType.ROLE,
                    subjectId: ROLE_ID,
                    expiresAt: new Date('2026-09-06T00:00:00.000Z'),
                })],
            }),
        });

        expect(service.canAccessDocument(active, 'document.update', [ROLE_ID], NOW)).toBe(true);
        expect(service.canAccessDocument(expired, 'document.update', [ROLE_ID], NOW)).toBe(false);
    });

    it('uses manage-all as a scope bypass while retaining RBAC operations', () => {
        const service = createService(['document.delete', 'document.manage_all']);

        expect(service.canAccessDocument(documentRecord(), 'document.delete', [], NOW)).toBe(true);
        expect(service.canAccessDocument(documentRecord(), 'document.share', [], NOW)).toBe(false);
    });

    it('rejects cross-tenant and deleted records before evaluating permissions', () => {
        const service = createService(['document.read', 'document.manage_all']);
        const crossTenant = documentRecord({ tenantId: '10000000-0000-0000-0000-000000000099' });
        const deleted = documentRecord({ resource: resourceRecord({ deletedAt: NOW }) });

        expect(service.canAccessDocument(crossTenant, 'document.read', [], NOW)).toBe(false);
        expect(service.canAccessDocument(deleted, 'document.read', [], NOW)).toBe(false);
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const OWNER_MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000002';
const ROLE_ID = '20000000-0000-0000-0000-000000000001';
const DOCUMENT_ID = '70000000-0000-0000-0000-000000000001';
const ACL_ID = '80000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-09-07T00:00:00.000Z');

function createService(permissions: string[]): ResourceAccessService {
    const prisma = {
        membershipRole: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: [],
            permissions,
        }),
    } as unknown as TenantContext;
    return new ResourceAccessService(prisma, tenantContext);
}

function documentRecord(overrides: Record<string, unknown> = {}): ManagedDocumentWithAccess {
    return {
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        title: 'Private document',
        content: 'content',
        visibility: DocumentVisibility.PRIVATE,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: USER_ID,
        updatedBy: USER_ID,
        deletedAt: null,
        version: 1,
        resource: resourceRecord(),
        ...overrides,
    } as ManagedDocumentWithAccess;
}

function resourceRecord(overrides: Record<string, unknown> = {}): ManagedDocumentWithAccess['resource'] {
    return {
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        type: 'DOCUMENT',
        ownerMembershipId: OWNER_MEMBERSHIP_ID,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: USER_ID,
        updatedBy: USER_ID,
        deletedAt: null,
        version: 1,
        acls: [],
        ...overrides,
    } as ManagedDocumentWithAccess['resource'];
}

function aclRecord(overrides: Record<string, unknown> = {}): ManagedDocumentWithAccess['resource']['acls'][number] {
    return {
        id: ACL_ID,
        tenantId: TENANT_ID,
        resourceId: DOCUMENT_ID,
        subjectType: AclSubjectType.MEMBERSHIP,
        subjectId: MEMBERSHIP_ID,
        permissionCodes: ['document.update'],
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
