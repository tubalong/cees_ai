import {
    Body,
    Controller,
    Get,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import {
    CreateDingTalkIntegrationDto,
    ListDingTalkOrganizationQueryDto,
    ListDingTalkSyncJobsQueryDto,
    UpdateDingTalkIntegrationDto,
    ApplyDingTalkMappingDto,
    PreviewDingTalkMappingDto,
    ImportDingTalkVisibleOrganizationSnapshotDto,
} from './dto';
import { DingTalkMappingService } from './dingtalk-mapping.service';
import { DingTalkService } from './dingtalk.service';
import {
    CursorListResult,
    DingTalkDepartmentResult,
    DingTalkIntegrationResult,
    DingTalkSyncJobResult,
    DingTalkUserResult,
    DingTalkMappingPreviewResult,
    DingTalkMappingResult,
} from './dingtalk.types';

@ApiTags('dingtalk')
@ApiBearerAuth()
@Controller('dingtalk')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class DingTalkController {
    constructor(
        private readonly dingTalkService: DingTalkService,
        private readonly dingTalkMappingService: DingTalkMappingService,
    ) { }

    @Get('integration')
    @RequirePermissions('dingtalk.integration.read')
    @ApiOkResponse({ description: '当前租户的钉钉企业绑定' })
    getIntegration(): Promise<DingTalkIntegrationResult> {
        return this.dingTalkService.getIntegration();
    }

    @Post('integration')
    @RequirePermissions('dingtalk.integration.manage')
    @ApiCreatedResponse({ description: '钉钉企业绑定已创建' })
    createIntegration(@Body() input: CreateDingTalkIntegrationDto): Promise<DingTalkIntegrationResult> {
        return this.dingTalkService.createIntegration(input);
    }

    @Patch('integration')
    @RequirePermissions('dingtalk.integration.manage')
    @ApiOkResponse({ description: '钉钉企业绑定已修改' })
    updateIntegration(@Body() input: UpdateDingTalkIntegrationDto): Promise<DingTalkIntegrationResult> {
        return this.dingTalkService.updateIntegration(input);
    }

    @Post('integration/verify')
    @RequirePermissions('dingtalk.integration.manage')
    @ApiOkResponse({ description: '钉钉应用凭证验证成功' })
    verifyIntegration(): Promise<DingTalkIntegrationResult> {
        return this.dingTalkService.verifyIntegration();
    }

    @Post('organization/sync')
    @RequirePermissions('dingtalk.organization.sync')
    @ApiOkResponse({ description: '钉钉组织架构和人员已同步' })
    syncOrganization(): Promise<DingTalkSyncJobResult> {
        return this.dingTalkService.syncOrganization();
    }

    @Post('organization/snapshot')
    @RequirePermissions('dingtalk.organization.sync')
    @ApiOkResponse({ description: 'DWS/MCP 可见组织快照已导入' })
    importVisibleOrganizationSnapshot(
        @Body() input: ImportDingTalkVisibleOrganizationSnapshotDto,
    ): Promise<DingTalkSyncJobResult> {
        return this.dingTalkService.importVisibleOrganizationSnapshot(input);
    }

    @Get('organization/departments')
    @RequirePermissions('dingtalk.organization.read')
    @ApiOkResponse({ description: '钉钉部门镜像列表' })
    listDepartments(
        @Query() query: ListDingTalkOrganizationQueryDto,
    ): Promise<CursorListResult<DingTalkDepartmentResult>> {
        return this.dingTalkService.listDepartments(query);
    }

    @Get('organization/users')
    @RequirePermissions('dingtalk.organization.read')
    @ApiOkResponse({ description: '钉钉人员镜像列表' })
    listUsers(@Query() query: ListDingTalkOrganizationQueryDto): Promise<CursorListResult<DingTalkUserResult>> {
        return this.dingTalkService.listUsers(query);
    }

    @Post('organization/mapping/preview')
    @RequirePermissions('dingtalk.organization.mapping.preview')
    @ApiOkResponse({ description: '钉钉组织映射预览' })
    previewOrganizationMapping(@Body() input: PreviewDingTalkMappingDto): Promise<DingTalkMappingPreviewResult> {
        return this.dingTalkMappingService.preview(input);
    }

    @Post('organization/mapping/apply')
    @RequirePermissions('dingtalk.organization.mapping.manage')
    @ApiOkResponse({ description: '钉钉组织映射已应用，并返回新成员的一次性激活凭证' })
    applyOrganizationMapping(@Body() input: ApplyDingTalkMappingDto): Promise<DingTalkMappingResult> {
        return this.dingTalkMappingService.apply(input);
    }
    @Get('sync-jobs')
    @RequirePermissions('dingtalk.integration.read')
    @ApiOkResponse({ description: '钉钉同步任务列表' })
    listSyncJobs(@Query() query: ListDingTalkSyncJobsQueryDto): Promise<CursorListResult<DingTalkSyncJobResult>> {
        return this.dingTalkService.listSyncJobs(query);
    }
}

