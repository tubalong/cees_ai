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
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { PlatformAuthenticatedPrincipal } from '../platform-auth/platform-auth.types';
import { PlatformJwtAuthGuard } from '../platform-auth/platform-jwt-auth.guard';
import {
    PlatformPermissionGuard,
    RequirePlatformPermissions,
} from '../platform-auth/platform-permission.guard';
import {
    AssignPlatformTenantAdministratorDto,
    CreatePlatformTenantDto,
    ListPlatformAuditEventsQueryDto,
    ListPlatformTenantsQueryDto,
    SuspendPlatformTenantDto,
    UpdatePlatformTenantDto,
    VersionDto,
} from './dto';
import { PlatformTenantService } from './platform-tenant.service';
import {
    PlatformAuditEventListResult,
    PlatformAuditEventResult,
    PlatformTenantAdministratorAssignmentResult,
    PlatformTenantAdministratorResult,
    PlatformTenantListResult,
    PlatformTenantProvisioningResult,
    PlatformTenantResult,
} from './platform-tenant.types';

type PlatformRequest = Request & { user: PlatformAuthenticatedPrincipal };

@ApiTags('platform-tenant')
@ApiBearerAuth('platformBearerAuth')
@Controller('platform/tenants')
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionGuard)
export class PlatformTenantController {
    constructor(private readonly platformTenantService: PlatformTenantService) { }

    @Get()
    @RequirePlatformPermissions('platform.tenant.read')
    @ApiOkResponse({ description: '平台租户列表' })
    listTenants(@Query() query: ListPlatformTenantsQueryDto): Promise<PlatformTenantListResult> {
        return this.platformTenantService.listTenants(query);
    }

    @Post()
    @RequirePlatformPermissions('platform.tenant.create')
    @ApiCreatedResponse({ description: '租户创建并完成初始化' })
    createTenant(
        @Body() input: CreatePlatformTenantDto,
        @Req() request: PlatformRequest,
    ): Promise<PlatformTenantProvisioningResult> {
        return this.platformTenantService.createTenant(input, request.user, getRequestMetadata(request));
    }

    @Get(':tenantId')
    @RequirePlatformPermissions('platform.tenant.read')
    @ApiOkResponse({ description: '平台租户详情' })
    getTenant(@Param('tenantId', new ParseUUIDPipe()) tenantId: string): Promise<PlatformTenantResult> {
        return this.platformTenantService.getTenant(tenantId);
    }

    @Patch(':tenantId')
    @RequirePlatformPermissions('platform.tenant.update')
    @ApiOkResponse({ description: '修改后的平台租户' })
    updateTenant(
        @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
        @Body() input: UpdatePlatformTenantDto,
        @Req() request: PlatformRequest,
    ): Promise<PlatformTenantResult> {
        return this.platformTenantService.updateTenant(tenantId, input, request.user, getRequestMetadata(request));
    }

    @Post(':tenantId/suspend')
    @RequirePlatformPermissions('platform.tenant.suspend')
    @ApiOkResponse({ description: '已停用的租户' })
    suspendTenant(
        @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
        @Body() input: SuspendPlatformTenantDto,
        @Req() request: PlatformRequest,
    ): Promise<PlatformTenantResult> {
        return this.platformTenantService.suspendTenant(tenantId, input, request.user, getRequestMetadata(request));
    }

    @Post(':tenantId/restore')
    @RequirePlatformPermissions('platform.tenant.restore')
    @ApiOkResponse({ description: '已恢复的租户' })
    restoreTenant(
        @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
        @Body() input: VersionDto,
        @Req() request: PlatformRequest,
    ): Promise<PlatformTenantResult> {
        return this.platformTenantService.restoreTenant(tenantId, input, request.user, getRequestMetadata(request));
    }

    @Get(':tenantId/administrators')
    @RequirePlatformPermissions('platform.tenant.admin.read')
    @ApiOkResponse({ description: '租户管理员列表' })
    listAdministrators(
        @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    ): Promise<{ items: PlatformTenantAdministratorResult[] }> {
        return this.platformTenantService.listAdministrators(tenantId);
    }

    @Post(':tenantId/administrators')
    @RequirePlatformPermissions('platform.tenant.admin.assign')
    @ApiOkResponse({ description: '已设置管理员或创建管理员邀请' })
    assignAdministrator(
        @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
        @Body() input: AssignPlatformTenantAdministratorDto,
        @Req() request: PlatformRequest,
    ): Promise<PlatformTenantAdministratorAssignmentResult> {
        return this.platformTenantService.assignAdministrator(tenantId, input, request.user, getRequestMetadata(request));
    }

    @Delete(':tenantId/administrators/:membershipId')
    @RequirePlatformPermissions('platform.tenant.admin.remove')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '已取消租户管理员角色' })
    removeAdministrator(
        @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Req() request: PlatformRequest,
    ): Promise<void> {
        return this.platformTenantService.removeAdministrator(
            tenantId,
            membershipId,
            request.user,
            getRequestMetadata(request),
        );
    }
}

@ApiTags('platform-audit')
@ApiBearerAuth('platformBearerAuth')
@Controller('platform/audit-events')
@UseGuards(PlatformJwtAuthGuard, PlatformPermissionGuard)
@RequirePlatformPermissions('platform.audit.read')
export class PlatformAuditController {
    constructor(private readonly platformTenantService: PlatformTenantService) { }

    @Get()
    @ApiOkResponse({ description: '平台审计事件列表' })
    listEvents(@Query() query: ListPlatformAuditEventsQueryDto): Promise<PlatformAuditEventListResult> {
        return this.platformTenantService.listAuditEvents(query);
    }

    @Get(':auditEventId')
    @ApiOkResponse({ description: '平台审计事件详情' })
    getEvent(
        @Param('auditEventId', new ParseUUIDPipe()) auditEventId: string,
    ): Promise<PlatformAuditEventResult> {
        return this.platformTenantService.getAuditEvent(auditEventId);
    }
}

function getRequestMetadata(request: Request): { requestId: string; ipAddress?: string; userAgent?: string } {
    return {
        requestId: getHeader(request, 'x-request-id') ?? randomUUID(),
        ipAddress: request.ip,
        userAgent: getHeader(request, 'user-agent'),
    };
}

function getHeader(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
}
