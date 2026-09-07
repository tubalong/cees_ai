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
import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiNoContentResponse,
    ApiOkResponse,
    ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantInvitationService } from '../tenant-invitation/tenant-invitation.service';
import { AccountSuggestionResult, TenantInvitationCreatedResult } from '../tenant-invitation/tenant-invitation.types';
import {
    AccountSuggestionDto,
    ListTenantMembersQueryDto,
    ReplaceTenantMemberRolesDto,
    UpdateTenantDto,
    UpdateTenantMemberDto,
    UpdateTenantMemberAccountDto,
} from './dto';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TenantGuard } from './tenant.guard';
import { TenantService } from './tenant.service';
import { TenantMemberListResult, TenantMemberResult, TenantResult } from './tenant.types';

@ApiTags('tenant')
@ApiBearerAuth()
@Controller('tenants/current')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class TenantController {
    constructor(
        private readonly tenantService: TenantService,
        private readonly tenantInvitationService: TenantInvitationService,
    ) { }

    @Get()
    @RequirePermissions('tenant.read')
    @ApiOkResponse({ description: '当前租户' })
    getCurrentTenant(): Promise<TenantResult> {
        return this.tenantService.getCurrentTenant();
    }

    @Patch()
    @RequirePermissions('tenant.update')
    @ApiOkResponse({ description: '修改后的租户' })
    updateCurrentTenant(@Body() input: UpdateTenantDto): Promise<TenantResult> {
        return this.tenantService.updateCurrentTenant(input);
    }

    @Get('members')
    @RequirePermissions('member.read')
    @ApiOkResponse({ description: '当前租户成员列表' })
    listMembers(@Query() query: ListTenantMembersQueryDto): Promise<TenantMemberListResult> {
        return this.tenantService.listMembers(query);
    }

    @Post('account-suggestions')
    @RequirePermissions('member.invite')
    @ApiOkResponse({ description: '当前租户账号建议' })
    suggestAccount(@Body() input: AccountSuggestionDto): Promise<AccountSuggestionResult> {
        return this.tenantInvitationService.suggestAccount(input.displayName);
    }

    @Get('members/:membershipId')
    @RequirePermissions('member.read')
    @ApiOkResponse({ description: '当前租户成员详情' })
    getMember(@Param('membershipId', new ParseUUIDPipe()) membershipId: string): Promise<TenantMemberResult> {
        return this.tenantService.getMember(membershipId);
    }

    @Patch('members/:membershipId')
    @RequirePermissions('member.update')
    @ApiOkResponse({ description: '修改后的当前租户成员' })
    updateMember(
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Body() input: UpdateTenantMemberDto,
    ): Promise<TenantMemberResult> {
        return this.tenantService.updateMember(membershipId, input);
    }

    @Patch('members/:membershipId/account')
    @RequirePermissions('member.account.update')
    @ApiOkResponse({ description: '修改账号后的当前租户成员' })
    updateMemberAccount(
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Body() input: UpdateTenantMemberAccountDto,
    ): Promise<TenantMemberResult> {
        return this.tenantService.updateMemberAccount(membershipId, input);
    }

    @Post('members/:membershipId/credential-reset')
    @RequirePermissions('member.credential.reset')
    @ApiCreatedResponse({ description: '凭证已重置；激活令牌只在本次响应返回' })
    resetMemberCredential(
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    ): Promise<TenantInvitationCreatedResult> {
        return this.tenantInvitationService.resetCredential(membershipId);
    }

    @Delete('members/:membershipId')
    @RequirePermissions('member.remove')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '成员已移除' })
    removeMember(@Param('membershipId', new ParseUUIDPipe()) membershipId: string): Promise<void> {
        return this.tenantService.removeMember(membershipId);
    }

    @Put('members/:membershipId/roles')
    @RequirePermissions('role.assign')
    @ApiOkResponse({ description: '角色替换后的当前租户成员' })
    replaceMemberRoles(
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Body() input: ReplaceTenantMemberRolesDto,
    ): Promise<TenantMemberResult> {
        return this.tenantService.replaceMemberRoles(membershipId, input);
    }
}
