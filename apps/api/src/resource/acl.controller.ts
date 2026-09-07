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
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { AclService } from './acl.service';
import { CreateResourceAclDto, DeleteResourceAclQueryDto } from './dto';
import { ResourceAclListResult, ResourceAclResult } from './resource.types';

@ApiTags('acl')
@ApiBearerAuth()
@Controller('resources/:resourceId/acl')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class AclController {
    constructor(private readonly aclService: AclService) { }

    @Get()
    @RequirePermissions('document.share')
    @ApiOkResponse({ description: '资源 ACL 列表' })
    listAcl(@Param('resourceId', new ParseUUIDPipe()) resourceId: string): Promise<ResourceAclListResult> {
        return this.aclService.listAcl(resourceId);
    }

    @Post()
    @RequirePermissions('document.share')
    @ApiCreatedResponse({ description: '已创建 ACL 授权' })
    createAcl(
        @Param('resourceId', new ParseUUIDPipe()) resourceId: string,
        @Body() input: CreateResourceAclDto,
    ): Promise<ResourceAclResult> {
        return this.aclService.createAcl(resourceId, input);
    }

    @Delete(':aclEntryId')
    @RequirePermissions('document.share')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: 'ACL 授权已撤销' })
    deleteAcl(
        @Param('resourceId', new ParseUUIDPipe()) resourceId: string,
        @Param('aclEntryId', new ParseUUIDPipe()) aclEntryId: string,
        @Query() query: DeleteResourceAclQueryDto,
    ): Promise<void> {
        return this.aclService.deleteAcl(resourceId, aclEntryId, query.version);
    }
}
