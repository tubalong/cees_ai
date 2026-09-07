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
import { DocumentService } from './document.service';
import { DocumentListResult, DocumentResult } from './document.types';
import { CreateDocumentDto, DeleteDocumentQueryDto, ListDocumentsQueryDto, UpdateDocumentDto } from './dto';

@ApiTags('document')
@ApiBearerAuth()
@Controller('documents')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class DocumentController {
    constructor(private readonly documentService: DocumentService) { }

    @Get()
    @RequirePermissions('document.read')
    @ApiOkResponse({ description: '授权范围内文档列表' })
    listDocuments(@Query() query: ListDocumentsQueryDto): Promise<DocumentListResult> {
        return this.documentService.listDocuments(query);
    }

    @Post()
    @RequirePermissions('document.create')
    @ApiCreatedResponse({ description: '已创建受控文档' })
    createDocument(@Body() input: CreateDocumentDto): Promise<DocumentResult> {
        return this.documentService.createDocument(input);
    }

    @Get(':documentId')
    @RequirePermissions('document.read')
    @ApiOkResponse({ description: '授权范围内文档详情' })
    getDocument(@Param('documentId', new ParseUUIDPipe()) documentId: string): Promise<DocumentResult> {
        return this.documentService.getDocument(documentId);
    }

    @Patch(':documentId')
    @RequirePermissions('document.update')
    @ApiOkResponse({ description: '修改后的文档' })
    updateDocument(
        @Param('documentId', new ParseUUIDPipe()) documentId: string,
        @Body() input: UpdateDocumentDto,
    ): Promise<DocumentResult> {
        return this.documentService.updateDocument(documentId, input);
    }

    @Delete(':documentId')
    @RequirePermissions('document.delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '文档已软删除' })
    deleteDocument(
        @Param('documentId', new ParseUUIDPipe()) documentId: string,
        @Query() query: DeleteDocumentQueryDto,
    ): Promise<void> {
        return this.documentService.deleteDocument(documentId, query.version);
    }
}
