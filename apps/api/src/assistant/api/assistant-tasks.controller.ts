import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { PermissionGuard, RequirePermissions } from '../../rbac/permission.guard';
import { TenantContextInterceptor } from '../../tenant/tenant-context.interceptor';
import { TenantGuard } from '../../tenant/tenant.guard';
import {
  CancelAssistantTaskRequestDto,
  ConfirmAssistantTaskPlanRequestDto,
  ListAssistantTasksQueryDto,
  ReplayTaskEventsQueryDto,
} from '../dto';
import type {
  PublicTaskDetail,
  PublicTaskListResult,
} from '../orchestration/orchestration.types';
import { TaskEventService } from '../orchestration/task-event.service';
import { TaskService } from '../orchestration/task.service';
import { attachCloseHandler, writeSse } from './sse.util';

/**
 * AI 任务接口：任务列表、详情、计划确认与取消。任务只属于发起成员——
 * 所有权由服务层的 membershipId 过滤保证，端点统一要求 ai.task.read。
 * 企业没有 AI 同事时任务自然为空，本组接口照常工作（列表为空、查询 404），
 * 不影响正常对话与其余工具。事件流与轮次共用 SSE 写出语义：客户端断开
 * 只解除订阅，任务事实由服务层持续写入，重连按 afterSeq 重放补齐。
 */
@ApiTags('Assistant Tasks')
@ApiBearerAuth()
@Controller('assistant/tasks')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class AssistantTasksController {
  constructor(
    private readonly taskService: TaskService,
    private readonly taskEvents: TaskEventService,
  ) { }

  @Get()
  @RequirePermissions('ai.task.read')
  @ApiOperation({ summary: '查询当前成员发起的 AI 任务列表' })
  @ApiOkResponse({ description: '按创建时间倒序返回当前成员发起的任务' })
  listTasks(@Query() query: ListAssistantTasksQueryDto): Promise<PublicTaskListResult> {
    return this.taskService.list({
      status: query.status,
      conversationId: query.conversationId,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get(':taskId')
  @RequirePermissions('ai.task.read')
  @ApiOperation({ summary: '查询任务详情' })
  @ApiOkResponse({ description: '任务、当前最新计划版本与运行时步骤' })
  getTask(
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
  ): Promise<PublicTaskDetail> {
    return this.taskService.getDetail(taskId);
  }

  /**
   * 以 SSE 重放并继续接收任务事件。先校验任务归属（404 先于流建立），
   * 任务进入终态且事件全部消费后流自然结束。
   */
  @Get(':taskId/events')
  @RequirePermissions('ai.task.read')
  @ApiOperation({ summary: '以 SSE 重放并继续接收任务事件' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'task_created/plan_ready/plan_confirmed/task_completed/task_failed/task_cancelled 事件流' })
  async replayTaskEvents(
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Query() query: ReplayTaskEventsQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const abortController = new AbortController();
    const onClose = attachCloseHandler(response, abortController);
    try {
      // 归属校验：任务不存在或不属于当前成员时在流建立前返回 404。
      await this.taskService.getDetail(taskId);
      const events = this.taskEvents.poll(taskId, query.afterSeq, abortController.signal);
      await writeSse(response, events, abortController, onClose);
    } catch (error) {
      response.removeListener('close', onClose);
      abortController.abort();
      throw error;
    }
  }

  @Post(':taskId/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ai.task.read')
  @ApiOperation({ summary: '确认或调整计划（派发前确认）' })
  @ApiOkResponse({ description: '返回更新后的任务详情' })
  confirmTask(
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() input: ConfirmAssistantTaskPlanRequestDto,
  ): Promise<PublicTaskDetail> {
    return this.taskService.confirm(taskId, {
      decision: input.decision,
      answers: input.answers,
    });
  }

  @Post(':taskId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ai.task.read')
  @ApiOperation({ summary: '取消任务' })
  @ApiOkResponse({ description: '返回更新后的任务详情' })
  cancelTask(
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() input: CancelAssistantTaskRequestDto,
  ): Promise<PublicTaskDetail> {
    return this.taskService.cancel(taskId, { reason: input?.reason ?? null });
  }
}
