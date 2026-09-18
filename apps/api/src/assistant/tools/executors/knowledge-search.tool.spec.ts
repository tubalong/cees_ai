import { KnowledgeSearchTool } from './knowledge-search.tool';
import { ToolPolicyError } from '../tool-policy.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolExecutionContext } from '../tool.types';
import type { KnowledgeService } from '../../../knowledge/knowledge.service';

describe('KnowledgeSearchTool', () => {
    let registry: ToolRegistryService;
    let knowledgeService: jest.Mocked<Pick<KnowledgeService, 'searchKnowledgeForAssistant'>>;
    const context: ToolExecutionContext = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        membershipId: 'membership-1',
        requestId: 'request-1',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        toolCallId: 'tool-1',
        executionOwner: 'api:test',
        executionToken: 'execution-token',
        permissions: ['knowledge_base.query'],
        knowledgeBaseEnabled: true,
        webSearchEnabled: false,
    };

    beforeEach(() => {
        registry = new ToolRegistryService();
        knowledgeService = { searchKnowledgeForAssistant: jest.fn() };
    });

    it('registers a read-only knowledge search tool with the expected schema and permission', () => {
        const tool = new KnowledgeSearchTool(registry, knowledgeService as unknown as KnowledgeService);
        tool.onModuleInit();
        const definition = registry.get('knowledge_search');

        expect(definition).toEqual(expect.objectContaining({
            name: 'knowledge_search',
            version: '1.0.0',
            requiredPermissions: ['knowledge_base.query'],
            riskLevel: 'READ',
        }));
        expect(definition?.parameters).toEqual(expect.objectContaining({
            required: ['query'],
        }));
        // 检索优先约束：内部信息类问题必须先检索，禁止未检索就反问用户。
        expect(definition?.description).toContain('必须先调用本工具检索知识库');
        expect(definition?.description).toContain('不得向用户反问');
    });

    it('validates and normalizes model arguments', () => {
        const tool = new KnowledgeSearchTool(registry, knowledgeService as unknown as KnowledgeService);
        tool.onModuleInit();
        const definition = registry.get('knowledge_search')!;

        expect(definition.validate({ query: '  项目周报  ' })).toEqual({ query: '项目周报' });
        expect(() => definition.validate({ query: 'x' })).toThrow('至少 2 个字符');
        expect(() => definition.validate({})).toThrow('至少 2 个字符');
    });

    it('rejects execution with a friendly summary when the turn-level switch is off', async () => {
        const tool = new KnowledgeSearchTool(registry, knowledgeService as unknown as KnowledgeService);
        tool.onModuleInit();
        const definition = registry.get('knowledge_search')!;

        await expect(definition.execute(
            { ...context, knowledgeBaseEnabled: false },
            { query: '内部资料' },
        )).rejects.toBeInstanceOf(ToolPolicyError);
        expect(knowledgeService.searchKnowledgeForAssistant).not.toHaveBeenCalled();
    });

    it('executes with explicit identity inputs and returns desensitized summary plus citations', async () => {
        const tool = new KnowledgeSearchTool(registry, knowledgeService as unknown as KnowledgeService);
        tool.onModuleInit();
        const definition = registry.get('knowledge_search')!;
        knowledgeService.searchKnowledgeForAssistant.mockResolvedValue({
            answer: '周报提交截止时间为每周五 18:00。',
            grounded: true,
            insufficientEvidence: false,
            citations: [{
                id: 'document-1',
                title: '项目周报规范',
                snippet: '周报需在每周五 18:00 前提交。',
                pageIndex: 2,
                knowledgeBaseId: 'kb-1',
                deletable: true,
            }],
            searchedKnowledgeBaseIds: ['kb-1'],
        });

        const result = await definition.execute(context, { query: '周报什么时候提交' });

        expect(knowledgeService.searchKnowledgeForAssistant).toHaveBeenCalledWith({
            tenantId: 'tenant-1',
            userId: 'user-1',
            membershipId: 'membership-1',
            permissions: ['knowledge_base.query'],
            requestId: 'request-1',
            query: '周报什么时候提交',
        });
        expect(result.resourceType).toBeNull();
        expect(result.resourceId).toBeNull();
        expect(result.citations).toEqual([{
            id: 'document-1',
            title: '项目周报规范',
            snippet: '周报需在每周五 18:00 前提交。',
            pageIndex: 2,
            knowledgeBaseId: 'kb-1',
            deletable: true,
        }]);
        const summary = JSON.parse(result.summary) as Record<string, unknown>;
        expect(summary).toEqual(expect.objectContaining({
            type: 'knowledge_search_result',
            answer: expect.stringContaining('每周五 18:00') as unknown,
            grounded: true,
            insufficient_evidence: false,
        }));
        expect(summary.citations).toEqual([{
            citation_id: 'S1',
            title: '项目周报规范',
            snippet: '周报需在每周五 18:00 前提交。',
            page_index: 2,
        }]);
        // 脱敏：内部标识（文档 ID、chunk ID、知识库 ID）不得进入回喂模型的摘要。
        expect(result.summary).not.toContain('document-1');
        expect(result.summary).not.toContain('kb-1');
        expect(result.summary).not.toContain('chunk');
    });

    it('tells the model to be honest when visible knowledge bases have no sufficient evidence', async () => {
        const tool = new KnowledgeSearchTool(registry, knowledgeService as unknown as KnowledgeService);
        tool.onModuleInit();
        const definition = registry.get('knowledge_search')!;
        knowledgeService.searchKnowledgeForAssistant.mockResolvedValue({
            answer: '',
            grounded: false,
            insufficientEvidence: true,
            citations: [],
            searchedKnowledgeBaseIds: [],
        });

        const result = await definition.execute(context, { query: '没有的内容' });

        expect(result.citations).toEqual([]);
        const summary = JSON.parse(result.summary) as Record<string, unknown>;
        expect(summary.insufficient_evidence).toBe(true);
        expect(summary.notice).toContain('如实告知用户');
    });
});
