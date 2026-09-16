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
import {
    CreateKnowledgeBaseDto,
    CreateKnowledgeBaseMemberDto,
    CreateKnowledgeDocumentDto,
    CreateKnowledgeDocumentVersionDto,
    DeleteKnowledgeBaseQueryDto,
    ListKnowledgeBaseMembersQueryDto,
    ListKnowledgeBasesQueryDto,
    ListKnowledgeDocumentsQueryDto,
    QueryKnowledgeBaseDto,
    UpdateKnowledgeBaseDto,
    UpdateKnowledgeBaseMemberDto,
} from './dto';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { KnowledgeService } from './knowledge.service';
import {
    KnowledgeBaseMemberListResult,
    KnowledgeBaseMemberResult,
    KnowledgeBaseListResult,
    KnowledgeBaseResult,
    KnowledgeDocumentListResult,
    KnowledgeDocumentResult,
    KnowledgeQueryResult,
} from './knowledge.types';

@ApiTags('knowledge-base')
@ApiBearerAuth()
@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class KnowledgeController {
    constructor(
        private readonly knowledgeService: KnowledgeService,
        private readonly knowledgeDocumentService: KnowledgeDocumentService,
    ) { }

    @Get()
    @RequirePermissions('knowledge_base.read')
    @ApiOkResponse({ description: '可访问的知识库列表' })
    listKnowledgeBases(@Query() query: ListKnowledgeBasesQueryDto): Promise<KnowledgeBaseListResult> {
        return this.knowledgeService.listKnowledgeBases(query);
    }

    @Post()
    @RequirePermissions('knowledge_base.create')
    @ApiCreatedResponse({ description: '知识库已创建' })
    createKnowledgeBase(@Body() input: CreateKnowledgeBaseDto): Promise<KnowledgeBaseResult> {
        return this.knowledgeService.createKnowledgeBase(input);
    }

    @Get(':knowledgeBaseId')
    @RequirePermissions('knowledge_base.read')
    @ApiOkResponse({ description: '知识库详情' })
    getKnowledgeBase(@Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string): Promise<KnowledgeBaseResult> {
        return this.knowledgeService.getKnowledgeBase(knowledgeBaseId);
    }

    @Post(':knowledgeBaseId/query')
    @RequirePermissions('knowledge_base.query')
    @ApiOkResponse({ description: '基于知识库证据的答案与引用列表' })
    queryKnowledgeBase(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Body() input: QueryKnowledgeBaseDto,
    ): Promise<KnowledgeQueryResult> {
        return this.knowledgeService.queryKnowledgeBase(knowledgeBaseId, input);
    }

    @Patch(':knowledgeBaseId')
    @RequirePermissions('knowledge_base.update')
    @ApiOkResponse({ description: '知识库已修改' })
    updateKnowledgeBase(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Body() input: UpdateKnowledgeBaseDto,
    ): Promise<KnowledgeBaseResult> {
        return this.knowledgeService.updateKnowledgeBase(knowledgeBaseId, input);
    }

    @Delete(':knowledgeBaseId')
    @RequirePermissions('knowledge_base.delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '知识库已软删除' })
    deleteKnowledgeBase(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Query() query: DeleteKnowledgeBaseQueryDto,
    ): Promise<void> {
        return this.knowledgeService.deleteKnowledgeBase(knowledgeBaseId, query);
    }

    @Get(':knowledgeBaseId/members')
    @RequirePermissions('knowledge_base.member.manage')
    @ApiOkResponse({ description: '知识库成员列表' })
    listMembers(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Query() query: ListKnowledgeBaseMembersQueryDto,
    ): Promise<KnowledgeBaseMemberListResult> {
        return this.knowledgeService.listMembers(knowledgeBaseId, query);
    }

    @Post(':knowledgeBaseId/members')
    @RequirePermissions('knowledge_base.member.manage')
    @ApiCreatedResponse({ description: '知识库成员已添加' })
    addMember(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Body() input: CreateKnowledgeBaseMemberDto,
    ): Promise<KnowledgeBaseMemberResult> {
        return this.knowledgeService.addMember(knowledgeBaseId, input);
    }

    @Patch(':knowledgeBaseId/members/:membershipId')
    @RequirePermissions('knowledge_base.member.manage')
    @ApiOkResponse({ description: '知识库成员权限已修改' })
    updateMember(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Body() input: UpdateKnowledgeBaseMemberDto,
    ): Promise<KnowledgeBaseMemberResult> {
        return this.knowledgeService.updateMember(knowledgeBaseId, membershipId, input);
    }

    @Delete(':knowledgeBaseId/members/:membershipId')
    @RequirePermissions('knowledge_base.member.manage')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '知识库成员已移除' })
    removeMember(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    ): Promise<void> {
        return this.knowledgeService.removeMember(knowledgeBaseId, membershipId);
    }

    @Get(':knowledgeBaseId/documents')
    @RequirePermissions('knowledge_base.read')
    @ApiOkResponse({ description: '知识库文档列表' })
    listDocuments(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Query() query: ListKnowledgeDocumentsQueryDto,
    ): Promise<KnowledgeDocumentListResult> {
        return this.knowledgeDocumentService.listDocuments(knowledgeBaseId, query);
    }

    @Post(':knowledgeBaseId/documents')
    @RequirePermissions('knowledge_base.document.manage')
    @ApiCreatedResponse({ description: '文档已创建，等待后台解析与索引' })
    createDocument(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Body() input: CreateKnowledgeDocumentDto,
    ): Promise<KnowledgeDocumentResult> {
        return this.knowledgeDocumentService.createDocument(knowledgeBaseId, input);
    }

    @Post(':knowledgeBaseId/documents/:documentId/versions')
    @RequirePermissions('knowledge_base.document.manage')
    @ApiCreatedResponse({ description: '新版本已创建，文档重新进入处理队列' })
    createDocumentVersion(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Param('documentId', new ParseUUIDPipe()) documentId: string,
        @Body() input: CreateKnowledgeDocumentVersionDto,
    ): Promise<KnowledgeDocumentResult> {
        return this.knowledgeDocumentService.createDocumentVersion(knowledgeBaseId, documentId, input);
    }

    @Post(':knowledgeBaseId/documents/:documentId/retry')
    @RequirePermissions('knowledge_base.document.manage')
    @ApiOkResponse({ description: '文档已重新进入处理队列' })
    retryDocument(
        @Param('knowledgeBaseId', new ParseUUIDPipe()) knowledgeBaseId: string,
        @Param('documentId', new ParseUUIDPipe()) documentId: string,
    ): Promise<KnowledgeDocumentResult> {
        return this.knowledgeDocumentService.retryDocument(knowledgeBaseId, documentId);
    }
}
