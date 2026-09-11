import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantContextInterceptor } from '../../tenant/tenant-context.interceptor';
import { TenantGuard } from '../../tenant/tenant.guard';
import { toAssistantHttpException } from '../assistant.errors';
import type {
  PublicConversation,
  PublicConversationDetail,
  PublicConversationListResult,
  PublicTurn,
  PublicTurnStreamEvent,
} from '../assistant.types';
import { ConversationService } from '../conversation/conversation.service';
import {
  CreateConversationRequestDto,
  CreateTurnRequestDto,
  ListConversationsQueryDto,
  ReplayTurnEventsQueryDto,
} from '../dto';
import { TurnRunnerService } from '../runtime/turn-runner.service';

const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

@ApiTags('Conversation')
@ApiBearerAuth()
@Controller('conversations')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class AssistantController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly turnRunner: TurnRunnerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建当前成员的私有 AI 会话' })
  @ApiOkResponse({ description: '会话创建成功' })
  createConversation(@Body() input: CreateConversationRequestDto): Promise<PublicConversation> {
    return this.conversationService.create(input.title);
  }

  @Get()
  @ApiOperation({ summary: '查询当前成员的会话列表' })
  @ApiOkResponse({ description: '按更新时间倒序返回当前成员的私有会话' })
  listConversations(@Query() query: ListConversationsQueryDto): Promise<PublicConversationListResult> {
    return this.conversationService.list(query.limit, query.cursor);
  }

  @Get(':conversationId')
  @ApiOperation({ summary: '查询会话详情与最近消息' })
  @ApiOkResponse({ description: '会话元数据与最近消息（按时间升序，最多 100 条）' })
  getConversation(@Param('conversationId') conversationId: string): Promise<PublicConversationDetail> {
    return this.conversationService.getDetail(conversationId);
  }

  /**
   * 发起一轮对话并以 SSE 流式返回事件。客户端断开只解除订阅不取消执行；
   * 重复提交同一 Idempotency-Key 返回原 Turn 的事件流。
   */
  @Post(':conversationId/turns')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发起一轮对话并以 SSE 流式返回事件' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'started/status/content_delta/tool_call/tool_result/usage/completed/error 事件流' })
  async createTurn(
    @Param('conversationId') conversationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreateTurnRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    const abortController = new AbortController();
    attachCloseHandler(response, abortController);
    const started = await this.turnRunner.startTurn({
      conversationId,
      idempotencyKey: normalizedKey,
      content: input.content,
      mode: input.mode,
    });
    const events = await this.turnRunner.subscribeTurn(
      { conversationId, turnId: started.turnId, afterSeq: 0 },
      abortController.signal,
    );
    await this.writeSse(response, events, abortController);
  }

  /** 重放 afterSeq 之后的事件并继续接收实时事件，直到轮次终态。 */
  @Get(':conversationId/turns/:turnId/events')
  @ApiOperation({ summary: '以 SSE 重放并继续接收轮次事件' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: '轮次事件流' })
  async replayTurnEvents(
    @Param('conversationId') conversationId: string,
    @Param('turnId') turnId: string,
    @Query() query: ReplayTurnEventsQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const abortController = new AbortController();
    attachCloseHandler(response, abortController);
    const events = await this.turnRunner.subscribeTurn(
      {
        conversationId,
        turnId,
        afterSeq: query.afterSeq,
      },
      abortController.signal,
    );
    await this.writeSse(response, events, abortController);
  }

  @Post(':conversationId/turns/:turnId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消正在执行的轮次' })
  @ApiOkResponse({ description: '轮次已取消' })
  cancelTurn(
    @Param('conversationId') conversationId: string,
    @Param('turnId') turnId: string,
  ): Promise<PublicTurn> {
    return this.turnRunner.cancelTurn(conversationId, turnId);
  }

  /**
   * 写出 SSE 事件流。客户端断开（close）只终止推送循环，不触发取消；
   * 上游执行由 TurnRunner 独立驱动，事件持久化后可通过重放接口补齐。
   */
  private async writeSse(
    response: Response,
    events: AsyncGenerator<PublicTurnStreamEvent>,
    abortController: AbortController,
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
        if (step.value.type === 'completed' || step.value.type === 'error') break;
      }
      if (!response.writableEnded && !response.destroyed) response.end();
    } catch (error) {
      if (response.destroyed) return;
      if (!response.headersSent) throw toAssistantHttpException(error);
      if (!response.writableEnded) response.end();
    } finally {
      response.removeListener('close', abortController.abort);
      abortController.abort();
    }
  }
}

function normalizeIdempotencyKey(idempotencyKey: string | undefined): string {
  const normalized = idempotencyKey?.trim();
  if (!normalized) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '缺少 Idempotency-Key 请求头',
    });
  }
  if (normalized.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_INVALID',
      message: `Idempotency-Key 不能超过 ${IDEMPOTENCY_KEY_MAX_LENGTH} 个字符`,
    });
  }
  return normalized;
}

function attachCloseHandler(response: Response, abortController: AbortController): void {
  response.once('close', abortController.abort);
}

async function writeSseEvent(response: Response, event: PublicTurnStreamEvent): Promise<void> {
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
