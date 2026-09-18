import { PrismaService } from '../../../database/prisma.service';
import { ToolRegistryService } from '../tool-registry';
import { ListDocumentsTool } from './list-documents.tool';

describe('ListDocumentsTool', () => {
    let registry: ToolRegistryService;
    let findManyDocuments: jest.Mock;
    let findManyRoles: jest.Mock;
    let definition: ReturnType<ToolRegistryService['get']>;

    const context = {
        tenantId: 't-1',
        userId: 'u-1',
        membershipId: 'm-1',
        requestId: 'r-1',
        conversationId: 'c-1',
        turnId: 'turn-1',
        toolCallId: 'tc-1',
        executionOwner: 'api:test',
        executionToken: 'execution-token-1',
        permissions: ['document.read'],
        knowledgeBaseEnabled: false,
        webSearchEnabled: false,
    };

    beforeEach(() => {
        registry = new ToolRegistryService();
        findManyDocuments = jest.fn();
        findManyRoles = jest.fn();
        const prisma = {
            managedDocument: { findMany: findManyDocuments },
            membershipRole: { findMany: findManyRoles },
        };
        const tool = new ListDocumentsTool(registry, prisma as unknown as PrismaService);
        tool.onModuleInit();
        definition = registry.get('list_documents');
    });

    it('self-registers as a READ tool with the document.read permission', () => {
        expect(definition).toBeDefined();
        expect(definition?.requiredPermissions).toEqual(['document.read']);
        expect(definition?.riskLevel).toEqual('READ');
    });

    it('validates arguments', () => {
        expect(() => definition?.validate(null)).toThrow('工具参数必须为对象');
        expect(() => definition?.validate([])).toThrow('工具参数必须为对象');
        expect(definition?.validate({})).toEqual({});
        expect(() => definition?.validate({ keyword: 123 })).toThrow('keyword 必须为字符串');
        expect(() => definition?.validate({ keyword: 'x'.repeat(101) })).toThrow('keyword 不能超过 100 字符');
        expect(() => definition?.validate({ limit: 0 })).toThrow('limit 必须是大于 0 的整数');
        expect(() => definition?.validate({ limit: 1.5 })).toThrow('limit 必须是大于 0 的整数');
        expect(definition?.validate({ keyword: '  产品  ', limit: 10 })).toEqual({ keyword: '产品', limit: 10 });
    });

    it('returns readable documents and instructs save_to_knowledge usage', async () => {
        findManyRoles.mockResolvedValue([]);
        findManyDocuments.mockResolvedValue([
            { id: 'd-1', title: '知识库使用说明', createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-02') },
        ]);
        const result = await definition!.execute(context, { keyword: '知识库' });

        expect(findManyDocuments).toHaveBeenCalledTimes(1);
        const where = findManyDocuments.mock.calls[0][0].where;
        expect(where).toEqual(expect.objectContaining({
            AND: expect.arrayContaining([
                expect.objectContaining({ title: { contains: '知识库', mode: 'insensitive' } }),
                expect.objectContaining({
                    OR: expect.arrayContaining([
                        expect.objectContaining({ visibility: 'TENANT' }),
                    ]),
                }),
            ]),
        }));
        const summary = JSON.parse(result.summary) as {
            candidates: { document_id: string; title: string }[];
            instruction: string;
        };
        expect(summary.candidates).toEqual([
            expect.objectContaining({ document_id: 'd-1', title: '知识库使用说明' }),
        ]);
        expect(summary.instruction).toContain('save_to_knowledge');
        expect(summary.instruction).toContain('sourceType=DOCUMENT');
        expect(summary.instruction).toContain('不要向用户展示 document_id');
        expect(result.resourceType).toBeNull();
        expect(result.resourceId).toBeNull();
    });

    it('includes tenant-wide and owner and role ACL access filters', async () => {
        findManyRoles.mockResolvedValue([{ roleId: 'role-1', tenantId: 't-1', membershipId: 'm-1', assignedAt: new Date() }]);
        findManyDocuments.mockResolvedValue([]);
        await definition!.execute(context, {});
        const where = findManyDocuments.mock.calls[0][0].where;
        expect(JSON.stringify(where)).toContain('ownerMembershipId');
        expect(JSON.stringify(where)).toContain('role-1');
        expect(JSON.stringify(where)).toContain('document.read');
    });

    it('skips membership/visibility filters for manage_all holders', async () => {
        findManyRoles.mockResolvedValue([]);
        findManyDocuments.mockResolvedValue([]);
        await definition!.execute({ ...context, permissions: ['document.read', 'document.manage_all'] }, {});
        const where = findManyDocuments.mock.calls[0][0].where;
        expect(JSON.stringify(where)).not.toContain('ownerMembershipId');
        expect(JSON.stringify(where)).not.toContain('acls');
    });

    it('instructs the model to stop when there are no readable documents', async () => {
        findManyRoles.mockResolvedValue([]);
        findManyDocuments.mockResolvedValue([]);
        const result = await definition!.execute(context, {});
        const summary = JSON.parse(result.summary) as { candidates: unknown[]; instruction: string };
        expect(summary.candidates).toEqual([]);
        expect(summary.instruction).toContain('没有可读文档');
    });
});
