import { KnowledgeDocumentService } from '../../../knowledge/knowledge-document.service';
import { ToolRegistryService } from '../tool-registry';
import { SaveToKnowledgeTool } from './save-to-knowledge.tool';

describe('SaveToKnowledgeTool', () => {
    let registry: ToolRegistryService;
    let knowledgeDocumentService: jest.Mocked<Pick<KnowledgeDocumentService, 'saveFromSource'>>;
    let definition: ReturnType<ToolRegistryService['get']>;

    beforeEach(() => {
        registry = new ToolRegistryService();
        knowledgeDocumentService = { saveFromSource: jest.fn() };
        const tool = new SaveToKnowledgeTool(registry, knowledgeDocumentService as unknown as KnowledgeDocumentService);
        tool.onModuleInit();
        definition = registry.get('save_to_knowledge');
    });

    it('self-registers as a WRITE tool with the document.manage permission', () => {
        expect(definition).toBeDefined();
        expect(definition?.requiredPermissions).toEqual(['knowledge_base.document.manage']);
        expect(definition?.riskLevel).toEqual('WRITE');
        expect(definition?.parameters).toEqual(expect.objectContaining({
            type: 'object',
            required: ['sourceType', 'sourceId', 'knowledgeBaseId'],
        }));
    });

    it('validates source fields and defaults visibilityScope to PRIVATE', () => {
        expect(() => definition?.validate(null)).toThrow('工具参数必须为对象');
        expect(() => definition?.validate({ sourceId: 's-1', knowledgeBaseId: 'kb-1' }))
            .toThrow('sourceType 必须是 FILE_OBJECT/DOCUMENT/MESSAGE 之一');
        expect(() => definition?.validate({ sourceType: 'MESSAGE', knowledgeBaseId: 'kb-1' }))
            .toThrow('sourceId 必须是非空字符串');
        expect(() => definition?.validate({ sourceType: 'MESSAGE', sourceId: 's-1' }))
            .toThrow('knowledgeBaseId 必须是非空字符串');
        expect(definition?.validate({ sourceType: 'MESSAGE', sourceId: ' s-1 ', knowledgeBaseId: ' kb-1 ' }))
            .toEqual({
                sourceType: 'MESSAGE',
                sourceId: 's-1',
                knowledgeBaseId: 'kb-1',
                visibilityScope: 'PRIVATE',
            });
    });

    it('validates optional name and visibility options', () => {
        expect(() => definition?.validate({
            sourceType: 'DOCUMENT',
            sourceId: 'd-1',
            knowledgeBaseId: 'kb-1',
            name: '',
        })).toThrow('name 必须是非空字符串');
        expect(() => definition?.validate({
            sourceType: 'DOCUMENT',
            sourceId: 'd-1',
            knowledgeBaseId: 'kb-1',
            visibilityScope: 'PUBLIC',
        })).toThrow('visibilityScope 必须是 PRIVATE/DEPARTMENT/PROJECT/TENANT 之一');
        expect(definition?.validate({
            sourceType: 'FILE_OBJECT',
            sourceId: 'f-1',
            knowledgeBaseId: 'kb-1',
            name: ' 会议纪要 ',
            visibilityScope: 'PROJECT',
            projectId: 'p-1',
        })).toEqual({
            sourceType: 'FILE_OBJECT',
            sourceId: 'f-1',
            knowledgeBaseId: 'kb-1',
            name: '会议纪要',
            visibilityScope: 'PROJECT',
            projectId: 'p-1',
        });
    });

    it('executes via saveFromSource with explicit context and a business-only summary', async () => {
        knowledgeDocumentService.saveFromSource.mockResolvedValue({
            id: 'doc-1',
            name: '会议纪要',
            status: 'PENDING',
        } as never);
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
            permissions: ['knowledge_base.document.manage'],
            knowledgeBaseEnabled: false,
        }, {
            sourceType: 'MESSAGE',
            sourceId: 'msg-1',
            knowledgeBaseId: 'kb-1',
            visibilityScope: 'PRIVATE',
        });

        expect(knowledgeDocumentService.saveFromSource).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't-1',
            userId: 'u-1',
            membershipId: 'm-1',
            permissions: ['knowledge_base.document.manage'],
            requestId: 'r-1',
            conversationId: 'c-1',
        }), {
            knowledgeBaseId: 'kb-1',
            sourceType: 'MESSAGE',
            sourceId: 'msg-1',
            name: undefined,
            visibilityScope: 'PRIVATE',
            departmentId: undefined,
            projectId: undefined,
        });
        expect(result).toEqual({
            resourceType: null,
            resourceId: null,
            summary: expect.stringContaining('会议纪要') as unknown,
        });
        expect(result.summary).toContain('已存入知识库');
        // 回喂模型的摘要不携带内部 ID：目标库与来源标识不得进模型答复。
        expect(result.summary).not.toContain('kb-1');
        expect(result.summary).not.toContain('msg-1');
        expect(result.summary).not.toContain('doc-1');
    });
});
