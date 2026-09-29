import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * SSE 写出与断线处理工具：轮次与任务事件流共用同一套语义。
 * 客户端断开（close）只终止推送并中止订阅，不触发取消；事件已持久化，
 * 重连按 afterSeq 重放补齐。流建立后任一步骤失败只静默收尾，不掩盖
 * 已推送的事实；头部尚未发送时则抛出错误，由调用方映射为 HTTP 异常。
 */

/** writeSse 的可选行为开关。 */
export interface WriteSseOptions<E> {
  /** 返回 true 的事件在推送后结束循环（如轮次的 error 终止事件）。 */
  terminateOn?: (event: E) => boolean;
  /** 头部未发送时把内部错误映射为 HTTP 异常（如轮次错误体系）。 */
  mapError?: (error: unknown) => unknown;
}

/** 写出事件流直到生成器结束、命中终止事件或客户端断开。 */
export async function writeSse<E extends { type: string }>(
  response: Response,
  events: AsyncGenerator<E>,
  abortController: AbortController,
  onClose: () => void,
  options?: WriteSseOptions<E>,
): Promise<void> {
  try {
    if (response.destroyed) return;
    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const generator = events[Symbol.asyncIterator]();
    while (true) {
      const step = await generator.next();
      if (step.done || response.destroyed) break;
      await writeSseEvent(response, step.value);
      if (options?.terminateOn?.(step.value)) break;
    }
    if (!response.writableEnded && !response.destroyed) response.end();
  } catch (error) {
    if (response.destroyed) return;
    if (!response.headersSent) throw options?.mapError ? options.mapError(error) : error;
    if (!response.writableEnded) response.end();
  } finally {
    response.removeListener('close', onClose);
    abortController.abort();
  }
}

/** 客户端断开时中止订阅（abort 信号）；返回解绑函数供调用方清理。 */
export function attachCloseHandler(response: Response, abortController: AbortController): () => void {
  const onClose = (): void => abortController.abort();
  response.once('close', onClose);
  return onClose;
}

/** 单条事件写入；写缓冲满时等待 drain，断开或出错时以异常中断推送循环。 */
async function writeSseEvent(response: Response, event: { type: string }): Promise<void> {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  if (response.write(payload)) return;

  await new Promise<void>((resolve, reject) => {
    const handleDrain = (): void => {
      cleanup();
      resolve();
    };
    const handleClose = (): void => {
      cleanup();
      reject(new Error('SSE client disconnected'));
    };
    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      response.removeListener('drain', handleDrain);
      response.removeListener('close', handleClose);
      response.removeListener('error', handleError);
    };
    response.once('drain', handleDrain);
    response.once('close', handleClose);
    response.once('error', handleError);
  });
}
