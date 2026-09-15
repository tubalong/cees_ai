import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConversationMessageRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import { ConversationService } from './conversation.service';

describe('ConversationService', () => {
  it('creates a private conversation and audits it in one transaction', async () => {
    const prisma = createPrismaMock();
    prisma.conversation.create.mockResolvedValue(conversationRecord({ title: '计划讨论' }));
    const service = createService(prisma);

    const result = await service.create(' 计划讨论 ');

    expect(result).toEqual(expect.objectContaining({ id: CONVERSATION_ID, title: '计划讨论', version: 1 }));
    expect(result.mode).toBe('standard');
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT_ID, ownerMembershipId: MEMBERSHIP_ID, title: '计划讨论', mode: 'standard' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'CONVERSATION_CREATED', resourceId: CONVERSATION_ID }),
    }));
  });

  it('stores an explicit default mode when creating a conversation', async () => {
    const prisma = createPrismaMock();
    prisma.conversation.create.mockResolvedValue(conversationRecord({ mode: 'ultra' }));
    const service = createService(prisma);

    const result = await service.create(null, 'ultra');

    expect(result.mode).toBe('ultra');
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT_ID, ownerMembershipId: MEMBERSHIP_ID, title: '', mode: 'ultra' },
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

  it('decodes a canonical cursor into the keyset filter', async () => {
    const prisma = createPrismaMock();
    prisma.conversation.findMany.mockResolvedValue([]);
    const service = createService(prisma);
    const cursor = Buffer.from(`2026-09-01T00:00:00.000Z|${CONVERSATION_ID}`).toString('base64url');

    await service.list(20, cursor);

    const where = prisma.conversation.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { updatedAt: { lt: new Date('2026-09-01T00:00:00.000Z') } },
      { updatedAt: new Date('2026-09-01T00:00:00.000Z'), id: { lt: CONVERSATION_ID } },
    ]);
  });

  it('rejects invalid pagination input at the service boundary', async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    await expect(service.list(0)).rejects.toMatchObject({ response: { code: 'PAGINATION_LIMIT_INVALID' } });
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
      select: expect.objectContaining({ id: true, version: true }),
    });
  });

  it('returns conversation detail with messages in ascending order', async () => {
    const prisma = createPrismaMock();
    prisma.conversation.findFirst.mockResolvedValue(conversationRecord());
    prisma.conversationMessage.findMany.mockResolvedValue([messageRecord()]);
    const service = createService(prisma);

    const result = await service.getDetail(CONVERSATION_ID);

    expect(result.messages).toHaveLength(1);
    expect(prisma.conversationMessage.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, conversationId: CONVERSATION_ID },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  });

  it('updates a title with optimistic locking and an audit record', async () => {
    const prisma = createPrismaMock();
    prisma.conversation.findFirst.mockResolvedValue(conversationRecord({ title: '旧标题', version: 3 }));
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
    prisma.conversation.findUniqueOrThrow.mockResolvedValue(conversationRecord({ title: '新标题', version: 4 }));
    const service = createService(prisma);

    const result = await service.updateTitle(CONVERSATION_ID, ' 新标题 ', 3);

    expect(result).toEqual(expect.objectContaining({ title: '新标题', version: 4 }));
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: CONVERSATION_ID,
        tenantId: TENANT_ID,
        ownerMembershipId: MEMBERSHIP_ID,
        deletedAt: null,
        version: 3,
      },
      data: { title: '新标题', version: { increment: 1 } },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'CONVERSATION_TITLE_UPDATED', resourceId: CONVERSATION_ID }),
    }));
  });

  it('rejects a stale title update', async () => {
    const prisma = createPrismaMock();
    prisma.conversation.findFirst.mockResolvedValue(conversationRecord({ version: 4 }));
    const service = createService(prisma);

    await expect(service.updateTitle(CONVERSATION_ID, '新标题', 3))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('soft-deletes a conversation only when no turn is active', async () => {
    const prisma = createPrismaMock();
    prisma.conversation.findFirst.mockResolvedValue(conversationRecord({ version: 2 }));
    prisma.assistantTurn.count.mockResolvedValue(0);
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
    const service = createService(prisma);

    await service.delete(CONVERSATION_ID, 2);

    expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: CONVERSATION_ID,
        tenantId: TENANT_ID,
        ownerMembershipId: MEMBERSHIP_ID,
        deletedAt: null,
        version: 2,
      },
      data: { deletedAt: expect.any(Date), version: { increment: 1 } },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'CONVERSATION_DELETED', resourceId: CONVERSATION_ID }),
    }));
  });

  it('does not delete a conversation while a turn is running', async () => {
    const prisma = createPrismaMock();
    prisma.conversation.findFirst.mockResolvedValue(conversationRecord({ version: 1 }));
    prisma.assistantTurn.count.mockResolvedValue(1);
    const service = createService(prisma);

    await expect(service.delete(CONVERSATION_ID, 1))
      .rejects.toMatchObject({ response: { code: 'CONVERSATION_ACTIVE_TURN' } });
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('derives a title from the first user message without overwriting a manual title', async () => {
    const prisma = createPrismaMock();
    prisma.conversation.findFirst.mockResolvedValue(conversationRecord({ title: '', version: 1 }));
    prisma.conversationMessage.findFirst.mockResolvedValue({
      content: '请帮我整理下周的项目计划并分配任务给各成员跟进执行，并在周会上同步进度',
    });
    prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
    const service = createService(prisma);

    await service.setTitleFromFirstUserMessage(CONVERSATION_ID);

    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { title: expect.stringContaining('请帮我整理'), version: { increment: 1 } },
    }));
  });
});

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '10000000-0000-4000-8000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-4000-8000-000000000001';
const CONVERSATION_ID = '60000000-0000-4000-8000-000000000001';
const SECOND_CONVERSATION_ID = '60000000-0000-4000-8000-000000000002';
const MESSAGE_ID = '70000000-0000-4000-8000-000000000001';

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
  const prisma: Record<string, any> = {
    conversation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    conversationMessage: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    assistantTurn: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ id: CONVERSATION_ID }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
  return prisma;
}

function conversationRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CONVERSATION_ID,
    tenantId: TENANT_ID,
    ownerMembershipId: MEMBERSHIP_ID,
    title: '',
    visibility: 'PRIVATE',
    mode: 'standard',
    lastTurnAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    deletedAt: null,
    version: 1,
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
    imageFileIds: [],
    toolCallId: null,
    createdAt: new Date('2026-09-01T00:00:01.000Z'),
    ...overrides,
  };
}
