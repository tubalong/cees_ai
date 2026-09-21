import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
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
  DeleteConversationQueryDto,
  ListConversationsQueryDto,
  ReplayTurnEventsQueryDto,
  UpdateConversationRequestDto,
} from '../dto';
import { TurnRunnerService } from '../runtime/turn-runner.service';
import { RELATED_QUESTIONS_LINGER_MS } from '../runtime/turn-execution.config';

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
  ) { }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建当前成员的私有 AI 会话' })
  @ApiOkResponse({ description: '会话创建成功' })
  createConversation(@Body() input: CreateConversationRequestDto): Promise<PublicConversation> {
    return this.conversationService.create(input.title, input.mode);
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
  getConversation(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ): Promise<PublicConversationDetail> {
    return this.conversationService.getDetail(conversationId);
  }

  @Patch(':conversationId')
  @ApiOperation({ summary: '修改当前成员私有会话的标题' })
  @ApiOkResponse({ description: '返回修改后的会话' })
  updateConversation(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() input: UpdateConversationRequestDto,
  ): Promise<PublicConversation> {
    return this.conversationService.updateTitle(conversationId, input.title, input.version);
  }

  @Delete(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '软删除当前成员的私有会话' })
  @ApiNoContentResponse({ description: '会话已删除；历史消息、事件和审计事实保留' })
  deleteConversation(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Query() query: DeleteConversationQueryDto,
  ): Promise<void> {
    return this.conversationService.delete(conversationId, query.version);
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
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreateTurnRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    const abortController = new AbortController();
    const onClose = attachCloseHandler(response, abortController);
    try {
      const started = await this.turnRunner.startTurn({
        conversationId,
        idempotencyKey: normalizedKey,
        content: input.content,
        imageFileIds: input.imageFileIds,
        documentFileIds: input.fileIds,
        connectorContexts: input.connectorContexts,
        mode: input.mode,
        knowledgeBaseEnabled: input.knowledgeBaseEnabled,
        webSearchEnabled: input.webSearchEnabled,
      });
      const events = await this.turnRunner.subscribeTurn(
        {
          conversationId,
          turnId: started.turnId,
          afterSeq: 0,
          lingerMs: RELATED_QUESTIONS_LINGER_MS,
        },
        abortController.signal,
      );
      await this.writeSse(response, events, abortController, onClose);
    } catch (error) {
      response.removeListener('close', onClose);
      abortController.abort();
      throw error;
    }
  }

  /** 重放 afterSeq 之后的事件并继续接收实时事件，直到轮次终态。 */
  @Get(':conversationId/turns/:turnId/events')
  @ApiOperation({ summary: '以 SSE 重放并继续接收轮次事件' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: '轮次事件流' })
  async replayTurnEvents(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Param('turnId', new ParseUUIDPipe()) turnId: string,
    @Query() query: ReplayTurnEventsQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const abortController = new AbortController();
    const onClose = attachCloseHandler(response, abortController);
    try {
      const events = await this.turnRunner.subscribeTurn(
        {
          conversationId,
          turnId,
          afterSeq: query.afterSeq,
          lingerMs: RELATED_QUESTIONS_LINGER_MS,
        },
        abortController.signal,
      );
      await this.writeSse(response, events, abortController, onClose);
    } catch (error) {
      response.removeListener('close', onClose);
      abortController.abort();
      throw error;
    }
  }

  @Post(':conversationId/turns/:turnId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消正在执行的轮次' })
  @ApiOkResponse({ description: '轮次已取消' })
  cancelTurn(
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Param('turnId', new ParseUUIDPipe()) turnId: string,
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
    onClose: () => void,
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
        // error 是终止事件；completed 之后可能还有 related_questions，
        // 由订阅侧的宽限期（lingerMs）决定何时自然结束。
        if (step.value.type === 'error') break;
      }
      if (!response.writableEnded && !response.destroyed) response.end();
    } catch (error) {
      if (response.destroyed) return;
      if (!response.headersSent) throw toAssistantHttpException(error);
      if (!response.writableEnded) response.end();
    } finally {
      response.removeListener('close', onClose);
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

function attachCloseHandler(response: Response, abortController: AbortController): () => void {
  const onClose = (): void => abortController.abort();
  response.once('close', onClose);
  return onClose;
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
