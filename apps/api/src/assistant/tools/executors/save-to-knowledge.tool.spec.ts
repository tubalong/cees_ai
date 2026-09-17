import { KnowledgeDocumentService } from '../../../knowledge/knowledge-document.service';
import { ToolRegistryService } from '../tool-registry';
import { SaveToKnowledgeTool } from './save-to-knowledge.tool';

describe('SaveToKnowledgeTool', () => {
    let registry: ToolRegistryService;
    let knowledgeDocumentService: jest.Mocked<Pick<KnowledgeDocumentService, 'saveFromSource' | 'saveDirectContent'>>;
    let definition: ReturnType<ToolRegistryService['get']>;

    beforeEach(() => {
        registry = new ToolRegistryService();
        knowledgeDocumentService = { saveFromSource: jest.fn(), saveDirectContent: jest.fn() };
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
            required: ['knowledgeBaseId'],
        }));
    });

    it('validates source fields and defaults visibilityScope to PRIVATE', () => {
        expect(() => definition?.validate(null)).toThrow('工具参数必须为对象');
        expect(() => definition?.validate({ sourceType: 'MESSAGE', knowledgeBaseId: 'kb-1' }))
            .toThrow('sourceType 与 sourceId 必须成对提供');
        expect(() => definition?.validate({ sourceId: 's-1', knowledgeBaseId: 'kb-1' }))
            .toThrow('sourceType 与 sourceId 必须成对提供');
        expect(() => definition?.validate({ sourceType: 'MESSAGE', sourceId: 's-1', content: 'x', knowledgeBaseId: 'kb-1' }))
            .toThrow('sourceType/sourceId 与 content 必须且只能提供一组');
        expect(() => definition?.validate({ sourceType: 'MESSAGE', sourceId: 's-1' }))
            .toThrow('knowledgeBaseId 必须是非空字符串');
        expect(() => definition?.validate({ knowledgeBaseId: 'kb-1' }))
            .toThrow('sourceType/sourceId 与 content 必须且只能提供一组');
        expect(definition?.validate({ sourceType: 'MESSAGE', sourceId: ' s-1 ', knowledgeBaseId: ' kb-1 ' }))
            .toEqual({
                sourceType: 'MESSAGE',
                sourceId: 's-1',
                knowledgeBaseId: 'kb-1',
                visibilityScope: 'PRIVATE',
            });
    });

    it('validates the direct content path as an alternative to source fields', () => {
        expect(() => definition?.validate({ content: '', knowledgeBaseId: 'kb-1' }))
            .toThrow('sourceType/sourceId 与 content 必须且只能提供一组');
        expect(definition?.validate({ content: ' 林波是图巴隆公司的超级管理员。 ', knowledgeBaseId: 'kb-1' }))
            .toEqual({
                knowledgeBaseId: 'kb-1',
                content: '林波是图巴隆公司的超级管理员。',
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

    it('executes via saveDirectContent when the model supplies content directly', async () => {
        knowledgeDocumentService.saveDirectContent.mockResolvedValue({
            id: 'doc-2',
            name: '对话内容 2026-09-17 11:00',
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
            content: '林波是图巴隆公司的超级管理员。',
            knowledgeBaseId: 'kb-1',
            visibilityScope: 'PRIVATE',
        });

        expect(knowledgeDocumentService.saveDirectContent).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't-1',
            userId: 'u-1',
            membershipId: 'm-1',
            requestId: 'r-1',
        }), {
            knowledgeBaseId: 'kb-1',
            content: '林波是图巴隆公司的超级管理员。',
            name: undefined,
            visibilityScope: 'PRIVATE',
            departmentId: undefined,
            projectId: undefined,
        });
        expect(knowledgeDocumentService.saveFromSource).not.toHaveBeenCalled();
        expect(result).toEqual({
            resourceType: null,
            resourceId: null,
            summary: expect.stringContaining('对话内容') as unknown,
        });
        expect(result.summary).toContain('已存入知识库');
    });
});
