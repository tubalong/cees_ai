import { DocumentVisibility } from '@prisma/client';
import { DocumentService } from '../../../document/document.service';
import { AssistantMessageContentService } from '../../runtime/message-content.service';
import { ToolRegistryService } from '../tool-registry';
import { GenerateDocumentTool } from './generate-document.tool';

describe('GenerateDocumentTool', () => {
    let registry: ToolRegistryService;
    let documentService: jest.Mocked<Pick<DocumentService, 'createGeneratedDocument' | 'createGeneratedSpreadsheet'>>;
    let messageContent: jest.Mocked<Pick<AssistantMessageContentService, 'resolveTurnDocumentSourceMaterials' | 'resolveConversationDocumentSourceMaterials'>>;

    beforeEach(() => {
        registry = new ToolRegistryService();
        documentService = { createGeneratedDocument: jest.fn(), createGeneratedSpreadsheet: jest.fn() };
        messageContent = {
            resolveTurnDocumentSourceMaterials: jest.fn().mockResolvedValue([]),
            resolveConversationDocumentSourceMaterials: jest.fn().mockResolvedValue([]),
        };
        const tool = new GenerateDocumentTool(
            registry,
            documentService as unknown as DocumentService,
            messageContent as unknown as AssistantMessageContentService,
        );
        tool.onModuleInit();
    });

    it('self-registers four format tools with the ai.document.generate permission', () => {
        for (const name of ['generate_docx', 'generate_pdf', 'generate_pptx', 'generate_xlsx']) {
            const definition = registry.get(name);
            expect(definition).toBeDefined();
            expect(definition?.requiredPermissions).toEqual(['ai.document.generate']);
            expect(definition?.parameters).toEqual(expect.objectContaining({
                type: 'object',
                required: ['instruction'],
            }));
        }
    });

    it('validates the instruction and defaults visibility to PRIVATE', () => {
        const definition = registry.get('generate_pdf');
        expect(() => definition?.validate(null)).toThrow('工具参数必须为对象');
        expect(() => definition?.validate({ instruction: '' })).toThrow('instruction 必须是非空字符串');
        expect(() => definition?.validate({ instruction: 42 })).toThrow('instruction 必须是非空字符串');
        expect(definition?.validate({ instruction: ' 写周报 ' })).toEqual({
            instruction: '写周报',
            visibility: DocumentVisibility.PRIVATE,
        });
    });

    it('validates title and visibility options', () => {
        const definition = registry.get('generate_pdf');
        expect(() => definition?.validate({ instruction: 'ok', title: '' })).toThrow('title 必须是非空字符串');
        expect(() => definition?.validate({ instruction: 'ok', visibility: 'PUBLIC' })).toThrow('visibility');
        expect(definition?.validate({ instruction: 'ok', title: ' 周报 ', visibility: 'TENANT' })).toEqual({
            instruction: 'ok',
            title: '周报',
            visibility: DocumentVisibility.TENANT,
        });
    });

    it('executes via DocumentService and returns the resource summary', async () => {
        const definition = registry.get('generate_pdf');
        documentService.createGeneratedDocument.mockResolvedValue({
            documentId: 'doc-1',
            title: '项目周报',
            contentLength: 1200,
            provider: 'openai_compatible',
            model: 'doc-model',
        });
        const result = await definition!.execute({
            tenantId: 't-1',
            userId: 'u-1',
            membershipId: 'm-1',
            requestId: 'r-1',
            conversationId: 'c-1',
            turnId: 'turn-1',
            toolCallId: 'tc-1',
            executionOwner: 'api:test',
            executionToken: 'execution-token-1',
            permissions: ['ai.document.generate'],
            knowledgeBaseEnabled: false,
            webSearchEnabled: false,
        }, { instruction: '写一份周报', visibility: 'PRIVATE' });

        expect(documentService.createGeneratedDocument).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't-1',
            turnId: 'turn-1',
            toolCallId: 'tc-1',
            instruction: '写一份周报',
            visibility: DocumentVisibility.PRIVATE,
        }));
        expect(result).toEqual({
            resourceType: 'DOCUMENT',
            resourceId: 'doc-1',
            summary: expect.stringContaining('项目周报') as unknown,
        });
        expect(result.summary).toContain('PDF 文档已生成');
        expect(result.summary).toContain('共 1200 字');
        // 回喂模型的摘要不携带系统内部信息：文档 ID 与模型名不得进入模型答复。
        expect(result.summary).not.toContain('doc-1');
        expect(result.summary).not.toContain('doc-model');
    });

    it('rebuilds current-turn attachments before generating XLSX', async () => {
        const definition = registry.get('generate_xlsx');
        messageContent.resolveTurnDocumentSourceMaterials.mockResolvedValue([
            { id: 'file-1', title: '收入.xlsx', content: '工作表：收入\n项目,金额\n华东,100' },
        ]);
        documentService.createGeneratedSpreadsheet.mockResolvedValue({
            documentId: 'sheet-1',
            title: '收入调整表',
            contentLength: 48,
            provider: 'openai_compatible',
            model: 'sheet-model',
        });

        const result = await definition!.execute({
            tenantId: 't-1', userId: 'u-1', membershipId: 'm-1', requestId: 'r-1',
            conversationId: 'c-1', turnId: 'turn-1', toolCallId: 'tc-1',
            executionOwner: 'api:test', executionToken: 'execution-token-1',
            permissions: ['ai.document.generate'], knowledgeBaseEnabled: false, webSearchEnabled: false,
        }, { instruction: '把金额提高 10%', visibility: 'PRIVATE' });

        expect(messageContent.resolveTurnDocumentSourceMaterials).toHaveBeenCalledWith(
            'turn-1',
            expect.objectContaining({ tenantId: 't-1', userId: 'u-1' }),
        );
        expect(documentService.createGeneratedSpreadsheet).toHaveBeenCalledWith(expect.objectContaining({
            instruction: '把金额提高 10%',
            sourceMaterials: [expect.objectContaining({ title: '收入.xlsx' })],
        }));
        expect(result).toEqual(expect.objectContaining({ resourceType: 'DOCUMENT', resourceId: 'sheet-1' }));
        expect(result.summary).toContain('XLSX 表格已生成');
    });

    it('reuses the latest spreadsheet from the conversation when the current turn has no attachment', async () => {
        const definition = registry.get('generate_xlsx');
        messageContent.resolveConversationDocumentSourceMaterials.mockResolvedValue([
            { id: 'generated-file-1', title: '收入调整表.xlsx', content: '工作表：收入调整表\n项目,金额\n华东,110' },
        ]);
        documentService.createGeneratedSpreadsheet.mockResolvedValue({
            documentId: 'sheet-2', title: '收入二次调整表', contentLength: 52, provider: 'openai_compatible', model: 'sheet-model',
        });

        await definition!.execute({
            tenantId: 't-1', userId: 'u-1', membershipId: 'm-1', requestId: 'r-1',
            conversationId: 'c-1', turnId: 'turn-2', toolCallId: 'tc-2',
            executionOwner: 'api:test', executionToken: 'execution-token-2',
            permissions: ['ai.document.generate'], knowledgeBaseEnabled: false, webSearchEnabled: false,
        }, { instruction: '再把金额提高 5%', visibility: 'PRIVATE' });

        expect(messageContent.resolveConversationDocumentSourceMaterials).toHaveBeenCalledWith(
            'c-1', expect.objectContaining({ tenantId: 't-1', userId: 'u-1' }),
        );
        expect(documentService.createGeneratedSpreadsheet).toHaveBeenCalledWith(expect.objectContaining({
            sourceMaterials: [expect.objectContaining({ title: '收入调整表.xlsx' })],
        }));
    });
});
