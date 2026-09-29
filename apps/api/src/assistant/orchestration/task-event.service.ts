import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  isTerminalTaskStatus,
  PendingTaskStreamEvent,
  PublicTaskStreamEvent,
  toAssistantTaskEventType,
} from './orchestration.types';

const POLL_INTERVAL_MS = 250;

/**
 * 任务事件的持久化与重放。事件带任务内递增 seq（@@unique([taskId, seq])），
 * 断线重连按 afterSeq 重放；订阅端通过短轮询读取新事件直到任务终态，
 * 不依赖进程内消息通道，因此对多实例部署安全（与轮次事件同构）。
 */
@Injectable()
export class TaskEventService {
  constructor(private readonly prisma: PrismaService) { }

  /** 追加一条事件；seq 由 AssistantTask.nextEventSeq 在同一事务内原子分配。 */
  async append(taskId: string, tenantId: string, event: PendingTaskStreamEvent): Promise<number> {
    return this.prisma.$transaction((transaction) =>
      this.appendInTransaction(transaction, taskId, tenantId, event));
  }

  /**
   * 在调用方事务中追加事件。关键状态变更与事件可借此原子提交，
   * SSE 仅消费已提交的事实，不再承担一致性职责。
   */
  async appendInTransaction(
    transaction: Prisma.TransactionClient,
    taskId: string,
    tenantId: string,
    event: PendingTaskStreamEvent,
  ): Promise<number> {
    const allocation = await transaction.assistantTask.update({
      where: { id: taskId },
      data: { nextEventSeq: { increment: 1 } },
      select: { nextEventSeq: true },
    });
    const seq = allocation.nextEventSeq - 1;
    await transaction.assistantTaskEvent.create({
      data: {
        tenantId,
        taskId,
        seq,
        type: toAssistantTaskEventType(event.type),
        payload: { ...event, seq } as Prisma.InputJsonObject,
      },
      select: { seq: true },
    });
    return seq;
  }

  /**
   * 从 afterSeq 之后开始按序产出事件，并在任务进入终态且事件全部消费后结束。
   * 调用方中断生成器（客户端断开）只停止推送，不影响执行侧持续写入。
   */
  async *poll(
    taskId: string,
    afterSeq: number,
    signal?: AbortSignal,
  ): AsyncGenerator<PublicTaskStreamEvent> {
    let lastSeq = afterSeq;
    while (true) {
      if (signal?.aborted) return;

      const events = await this.prisma.assistantTaskEvent.findMany({
        where: { taskId, seq: { gt: lastSeq } },
        orderBy: { seq: 'asc' },
        take: 200,
        select: { seq: true, payload: true },
      });
      for (const event of events) {
        lastSeq = event.seq;
        yield event.payload as unknown as PublicTaskStreamEvent;
      }
      if (events.length > 0) continue;

      const task = await this.prisma.assistantTask.findUnique({
        where: { id: taskId },
        select: { status: true },
      });
      if (!task || isTerminalTaskStatus(task.status)) return;

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
