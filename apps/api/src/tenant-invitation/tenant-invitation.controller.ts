import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Req,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { AcceptTenantInvitationDto, CreateTenantInvitationDto, ListTenantInvitationsQueryDto } from './dto';
import { TenantInvitationService } from './tenant-invitation.service';
import {
    TenantInvitationAcceptanceResult,
    TenantInvitationCreatedResult,
    TenantInvitationListResult,
} from './tenant-invitation.types';

@ApiTags('tenant-invitation')
@ApiBearerAuth()
@Controller('tenants/current/invitations')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
@RequirePermissions('member.invite')
export class TenantInvitationController {
    constructor(private readonly tenantInvitationService: TenantInvitationService) { }

    @Get()
    @ApiOkResponse({ description: '当前租户成员邀请列表' })
    listInvitations(@Query() query: ListTenantInvitationsQueryDto): Promise<TenantInvitationListResult> {
        return this.tenantInvitationService.listInvitations(query);
    }

    @Post()
    @ApiCreatedResponse({ description: '邀请已创建；令牌只在本次响应返回' })
    createInvitation(@Body() input: CreateTenantInvitationDto): Promise<TenantInvitationCreatedResult> {
        return this.tenantInvitationService.createInvitation(input);
    }

    @Delete(':invitationId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '邀请已撤销' })
    revokeInvitation(@Param('invitationId', new ParseUUIDPipe()) invitationId: string): Promise<void> {
        return this.tenantInvitationService.revokeInvitation(invitationId);
    }
}

@ApiTags('auth')
@Controller('auth')
export class TenantInvitationAcceptanceController {
    constructor(private readonly tenantInvitationService: TenantInvitationService) { }

    @Post('activate')
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ description: '租户账号激活成功' })
    acceptInvitation(
        @Body() input: AcceptTenantInvitationDto,
        @Req() request: Request,
    ): Promise<TenantInvitationAcceptanceResult> {
        return this.tenantInvitationService.acceptInvitation(input, {
            requestId: getHeader(request, 'x-request-id') ?? randomUUID(),
            ipAddress: request.ip,
            userAgent: getHeader(request, 'user-agent'),
        });
    }
}

function getHeader(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
}
