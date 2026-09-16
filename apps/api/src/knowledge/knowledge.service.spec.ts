import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiServiceGateway, AiServiceInvocationError } from '../ai-orchestration/ai-service-gateway.service';
import { KnowledgeService } from './knowledge.service';
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

    it('allows manage_all members to list all tenant knowledge bases', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findMany.mockResolvedValue([knowledgeBaseRecord()]);
        prisma.knowledgeBaseMember.count.mockResolvedValue(1);
        const service = createService(prisma, ['knowledge_base.manage_all']);

        await service.listKnowledgeBases({ limit: 20 });

        expect(prisma.knowledgeBaseMember.findMany).not.toHaveBeenCalled();
        expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null, id: undefined }),
        }));
    });

    it('rejects an update with a stale version', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'MANAGER' });
        prisma.knowledgeBase.updateMany.mockResolvedValue({ count: 0 });
        const service = createService(prisma, ['knowledge_base.update']);

        await expect(service.updateKnowledgeBase(KNOWLEDGE_BASE_ID, { name: '新名称', version: 99 }))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'RESOURCE_VERSION_CONFLICT' }) });
    });

    it('rejects a member from another tenant before creating the relation', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'MANAGER' });
        prisma.tenantMembership.findFirst.mockResolvedValue(null);
        const service = createService(prisma, ['knowledge_base.member.manage']);

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
        const service = createService(prisma, ['knowledge_base.member.manage']);

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
        const service = createService(prisma, ['knowledge_base.member.manage']);

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
        const service = createService(prisma, ['knowledge_base.member.manage']);

        await expect(service.removeMember(KNOWLEDGE_BASE_ID, OTHER_MEMBERSHIP_ID))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'KNOWLEDGE_BASE_LAST_MANAGER' }) });
        expect(prisma.knowledgeBaseMember.delete).not.toHaveBeenCalled();
    });

    it('soft deletes a knowledge base with the current version', async () => {
        const prisma = createPrismaMock();
        prisma.knowledgeBase.findFirst.mockResolvedValue(knowledgeBaseRecord());
        prisma.knowledgeBaseMember.findUnique.mockResolvedValue({ permission: 'MANAGER' });
        prisma.knowledgeBase.updateMany.mockResolvedValue({ count: 1 });
        const service = createService(prisma, ['knowledge_base.delete']);

        await service.deleteKnowledgeBase(KNOWLEDGE_BASE_ID, { version: 1 });

        expect(prisma.knowledgeBase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: TENANT_ID, version: 1, deletedAt: null }),
            data: expect.objectContaining({ updatedBy: USER_ID, deletedAt: expect.any(Date) }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'KNOWLEDGE_BASE_DELETED' }),
        });
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
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const OTHER_USER_ID = '10000000-0000-0000-0000-000000000003';
const CURRENT_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000001';
const OTHER_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000002';
const KNOWLEDGE_BASE_ID = '30000000-0000-0000-0000-000000000001';
const KNOWLEDGE_BASE_MEMBER_ID = '40000000-0000-0000-0000-000000000001';

function createService(
    prisma: Record<string, any>,
    permissions: string[],
    gateway?: Record<string, any>,
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
    return new KnowledgeService(prisma as unknown as PrismaService, tenantContext, effectiveGateway);
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
        tenantMembership: { findFirst: jest.fn(), findMany: jest.fn() },
        department: { findMany: jest.fn() },
        projectMember: { findMany: jest.fn() },
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
