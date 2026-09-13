import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConversationMessageRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import type {
  PublicConversation,
  PublicConversationDetail,
  PublicConversationListResult,
} from '../assistant.types';

/** 历史消息按更新时间倒序分页时的 keyset 游标，base64url 编码。 */
interface ConversationCursor {
  updatedAt: Date;
  id: string;
}

/**
 * 服务端会话事实源：Conversation / ConversationMessage / ConversationSummary
 * 的写入与查询都经过本服务，统一做成员归属校验。
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async create(title?: string | null): Promise<PublicConversation> {
    const { tenantId, membershipId } = this.tenantContext.require();
    const conversation = await this.prisma.conversation.create({
      data: {
        tenantId,
        ownerMembershipId: membershipId,
        title: title?.trim() ?? '',
      },
    });
    return toPublicConversation(conversation);
  }

  async list(limit: number, cursor?: string): Promise<PublicConversationListResult> {
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
    await this.requireMemberConversation(conversationId);
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    const messages = await this.prisma.conversationMessage.findMany({
      where: { tenantId: conversation.tenantId, conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    return {
      conversation: toPublicConversation(conversation),
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        turnId: message.turnId,
        toolCallId: message.toolCallId,
      })),
    };
  }

  /** 校验会话属于当前成员；不属于或已删除按不存在处理。 */
  async requireMemberConversation(
    conversationId: string,
  ): Promise<{ id: string; tenantId: string; title: string; ownerMembershipId: string }> {
    const { tenantId, membershipId } = this.tenantContext.require();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, ownerMembershipId: membershipId, deletedAt: null },
      select: { id: true, tenantId: true, title: true, ownerMembershipId: true },
    });
    if (!conversation) {
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: '会话不存在或不属于当前成员',
      });
    }
    return conversation;
  }

  /** 轮次完成且会话尚无标题时，按首条 user 消息生成标题。 */
  async setTitleFromFirstUserMessage(conversationId: string): Promise<void> {
    const conversation = await this.requireMemberConversation(conversationId);
    if (conversation.title) return;

    const first = await this.prisma.conversationMessage.findFirst({
      where: { tenantId: conversation.tenantId, conversationId, role: ConversationMessageRole.USER },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { content: true },
    });
    const source = first?.content.trim();
    if (!source) return;

    const title = source.length > 30 ? `${source.slice(0, 30)}…` : source;
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { title } });
  }

  async appendUserMessage(input: {
    conversation: { id: string; tenantId: string };
    turnId: string;
    content: string;
  }): Promise<void> {
    await this.prisma.conversationMessage.create({
      data: {
        tenantId: input.conversation.tenantId,
        conversationId: input.conversation.id,
        turnId: input.turnId,
        role: ConversationMessageRole.USER,
        content: input.content,
      },
    });
  }

  async appendAssistantMessage(input: {
    conversation: { id: string; tenantId: string };
    turnId: string;
    content: string;
  }): Promise<void> {
    await this.prisma.conversationMessage.create({
      data: {
        tenantId: input.conversation.tenantId,
        conversationId: input.conversation.id,
        turnId: input.turnId,
        role: ConversationMessageRole.ASSISTANT,
        content: input.content,
      },
    });
  }

  /** 工具结果消息：toolCallId 关联公开 tool_call / tool_result 事件的稳定标识。 */
  async appendToolMessage(input: {
    conversation: { id: string; tenantId: string };
    turnId: string;
    toolCallId: string;
    content: string;
  }): Promise<void> {
    await this.prisma.conversationMessage.create({
      data: {
        tenantId: input.conversation.tenantId,
        conversationId: input.conversation.id,
        turnId: input.turnId,
        role: ConversationMessageRole.TOOL,
        toolCallId: input.toolCallId,
        content: input.content,
      },
    });
  }

  /** 会话最近发起轮次时间；列表按更新时间倒序依赖该字段联动 updatedAt。 */
  async touchLastTurnAt(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastTurnAt: new Date() },
    });
  }
}

function toPublicConversation(conversation: {
  id: string;
  title: string;
  visibility: 'PRIVATE';
  createdAt: Date;
  updatedAt: Date;
  lastTurnAt: Date | null;
}): PublicConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    visibility: conversation.visibility,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastTurnAt: conversation.lastTurnAt,
  };
}

function encodeConversationCursor(conversation: { updatedAt: Date; id: string }): string {
  return Buffer.from(`${conversation.updatedAt.toISOString()}|${conversation.id}`).toString('base64url');
}

function decodeConversationCursor(cursor: string): ConversationCursor {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator < 1) throw new Error('missing separator');
    const updatedAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (Number.isNaN(updatedAt.getTime()) || !id) throw new Error('invalid cursor fields');
    return { updatedAt, id };
  } catch {
    throw new BadRequestException({
      code: 'PAGINATION_CURSOR_INVALID',
      message: '分页游标无效',
    });
  }
}
