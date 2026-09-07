import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditOutcome } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { AuditService } from './audit.service';

describe('AuditService', () => {
    it('lists filtered events for the current tenant and returns a cursor', async () => {
        const prisma = createPrismaMock();
        prisma.auditLog.findMany.mockResolvedValue([
            auditRecord({ id: AUDIT_ID }),
            auditRecord({ id: SECOND_AUDIT_ID, action: 'ROLE_UPDATED' }),
        ]);
        const service = createService(prisma);

        const result = await service.listEvents({
            action: 'AUTH_LOGIN_SUCCEEDED',
            outcome: AuditOutcome.SUCCESS,
            actorId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            resourceType: 'AUTH_SESSION',
            resourceId: RESOURCE_ID,
            requestId: 'request-id',
            from: '2026-09-01T00:00:00.000Z',
            to: '2026-09-04T23:59:59.000Z',
            limit: 1,
        });

        expect(result.items).toHaveLength(1);
        expect(result.nextCursor).toBe(AUDIT_ID);
        expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
            where: {
                tenantId: TENANT_ID,
                action: 'AUTH_LOGIN_SUCCEEDED',
                outcome: AuditOutcome.SUCCESS,
                actorUserId: USER_ID,
                actorMembershipId: MEMBERSHIP_ID,
                resourceType: 'AUTH_SESSION',
                resourceId: RESOURCE_ID,
                requestId: 'request-id',
                createdAt: {
                    gte: new Date('2026-09-01T00:00:00.000Z'),
                    lte: new Date('2026-09-04T23:59:59.000Z'),
                },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: undefined,
            skip: 0,
            take: 2,
        });
    });

    it('rejects an inverted date range', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma);

        await expect(service.listEvents({
            from: '2026-09-05T00:00:00.000Z',
            to: '2026-09-04T00:00:00.000Z',
            limit: 50,
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });

    it('rejects a cursor outside the current tenant', async () => {
        const prisma = createPrismaMock();
        prisma.auditLog.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.listEvents({ cursor: AUDIT_ID, limit: 50 }))
            .rejects.toMatchObject({ response: { code: 'PAGINATION_CURSOR_INVALID' } });
        expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({
            where: { id: AUDIT_ID, tenantId: TENANT_ID },
            select: { id: true },
        });
    });

    it('returns an audit event from the current tenant', async () => {
        const prisma = createPrismaMock();
        prisma.auditLog.findFirst.mockResolvedValue(auditRecord());
        const service = createService(prisma);

        const result = await service.getEvent(AUDIT_ID);

        expect(result).toEqual(expect.objectContaining({
            id: AUDIT_ID,
            outcome: AuditOutcome.SUCCESS,
            actorMembershipId: MEMBERSHIP_ID,
        }));
        expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({
            where: { id: AUDIT_ID, tenantId: TENANT_ID },
        });
    });

    it('hides audit events from other tenants', async () => {
        const prisma = createPrismaMock();
        prisma.auditLog.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.getEvent(AUDIT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const AUDIT_ID = '60000000-0000-0000-0000-000000000001';
const SECOND_AUDIT_ID = '60000000-0000-0000-0000-000000000002';
const RESOURCE_ID = '70000000-0000-0000-0000-000000000001';

function createService(prisma: Record<string, any>): AuditService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'query-request-id',
            roles: ['tenant_admin'],
            permissions: ['audit.read'],
        }),
    } as unknown as TenantContext;
    return new AuditService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    return {
        auditLog: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
        },
    };
}

function auditRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: AUDIT_ID,
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        actorMembershipId: MEMBERSHIP_ID,
        action: 'AUTH_LOGIN_SUCCEEDED',
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'AUTH_SESSION',
        resourceId: RESOURCE_ID,
        requestId: 'request-id',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        metadata: { deviceName: 'test' },
        createdAt: new Date('2026-09-04T00:00:00.000Z'),
        ...overrides,
    };
}
