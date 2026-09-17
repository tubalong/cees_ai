import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { ToolRegistryService } from '../tool-registry';
import { ListKnowledgeBasesTool } from './list-knowledge-bases.tool';

describe('ListKnowledgeBasesTool', () => {
    let registry: ToolRegistryService;
    let knowledgeService: jest.Mocked<Pick<KnowledgeService, 'listKnowledgeBasesForAssistant'>>;
    let definition: ReturnType<ToolRegistryService['get']>;

    beforeEach(() => {
        registry = new ToolRegistryService();
        knowledgeService = { listKnowledgeBasesForAssistant: jest.fn() };
        const tool = new ListKnowledgeBasesTool(registry, knowledgeService as unknown as KnowledgeService);
        tool.onModuleInit();
        definition = registry.get('list_knowledge_bases');
    });

    it('self-registers as a READ tool with the knowledge_base.read permission', () => {
        expect(definition).toBeDefined();
        expect(definition?.requiredPermissions).toEqual(['knowledge_base.read']);
        expect(definition?.riskLevel).toEqual('READ');
    });

    it('validates that arguments are an object', () => {
        expect(() => definition?.validate(null)).toThrow('工具参数必须为对象');
        expect(() => definition?.validate([])).toThrow('工具参数必须为对象');
        expect(definition?.validate({})).toEqual({});
    });

    it('returns candidate knowledge bases with ids for the follow-up tool call', async () => {
        knowledgeService.listKnowledgeBasesForAssistant.mockResolvedValue([
            {
                id: 'kb-1',
                tenantId: 't-1',
                name: '产品知识库',
                description: '产品资料',
                memberCount: 3,
                createdBy: null,
                updatedBy: null,
                version: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ]);
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
            permissions: ['knowledge_base.read'],
            knowledgeBaseEnabled: false,
        }, {});

        expect(knowledgeService.listKnowledgeBasesForAssistant).toHaveBeenCalledWith({
            tenantId: 't-1',
            userId: 'u-1',
            permissions: ['knowledge_base.read'],
        });
        expect(result.resourceType).toBeNull();
        expect(result.resourceId).toBeNull();
        const summary = JSON.parse(result.summary) as {
            candidates: { knowledge_base_id: string; name: string }[];
            instruction: string;
        };
        expect(summary.candidates).toEqual([
            expect.objectContaining({ knowledge_base_id: 'kb-1', name: '产品知识库' }),
        ]);
        expect(summary.instruction).toContain('save_to_knowledge');
    });

    it('instructs the model to stop when there is no writable knowledge base', async () => {
        knowledgeService.listKnowledgeBasesForAssistant.mockResolvedValue([]);
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
            permissions: ['knowledge_base.read'],
            knowledgeBaseEnabled: false,
        }, {});

        const summary = JSON.parse(result.summary) as { candidates: unknown[]; instruction: string };
        expect(summary.candidates).toEqual([]);
        expect(summary.instruction).toContain('没有可写入的知识库');
    });
});
