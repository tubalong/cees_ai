import {
    Body,
    Controller,
    Delete,
    Get,
    Header,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    StreamableFile,
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

/** DOCX 的 MIME 类型，与 ai-service DocxRenderer 保持一致。 */
const DOCX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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

    /**
     * 导出文档为 DOCX：复用 document.read 权限（导出是同一文档资源的交付视图，
     * 不是独立资源）。文件由落库的 DocumentSpec 确定性渲染，不调用 LLM。
     */
    @Get(':documentId/export')
    @RequirePermissions('document.read')
    @Header('Cache-Control', 'no-store')
    @ApiOkResponse({ description: 'DOCX 文档文件' })
    async exportDocumentDocx(
        @Param('documentId', new ParseUUIDPipe()) documentId: string,
    ): Promise<StreamableFile> {
        const { filename, bytes } = await this.documentService.exportDocumentDocx(documentId);
        const asciiFallback = 'document.docx';
        const encoded = encodeURIComponent(`${filename}.docx`);
        return new StreamableFile(bytes, {
            type: DOCX_MEDIA_TYPE,
            disposition: `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
        });
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
