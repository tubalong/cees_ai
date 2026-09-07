import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { AuditService } from './audit.service';
import { AuditEventListResult, AuditEventResult } from './audit.types';
import { ListAuditEventsQueryDto } from './dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-events')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class AuditController {
    constructor(private readonly auditService: AuditService) { }

    @Get()
    @RequirePermissions('audit.read')
    @ApiOkResponse({ description: '当前租户审计事件列表' })
    listEvents(@Query() query: ListAuditEventsQueryDto): Promise<AuditEventListResult> {
        return this.auditService.listEvents(query);
    }

    @Get(':auditEventId')
    @RequirePermissions('audit.read')
    @ApiOkResponse({ description: '当前租户审计事件详情' })
    getEvent(@Param('auditEventId', new ParseUUIDPipe()) auditEventId: string): Promise<AuditEventResult> {
        return this.auditService.getEvent(auditEventId);
    }
}
