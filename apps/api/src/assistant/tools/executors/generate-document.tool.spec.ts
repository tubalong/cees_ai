import { DocumentVisibility } from '@prisma/client';
import { DocumentService } from '../../../document/document.service';
import { ToolRegistryService } from '../tool-registry';
import { GenerateDocumentTool } from './generate-document.tool';

describe('GenerateDocumentTool', () => {
    let registry: ToolRegistryService;
    let documentService: jest.Mocked<Pick<DocumentService, 'createGeneratedDocument'>>;
    let definition: ReturnType<ToolRegistryService['get']>;

    beforeEach(() => {
        registry = new ToolRegistryService();
        documentService = { createGeneratedDocument: jest.fn() };
        const tool = new GenerateDocumentTool(registry, documentService as unknown as DocumentService);
        tool.onModuleInit();
        definition = registry.get('generate_document');
    });

    it('self-registers with the ai.document.generate permission and a JSON Schema', () => {
        expect(definition).toBeDefined();
        expect(definition?.requiredPermissions).toEqual(['ai.document.generate']);
        expect(definition?.parameters).toEqual(expect.objectContaining({
            type: 'object',
            required: ['instruction'],
        }));
    });

    it('validates the instruction and defaults visibility to PRIVATE', () => {
        expect(() => definition?.validate(null)).toThrow('工具参数必须为对象');
        expect(() => definition?.validate({ instruction: '' })).toThrow('instruction 必须是非空字符串');
        expect(() => definition?.validate({ instruction: 42 })).toThrow('instruction 必须是非空字符串');
        expect(definition?.validate({ instruction: ' 写周报 ' })).toEqual({
            instruction: '写周报',
            visibility: DocumentVisibility.PRIVATE,
        });
    });

    it('validates title and visibility options', () => {
        expect(() => definition?.validate({ instruction: 'ok', title: '' })).toThrow('title 必须是非空字符串');
        expect(() => definition?.validate({ instruction: 'ok', visibility: 'PUBLIC' })).toThrow('visibility');
        expect(definition?.validate({ instruction: 'ok', title: ' 周报 ', visibility: 'TENANT' })).toEqual({
            instruction: 'ok',
            title: '周报',
            visibility: DocumentVisibility.TENANT,
        });
    });

    it('executes via DocumentService and returns the resource summary', async () => {
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
        expect(result.summary).toContain('文档已生成');
    });
});
