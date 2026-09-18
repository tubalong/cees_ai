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
    Redirect,
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
/** PDF 的 MIME 类型，与 ai-service PdfRenderer 保持一致。 */
const PDF_MEDIA_TYPE = 'application/pdf';
/** PPTX 的 MIME 类型，与 ai-service PptxRenderer 保持一致。 */
const PPTX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * 构造带中文标题的附件下载响应头：同时给出 ASCII 回退名与 RFC 5987 的
 * `filename*=UTF-8''<pct-encoded>`。现代浏览器优先采用后者，用户下载到的就是
 * 「按主题命名」的文件（如 `铭记九一八 · 勿忘国耻 吾辈自强.pdf`），而不是通用的
 * `document.pdf`。回退名保留 `document.<ext>`，避免老客户端解析到乱码名。
 */
function attachmentDisposition(filename: string, extension: string): string {
    return `attachment; filename="document.${extension}"; filename*=UTF-8''${encodeRfc5987(`${filename}.${extension}`)}`;
}

/**
 * RFC 5987 严格百分号编码。`encodeURIComponent` 会漏掉 `!'()*`——它们不属于
 * RFC 5987 的 `attr-char`，会让响应头在严格解析器下成为非法值，这里补编码。
 */
function encodeRfc5987(value: string): string {
    return encodeURIComponent(value).replace(/['()!*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

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
        return new StreamableFile(bytes, {
            type: DOCX_MEDIA_TYPE,
            disposition: attachmentDisposition(filename, 'docx'),
        });
    }

    /**
     * 导出文档为 PDF：复用 document.read 权限，由落库的 DocumentSpec 确定性
     * 渲染（内嵌 CJK 字体），不调用 LLM。
     */
    @Get(':documentId/export/pdf')
    @RequirePermissions('document.read')
    @Header('Cache-Control', 'no-store')
    @ApiOkResponse({ description: 'PDF 文档文件' })
    async exportDocumentPdf(
        @Param('documentId', new ParseUUIDPipe()) documentId: string,
    ): Promise<StreamableFile> {
        const { filename, bytes } = await this.documentService.exportDocumentPdf(documentId);
        return new StreamableFile(bytes, {
            type: PDF_MEDIA_TYPE,
            disposition: attachmentDisposition(filename, 'pdf'),
        });
    }

    /**
     * 导出文档为 PPTX：复用 document.read 权限，把落库的 DocumentSpec 按
     * 「一节一页」映射后确定性渲染，不调用 LLM。
     */
    @Get(':documentId/export/pptx')
    @RequirePermissions('document.read')
    @Header('Cache-Control', 'no-store')
    @ApiOkResponse({ description: 'PPTX 演示文稿文件' })
    async exportDocumentPptx(
        @Param('documentId', new ParseUUIDPipe()) documentId: string,
    ): Promise<StreamableFile> {
        const { filename, bytes } = await this.documentService.exportDocumentPptx(documentId);
        return new StreamableFile(bytes, {
            type: PPTX_MEDIA_TYPE,
            disposition: attachmentDisposition(filename, 'pptx'),
        });
    }

    /**
     * 下载生成时落盘的正式文件（DOCX/PDF/PPTX）：重定向到 COS 短期签名 URL。
     * 复用 document.read 权限，直接交付已落盘字节，不重新渲染。
     */
    @Get(':documentId/file')
    @RequirePermissions('document.read')
    @Redirect()
    @ApiOkResponse({ description: '已落盘生成文件的下载地址' })
    async downloadDocumentFile(
        @Param('documentId', new ParseUUIDPipe()) documentId: string,
    ): Promise<{ url: string }> {
        const { url } = await this.documentService.getDocumentFileDownload(documentId);
        return { url };
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
