import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { ToolRegistryService } from '../tool-registry';
import { CreateKnowledgeBaseTool } from './create-knowledge-base.tool';

describe('CreateKnowledgeBaseTool', () => {
    let registry: ToolRegistryService;
    let knowledgeService: jest.Mocked<Pick<KnowledgeService, 'createKnowledgeBaseForAssistant' | 'isKnowledgeBaseNameAvailable'>>;
    let definition: ReturnType<ToolRegistryService['get']>;

    beforeEach(() => {
        registry = new ToolRegistryService();
        knowledgeService = { createKnowledgeBaseForAssistant: jest.fn(), isKnowledgeBaseNameAvailable: jest.fn() };
        const tool = new CreateKnowledgeBaseTool(registry, knowledgeService as unknown as KnowledgeService);
        tool.onModuleInit();
        definition = registry.get('create_knowledge_base');
    });

    const confirmationContext = {
        tenantId: 't-1',
        userId: 'u-1',
        membershipId: 'm-1',
        requestId: 'r-1',
        turnId: 'turn-1',
        permissions: ['knowledge_base.create'],
    };

    it('self-registers as a WRITE tool with the create permission', () => {
        expect(definition).toBeDefined();
        expect(definition?.requiredPermissions).toEqual(['knowledge_base.create']);
        expect(definition?.riskLevel).toEqual('WRITE');
        expect(definition?.parameters).toEqual(expect.objectContaining({
            type: 'object',
            required: ['name'],
        }));
    });

    it('validates name and optional description', () => {
        expect(() => definition?.validate(null)).toThrow('工具参数必须为对象');
        expect(() => definition?.validate({})).toThrow('name 必须是非空字符串');
        expect(() => definition?.validate({ name: '   ' })).toThrow('name 必须是非空字符串');
        expect(() => definition?.validate({ name: 'x'.repeat(201) }))
            .toThrow('name 不能超过 200 字符');
        expect(() => definition?.validate({ name: '产品库', description: 123 }))
            .toThrow('description 必须是字符串');
        expect(() => definition?.validate({ name: '产品库', description: 'x'.repeat(2001) }))
            .toThrow('description 不能超过 2000 字符');
        expect(definition?.validate({ name: '  产品知识库  ', description: '  产品资料  ' }))
            .toEqual({ name: '产品知识库', description: '产品资料' });
        expect(definition?.validate({ name: '产品知识库', description: '   ' }))
            .toEqual({ name: '产品知识库' });
    });

    it('executes via createKnowledgeBaseForAssistant with explicit context and returns the new id for follow-up save', async () => {
        knowledgeService.createKnowledgeBaseForAssistant.mockResolvedValue({
            id: 'kb-1',
            tenantId: 't-1',
            name: '产品知识库',
            description: '产品资料',
            visibilityScope: 'PRIVATE',
            departmentId: null,
            projectId: null,
            memberCount: 1,
            myPermission: 'MANAGER',
            createdBy: 'u-1',
            updatedBy: 'u-1',
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
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
            permissions: ['knowledge_base.create'],
            knowledgeBaseEnabled: false,
            webSearchEnabled: false,
        }, {
            // ToolPolicy 已在执行前完成 validate，此处传入验证后的干净参数（与真实调用链一致）。
            name: '产品知识库',
            description: '产品资料',
        });

        expect(knowledgeService.createKnowledgeBaseForAssistant).toHaveBeenCalledWith({
            tenantId: 't-1',
            userId: 'u-1',
            membershipId: 'm-1',
            requestId: 'r-1',
            name: '产品知识库',
            description: '产品资料',
        });
        expect(result.resourceType).toBeNull();
        expect(result.resourceId).toBeNull();
        const summary = JSON.parse(result.summary) as {
            knowledge_base_id: string;
            name: string;
            instruction: string;
        };
        expect(summary.knowledge_base_id).toBe('kb-1');
        expect(summary.name).toBe('产品知识库');
        expect(summary.instruction).toContain('save_to_knowledge');
        // 内部标识与权限枚举只用于工具调用，不得转述给用户。
        expect(summary.instruction).toContain('不得向用户展示 knowledge_base_id');
        expect(result.userSummary).toBe('知识库「产品知识库」已创建，你是该知识库的管理员。');
        expect(result.userSummary).not.toContain('kb-1');
        expect(result.userSummary).not.toContain('MANAGER');
        expect(result.userSummary).not.toContain('instruction');
    });

    it('refuses to build a confirmation for a taken name so the model can ask for another one', async () => {
        knowledgeService.isKnowledgeBaseNameAvailable.mockResolvedValue(false);

        await expect(definition!.buildConfirmation!(confirmationContext, { name: '公司共用库' })).rejects.toMatchObject({
            code: 'KNOWLEDGE_BASE_NAME_TAKEN',
            // 用户文案要能直接照做：告诉他换个名称。
            message: expect.stringContaining('请换一个名称'),
            // 模型摘要也必须点明「重名」，否则 toToolFailure 会退化成「请稍后重试」，
            // 模型只会道歉而不会向用户要新名称。
            userFacingSummary: expect.stringContaining('换一个名称'),
        });
        expect(knowledgeService.isKnowledgeBaseNameAvailable).toHaveBeenCalledWith('t-1', '公司共用库');
    });

    it('builds the confirmation when the name is still available', async () => {
        knowledgeService.isKnowledgeBaseNameAvailable.mockResolvedValue(true);

        const confirmation = await definition!.buildConfirmation!(confirmationContext, { name: '公司共用库' });

        expect(confirmation.title).toBe('创建知识库');
        expect(confirmation.fields).toEqual([
            { label: '知识库名称', value: '公司共用库' },
            { label: '知识库说明', value: '（未填写）' },
        ]);
        expect(confirmation.summary).toContain('公司共用库');
    });
});
