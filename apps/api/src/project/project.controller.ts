import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Put,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import {
    AddProjectMemberDto,
    CompleteProjectDto,
    CreateProjectDto,
    DeleteProjectQueryDto,
    ListProjectsQueryDto,
    ProjectReasonDto,
    ProjectVersionDto,
    TransferProjectOwnerDto,
    UpdateProjectDto,
    UpdateProjectMemberDto,
} from './dto';
import { ProjectService } from './project.service';
import { ProjectListResult, ProjectMemberListResult, ProjectMemberResult, ProjectResult } from './project.types';

@ApiTags('project')
@ApiBearerAuth()
@Controller('projects')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class ProjectController {
    constructor(private readonly projectService: ProjectService) { }

    @Get()
    @RequirePermissions('project.read')
    @ApiOkResponse({ description: '当前成员可见的项目列表' })
    listProjects(@Query() query: ListProjectsQueryDto): Promise<ProjectListResult> {
        return this.projectService.listProjects(query);
    }

    @Post()
    @RequirePermissions('project.create')
    @ApiCreatedResponse({ description: '项目已创建' })
    createProject(@Body() input: CreateProjectDto): Promise<ProjectResult> {
        return this.projectService.createProject(input);
    }

    @Get(':projectId')
    @RequirePermissions('project.read')
    @ApiOkResponse({ description: '项目详情' })
    getProject(@Param('projectId', new ParseUUIDPipe()) projectId: string): Promise<ProjectResult> {
        return this.projectService.getProject(projectId);
    }

    @Patch(':projectId')
    @RequirePermissions('project.update')
    @ApiOkResponse({ description: '项目已修改' })
    updateProject(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Body() input: UpdateProjectDto,
    ): Promise<ProjectResult> {
        return this.projectService.updateProject(projectId, input);
    }

    @Delete(':projectId')
    @RequirePermissions('project.delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '项目已软删除' })
    deleteProject(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Query() query: DeleteProjectQueryDto,
    ): Promise<void> {
        return this.projectService.deleteProject(projectId, query.version);
    }

    @Get(':projectId/members')
    @RequirePermissions('project.member.read')
    @ApiOkResponse({ description: '项目成员列表' })
    listMembers(@Param('projectId', new ParseUUIDPipe()) projectId: string): Promise<ProjectMemberListResult> {
        return this.projectService.listMembers(projectId);
    }

    @Post(':projectId/members')
    @RequirePermissions('project.member.manage')
    @ApiCreatedResponse({ description: '项目成员已添加' })
    addMember(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Body() input: AddProjectMemberDto,
    ): Promise<ProjectMemberResult> {
        return this.projectService.addMember(projectId, input);
    }

    @Patch(':projectId/members/:membershipId')
    @RequirePermissions('project.member.manage')
    @ApiOkResponse({ description: '项目成员角色已修改' })
    updateMember(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Body() input: UpdateProjectMemberDto,
    ): Promise<ProjectMemberResult> {
        return this.projectService.updateMember(projectId, membershipId, input);
    }

    @Delete(':projectId/members/:membershipId')
    @RequirePermissions('project.member.manage')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '项目成员已移除' })
    removeMember(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Query() query: DeleteProjectQueryDto,
    ): Promise<void> {
        return this.projectService.removeMember(projectId, membershipId, query.version);
    }

    @Put(':projectId/owner')
    @RequirePermissions('project.member.manage')
    @ApiOkResponse({ description: '项目负责人已转移' })
    transferOwner(
        @Param('projectId', new ParseUUIDPipe()) projectId: string,
        @Body() input: TransferProjectOwnerDto,
    ): Promise<ProjectResult> {
        return this.projectService.transferOwner(projectId, input);
    }

    @Post(':projectId/start')
    @RequirePermissions('project.update')
    start(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: ProjectVersionDto): Promise<ProjectResult> {
        return this.projectService.start(projectId, input);
    }

    @Post(':projectId/pause')
    @RequirePermissions('project.update')
    pause(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: ProjectVersionDto): Promise<ProjectResult> {
        return this.projectService.pause(projectId, input);
    }

    @Post(':projectId/resume')
    @RequirePermissions('project.update')
    resume(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: ProjectVersionDto): Promise<ProjectResult> {
        return this.projectService.resume(projectId, input);
    }

    @Post(':projectId/complete')
    @RequirePermissions('project.complete')
    complete(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: CompleteProjectDto): Promise<ProjectResult> {
        return this.projectService.complete(projectId, input);
    }

    @Post(':projectId/reopen')
    @RequirePermissions('project.reopen')
    reopen(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: ProjectReasonDto): Promise<ProjectResult> {
        return this.projectService.reopen(projectId, input);
    }

    @Post(':projectId/cancel')
    @RequirePermissions('project.update')
    cancel(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: ProjectReasonDto): Promise<ProjectResult> {
        return this.projectService.cancel(projectId, input);
    }

    @Post(':projectId/archive')
    @RequirePermissions('project.archive')
    archive(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: ProjectVersionDto): Promise<ProjectResult> {
        return this.projectService.archive(projectId, input);
    }

    @Post(':projectId/restore')
    @RequirePermissions('project.archive')
    restore(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() input: ProjectVersionDto): Promise<ProjectResult> {
        return this.projectService.restore(projectId, input);
    }
}
