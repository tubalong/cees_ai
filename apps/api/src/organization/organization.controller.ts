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
import { TenantMemberListResult, TenantMemberResult } from '../tenant/tenant.types';
import {
    AssignMemberDepartmentDto,
    CreateDepartmentDto,
    DeleteDepartmentQueryDto,
    ListDepartmentMembersQueryDto,
    ListDepartmentsQueryDto,
    UpdateDepartmentDto,
} from './dto';
import { OrganizationService } from './organization.service';
import { DepartmentResult, DepartmentTreeResult } from './organization.types';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('tenants/current')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class OrganizationController {
    constructor(private readonly organizationService: OrganizationService) { }

    @Get('departments')
    @RequirePermissions('department.read')
    @ApiOkResponse({ description: '当前租户部门树' })
    listDepartments(@Query() query: ListDepartmentsQueryDto): Promise<DepartmentTreeResult> {
        return this.organizationService.listDepartments(query);
    }

    @Post('departments')
    @RequirePermissions('department.create')
    @ApiCreatedResponse({ description: '已创建部门' })
    createDepartment(@Body() input: CreateDepartmentDto): Promise<DepartmentResult> {
        return this.organizationService.createDepartment(input);
    }

    @Get('departments/:departmentId')
    @RequirePermissions('department.read')
    @ApiOkResponse({ description: '当前租户部门详情' })
    getDepartment(@Param('departmentId', new ParseUUIDPipe()) departmentId: string): Promise<DepartmentResult> {
        return this.organizationService.getDepartment(departmentId);
    }

    @Patch('departments/:departmentId')
    @RequirePermissions('department.update')
    @ApiOkResponse({ description: '修改后的部门' })
    updateDepartment(
        @Param('departmentId', new ParseUUIDPipe()) departmentId: string,
        @Body() input: UpdateDepartmentDto,
    ): Promise<DepartmentResult> {
        return this.organizationService.updateDepartment(departmentId, input);
    }

    @Delete('departments/:departmentId')
    @RequirePermissions('department.delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '部门已删除' })
    deleteDepartment(
        @Param('departmentId', new ParseUUIDPipe()) departmentId: string,
        @Query() query: DeleteDepartmentQueryDto,
    ): Promise<void> {
        return this.organizationService.deleteDepartment(departmentId, query.version);
    }

    @Get('departments/:departmentId/members')
    @RequirePermissions('department.read', 'member.read')
    @ApiOkResponse({ description: '当前部门成员列表' })
    listDepartmentMembers(
        @Param('departmentId', new ParseUUIDPipe()) departmentId: string,
        @Query() query: ListDepartmentMembersQueryDto,
    ): Promise<TenantMemberListResult> {
        return this.organizationService.listDepartmentMembers(departmentId, query);
    }

    @Put('members/:membershipId/department')
    @RequirePermissions('department.member.assign')
    @ApiOkResponse({ description: '调整部门后的当前租户成员' })
    assignMemberDepartment(
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Body() input: AssignMemberDepartmentDto,
    ): Promise<TenantMemberResult> {
        return this.organizationService.assignMemberDepartment(membershipId, input);
    }
}
