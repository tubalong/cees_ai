import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { describeChatError, toChatHttpException } from './chat.errors';
import { ChatService } from './chat.service';
import { ChatCompactRequestDto, ChatRequestDto } from './dto';
import { ChatCompactResult, ChatInvokeResult, ChatStreamResultEvent } from './chat.types';

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** 生成完整回答；消息正文和摘要只在本次请求中传递，不在 API 数据库保存。 */
  @Post('invoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '生成一轮完整的 AI 对话回答' })
  @ApiOkResponse({ description: 'AI 回答及本次调用的 Token 指标' })
  invoke(
    @Headers('x-request-id') requestId: string | undefined,
    @Body() input: ChatRequestDto,
  ): Promise<ChatInvokeResult> {
    return this.chatService.invoke(input, requestId);
  }

  /**
   * 代理 ai-service Chat SSE。此路由直接写出 SSE，故不使用普通 JSON
   * 成功包络；客户端断开时 AbortSignal 会继续传递到上游模型流。
   */
  @Post('stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '以 SSE 流式生成一轮 AI 对话回答' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'started/status/content_delta/usage/completed/error 事件流' })
  async stream(
    @Headers('x-request-id') requestId: string | undefined,
    @Body() input: ChatRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    const abortController = new AbortController();
    const handleClose = (): void => {
      if (!response.writableEnded) abortController.abort();
    };
    response.once('close', handleClose);

    try {
      const events = await this.chatService.stream(input, requestId, abortController.signal);
      if (response.destroyed) return;

      response.status(HttpStatus.OK);
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache, no-transform');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();

      for await (const event of events) {
        if (response.destroyed) break;
        await writeSseEvent(response, event);
        if (event.type === 'completed' || event.type === 'error') break;
      }
      if (!response.writableEnded && !response.destroyed) response.end();
    } catch (error) {
      if (response.destroyed) return;
      if (!response.headersSent) throw toChatHttpException(error);

      const described = describeChatError(error);
      if (!response.writableEnded) {
        await writeSseEvent(response, {
          type: 'error',
          error: {
            code: described.code,
            message: described.message,
            retryable: described.retryable,
          },
        });
        response.end();
      }
    } finally {
      response.removeListener('close', handleClose);
      abortController.abort();
    }
  }

  /** 生成供客户端本地保存的历史摘要；API 只记录本次调用的 Token 指标。 */
  @Post('compact')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '将本地对话历史压缩为可复用摘要' })
  @ApiOkResponse({ description: '新摘要、压缩截止消息 ID 和本次调用的 Token 指标' })
  compact(
    @Headers('x-request-id') requestId: string | undefined,
    @Body() input: ChatCompactRequestDto,
  ): Promise<ChatCompactResult> {
    return this.chatService.compact(input, requestId);
  }
}

async function writeSseEvent(response: Response, event: ChatStreamResultEvent): Promise<void> {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  if (response.write(payload)) return;

  await new Promise<void>((resolve, reject) => {
    const handleDrain = (): void => {
      cleanup();
      resolve();
    };
    const handleClose = (): void => {
      cleanup();
      reject(new Error('Chat SSE client disconnected'));
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
