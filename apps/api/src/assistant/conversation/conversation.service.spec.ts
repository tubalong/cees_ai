import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConversationMessageRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import { ConversationService } from './conversation.service';

describe('ConversationService', () => {
    it('creates a private conversation for the current member', async () => {
        const prisma = createPrismaMock();
        // 模拟数据库回显：create 返回与写入一致的 title。
        prisma.conversation.create.mockResolvedValue(conversationRecord({ id: CONVERSATION_ID, title: '计划讨论' }));
        const service = createService(prisma);

        const result = await service.create('  计划讨论  ');

        expect(result).toEqual(expect.objectContaining({ id: CONVERSATION_ID, title: '计划讨论' }));
        expect(prisma.conversation.create).toHaveBeenCalledWith({
            data: {
                tenantId: TENANT_ID,
                ownerMembershipId: MEMBERSHIP_ID,
                title: '计划讨论',
            },
        });
    });

    it('lists conversations ordered by updated time and returns a cursor', async () => {
        const prisma = createPrismaMock();
        prisma.conversation.findMany.mockResolvedValue([
            conversationRecord({ id: CONVERSATION_ID }),
            conversationRecord({ id: SECOND_CONVERSATION_ID }),
        ]);
        const service = createService(prisma);

        const result = await service.list(1);

        expect(result.items).toHaveLength(1);
        expect(result.nextCursor).toBeTruthy();
        expect(prisma.conversation.findMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT_ID, ownerMembershipId: MEMBERSHIP_ID, deletedAt: null },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: 2,
        });
    });

    it('decodes a cursor into the keyset filter', async () => {
        const prisma = createPrismaMock();
        prisma.conversation.findMany.mockResolvedValue([]);
        const service = createService(prisma);
        const cursor = Buffer.from('2026-09-01T00:00:00.000Z|' + CONVERSATION_ID).toString('base64url');

        await service.list(20, cursor);

        const where = prisma.conversation.findMany.mock.calls[0][0].where;
        expect(where.OR).toEqual([
            { updatedAt: { lt: new Date('2026-09-01T00:00:00.000Z') } },
            { updatedAt: new Date('2026-09-01T00:00:00.000Z'), id: { lt: CONVERSATION_ID } },
        ]);
    });

    it('rejects an invalid cursor', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma);

        await expect(service.list(20, 'not-a-valid-cursor'))
            .rejects.toMatchObject({ response: { code: 'PAGINATION_CURSOR_INVALID' } });
        expect(prisma.conversation.findMany).not.toHaveBeenCalled();
    });

    it('hides conversations owned by other members', async () => {
        const prisma = createPrismaMock();
        prisma.conversation.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.getDetail(CONVERSATION_ID)).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
            where: {
                id: CONVERSATION_ID,
                tenantId: TENANT_ID,
                ownerMembershipId: MEMBERSHIP_ID,
                deletedAt: null,
            },
            select: { id: true, tenantId: true, title: true, ownerMembershipId: true },
        });
    });

    it('returns conversation detail with messages in ascending order', async () => {
        const prisma = createPrismaMock();
        prisma.conversation.findFirst.mockResolvedValue({
            id: CONVERSATION_ID,
            tenantId: TENANT_ID,
            title: '',
            ownerMembershipId: MEMBERSHIP_ID,
        });
        prisma.conversation.findUniqueOrThrow.mockResolvedValue(conversationRecord({ id: CONVERSATION_ID }));
        prisma.conversationMessage.findMany.mockResolvedValue([messageRecord()]);
        const service = createService(prisma);

        const result = await service.getDetail(CONVERSATION_ID);

        expect(result.messages).toHaveLength(1);
        expect(prisma.conversationMessage.findMany).toHaveBeenCalledWith({
            where: { tenantId: TENANT_ID, conversationId: CONVERSATION_ID },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 100,
        });
    });

    it('derives a title from the first user message when the conversation has none', async () => {
        const prisma = createPrismaMock();
        prisma.conversation.findFirst.mockResolvedValue({
            id: CONVERSATION_ID,
            tenantId: TENANT_ID,
            title: '',
            ownerMembershipId: MEMBERSHIP_ID,
        });
        // 35 字符，超过 30 字符上限，验证截断并追加省略号。
        prisma.conversationMessage.findFirst.mockResolvedValue({
            content: '请帮我整理下周的项目计划并分配任务给各成员跟进执行，并在周会上同步进度',
        });
        const service = createService(prisma);

        await service.setTitleFromFirstUserMessage(CONVERSATION_ID);

        expect(prisma.conversation.update).toHaveBeenCalledWith({
            where: { id: CONVERSATION_ID },
            data: { title: '请帮我整理下周的项目计划并分配任务给各成员跟进执行，并在周会…' },
        });
    });

    it('does not overwrite an existing title', async () => {
        const prisma = createPrismaMock();
        prisma.conversation.findFirst.mockResolvedValue({
            id: CONVERSATION_ID,
            tenantId: TENANT_ID,
            title: '已有标题',
            ownerMembershipId: MEMBERSHIP_ID,
        });
        const service = createService(prisma);

        await service.setTitleFromFirstUserMessage(CONVERSATION_ID);

        expect(prisma.conversationMessage.findFirst).not.toHaveBeenCalled();
        expect(prisma.conversation.update).not.toHaveBeenCalled();
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const CONVERSATION_ID = '60000000-0000-0000-0000-000000000001';
const SECOND_CONVERSATION_ID = '60000000-0000-0000-0000-000000000002';
const MESSAGE_ID = '70000000-0000-0000-0000-000000000001';

function createService(prisma: Record<string, any>): ConversationService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'query-request-id',
            roles: [],
            permissions: [],
        }),
    } as unknown as TenantContext;
    return new ConversationService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    return {
        conversation: {
            create: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
            findUniqueOrThrow: jest.fn(),
            update: jest.fn(),
        },
        conversationMessage: {
            create: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
        },
        conversationSummary: {
            create: jest.fn(),
            findFirst: jest.fn(),
        },
    };
}

function conversationRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: CONVERSATION_ID,
        tenantId: TENANT_ID,
        ownerMembershipId: MEMBERSHIP_ID,
        title: '',
        visibility: 'PRIVATE',
        lastTurnAt: null,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        deletedAt: null,
        ...overrides,
    };
}

function messageRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: MESSAGE_ID,
        tenantId: TENANT_ID,
        conversationId: CONVERSATION_ID,
        turnId: null,
        role: ConversationMessageRole.USER,
        content: '你好',
        toolCallId: null,
        createdAt: new Date('2026-09-01T00:00:01.000Z'),
        ...overrides,
    };
}
