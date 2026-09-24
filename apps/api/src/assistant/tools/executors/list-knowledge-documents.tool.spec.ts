import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolExecutionContext } from '../tool.types';
import { ListKnowledgeDocumentsTool } from './list-knowledge-documents.tool';

const context: ToolExecutionContext = {
    tenantId: '1e1c1f0e-0000-4000-8000-000000000001',
    userId: 'u-1',
    membershipId: 'm-1',
    requestId: 'r-1',
    conversationId: 'c-1',
    turnId: 'turn-1',
    toolCallId: 'tc-1',
    executionOwner: 'api:test',
    executionToken: 'execution-token-1',
    permissions: ['knowledge_base.read'],
    knowledgeBaseEnabled: true,
    webSearchEnabled: false,
};

function documents() {
    return [
        {
            documentId: '90000000-0000-4000-8000-000000000001',
            name: '李悦.txt',
            status: 'READY' as const,
            knowledgeBaseId: '80000000-0000-4000-8000-000000000001',
            knowledgeBaseName: '自用',
            updatedAt: '2026-09-23T08:19:27.285Z',
        },
    ];
}

describe('list_knowledge_documents assistant tool', () => {
    let registry: ToolRegistryService;
    let knowledgeService: jest.Mocked<Pick<KnowledgeService, 'listKnowledgeDocumentsForAssistant'>>;
    let definition: ReturnType<ToolRegistryService['get']>;

    beforeEach(() => {
        registry = new ToolRegistryService();
        knowledgeService = {
            listKnowledgeDocumentsForAssistant: jest.fn().mockResolvedValue(documents()),
        };
        new ListKnowledgeDocumentsTool(
            registry,
            knowledgeService as unknown as KnowledgeService,
        ).onModuleInit();
        definition = registry.get('list_knowledge_documents');
    });

    it('self-registers as a READ tool gated by knowledge_base.read', () => {
        expect(definition).toBeDefined();
        expect(definition?.requiredPermissions).toEqual(['knowledge_base.read']);
        expect(definition?.riskLevel).toEqual('READ');
        // 只读清单不需要用户确认。
        expect(definition?.buildConfirmation).toBeUndefined();
    });

    it('rejects unknown arguments so the model cannot invent filters', () => {
        expect(() => definition?.validate({})).not.toThrow();
        expect(() => definition?.validate({ knowledge_base_id: 'x' })).toThrow('不支持的参数：knowledge_base_id');
        expect(() => definition?.validate({ limit: 0 })).toThrow('limit 必须是大于 0 的整数');
        expect(() => definition?.validate({ keyword: '  ' })).toThrow('keyword 必须是非空字符串');
    });

    it('clamps the limit to the documented maximum', () => {
        expect(definition?.validate({ limit: 500 })).toEqual({ limit: 50 });
        expect(definition?.validate({ limit: 5 })).toEqual({ limit: 5 });
    });

    it('lists documents scoped to the real member knowledge bases', async () => {
        const result = await definition!.execute(context, { knowledge_base_name: '自用' });

        expect(knowledgeService.listKnowledgeDocumentsForAssistant).toHaveBeenCalledWith({
            tenantId: context.tenantId,
            userId: context.userId,
            permissions: context.permissions,
            knowledgeBaseName: '自用',
            keyword: undefined,
            limit: 20,
        });
        expect(result.resourceType).toBeNull();
        const summary = JSON.parse(result.summary) as {
            type: string;
            total: number;
            documents: { document_id: string; name: string; knowledge_base_name: string; status: string }[];
        };
        expect(summary.type).toBe('knowledge_document_list');
        expect(summary.total).toBe(1);
        expect(summary.documents).toEqual([
            {
                document_id: '90000000-0000-4000-8000-000000000001',
                name: '李悦.txt',
                knowledge_base_id: '80000000-0000-4000-8000-000000000001',
                knowledge_base_name: '自用',
                status: 'READY',
                updated_at: '2026-09-23T08:19:27.285Z',
            },
        ]);
        // 内部标识不得进入模型上下文。
        expect(result.summary).not.toContain('objectKey');
        expect(result.summary).not.toContain('fileObjectId');
    });

    it('reports an explicit empty result instead of staying silent', async () => {
        knowledgeService.listKnowledgeDocumentsForAssistant.mockResolvedValue([]);
        const result = await definition!.execute(context, {});

        const summary = JSON.parse(result.summary) as { total: number; note: string };
        expect(summary.total).toBe(0);
        expect(summary.note).toContain('没有匹配的文档');
    });
});
