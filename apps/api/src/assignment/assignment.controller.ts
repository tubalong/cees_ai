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
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { AssignmentService } from './assignment.service';
import { AssignmentPolicy, AssignmentPolicyList, AssignmentPolicyResolveResult } from './assignment.types';
import {
    CreateAssignmentPolicyDto,
    DeleteAssignmentPolicyQueryDto,
    ListAssignmentPoliciesQueryDto,
    ResolveAssignmentPolicyDto,
    UpdateAssignmentPolicyDto,
} from './dto';

@ApiTags('assignment')
@ApiBearerAuth()
@Controller('assignment/policies')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class AssignmentController {
    constructor(private readonly assignmentService: AssignmentService) { }

    @Get()
    @RequirePermissions('assignment.policy.read')
    @ApiOkResponse({ description: '分配策略列表' })
    listPolicies(@Query() query: ListAssignmentPoliciesQueryDto): Promise<AssignmentPolicyList> {
        return this.assignmentService.listPolicies(query);
    }

    @Post()
    @RequirePermissions('assignment.policy.manage')
    @ApiCreatedResponse({ description: '分配策略已创建' })
    createPolicy(@Body() input: CreateAssignmentPolicyDto): Promise<AssignmentPolicy> {
        return this.assignmentService.createPolicy(input);
    }

    @Post('resolve')
    @RequirePermissions('assignment.policy.read')
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ description: '策略解析结果' })
    resolvePolicy(@Body() input: ResolveAssignmentPolicyDto): Promise<AssignmentPolicyResolveResult> {
        return this.assignmentService.resolvePolicy(input);
    }

    @Get(':policyId')
    @RequirePermissions('assignment.policy.read')
    @ApiOkResponse({ description: '分配策略详情' })
    getPolicy(@Param('policyId', new ParseUUIDPipe()) policyId: string): Promise<AssignmentPolicy> {
        return this.assignmentService.getPolicy(policyId);
    }

    @Patch(':policyId')
    @RequirePermissions('assignment.policy.manage')
    @ApiOkResponse({ description: '修改后的分配策略' })
    updatePolicy(
        @Param('policyId', new ParseUUIDPipe()) policyId: string,
        @Body() input: UpdateAssignmentPolicyDto,
    ): Promise<AssignmentPolicy> {
        return this.assignmentService.updatePolicy(policyId, input);
    }

    @Delete(':policyId')
    @RequirePermissions('assignment.policy.manage')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '分配策略已删除' })
    deletePolicy(
        @Param('policyId', new ParseUUIDPipe()) policyId: string,
        @Query() query: DeleteAssignmentPolicyQueryDto,
    ): Promise<void> {
        return this.assignmentService.deletePolicy(policyId, query.version);
    }
}