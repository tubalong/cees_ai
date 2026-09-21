import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { CancelProjectMilestoneDto, CompleteProjectMilestoneDto, CreateProjectDecisionDto, CreateProjectMilestoneDto, CreateProjectRepositoryDto, ListProjectActivitiesQueryDto, ProjectRepositoryVersionQueryDto, ProjectWorkflowVersionDto, PublishProjectDecisionDto, ReopenProjectMilestoneDto, UpdateProjectDecisionDto, UpdateProjectMilestoneDto, UpdateProjectRepositoryDto } from './project-workflow.dto';
import { ProjectWorkflowService } from './project-workflow.service';
import { ProjectActivityResult, ProjectDecisionResult, ProjectMilestoneResult, ProjectRepositoryResult, ProjectWorkflowSummaryResult } from './project-workflow.types';

@ApiTags('project-workflow')
@ApiBearerAuth()
@Controller('projects/:projectId')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class ProjectWorkflowController {
  constructor(private readonly service: ProjectWorkflowService) {}

  @Get('workflow-summary')
  @RequirePermissions('project.read')
  @ApiOkResponse({ description: '项目工作流汇总' })
  summary(@Param('projectId', new ParseUUIDPipe()) projectId: string): Promise<ProjectWorkflowSummaryResult> { return this.service.summary(projectId); }

  @Get('activities')
  @RequirePermissions('project.read')
  @ApiOkResponse({ description: '项目正式动态' })
  activities(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Query() query: ListProjectActivitiesQueryDto): Promise<ProjectActivityResult[]> { return this.service.listActivities(projectId, query); }

  @Get('decisions')
  @RequirePermissions('project.read')
  @ApiOkResponse({ description: '项目决策列表' })
  decisions(@Param('projectId', new ParseUUIDPipe()) projectId: string): Promise<ProjectDecisionResult[]> { return this.service.listDecisions(projectId); }

  @Post('decisions')
  @RequirePermissions('project.read')
  @ApiCreatedResponse({ description: '决策草稿已创建' })
  createDecision(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: CreateProjectDecisionDto): Promise<ProjectDecisionResult> { return this.service.createDecision(projectId, input); }

  @Get('decisions/:decisionId')
  @RequirePermissions('project.read')
  @ApiOkResponse({ description: '项目决策详情' })
  decision(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('decisionId', new ParseUUIDPipe()) decisionId: string): Promise<ProjectDecisionResult> { return this.service.getDecision(projectId, decisionId); }

  @Patch('decisions/:decisionId')
  @RequirePermissions('project.read')
  @ApiOkResponse({ description: '决策草稿已修改' })
  updateDecision(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('decisionId', new ParseUUIDPipe()) decisionId: string, @Body() input: UpdateProjectDecisionDto): Promise<ProjectDecisionResult> { return this.service.updateDecision(projectId, decisionId, input); }

  @Post('decisions/:decisionId/publish')
  @RequirePermissions('project.update')
  @ApiOkResponse({ description: '决策已发布' })
  publishDecision(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('decisionId', new ParseUUIDPipe()) decisionId: string, @Body() input: PublishProjectDecisionDto): Promise<ProjectDecisionResult> { return this.service.publishDecision(projectId, decisionId, input); }

  @Delete('decisions/:decisionId')
  @RequirePermissions('project.read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: '决策草稿已删除' })
  deleteDecision(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('decisionId', new ParseUUIDPipe()) decisionId: string, @Query() query: ProjectWorkflowVersionDto): Promise<void> { return this.service.deleteDecision(projectId, decisionId, query.version); }

  @Get('milestones')
  @RequirePermissions('project.read')
  @ApiOkResponse({ description: '项目里程碑列表' })
  milestones(@Param('projectId', new ParseUUIDPipe()) projectId: string): Promise<ProjectMilestoneResult[]> { return this.service.listMilestones(projectId); }

  @Post('milestones')
  @RequirePermissions('project.update')
  @ApiCreatedResponse({ description: '项目里程碑已创建' })
  createMilestone(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: CreateProjectMilestoneDto): Promise<ProjectMilestoneResult> { return this.service.createMilestone(projectId, input); }

  @Get('milestones/:milestoneId')
  @RequirePermissions('project.read')
  @ApiOkResponse({ description: '项目里程碑详情' })
  milestone(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('milestoneId', new ParseUUIDPipe()) milestoneId: string): Promise<ProjectMilestoneResult> { return this.service.getMilestone(projectId, milestoneId); }

  @Patch('milestones/:milestoneId')
  @RequirePermissions('project.update')
  @ApiOkResponse({ description: '项目里程碑已修改' })
  updateMilestone(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('milestoneId', new ParseUUIDPipe()) milestoneId: string, @Body() input: UpdateProjectMilestoneDto): Promise<ProjectMilestoneResult> { return this.service.updateMilestone(projectId, milestoneId, input); }

  @Post('milestones/:milestoneId/start')
  @RequirePermissions('project.update')
  @ApiOkResponse({ description: '里程碑已启动' })
  startMilestone(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('milestoneId', new ParseUUIDPipe()) milestoneId: string, @Body() input: ProjectWorkflowVersionDto): Promise<ProjectMilestoneResult> { return this.service.startMilestone(projectId, milestoneId, input.version); }

  @Post('milestones/:milestoneId/acceptance')
  @RequirePermissions('project.update')
  @ApiOkResponse({ description: '里程碑已进入验收' })
  startAcceptance(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('milestoneId', new ParseUUIDPipe()) milestoneId: string, @Body() input: ProjectWorkflowVersionDto): Promise<ProjectMilestoneResult> { return this.service.startMilestoneAcceptance(projectId, milestoneId, input.version); }

  @Post('milestones/:milestoneId/complete')
  @RequirePermissions('project.update')
  @ApiOkResponse({ description: '里程碑已完成' })
  completeMilestone(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('milestoneId', new ParseUUIDPipe()) milestoneId: string, @Body() input: CompleteProjectMilestoneDto): Promise<ProjectMilestoneResult> { return this.service.completeMilestone(projectId, milestoneId, input); }

  @Post('milestones/:milestoneId/return')
  @RequirePermissions('project.update')
  @ApiOkResponse({ description: '里程碑已退回进行中' })
  returnMilestone(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('milestoneId', new ParseUUIDPipe()) milestoneId: string, @Body() input: ReopenProjectMilestoneDto): Promise<ProjectMilestoneResult> { return this.service.returnMilestoneToProgress(projectId, milestoneId, input); }

  @Post('milestones/:milestoneId/cancel')
  @RequirePermissions('project.update')
  @ApiOkResponse({ description: '里程碑已取消' })
  cancelMilestone(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('milestoneId', new ParseUUIDPipe()) milestoneId: string, @Body() input: CancelProjectMilestoneDto): Promise<ProjectMilestoneResult> { return this.service.cancelMilestone(projectId, milestoneId, input); }

  @Post('milestones/:milestoneId/reopen')
  @RequirePermissions('project.update')
  @ApiOkResponse({ description: '里程碑已重新打开' })
  reopenMilestone(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('milestoneId', new ParseUUIDPipe()) milestoneId: string, @Body() input: ReopenProjectMilestoneDto): Promise<ProjectMilestoneResult> { return this.service.reopenMilestone(projectId, milestoneId, input); }

  @Get('repositories')
  @RequirePermissions('project.read')
  @ApiOkResponse({ description: '项目仓库列表' })
  repositories(@Param('projectId', new ParseUUIDPipe()) projectId: string): Promise<ProjectRepositoryResult[]> { return this.service.listRepositories(projectId); }

  @Post('repositories')
  @RequirePermissions('project.update')
  @ApiCreatedResponse({ description: '项目仓库已绑定' })
  createRepository(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: CreateProjectRepositoryDto): Promise<ProjectRepositoryResult> { return this.service.createRepository(projectId, input); }

  @Patch('repositories/:repositoryId')
  @RequirePermissions('project.update')
  @ApiOkResponse({ description: '项目仓库已修改' })
  updateRepository(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('repositoryId', new ParseUUIDPipe()) repositoryId: string, @Body() input: UpdateProjectRepositoryDto): Promise<ProjectRepositoryResult> { return this.service.updateRepository(projectId, repositoryId, input); }

  @Delete('repositories/:repositoryId')
  @RequirePermissions('project.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: '项目仓库已解除绑定' })
  deleteRepository(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Param('repositoryId', new ParseUUIDPipe()) repositoryId: string, @Query() query: ProjectRepositoryVersionQueryDto): Promise<void> { return this.service.deleteRepository(projectId, repositoryId, query.version); }
}
