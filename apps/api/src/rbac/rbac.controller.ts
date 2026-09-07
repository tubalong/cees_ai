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
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import {
    CreateRoleDto,
    DeleteRoleQueryDto,
    ListRolesQueryDto,
    ReplaceRolePermissionsDto,
    UpdateRoleDto,
} from './dto';
import { PermissionGuard, RequirePermissions } from './permission.guard';
import { RbacService } from './rbac.service';
import { PermissionListResult, RoleListResult, RoleResult } from './rbac.types';

@ApiTags('rbac')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class RbacController {
    constructor(private readonly rbacService: RbacService) { }

    @Get('permissions')
    @RequirePermissions('role.read')
    @ApiOkResponse({ description: '平台预置权限目录' })
    listPermissions(): Promise<PermissionListResult> {
        return this.rbacService.listPermissions();
    }

    @Get('roles')
    @RequirePermissions('role.read')
    @ApiOkResponse({ description: '当前租户角色列表' })
    listRoles(@Query() query: ListRolesQueryDto): Promise<RoleListResult> {
        return this.rbacService.listRoles(query);
    }

    @Post('roles')
    @RequirePermissions('role.create')
    @ApiCreatedResponse({ description: '已创建角色' })
    createRole(@Body() input: CreateRoleDto): Promise<RoleResult> {
        return this.rbacService.createRole(input);
    }

    @Get('roles/:roleId')
    @RequirePermissions('role.read')
    @ApiOkResponse({ description: '当前租户角色详情' })
    getRole(@Param('roleId', new ParseUUIDPipe()) roleId: string): Promise<RoleResult> {
        return this.rbacService.getRole(roleId);
    }

    @Patch('roles/:roleId')
    @RequirePermissions('role.update')
    @ApiOkResponse({ description: '修改后的角色' })
    updateRole(
        @Param('roleId', new ParseUUIDPipe()) roleId: string,
        @Body() input: UpdateRoleDto,
    ): Promise<RoleResult> {
        return this.rbacService.updateRole(roleId, input);
    }

    @Delete('roles/:roleId')
    @RequirePermissions('role.delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '角色已删除' })
    deleteRole(
        @Param('roleId', new ParseUUIDPipe()) roleId: string,
        @Query() query: DeleteRoleQueryDto,
    ): Promise<void> {
        return this.rbacService.deleteRole(roleId, query.version);
    }

    @Put('roles/:roleId/permissions')
    @RequirePermissions('role.update')
    @ApiOkResponse({ description: '权限替换后的角色' })
    replaceRolePermissions(
        @Param('roleId', new ParseUUIDPipe()) roleId: string,
        @Body() input: ReplaceRolePermissionsDto,
    ): Promise<RoleResult> {
        return this.rbacService.replaceRolePermissions(roleId, input);
    }
}
