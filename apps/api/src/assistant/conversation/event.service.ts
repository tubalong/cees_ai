import { Injectable } from '@nestjs/common';
import { AssistantEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { isTerminalTurnStatus, PublicTurnStreamEvent } from '../assistant.types';

const POLL_INTERVAL_MS = 250;

/** 轮次终态后的宽限等待窗口；期间仍可能追加后续事件（如 related_questions）。 */
export interface TurnPollOptions {
  /** 终态且事件消费完后继续等待新事件的最长毫秒数；不传或传 0 时保持旧行为。 */
  lingerMs?: number;
}

/**
 * 轮次事件的持久化与重放。事件带轮次内递增 seq（@@unique([turnId, seq])），
 * 断线重连按 afterSeq 重放；订阅端通过短轮询读取新事件直到轮次终态，
 * 不依赖进程内消息通道，因此对多实例部署安全。
 */
@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  /** 追加一条事件；seq 由 AssistantTurn.nextEventSeq 在同一事务内原子分配。 */
  async append(
    turnId: string,
    tenantId: string,
    type: AssistantEventType,
    payload: Record<string, unknown>,
  ): Promise<number> {
    return this.prisma.$transaction((transaction) =>
      this.appendInTransaction(transaction, turnId, tenantId, type, payload));
  }

  /**
   * 在调用方事务中追加事件。关键状态变更、工具结果消息和事件可借此原子提交，
   * SSE 仅消费已提交的事实，不再承担一致性职责。
   */
  async appendInTransaction(
    transaction: Prisma.TransactionClient,
    turnId: string,
    tenantId: string,
    type: AssistantEventType,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const allocation = await transaction.assistantTurn.update({
      where: { id: turnId },
      data: { nextEventSeq: { increment: 1 } },
      select: { nextEventSeq: true },
    });
    const seq = allocation.nextEventSeq - 1;
    await transaction.assistantEvent.create({
      data: {
        tenantId,
        turnId,
        seq,
        type,
        payload: { ...payload, seq } as Prisma.InputJsonObject,
      },
      select: { seq: true },
    });
    return seq;
  }

  /**
   * 从 afterSeq 之后开始按序产出事件，并在轮次进入终态且事件全部消费后结束。
   * 指定 lingerMs 时，终态后进入最长 lingerMs 毫秒的宽限期：期间追加的新事件
   * 继续产出，宽限期到则结束。用于 completed 之后异步到达的 related_questions。
   * 调用方中断生成器（客户端断开）只停止推送，不影响执行侧持续写入。
   */
  async *poll(
    turnId: string,
    afterSeq: number,
    signal?: AbortSignal,
    options?: TurnPollOptions,
  ): AsyncGenerator<PublicTurnStreamEvent> {
    const lingerMs = options?.lingerMs ?? 0;
    let lastSeq = afterSeq;
    let lingerUntil: number | null = null;
    while (true) {
      if (signal?.aborted) return;

      const events = await this.prisma.assistantEvent.findMany({
        where: { turnId, seq: { gt: lastSeq } },
        orderBy: { seq: 'asc' },
        take: 200,
        select: { seq: true, payload: true },
      });
      for (const event of events) {
        lastSeq = event.seq;
        yield event.payload as unknown as PublicTurnStreamEvent;
      }
      if (events.length > 0) continue;

      const turn = await this.prisma.assistantTurn.findUnique({
        where: { id: turnId },
        select: { status: true },
      });
      if (!turn || isTerminalTurnStatus(turn.status)) {
        if (lingerMs <= 0) return;
        if (lingerUntil === null) lingerUntil = Date.now() + lingerMs;
        if (Date.now() >= lingerUntil) return;
      }

      await sleep(POLL_INTERVAL_MS, signal);
    }
  }
}

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }
  });
}
