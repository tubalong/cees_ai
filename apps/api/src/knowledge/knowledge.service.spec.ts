import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiServiceGateway, AiServiceInvocationError } from '../ai-orchestration/ai-service-gateway.service';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeIndexingService } from './knowledge-indexing.service';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';

describe('KnowledgeService', () => {
    it('creates a knowledge base and grants the creator MANAGER permission', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.create.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.create.mockResolvedValue(knowledgeBaseMemberRecord());
        const service = createService(prisma, ['knowledge_base.create']);

        const result = await service.createKnowledgeBase({ name: '  产品知识库  ', description: '  产品资料  ' });

        expect(result).toEqual(expect.objectContaining({
            id: KNOWLEDGE_BASE_ID,
            name: '产品知识库',
            memberCount: 1,
            myPermission: 'MANAGER',
        }));
        expect(prisma.knowledgeBaseMember.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                userId: USER_ID,
                permission: 'MANAGER',
            }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'KNOWLEDGE_BASE_CREATED' }),
        });
    });

    it('creates a department-scoped knowledge base with a valid anchor', async () => {
        const prisma = createPrismaMock();
        prisma.department.findFirst.mockResolvedValue({ id: 'dept-1' });
        prisma.knowledgeBase.create.mockResolvedValue(
            knowledgeBaseRecord({ visibilityScope: 'DEPARTMENT', departmentId: 'dept-1' }),
        );
        prisma.knowledgeBaseMember.create.mockResolvedValue(knowledgeBaseMemberRecord());
        const service = createService(prisma, ['knowledge_base.create']);

        const result = await service.createKnowledgeBase({
            name: '市场部知识库',
            visibilityScope: 'DEPARTMENT',
            departmentId: 'dept-1',
        });

        expect(prisma.knowledgeBase.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                visibilityScope: 'DEPARTMENT',
                departmentId: 'dept-1',
                projectId: null,
            }),
            select: expect.anything(),
        });
        expect(result).toEqual(expect.objectContaining({ visibilityScope: 'DEPARTMENT', departmentId: 'dept-1' }));
    });

    it('creates a project-scoped knowledge base with a valid anchor', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
        prisma.knowledgeBase.create.mockResolvedValue(
            knowledgeBaseRecord({ visibilityScope: 'PROJECT', projectId: 'project-1' }),
        );
        prisma.knowledgeBaseMember.create.mockResolvedValue(knowledgeBaseMemberRecord());
        const service = createService(prisma, ['knowledge_base.create']);

        await service.createKnowledgeBase({
            name: '项目知识库',
            visibilityScope: 'PROJECT',
            projectId: 'project-1',
        });

        expect(prisma.knowledgeBase.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                visibilityScope: 'PROJECT',
                departmentId: null,
                projectId: 'project-1',
            }),
            select: expect.anything(),
        });
    });

    it('rejects a department-scoped knowledge base without a department anchor', async () => {
        const prisma = createPrismaMock();
        const service = createService(prisma, ['knowledge_base.create']);

        await expect(service.createKnowledgeBase({ name: '无锚点部门库', visibilityScope: 'DEPARTMENT' }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_SCOPE_INVALID' }) });
        expect(prisma.knowledgeBase.create).not.toHaveBeenCalled();
    });

    it('rejects an anchor department outside the current tenant', async () => {
        const prisma = createPrismaMock();
        prisma.department.findFirst.mockResolvedValue(null);
        const service = createService(prisma, ['knowledge_base.create']);

        await expect(service.createKnowledgeBase({
            name: '外部部门库',
            visibilityScope: 'DEPARTMENT',
            departmentId: 'dept-x',
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_SCOPE_INVALID' }) });
    });

    it('limits ordinary members to knowledge bases they joined', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBaseMember.findMany.mockResolvedValue([{ knowledgeBaseId: KNOWLEDGE_BASE_ID }]);
        prisma.knowledgeBase.findMany.mockResolvedValue([knowledgeBaseRecord()]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read']);

        const result = await service.listKnowledgeBases({ limit: 20 });

        expect(result.items).toHaveLength(1);
        expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: { in: [KNOWLEDGE_BASE_ID] } }),
        }));
    });

    it('shows TENANT-scoped knowledge bases to anchor readers who are not members', async () => {
        const prisma = createPrismaMock();
        // 非成员：成员表无记录，但库归属 TENANT 使全员成为虚拟 READER。
        prisma.knowledgeBaseMember.findMany.mockResolvedValue([]);
        prisma.knowledgeBase.findMany
            .mockResolvedValueOnce([{ id: KNOWLEDGE_BASE_ID, visibilityScope: 'TENANT', departmentId: null, projectId: null }])
            .mockResolvedValueOnce([knowledgeBaseRecord({ visibilityScope: 'TENANT' })]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read']);

        const result = await service.listKnowledgeBases({ limit: 20 });

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toEqual(expect.objectContaining({ id: KNOWLEDGE_BASE_ID, visibilityScope: 'TENANT', myPermission: 'READER' }));
        // 第二次 findMany 是页面主查询，锚点库必须被并入可见范围。
        expect(prisma.knowledgeBase.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({ id: { in: [KNOWLEDGE_BASE_ID] } }),
        }));
    });

    it('shows DEPARTMENT-scoped knowledge bases to department tree members', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBaseMember.findMany.mockResolvedValue([]);
        // 锚点查询命中一个挂在子部门上的库，当前成员属于父部门。
        prisma.knowledgeBase.findMany
            .mockResolvedValueOnce([{ id: KNOWLEDGE_BASE_ID, visibilityScope: 'DEPARTMENT', departmentId: 'dept-child', projectId: null }])
            .mockResolvedValueOnce([knowledgeBaseRecord({ visibilityScope: 'DEPARTMENT', departmentId: 'dept-child' })]);
        prisma.tenantMembership.findFirst.mockResolvedValue({ departmentId: 'dept-root' });
        prisma.department.findMany.mockResolvedValue([
            { id: 'dept-root', parentId: null },
            { id: 'dept-child', parentId: 'dept-root' },
        ]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read']);

        const result = await service.listKnowledgeBases({ limit: 20 });

        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toEqual(expect.objectContaining({ id: KNOWLEDGE_BASE_ID, visibilityScope: 'DEPARTMENT' }));
    });

    it('allows manage_all members to list all tenant knowledge bases', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findMany.mockResolvedValue([knowledgeBaseRecord()]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.manage_all']);

        const result = await service.listKnowledgeBases({ limit: 20 });

        expect(prisma.knowledgeBaseMember.findMany).not.toHaveBeenCalled();
        expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null, id: undefined }),
        }));
        expect(result.items[0]).toEqual(expect.objectContaining({ myPermission: 'MANAGER' }));
    });

    it('allows read_all members to list all tenant knowledge bases', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findMany.mockResolvedValue([knowledgeBaseRecord()]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read_all']);

        const result = await service.listKnowledgeBases({ limit: 20 });

        expect(prisma.knowledgeBaseMember.findMany).not.toHaveBeenCalled();
        expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null, id: undefined }),
        }));
        expect(result.items[0]).toEqual(expect.objectContaining({ myPermission: 'READER' }));
    });

    it('filters the list by a minimum member permission', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBaseMember.findMany.mockResolvedValue([
            { knowledgeBaseId: KNOWLEDGE_BASE_ID, permission: 'EDITOR' },
            { knowledgeBaseId: OTHER_KNOWLEDGE_BASE_ID, permission: 'READER' },
        ]);
        prisma.knowledgeBase.findMany.mockResolvedValue([knowledgeBaseRecord()]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read']);

        const result = await service.listKnowledgeBases({ limit: 20, permission: 'EDITOR' });

        expect(prisma.knowledgeBaseMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: TENANT_ID, userId: USER_ID },
            select: { knowledgeBaseId: true, permission: true },
        }));
        expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: { in: [KNOWLEDGE_BASE_ID] } }),
        }));
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toEqual(expect.objectContaining({ myPermission: 'EDITOR' }));
    });

    it('lists all visible knowledge bases for the assistant with permission labels', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBaseMember.findMany.mockResolvedValue([
            { knowledgeBaseId: KNOWLEDGE_BASE_ID, permission: 'EDITOR' },
            { knowledgeBaseId: OTHER_KNOWLEDGE_BASE_ID, permission: 'READER' },
        ]);
        prisma.knowledgeBase.findMany.mockResolvedValue([
            knowledgeBaseRecord(),
            knowledgeBaseRecord({ id: OTHER_KNOWLEDGE_BASE_ID, name: '公司制度库' }),
        ]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read']);

        const result = await service.listKnowledgeBasesForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            permissions: ['knowledge_base.read'],
        });

        expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: { in: [KNOWLEDGE_BASE_ID, OTHER_KNOWLEDGE_BASE_ID] },
            }),
            take: 100,
        }));
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(expect.objectContaining({
            id: KNOWLEDGE_BASE_ID, myPermission: 'EDITOR', retrievable: true,
        }));
        expect(result[1]).toEqual(expect.objectContaining({
            id: OTHER_KNOWLEDGE_BASE_ID, myPermission: 'READER', retrievable: true,
        }));
    });

    it('labels anchor-only knowledge bases as READER for the assistant', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBaseMember.findMany.mockResolvedValue([]);
        prisma.knowledgeBase.findMany
            .mockResolvedValueOnce([{ id: KNOWLEDGE_BASE_ID, visibilityScope: 'TENANT', departmentId: null, projectId: null }])
            .mockResolvedValueOnce([knowledgeBaseRecord({ visibilityScope: 'TENANT' })]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read']);

        const result = await service.listKnowledgeBasesForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            permissions: ['knowledge_base.read'],
        });

        // 锚点人群虚拟 READER：仅可见，不参与 search_knowledge 检索。
        expect(result).toEqual([expect.objectContaining({
            id: KNOWLEDGE_BASE_ID, myPermission: 'READER', retrievable: false,
        })]);
    });

    it('returns no candidates when the user is neither a member nor in any anchor group', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBaseMember.findMany.mockResolvedValue([]);
        // 锚点库查询（TENANT/部门树/项目）无命中。
        prisma.knowledgeBase.findMany.mockResolvedValue([]);
        const service = createService(prisma, ['knowledge_base.read']);

        const result = await service.listKnowledgeBasesForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            permissions: ['knowledge_base.read'],
        });

        expect(result).toEqual([]);
    });

    it('labels every candidate MANAGER for the assistant when manage_all shortcuts', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findMany.mockResolvedValue([knowledgeBaseRecord()]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.manage_all']);

        const result = await service.listKnowledgeBasesForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            permissions: ['knowledge_base.manage_all'],
        });

        expect(prisma.knowledgeBaseMember.findMany).not.toHaveBeenCalled();
        expect(result).toEqual([expect.objectContaining({
            id: KNOWLEDGE_BASE_ID, myPermission: 'MANAGER', retrievable: true,
        })]);
    });

    it('labels every candidate READER for the assistant when read_all shortcuts', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findMany.mockResolvedValue([knowledgeBaseRecord()]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read_all']);

        const result = await service.listKnowledgeBasesForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            permissions: ['knowledge_base.read_all'],
        });

        expect(prisma.knowledgeBaseMember.findMany).not.toHaveBeenCalled();
        expect(result).toEqual([expect.objectContaining({
            id: KNOWLEDGE_BASE_ID, myPermission: 'READER', retrievable: true,
        })]);
    });

    it('lets anchor readers open a TENANT-scoped knowledge base detail', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst
            .mockResolvedValueOnce(knowledgeBaseRecord({ visibilityScope: 'TENANT' }))
            .mockResolvedValueOnce({ visibilityScope: 'TENANT', departmentId: null, projectId: null });
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue(null);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read']);

        const result = await service.getKnowledgeBase(KNOWLEDGE_BASE_ID);

        expect(result).toEqual(expect.objectContaining({ id: KNOWLEDGE_BASE_ID, visibilityScope: 'TENANT', memberCount: 1, myPermission: 'READER' }));
    });

    it('audits visibility scope changes when updating a knowledge base anchor', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst
            .mockResolvedValueOnce(knowledgeBaseRecord({ visibilityScope: 'PRIVATE' }))
            .mockResolvedValueOnce(knowledgeBaseRecord({ visibilityScope: 'TENANT' }));
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'MANAGER' });
        prisma.knowledgeBase.updateMany.mockResolvedValue({ count: 1 });
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read']);

        await service.updateKnowledgeBase(KNOWLEDGE_BASE_ID, { visibilityScope: 'TENANT', version: 1 });

        expect(prisma.knowledgeBase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ visibilityScope: 'TENANT', departmentId: null, projectId: null }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KNOWLEDGE_BASE_UPDATED',
                metadata: {
                    before: expect.objectContaining({ visibilityScope: 'PRIVATE', departmentId: null, projectId: null }),
                    after: expect.objectContaining({ visibilityScope: 'TENANT', departmentId: null, projectId: null }),
                },
            }),
        });
    });

    it('rejects an update with a stale version', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'MANAGER' });
        prisma.knowledgeBase.updateMany.mockResolvedValue({ count: 0 });
        const service = createService(prisma, ['knowledge_base.read']);

        await expect(service.updateKnowledgeBase(KNOWLEDGE_BASE_ID, { name: '新名称', version: 99 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'RESOURCE_VERSION_CONFLICT' }) });
    });

    it('rejects a member from another tenant before creating the relation', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'MANAGER' });
        prisma.tenantMembership.findFirst.mockResolvedValue(null);
        const service = createService(prisma, ['knowledge_base.read']);

        await expect(service.addMember(KNOWLEDGE_BASE_ID, {
            membershipId: OTHER_MEMBERSHIP_ID,
            permission: 'READER',
        })).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.knowledgeBaseMember.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate knowledge base members', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'MANAGER' });
        prisma.tenantMembership.findFirst.mockResolvedValue(membershipRecord({ id: OTHER_MEMBERSHIP_ID, userId: OTHER_USER_ID }));
        prisma.knowledgeBaseMember.create.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.19.3' }),
        );
        const service = createService(prisma, ['knowledge_base.read']);

        await expect(service.addMember(KNOWLEDGE_BASE_ID, {
            membershipId: OTHER_MEMBERSHIP_ID,
            permission: 'EDITOR',
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_MEMBER_EXISTS' }) });
    });

    it('does not allow lowering the creator below MANAGER', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique
            .mockResolvedValueOnce({ permission: 'MANAGER' })
            .mockResolvedValueOnce(knowledgeBaseMemberRecord());
        prisma.tenantMembership.findFirst.mockResolvedValue(membershipRecord());
        const service = createService(prisma, ['knowledge_base.read']);

        await expect(service.updateMember(KNOWLEDGE_BASE_ID, CURRENT_MEMBERSHIP_ID, { permission: 'READER' }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_OWNER_REQUIRED' }) });
    });

    it('does not remove the last MANAGER', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue(knowledgeBaseMemberRecord({
            userId: OTHER_USER_ID,
            permission: 'MANAGER',
        }));
        prisma.tenantMembership.findFirst.mockResolvedValue(membershipRecord({ userId: OTHER_USER_ID }));
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.read']);

        await expect(service.removeMember(KNOWLEDGE_BASE_ID, OTHER_MEMBERSHIP_ID))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_LAST_MANAGER' }) });
        expect(prisma.knowledgeBaseMember.delete).not.toHaveBeenCalled();
    });

    it('soft deletes a knowledge base with the current version', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'MANAGER' });
        prisma.knowledgeBase.updateMany.mockResolvedValue({ count: 1 });
        const deleteIndexesSpy = jest.fn().mockResolvedValue(undefined);
        const service = createService(
            prisma,
            ['knowledge_base.read'],
            undefined,
            { deleteKnowledgeBaseIndexes: deleteIndexesSpy },
        );

        await service.deleteKnowledgeBase(KNOWLEDGE_BASE_ID, { version: 1 });

        expect(prisma.knowledgeBase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, version: 1, deletedAt: null }),
            data: expect.objectContaining({ updatedBy: USER_ID, deletedAt: expect.any(Date) }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'KNOWLEDGE_BASE_DELETED' }),
        });
        expect(deleteIndexesSpy).toHaveBeenCalledWith(TENANT_ID, USER_ID, KNOWLEDGE_BASE_ID);
    });

    it('rejects AI queries for anchor readers who are not real members', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord({ visibilityScope: 'TENANT' }));
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue(null);
        const gateway = { answerKnowledge: jest.fn() };
        const service = createService(prisma, ['knowledge_base.query'], gateway);

        await expect(service.queryKnowledgeBase(KNOWLEDGE_BASE_ID, { query: '问题' }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_NOT_FOUND' }) });
        expect(gateway.answerKnowledge).not.toHaveBeenCalled();
    });

    it('queries a knowledge base with folded scope and records the query log', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'READER' });
        prisma.tenantMembership.findFirst.mockResolvedValue({ departmentId: 'dept-root' });
        prisma.department.findMany.mockResolvedValue([
            { id: 'dept-root', parentId: null },
            { id: 'dept-child', parentId: 'dept-root' },
            { id: 'dept-other', parentId: null },
        ]);
        prisma.projectMember.findMany.mockResolvedValue([{ projectId: 'project-1' }]);
        const gateway = { answerKnowledge: jest.fn().mockResolvedValue(answerResponse()) };
        const service = createService(prisma, ['knowledge_base.query'], gateway);

        const result = await service.queryKnowledgeBase(KNOWLEDGE_BASE_ID, { query: '项目延期怎么处理' });

        expect(result).toEqual({
            answer: '延期超过两周需要升级到项目委员会。',
            grounded: true,
            insufficientEvidence: false,
            citations: [{
                citationId: 'S1',
                documentId: 'doc-1',
                documentVersionId: 'docv-1',
                chunkId: 'chunk-1',
                text: '项目延期超过两周时需要升级到项目委员会。',
                score: 0.92,
                pageIndex: 3,
                bbox: null,
            }],
        });
        expect(gateway.answerKnowledge).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: TENANT_ID,
            user_id: USER_ID,
            query: '项目延期怎么处理',
            scope: {
                knowledge_base_ids: [KNOWLEDGE_BASE_ID],
                department_ids: ['dept-root', 'dept-child'],
                project_ids: ['project-1'],
            },
            index_version: 'knowledge-index-v1',
        }));
        expect(prisma.knowledgeQueryLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                userId: USER_ID,
                query: '项目延期怎么处理',
                grounded: true,
                latencyMs: 1234,
                inputTokens: 500,
                outputTokens: 120,
                totalTokens: 620,
                requestId: 'request-id',
            }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'KNOWLEDGE_BASE_QUERIED' }),
        });
    });

    it('folds an empty allowlist for members without department or project', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'READER' });
        prisma.tenantMembership.findFirst.mockResolvedValue({ departmentId: null });
        prisma.projectMember.findMany.mockResolvedValue([]);
        const gateway = { answerKnowledge: jest.fn().mockResolvedValue(answerResponse({ answer: '', grounded: false, insufficient_evidence: true, citations: [] })) };
        const service = createService(prisma, ['knowledge_base.query'], gateway);

        await service.queryKnowledgeBase(KNOWLEDGE_BASE_ID, { query: '无关问题' });

        expect(gateway.answerKnowledge).toHaveBeenCalledWith(expect.objectContaining({
            scope: {
                knowledge_base_ids: [KNOWLEDGE_BASE_ID],
                department_ids: [],
                project_ids: [],
            },
        }));
        expect(prisma.department.findMany).not.toHaveBeenCalled();
    });

    it('maps ai-service failures to 503 with a failure audit', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'READER' });
        prisma.tenantMembership.findFirst.mockResolvedValue({ departmentId: null });
        prisma.projectMember.findMany.mockResolvedValue([]);
        const gateway = {
            answerKnowledge: jest.fn().mockRejectedValue(new AiServiceInvocationError('AI_SERVICE_UNAVAILABLE', 'down', true, 503)),
        };
        const service = createService(prisma, ['knowledge_base.query'], gateway);

        await expect(service.queryKnowledgeBase(KNOWLEDGE_BASE_ID, { query: '问题' }))
            .rejects.toMatchObject({
                status: 503,
                response: expect.objectContaining({ code: 'KNOWLEDGE_QUERY_SERVICE_UNAVAILABLE' }),
            });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KNOWLEDGE_BASE_QUERIED',
                outcome: 'FAILURE',
                metadata: { errorCode: 'AI_SERVICE_UNAVAILABLE' },
            }),
        });
        expect(prisma.knowledgeQueryLog.create).not.toHaveBeenCalled();
    });

    it('searches all visible knowledge bases for the assistant with folded scope and backfills document titles', async () => {
        const prisma = createPrismaMock();
        // 第一次 findMany：可见库列表；第二次 findMany：用户 EDITOR 及以上可删库列表。
        prisma.knowledgeBaseMember.findMany
            .mockResolvedValueOnce([
                { knowledgeBaseId: KNOWLEDGE_BASE_ID },
                { knowledgeBaseId: OTHER_KNOWLEDGE_BASE_ID },
            ])
            .mockResolvedValueOnce([{ knowledgeBaseId: KNOWLEDGE_BASE_ID, permission: 'EDITOR' }]);
        prisma.tenantMembership.findFirst.mockResolvedValue({ departmentId: 'dept-root' });
        prisma.department.findMany.mockResolvedValue([
            { id: 'dept-root', parentId: null },
            { id: 'dept-child', parentId: 'dept-root' },
        ]);
        prisma.projectMember.findMany.mockResolvedValue([{ projectId: 'project-1' }]);
        prisma.knowledgeDocument.findMany.mockResolvedValue([{ id: 'doc-1', name: '项目延期管理制度', knowledgeBaseId: KNOWLEDGE_BASE_ID }]);
        const gateway = { answerKnowledge: jest.fn().mockResolvedValue(answerResponse()) };
        const service = createService(prisma, ['knowledge_base.query'], gateway);

        const result = await service.searchKnowledgeForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            permissions: ['knowledge_base.query'],
            requestId: 'request-id',
            query: '项目延期怎么处理',
        });

        expect(result).toEqual({
            answer: '延期超过两周需要升级到项目委员会。',
            grounded: true,
            insufficientEvidence: false,
            citations: [{
                id: 'doc-1',
                title: '项目延期管理制度',
                snippet: '项目延期超过两周时需要升级到项目委员会。',
                pageIndex: 3,
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                deletable: true,
            }],
            searchedKnowledgeBaseIds: [KNOWLEDGE_BASE_ID, OTHER_KNOWLEDGE_BASE_ID],
        });
        expect(gateway.answerKnowledge).toHaveBeenCalledWith(expect.objectContaining({
            scope: {
                knowledge_base_ids: [KNOWLEDGE_BASE_ID, OTHER_KNOWLEDGE_BASE_ID],
                department_ids: ['dept-root', 'dept-child'],
                project_ids: ['project-1'],
            },
        }));
        // 多库检索日志的知识库 ID 为空，审计记录实际检索范围。
        expect(prisma.knowledgeQueryLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                knowledgeBaseId: null,
                query: '项目延期怎么处理',
            }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'KNOWLEDGE_BASE_QUERIED',
                resourceId: null,
                metadata: expect.objectContaining({
                    knowledgeBaseIds: [KNOWLEDGE_BASE_ID, OTHER_KNOWLEDGE_BASE_ID],
                }),
            }),
        });
    });

    it('short-circuits to all tenant knowledge bases for manage_all members', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findMany.mockResolvedValue([
            knowledgeBaseRecord(),
            knowledgeBaseRecord({ id: OTHER_KNOWLEDGE_BASE_ID }),
        ]);
        prisma.tenantMembership.findFirst.mockResolvedValue({ departmentId: null });
        prisma.projectMember.findMany.mockResolvedValue([]);
        prisma.knowledgeDocument.findMany.mockResolvedValue([]);
        const gateway = { answerKnowledge: jest.fn().mockResolvedValue(answerResponse({ citations: [] })) };
        const service = createService(prisma, ['knowledge_base.manage_all'], gateway);

        const result = await service.searchKnowledgeForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            permissions: ['knowledge_base.manage_all'],
            requestId: 'request-id',
            query: '问题',
        });

        expect(prisma.knowledgeBaseMember.findMany).not.toHaveBeenCalled();
        expect(gateway.answerKnowledge).toHaveBeenCalledWith(expect.objectContaining({
            scope: expect.objectContaining({
                knowledge_base_ids: [KNOWLEDGE_BASE_ID, OTHER_KNOWLEDGE_BASE_ID],
            }),
        }));
        expect(result.citations).toEqual([]);
    });

    it('returns an empty evidence result without calling ai-service when no knowledge base is visible', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBaseMember.findMany.mockResolvedValue([]);
        const gateway = { answerKnowledge: jest.fn() };
        const service = createService(prisma, ['knowledge_base.query'], gateway);

        const result = await service.searchKnowledgeForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            permissions: ['knowledge_base.query'],
            requestId: 'request-id',
            query: '问题',
        });

        expect(result).toEqual({
            answer: '',
            grounded: false,
            insufficientEvidence: true,
            citations: [],
            searchedKnowledgeBaseIds: [],
        });
        expect(gateway.answerKnowledge).not.toHaveBeenCalled();
        expect(prisma.knowledgeQueryLog.create).not.toHaveBeenCalled();
    });

    it('lists knowledge documents within the real member knowledge bases', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBaseMember.findMany.mockResolvedValue([{ knowledgeBaseId: KNOWLEDGE_BASE_ID }]);
        prisma.knowledgeBase.findMany.mockResolvedValue([{ id: KNOWLEDGE_BASE_ID, name: '自用' }]);
        prisma.knowledgeDocument.findMany.mockResolvedValue([
            {
                id: '70000000-0000-0000-0000-000000000001',
                name: '李悦.txt',
                status: 'READY',
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                updatedAt: new Date('2026-09-23T08:19:27.285Z'),
            },
        ]);
        const service = createService(prisma, ['knowledge_base.read']);

        const result = await service.listKnowledgeDocumentsForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            permissions: ['knowledge_base.read'],
            limit: 20,
        });

        expect(result).toEqual([{
            documentId: '70000000-0000-0000-0000-000000000001',
            name: '李悦.txt',
            status: 'READY',
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            knowledgeBaseName: '自用',
            updatedAt: '2026-09-23T08:19:27.285Z',
        }]);
        // 只查真实成员库：锚点虚拟 READER 库不进清单，避免「列得出来、检索不到」。
        expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: { in: [KNOWLEDGE_BASE_ID] } }),
        }));
    });

    it('short-circuits the document list to all tenant knowledge bases for manage_all members', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findMany
            .mockResolvedValueOnce([{ id: KNOWLEDGE_BASE_ID }, { id: OTHER_KNOWLEDGE_BASE_ID }])
            .mockResolvedValueOnce([
                { id: KNOWLEDGE_BASE_ID, name: '产品知识库' },
                { id: OTHER_KNOWLEDGE_BASE_ID, name: '自用' },
            ]);
        prisma.knowledgeDocument.findMany.mockResolvedValue([]);
        const service = createService(prisma, ['knowledge_base.manage_all']);

        const result = await service.listKnowledgeDocumentsForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            permissions: ['knowledge_base.manage_all'],
            limit: 20,
        });

        expect(result).toEqual([]);
        expect(prisma.knowledgeBaseMember.findMany).not.toHaveBeenCalled();
        expect(prisma.knowledgeDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                knowledgeBaseId: { in: [KNOWLEDGE_BASE_ID, OTHER_KNOWLEDGE_BASE_ID] },
            }),
        }));
    });

    it('does not query documents when the requested knowledge base name matches nothing', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBaseMember.findMany.mockResolvedValue([{ knowledgeBaseId: KNOWLEDGE_BASE_ID }]);
        prisma.knowledgeBase.findMany.mockResolvedValue([{ id: KNOWLEDGE_BASE_ID, name: '自用' }]);
        const service = createService(prisma, ['knowledge_base.read']);

        const result = await service.listKnowledgeDocumentsForAssistant({
            tenantId: TENANT_ID,
            userId: USER_ID,
            permissions: ['knowledge_base.read'],
            knowledgeBaseName: '不存在的库',
            limit: 20,
        });

        expect(result).toEqual([]);
        expect(prisma.knowledgeDocument.findMany).not.toHaveBeenCalled();
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const OTHER_USER_ID = '10000000-0000-0000-0000-000000000003';
const CURRENT_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000001';
const OTHER_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000002';
const KNOWLEDGE_BASE_ID = '30000000-0000-0000-0000-000000000001';
const OTHER_KNOWLEDGE_BASE_ID = '30000000-0000-0000-0000-000000000002';
const KNOWLEDGE_BASE_MEMBER_ID = '40000000-0000-0000-0000-000000000001';

function createService(
    prisma: Record<string, any>,
    permissions: string[],
    gateway?: Record<string, any>,
    indexingService?: Record<string, any>,
): KnowledgeService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: ['tenant_admin'],
            permissions,
        }),
    } as unknown as TenantContext;
    const effectiveGateway = (gateway ?? { answerKnowledge: jest.fn() }) as unknown as AiServiceGateway;
    const effectiveIndexingService = (
        indexingService ?? { deleteKnowledgeBaseIndexes: jest.fn() }
    ) as unknown as KnowledgeIndexingService;
    return new KnowledgeService(
        prisma as unknown as PrismaService,
        tenantContext,
        effectiveGateway,
        effectiveIndexingService,
    );
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        knowledgeBase: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
        },
        knowledgeBaseMember: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
        },
        tenantMembership: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
        department: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        project: { findFirst: jest.fn() },
        projectMember: { findMany: jest.fn().mockResolvedValue([]) },
        knowledgeDocument: { findMany: jest.fn() },
        knowledgeQueryLog: { create: jest.fn() },
        auditLog: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function knowledgeBaseRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: KNOWLEDGE_BASE_ID,
        tenantId: TENANT_ID,
        name: '产品知识库',
        description: '产品资料',
        visibilityScope: 'PRIVATE',
        departmentId: null,
        projectId: null,
        createdBy: USER_ID,
        updatedBy: USER_ID,
        version: 1,
        createdAt: new Date('2026-09-14T00:00:00.000Z'),
        updatedAt: new Date('2026-09-14T00:00:00.000Z'),
        ...overrides,
    };
}

function knowledgeBaseMemberRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: KNOWLEDGE_BASE_MEMBER_ID,
        tenantId: TENANT_ID,
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        userId: USER_ID,
        permission: 'MANAGER',
        createdAt: new Date('2026-09-14T00:00:00.000Z'),
        ...overrides,
    };
}

function answerResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        request_id: 'request-id',
        answer: '延期超过两周需要升级到项目委员会。',
        grounded: true,
        insufficient_evidence: false,
        citations: [{
            citation_id: 'S1',
            document_id: 'doc-1',
            document_version_id: 'docv-1',
            chunk_id: 'chunk-1',
            text: '项目延期超过两周时需要升级到项目委员会。',
            score: 0.92,
            page_index: 3,
            bbox: null,
        }],
        execution: {
            profile: 'rag',
            provider: 'mock',
            model: 'mock-model',
            fallback_count: 0,
            latency_ms: 1234,
            token_usage: { input_tokens: 500, output_tokens: 120, total_tokens: 620 },
        },
        index_version: 'knowledge-index-v1',
        embedding_profile: 'deterministic',
        ...overrides,
    };
}

function membershipRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: CURRENT_MEMBERSHIP_ID,
        userId: USER_ID,
        account: 'zhangsan',
        displayName: '张三',
        user: { displayName: '张三', status: 'ACTIVE', deletedAt: null },
        ...overrides,
    };
}
