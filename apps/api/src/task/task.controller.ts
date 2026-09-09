import {
    Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe,
    Patch, Post, Put, Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import {
    AddTaskAttachmentDto, CreateTaskCommentDto, CreateTaskDto, ListTaskEntriesQueryDto,
    ListTasksQueryDto, ReplaceTaskAssigneesDto, TaskTransitionDto, TaskVersionQueryDto,
    UpdateTaskCommentDto, UpdateTaskDto,
} from './dto';
import { TaskService } from './task.service';
import {
    TaskActivityListResult, TaskAttachmentListResult, TaskAttachmentResult,
    TaskCommentListResult, TaskCommentResult, TaskListResult, TaskResult,
} from './task.types';

@ApiTags('task')
@ApiBearerAuth()
@Controller('projects/:projectId/tasks')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class TaskController {
    constructor(private readonly taskService: TaskService) { }

    @Get()
    @RequirePermissions('task.read')
    @ApiOkResponse({ description: '项目任务列表' })
    listTasks(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Query() query: ListTasksQueryDto,
    ): Promise<TaskListResult> {
        return this.taskService.listTasks(projectId, query);
    }

    @Post()
    @RequirePermissions('task.create')
    @ApiCreatedResponse({ description: '任务已创建' })
    createTask(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Body() input: CreateTaskDto,
    ): Promise<TaskResult> {
        return this.taskService.createTask(projectId, input);
    }

    @Get(':taskId')
    @RequirePermissions('task.read')
    @ApiOkResponse({ description: '任务详情' })
    getTask(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
    ): Promise<TaskResult> {
        return this.taskService.getTask(projectId, taskId);
    }

    @Patch(':taskId')
    @RequirePermissions('task.update')
    @ApiOkResponse({ description: '任务已修改' })
    updateTask(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Body() input: UpdateTaskDto,
    ): Promise<TaskResult> {
        return this.taskService.updateTask(projectId, taskId, input);
    }

    @Delete(':taskId')
    @RequirePermissions('task.delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '任务已软删除' })
    deleteTask(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Query() query: TaskVersionQueryDto,
    ): Promise<void> {
        return this.taskService.deleteTask(projectId, taskId, query.version);
    }

    @Post(':taskId/transitions')
    @RequirePermissions('task.status.update')
    @ApiOkResponse({ description: '任务状态已变更' })
    transitionTask(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Body() input: TaskTransitionDto,
    ): Promise<TaskResult> {
        return this.taskService.transitionTask(projectId, taskId, input);
    }

    @Put(':taskId/assignees')
    @RequirePermissions('task.assignee.manage')
    @ApiOkResponse({ description: '任务执行人已替换' })
    replaceAssignees(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Body() input: ReplaceTaskAssigneesDto,
    ): Promise<TaskResult> {
        return this.taskService.replaceAssignees(projectId, taskId, input);
    }

    @Get(':taskId/comments')
    @RequirePermissions('task.read')
    @ApiOkResponse({ description: '任务评论列表' })
    listComments(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Query() query: ListTaskEntriesQueryDto,
    ): Promise<TaskCommentListResult> {
        return this.taskService.listComments(projectId, taskId, query);
    }

    @Post(':taskId/comments')
    @RequirePermissions('task.comment.create')
    @ApiCreatedResponse({ description: '任务评论已创建' })
    createComment(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Body() input: CreateTaskCommentDto,
    ): Promise<TaskCommentResult> {
        return this.taskService.createComment(projectId, taskId, input);
    }

    @Patch(':taskId/comments/:commentId')
    @RequirePermissions('task.comment.update')
    @ApiOkResponse({ description: '任务评论已修改' })
    updateComment(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Param('commentId', new ParseUUIDPipe()) commentId: string,
        @Body() input: UpdateTaskCommentDto,
    ): Promise<TaskCommentResult> {
        return this.taskService.updateComment(projectId, taskId, commentId, input);
    }

    @Delete(':taskId/comments/:commentId')
    @RequirePermissions('task.comment.delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '任务评论已删除' })
    deleteComment(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Param('commentId', new ParseUUIDPipe()) commentId: string,
        @Query() query: TaskVersionQueryDto,
    ): Promise<void> {
        return this.taskService.deleteComment(projectId, taskId, commentId, query.version);
    }

    @Get(':taskId/attachments')
    @RequirePermissions('task.read')
    @ApiOkResponse({ description: '任务附件列表' })
    listAttachments(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
    ): Promise<TaskAttachmentListResult> {
        return this.taskService.listAttachments(projectId, taskId);
    }

    @Post(':taskId/attachments')
    @RequirePermissions('task.attachment.manage')
    @ApiCreatedResponse({ description: '任务附件已添加' })
    addAttachment(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Body() input: AddTaskAttachmentDto,
    ): Promise<TaskAttachmentResult> {
        return this.taskService.addAttachment(projectId, taskId, input);
    }

    @Delete(':taskId/attachments/:attachmentId')
    @RequirePermissions('task.attachment.manage')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '任务附件关联已移除' })
    removeAttachment(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
        @Query() query: TaskVersionQueryDto,
    ): Promise<void> {
        return this.taskService.removeAttachment(projectId, taskId, attachmentId, query.version);
    }

    @Get(':taskId/activities')
    @RequirePermissions('task.read')
    @ApiOkResponse({ description: '任务操作动态列表' })
    listActivities(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('taskId', new ParseUUIDPipe()) taskId: string,
        @Query() query: ListTaskEntriesQueryDto,
    ): Promise<TaskActivityListResult> {
        return this.taskService.listActivities(projectId, taskId, query);
    }
}
