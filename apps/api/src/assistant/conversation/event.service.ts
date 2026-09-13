import { Injectable } from '@nestjs/common';
import { AssistantEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { isTerminalTurnStatus, PublicTurnStreamEvent } from '../assistant.types';

const POLL_INTERVAL_MS = 250;

/**
 * 轮次事件的持久化与重放。事件带轮次内递增 seq（@@unique([turnId, seq])），
 * 断线重连按 afterSeq 重放；订阅端通过短轮询读取新事件直到轮次终态，
 * 不依赖进程内消息通道，因此对多实例部署安全。
 */
@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 追加一条事件并返回分配的 seq；seq 由数据库 max+1 分配（冲突时重试），
   * 并补写进 payload，使持久化 JSON 与公开事件结构完全一致。
   */
  async append(
    turnId: string,
    tenantId: string,
    type: AssistantEventType,
    payload: Record<string, unknown>,
  ): Promise<number> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const aggregate = await tx.assistantEvent.aggregate({
            where: { turnId },
            _max: { seq: true },
          });
          const seq = (aggregate._max.seq ?? 0) + 1;
          await tx.assistantEvent.create({
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
        });
      } catch (error) {
        if (isUniqueConstraintError(error) && attempt < 2) continue;
        throw error;
      }
    }
    throw new Error(`failed to append assistant event for turn ${turnId}`);
  }

  /**
   * 从 afterSeq 之后开始按序产出事件，并在轮次进入终态且事件全部消费后结束。
   * 调用方中断生成器（客户端断开）只停止推送，不影响执行侧持续写入。
   */
  async *poll(
    turnId: string,
    afterSeq: number,
    signal?: AbortSignal,
  ): AsyncGenerator<PublicTurnStreamEvent> {
    let lastSeq = afterSeq;
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
      if (!turn || isTerminalTurnStatus(turn.status)) return;

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

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
