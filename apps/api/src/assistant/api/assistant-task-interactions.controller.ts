import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../../rbac/permission.guard';
import { TenantContextInterceptor } from '../../tenant/tenant-context.interceptor';
import { TenantGuard } from '../../tenant/tenant.guard';
import { ResolveTaskInteractionRequestDto } from '../dto';
import { InteractionService } from '../orchestration/interaction.service';
import type { PublicTaskDetail } from '../orchestration/orchestration.types';
import { TaskService } from '../orchestration/task.service';

/**
 * 挂起事项接口：解决授权批准/拒绝、提问答复、裁决选项。
 * 与任务接口同源的归属与权限语义——归属由服务层按发起成员过滤（不属于则 404），
 * 端点统一要求 ai.task.read；解决动作幂等（重复提交返回当前状态而不是报错）。
 */
@ApiTags('Assistant Tasks')
@ApiBearerAuth()
@Controller('assistant/task-interactions')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class AssistantTaskInteractionsController {
  constructor(
    private readonly interactions: InteractionService,
    private readonly taskService: TaskService,
  ) { }

  @Post(':interactionId/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ai.task.read')
  @ApiOperation({ summary: '解决挂起事项（授权批准/拒绝、提问答复、裁决选项）' })
  @ApiOkResponse({ description: '返回更新后的任务详情' })
  async resolveTaskInteraction(
    @Param('interactionId', new ParseUUIDPipe()) interactionId: string,
    @Body() input: ResolveTaskInteractionRequestDto,
  ): Promise<PublicTaskDetail> {
    const interaction = await this.interactions.resolve(interactionId, {
      decision: input.decision,
      scope: input.scope ?? null,
      value: input.value ?? null,
    });
    // 解决后即时恢复：任务挂起且已无未决事项时转回 RUNNING 并重新调度
    // （仍有多条未决或任务本就在跑时不动作，由调度循环自行衔接）。
    await this.taskService.resumeAfterInteractionResolved(interaction.taskId);
    return this.taskService.getDetail(interaction.taskId);
  }
}
