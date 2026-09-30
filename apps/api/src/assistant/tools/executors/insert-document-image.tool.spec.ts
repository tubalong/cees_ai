import { DocumentService } from '../../../document/document.service';
import { AssistantMessageContentService, ConversationImageReference } from '../../runtime/message-content.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolExecutionContext } from '../tool.types';
import { InsertDocumentImageTool } from './insert-document-image.tool';

describe('InsertDocumentImageTool', () => {
    let registry: ToolRegistryService;
    let documentService: jest.Mocked<Pick<DocumentService, 'insertDocumentImage'>>;
    let messageContent: jest.Mocked<Pick<AssistantMessageContentService, 'resolveConversationImageReferences'>>;

    const context: ToolExecutionContext = {
        tenantId: '10000000-0000-0000-0000-000000000001',
        userId: '10000000-0000-0000-0000-000000000002',
        membershipId: '50000000-0000-0000-0000-000000000001',
        requestId: 'request-id',
        conversationId: '60000000-0000-0000-0000-000000000001',
        turnId: 'turn-id',
        toolCallId: 'tool-call-id',
        executionOwner: 'api:test',
        executionToken: 'execution-token-1',
        permissions: ['ai.document.generate'],
        knowledgeBaseEnabled: false,
        webSearchEnabled: false,
    };

    beforeEach(() => {
        registry = new ToolRegistryService();
        documentService = { insertDocumentImage: jest.fn() };
        messageContent = { resolveConversationImageReferences: jest.fn() };
        const tool = new InsertDocumentImageTool(
            registry,
            documentService as unknown as DocumentService,
            messageContent as unknown as AssistantMessageContentService,
        );
        tool.onModuleInit();
    });

    it('self-registers as a write tool guarded by the ai.document.generate permission', () => {
        const definition = registry.get('insert_document_image');
        expect(definition).toBeDefined();
        expect(definition?.requiredPermissions).toEqual(['ai.document.generate']);
        expect(definition?.riskLevel).toBe('WRITE');
        expect(definition?.parameters).toEqual(expect.objectContaining({
            type: 'object',
            required: [],
            additionalProperties: false,
        }));
    });

    it('validates and normalizes model arguments', () => {
        const definition = registry.get('insert_document_image');
        expect(() => definition?.validate(null)).toThrow('工具参数必须为对象');
        expect(() => definition?.validate({ section_title: '' })).toThrow('section_title 必须是非空字符串');
        expect(() => definition?.validate({ caption: 'x'.repeat(301) })).toThrow('caption 不能超过 300 字符');
        expect(() => definition?.validate({ image_index: 0 })).toThrow('image_index 必须是不小于 1 的整数');
        expect(() => definition?.validate({ image_index: 1.5 })).toThrow('image_index 必须是不小于 1 的整数');
        expect(() => definition?.validate({ image_file_id: 'file-1', image_index: 1 })).toThrow('只能提供一个');
        expect(definition?.validate({ section_title: ' 下周计划 ', caption: ' 架构图 ', image_index: 2 })).toEqual({
            section_title: '下周计划',
            caption: '架构图',
            image_index: 2,
        });
    });

    it('resolves the requested image and inserts it without rewriting body text', async () => {
        const references: ConversationImageReference[] = [
            { fileId: 'file-1', objectKey: 'cees/local/a.png', mimeType: 'image/png', source: 'UPLOAD', label: 'a.png', createdAt: new Date('2026-09-29T01:00:00Z') },
            { fileId: 'file-2', objectKey: 'cees/local/b.png', mimeType: 'image/png', source: 'GENERATED', label: '团队协作插画', createdAt: new Date('2026-09-29T02:00:00Z') },
        ];
        messageContent.resolveConversationImageReferences.mockResolvedValue(references);
        documentService.insertDocumentImage.mockResolvedValue({
            documentId: 'doc-1',
            title: '项目周报',
            sectionHeading: '下周计划',
            sectionIndex: 1,
            format: 'pdf',
        });
        const definition = registry.get('insert_document_image');

        const result = await definition!.execute(context, { section_title: '下周计划', caption: '架构图', image_file_id: 'file-2' });

        expect(messageContent.resolveConversationImageReferences).toHaveBeenCalledWith(context.conversationId, expect.objectContaining({
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
        }));
        expect(documentService.insertDocumentImage).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: context.tenantId,
            turnId: context.turnId,
            toolCallId: context.toolCallId,
            conversationId: context.conversationId,
            imageObjectKey: 'cees/local/b.png',
            sectionTitle: '下周计划',
            caption: '架构图',
        }));
        expect(result).toEqual({
            resourceType: 'DOCUMENT',
            resourceId: 'doc-1',
            summary: expect.stringContaining('下周计划') as unknown,
        });
        // 回喂模型的摘要不携带系统内部信息：文档 ID 与对象键不得进入模型答复。
        expect(result.summary).not.toContain('doc-1');
        expect(result.summary).not.toContain('cees/local/b.png');
    });

    it('defaults to the latest image of the conversation when selection is omitted', async () => {
        messageContent.resolveConversationImageReferences.mockResolvedValue([
            { fileId: 'file-1', objectKey: 'cees/local/a.png', mimeType: 'image/png', source: 'UPLOAD', label: 'a.png', createdAt: new Date('2026-09-29T01:00:00Z') },
            { fileId: 'file-2', objectKey: 'cees/local/b.png', mimeType: 'image/png', source: 'GENERATED', label: '团队协作插画', createdAt: new Date('2026-09-29T02:00:00Z') },
        ]);
        documentService.insertDocumentImage.mockResolvedValue({
            documentId: 'doc-1',
            title: '项目周报',
            sectionHeading: '本周进展',
            sectionIndex: 0,
            format: 'pdf',
        });
        const definition = registry.get('insert_document_image');

        await definition!.execute(context, {});

        expect(documentService.insertDocumentImage).toHaveBeenCalledWith(expect.objectContaining({
            imageObjectKey: 'cees/local/b.png',
        }));
    });

    it('rejects when the conversation has no usable image', async () => {
        messageContent.resolveConversationImageReferences.mockResolvedValue([]);
        const definition = registry.get('insert_document_image');

        await expect(definition!.execute(context, {})).rejects.toThrow('当前会话没有可供插入的图片');
        expect(documentService.insertDocumentImage).not.toHaveBeenCalled();
    });

    it('rejects an out-of-range image_index', async () => {
        messageContent.resolveConversationImageReferences.mockResolvedValue([
            { fileId: 'file-1', objectKey: 'cees/local/a.png', mimeType: 'image/png', source: 'UPLOAD', label: 'a.png', createdAt: new Date('2026-09-29T01:00:00Z') },
        ]);
        const definition = registry.get('insert_document_image');

        await expect(definition!.execute(context, { image_index: 3 })).rejects.toThrow('image_index 必须在 1 到 1 之间');
        expect(documentService.insertDocumentImage).not.toHaveBeenCalled();
    });
});
