import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssistantTurnStatus,
  AuditOutcome,
  ConversationMessageRole,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import type {
  PublicConversation,
  PublicConversationDetail,
  PublicConversationListResult,
  PublicTurnMode,
} from '../assistant.types';
import { lockConversationForUpdate } from './conversation-transaction-lock';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const MAX_TITLE_LENGTH = 128;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const memberConversationSelect = {
  id: true,
  tenantId: true,
  ownerMembershipId: true,
  title: true,
  visibility: true,
  mode: true,
  lastTurnAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  version: true,
} satisfies Prisma.ConversationSelect;

export type MemberConversation = Prisma.ConversationGetPayload<{
  select: typeof memberConversationSelect;
}>;

type ConversationDb = PrismaService | Prisma.TransactionClient;

interface ConversationCursor {
  updatedAt: Date;
  id: string;
}

/**
 * 服务端会话目录与成员归属入口。会话生命周期只在这里实现；TurnStateService
 * 负责轮次、消息和事件事务，避免出现第二套聊天状态机。
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async create(title?: string | null, mode?: PublicTurnMode): Promise<PublicConversation> {
    const context = this.tenantContext.require();
    const normalizedTitle = normalizeOptionalTitle(title);
    const normalizedMode = normalizeConversationMode(mode);
    const conversation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.conversation.create({
        data: {
          tenantId: context.tenantId,
          ownerMembershipId: context.membershipId,
          title: normalizedTitle,
          mode: normalizedMode,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          action: 'CONVERSATION_CREATED',
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'CONVERSATION',
          resourceId: created.id,
          requestId: context.requestId,
          metadata: { title: normalizedTitle || null, mode: normalizedMode },
        },
      });
      return created;
    });
    return toPublicConversation(conversation);
  }

  async list(limit = DEFAULT_LIST_LIMIT, cursor?: string): Promise<PublicConversationListResult> {
    assertListLimit(limit);
    const { tenantId, membershipId } = this.tenantContext.require();
    const keyset = cursor ? decodeConversationCursor(cursor) : undefined;

    const conversations = await this.prisma.conversation.findMany({
      where: {
        tenantId,
        ownerMembershipId: membershipId,
        deletedAt: null,
        ...(keyset
          ? {
              OR: [
                { updatedAt: { lt: keyset.updatedAt } },
                { updatedAt: keyset.updatedAt, id: { lt: keyset.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNextPage = conversations.length > limit;
    const page = hasNextPage ? conversations.slice(0, limit) : conversations;
    const last = page[page.length - 1];
    return {
      items: page.map(toPublicConversation),
      nextCursor: hasNextPage && last ? encodeConversationCursor(last) : null,
    };
  }

  async getDetail(conversationId: string): Promise<PublicConversationDetail> {
    const conversation = await this.requireMemberConversation(conversationId);
    const messages = await this.prisma.conversationMessage.findMany({
      where: { tenantId: conversation.tenantId, conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return {
      conversation: toPublicConversation(conversation),
      messages: messages.reverse().map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        imageFileIds: message.imageFileIds,
        createdAt: message.createdAt,
        turnId: message.turnId,
        toolCallId: message.toolCallId,
      })),
    };
  }

  async updateTitle(
    conversationId: string,
    title: string,
    version: number,
  ): Promise<PublicConversation> {
    const context = this.tenantContext.require();
    const normalizedTitle = normalizeRequiredTitle(title);
    const conversation = await this.prisma.$transaction(async (transaction) => {
      await lockConversationForUpdate(transaction, context.tenantId, conversationId);
      const current = await this.requireMemberConversation(conversationId, transaction);
      assertVersion(current.version, version);

      const updated = await transaction.conversation.updateMany({
        where: {
          id: conversationId,
          tenantId: context.tenantId,
          ownerMembershipId: context.membershipId,
          deletedAt: null,
          version,
        },
        data: { title: normalizedTitle, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw versionConflict();

      await transaction.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          action: 'CONVERSATION_TITLE_UPDATED',
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'CONVERSATION',
          resourceId: conversationId,
          requestId: context.requestId,
          metadata: {
            before: { title: current.title, version: current.version },
            after: { title: normalizedTitle, version: version + 1 },
          },
        },
      });
      return transaction.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: memberConversationSelect,
      });
    });
    return toPublicConversation(conversation);
  }

  /**
   * 软删除会话，保留消息、ToolCall、事件和审计事实。存在运行中轮次时拒绝删除，
   * 避免后台执行在会话已经不可见后继续写入结果。
   */
  async delete(conversationId: string, version: number): Promise<void> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockConversationForUpdate(transaction, context.tenantId, conversationId);
      const current = await this.requireMemberConversation(conversationId, transaction);
      assertVersion(current.version, version);

      const activeTurns = await transaction.assistantTurn.count({
        where: {
          tenantId: context.tenantId,
          conversationId,
          status: { in: [AssistantTurnStatus.RECEIVED, AssistantTurnStatus.RUNNING] },
        },
      });
      if (activeTurns > 0) {
        throw new ConflictException({
          code: 'CONVERSATION_ACTIVE_TURN',
          message: '会话仍有执行中的轮次，请先取消或等待轮次结束',
        });
      }

      const now = new Date();
      const deleted = await transaction.conversation.updateMany({
        where: {
          id: conversationId,
          tenantId: context.tenantId,
          ownerMembershipId: context.membershipId,
          deletedAt: null,
          version,
        },
        data: { deletedAt: now, version: { increment: 1 } },
      });
      if (deleted.count !== 1) throw versionConflict();

      await transaction.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          actorMembershipId: context.membershipId,
          action: 'CONVERSATION_DELETED',
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'CONVERSATION',
          resourceId: conversationId,
          requestId: context.requestId,
          metadata: { title: current.title, version: current.version },
        },
      });
    });
  }

  /** 校验会话属于当前成员；不属于或已经软删除统一按不存在处理。 */
  async requireMemberConversation(
    conversationId: string,
    database: ConversationDb = this.prisma,
  ): Promise<MemberConversation> {
    const { tenantId, membershipId } = this.tenantContext.require();
    const conversation = await database.conversation.findFirst({
      where: { id: conversationId, tenantId, ownerMembershipId: membershipId, deletedAt: null },
      select: memberConversationSelect,
    });
    if (!conversation) throw conversationNotFound();
    return conversation;
  }

  /** 轮次完成且会话尚无标题时，按首条 user 消息生成标题。 */
  async setTitleFromFirstUserMessage(conversationId: string): Promise<void> {
    const conversation = await this.requireMemberConversation(conversationId);
    if (conversation.title) return;

    const first = await this.prisma.conversationMessage.findFirst({
      where: {
        tenantId: conversation.tenantId,
        conversationId,
        role: ConversationMessageRole.USER,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { content: true },
    });
    const source = first?.content.trim();
    if (!source) return;

    const title = source.length > 30 ? `${source.slice(0, 30)}…` : source;
    await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        tenantId: conversation.tenantId,
        ownerMembershipId: conversation.ownerMembershipId,
        title: '',
        version: conversation.version,
        deletedAt: null,
      },
      data: { title, version: { increment: 1 } },
    });
  }
}

function toPublicConversation(conversation: {
  id: string;
  title: string;
  visibility: 'PRIVATE';
  mode: string;
  createdAt: Date;
  updatedAt: Date;
  lastTurnAt: Date | null;
  version: number;
}): PublicConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    visibility: conversation.visibility,
    mode: conversation.mode === 'ultra' ? 'ultra' : 'standard',
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastTurnAt: conversation.lastTurnAt,
    version: conversation.version,
  };
}

function normalizeConversationMode(mode: PublicTurnMode | undefined): 'standard' | 'ultra' {
  return mode === 'ultra' ? 'ultra' : 'standard';
}

function normalizeOptionalTitle(title: string | null | undefined): string {
  if (title === null || title === undefined) return '';
  const normalized = title.trim();
  if (normalized.length > MAX_TITLE_LENGTH) return normalizeRequiredTitle(title);
  return normalized;
}

function normalizeRequiredTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized || normalized.length > MAX_TITLE_LENGTH) {
    throw new BadRequestException({
      code: 'CONVERSATION_TITLE_INVALID',
      message: `会话标题必须为 1 至 ${MAX_TITLE_LENGTH} 个字符`,
    });
  }
  return normalized;
}

function assertListLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new BadRequestException({
      code: 'PAGINATION_LIMIT_INVALID',
      message: `limit 必须是 1 至 ${MAX_LIST_LIMIT} 的整数`,
    });
  }
}

function assertVersion(actual: number, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 1 || actual !== expected) {
    throw versionConflict();
  }
}

function versionConflict(): ConflictException {
  return new ConflictException({
    code: 'CONVERSATION_VERSION_CONFLICT',
    message: '会话已被其他请求修改，请刷新后重试',
  });
}

function conversationNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'CONVERSATION_NOT_FOUND',
    message: '会话不存在或不属于当前成员',
  });
}

function encodeConversationCursor(conversation: { updatedAt: Date; id: string }): string {
  return Buffer.from(`${conversation.updatedAt.toISOString()}|${conversation.id}`).toString('base64url');
}

function decodeConversationCursor(cursor: string): ConversationCursor {
  try {
    if (!BASE64URL_PATTERN.test(cursor)) throw new Error('invalid base64url');
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== cursor) throw new Error('non-canonical base64url');
    const fields = decoded.split('|');
    if (fields.length !== 2) throw new Error('invalid field count');
    const [timestamp, id] = fields;
    const updatedAt = new Date(timestamp);
    if (
      Number.isNaN(updatedAt.getTime())
      || updatedAt.toISOString() !== timestamp
      || !UUID_PATTERN.test(id)
    ) {
      throw new Error('invalid cursor fields');
    }
    return { updatedAt, id };
  } catch {
    throw new BadRequestException({
      code: 'PAGINATION_CURSOR_INVALID',
      message: '分页游标无效',
    });
  }
}
