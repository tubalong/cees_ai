import { ConflictException } from '@nestjs/common';
import { MemoryType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { UserMemoryService } from './user-memory.service';

describe('UserMemoryService', () => {
    it('returns the active memories of the current membership ordered by creation time', async () => {
        const prisma = createPrismaMock();
        prisma.userMemory.findMany.mockResolvedValue([
            memoryRecord(),
            memoryRecord({ id: MEMORY_ID_2, content: '习惯使用夜间模式', type: MemoryType.HABIT, createdAt: LATER }),
        ]);
        const service = createService(prisma);

        const result = await service.list();

        expect(result).toHaveLength(2);
        expect(result[0].content).toBe('偏好简洁的代码风格');
        expect(prisma.userMemory.findMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT_ID, membershipId: MEMBERSHIP_ID, deletedAt: null },
            select: expect.any(Object),
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
    });

    it('updates memory content with optimistic locking and writes audit', async () => {
        const prisma = createPrismaMock();
        prisma.userMemory.findFirst.mockResolvedValue(memoryRecord());
        prisma.userMemory.updateMany.mockResolvedValue({ count: 1 });
        prisma.userMemory.findUniqueOrThrow.mockResolvedValue(
            memoryRecord({ content: '偏好简洁且带注释的代码', version: 2, updatedAt: LATER }),
        );
        const service = createService(prisma);

        const result = await service.update(MEMORY_ID, { content: '  偏好简洁且带注释的代码  ', version: 1 });

        expect(result.content).toBe('偏好简洁且带注释的代码');
        expect(result.version).toBe(2);
        expect(prisma.userMemory.updateMany).toHaveBeenCalledWith({
            where: {
                id: MEMORY_ID,
                tenantId: TENANT_ID,
                membershipId: MEMBERSHIP_ID,
                version: 1,
                deletedAt: null,
            },
            data: { content: '偏好简洁且带注释的代码', version: { increment: 1 } },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'USER_MEMORY_UPDATED',
                resourceType: 'USER_MEMORY',
                resourceId: MEMORY_ID,
                metadata: {
                    before: { type: 'PREFERENCE', content: '偏好简洁的代码风格', version: 1 },
                    after: { type: 'PREFERENCE', content: '偏好简洁且带注释的代码', version: 2 },
                },
            }),
        });
    });

    it('changes only the memory type when content is omitted', async () => {
        const prisma = createPrismaMock();
        prisma.userMemory.findFirst.mockResolvedValue(memoryRecord());
        prisma.userMemory.updateMany.mockResolvedValue({ count: 1 });
        prisma.userMemory.findUniqueOrThrow.mockResolvedValue(
            memoryRecord({ type: MemoryType.DECISION, version: 2, updatedAt: LATER }),
        );
        const service = createService(prisma);

        await service.update(MEMORY_ID, { type: MemoryType.DECISION, version: 1 });

        expect(prisma.userMemory.updateMany).toHaveBeenCalledWith({
            where: expect.any(Object),
            data: { type: MemoryType.DECISION, version: { increment: 1 } },
        });
    });

    it('does not write or audit when the update changes nothing', async () => {
        const prisma = createPrismaMock();
        prisma.userMemory.findFirst.mockResolvedValue(memoryRecord());
        const service = createService(prisma);

        const result = await service.update(MEMORY_ID, {
            content: ' 偏好简洁的代码风格 ',
            type: MemoryType.PREFERENCE,
            version: 1,
        });

        expect(result.version).toBe(1);
        expect(prisma.userMemory.updateMany).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects a stale memory version', async () => {
        const prisma = createPrismaMock();
        prisma.userMemory.findFirst.mockResolvedValue(memoryRecord({ version: 2 }));
        prisma.userMemory.updateMany.mockResolvedValue({ count: 0 });
        const service = createService(prisma);

        await expect(service.update(MEMORY_ID, { content: '新内容', version: 1 }))
            .rejects.toBeInstanceOf(ConflictException);
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects updating a memory that does not belong to the current membership', async () => {
        const prisma = createPrismaMock();
        prisma.userMemory.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.update(MEMORY_ID, { content: '新内容', version: 1 }))
            .rejects.toMatchObject({ response: { code: 'USER_MEMORY_NOT_FOUND' } });
        expect(prisma.userMemory.updateMany).not.toHaveBeenCalled();
    });

    it('rejects content that is empty after trimming', async () => {
        const prisma = createPrismaMock();
        prisma.userMemory.findFirst.mockResolvedValue(memoryRecord());
        const service = createService(prisma);

        await expect(service.update(MEMORY_ID, { content: '   ', version: 1 }))
            .rejects.toMatchObject({ response: { code: 'USER_MEMORY_CONTENT_INVALID' } });
    });

    it('rejects an update providing neither content nor type', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma);

        await expect(service.update(MEMORY_ID, { version: 1 }))
            .rejects.toMatchObject({ response: { code: 'USER_MEMORY_UPDATE_EMPTY' } });
    });

    it('soft-deletes a memory with optimistic locking and writes audit', async () => {
        const prisma = createPrismaMock();
        prisma.userMemory.findFirst.mockResolvedValue(memoryRecord());
        prisma.userMemory.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma);

        await service.remove(MEMORY_ID, 1);

        expect(prisma.userMemory.updateMany).toHaveBeenCalledWith({
            where: {
                id: MEMORY_ID,
                tenantId: TENANT_ID,
                membershipId: MEMBERSHIP_ID,
                version: 1,
                deletedAt: null,
            },
            data: { deletedAt: expect.any(Date), version: { increment: 1 } },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'USER_MEMORY_DELETED',
                resourceType: 'USER_MEMORY',
                resourceId: MEMORY_ID,
                metadata: { type: 'PREFERENCE', content: '偏好简洁的代码风格', version: 1 },
            }),
        });
    });

    it('rejects deleting a memory with a stale version', async () => {
        const prisma = createPrismaMock();
        prisma.userMemory.findFirst.mockResolvedValue(memoryRecord({ version: 3 }));
        prisma.userMemory.updateMany.mockResolvedValue({ count: 0 });
        const service = createService(prisma);

        await expect(service.remove(MEMORY_ID, 1)).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('rejects deleting a memory that does not exist for the current membership', async () => {
        const prisma = createPrismaMock();
        prisma.userMemory.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.remove(MEMORY_ID, 1))
            .rejects.toMatchObject({ response: { code: 'USER_MEMORY_NOT_FOUND' } });
        expect(prisma.userMemory.updateMany).not.toHaveBeenCalled();
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const MEMORY_ID = '70000000-0000-0000-0000-000000000001';
const MEMORY_ID_2 = '70000000-0000-0000-0000-000000000002';
const LATER = new Date('2026-09-21T12:00:00.000Z');

function createService(prisma: Record<string, any>): UserMemoryService {
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
    return new UserMemoryService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        userMemory: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            findUniqueOrThrow: jest.fn(),
            updateMany: jest.fn(),
        },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
        async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma),
    );
    return prisma;
}

function memoryRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: MEMORY_ID,
        type: MemoryType.PREFERENCE,
        content: '偏好简洁的代码风格',
        version: 1,
        createdAt: new Date('2026-09-21T08:00:00.000Z'),
        updatedAt: new Date('2026-09-21T08:00:00.000Z'),
        ...overrides,
    };
}
