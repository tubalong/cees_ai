import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AssistantEventType, DraftStatus, ToolCallStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { isActiveMembership, resolveMembershipAuthorization } from '../../rbac/authorization-resolver';
import { TenantContext } from '../../tenant/tenant-context';
import { EventService } from '../conversation/event.service';
import { ToolPolicyService } from '../tools/tool-policy.service';
import { ToolRegistryService } from '../tools/tool-registry';
import { ACTION_DRAFT_TTL_MS, AssistantActionDraftService } from './assistant-action-draft.service';

jest.mock('../../rbac/authorization-resolver', () => ({
    isActiveMembership: jest.fn(),
    resolveMembershipAuthorization: jest.fn(),
}));

const mockedIsActiveMembership = jest.mocked(isActiveMembership);
const mockedResolveAuthorization = jest.mocked(resolveMembershipAuthorization);

const TENANT_ID = '1e1c1f0e-0000-4000-8000-000000000001';
const DRAFT_ID = '2e1c1f0e-0000-4000-8000-000000000002';
const TOOL_CALL_ID = '3e1c1f0e-0000-4000-8000-000000000003';
const TURN_ID = '4e1c1f0e-0000-4000-8000-000000000004';

interface Harness {
    service: AssistantActionDraftService;
    prisma: {
        assistantActionDraft: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
        toolCall: { updateMany: jest.Mock };
        conversationMessage: { create: jest.Mock };
        auditLog: { create: jest.Mock };
        $transaction: jest.Mock;
    };
    registry: ToolRegistryService;
    execute: jest.Mock;
    appendInTransaction: jest.Mock;
}

function createHarness(): Harness {
    const prisma = {
        assistantActionDraft: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
        toolCall: { updateMany: jest.fn() },
        conversationMessage: { create: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => callback(prisma));

    const registry = new ToolRegistryService();
    const execute = jest.fn(async () => ({ resourceType: null, resourceId: null, summary: '部门「华东销售部」已创建。' }));
    registry.register({
        name: 'create_department',
        version: '1.0.0',
        displayName: '新建部门',
        description: '测试用工具',
        parameters: { type: 'object' },
        requiredPermissions: ['department.create'],
        riskLevel: 'WRITE',
        validate: (input) => input as Record<string, unknown>,
        execute,
    });

    const tenantContext = { require: () => ({ tenantId: TENANT_ID, userId: 'u-1', membershipId: 'm-1', requestId: 'r-1', roles: [], permissions: ['department.create'] }) } as unknown as TenantContext;
    const eventService = { appendInTransaction: jest.fn() } as unknown as EventService;

    return {
        service: new AssistantActionDraftService(prisma as unknown as PrismaService, tenantContext, registry, new ToolPolicyService(registry), eventService),
        prisma,
        registry,
        execute,
        appendInTransaction: (eventService as unknown as { appendInTransaction: jest.Mock }).appendInTransaction,
    };
}

function pendingDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: DRAFT_ID,
        tenantId: TENANT_ID,
        conversationId: 'c-1',
        turnId: TURN_ID,
        membershipId: 'm-1',
        userId: 'u-1',
        requestId: 'r-1',
        toolCallId: TOOL_CALL_ID,
        toolName: 'create_department',
        toolVersion: '1.0.0',
        riskLevel: 'WRITE',
        arguments: { name: '华东销售部' },
        preview: { title: '新建部门', fields: [] },
        status: DraftStatus.PENDING_CONFIRMATION,
        expiresAt: new Date(Date.now() + 60_000),
        ...overrides,
    };
}

describe('AssistantActionDraftService', () => {
    let harness: Harness;

    beforeEach(() => {
        harness = createHarness();
        mockedIsActiveMembership.mockReset().mockResolvedValue(true);
        mockedResolveAuthorization.mockReset().mockResolvedValue({ roles: ['tenant_admin'], permissions: ['department.create'] });
    });

    describe('createDraft', () => {
        it('stores the normalized arguments snapshot with a TTL and returns the preview id', async () => {
            harness.prisma.assistantActionDraft.create.mockImplementation(async (input: { data: { expiresAt: Date } }) => ({
                id: DRAFT_ID,
                expiresAt: input.data.expiresAt,
            }));
            const before = Date.now();
            const result = await harness.service.createDraft({
                tenantId: TENANT_ID, conversationId: 'c-1', turnId: TURN_ID, membershipId: 'm-1', userId: 'u-1',
                requestId: 'r-1', toolCallId: TOOL_CALL_ID, toolName: 'create_department', toolVersion: '1.0.0',
                riskLevel: 'WRITE', arguments: { name: '华东销售部' },
                confirmation: { title: '新建部门', fields: [{ label: '部门名称', value: '华东销售部' }], summary: '已生成待确认草稿' },
            });
            expect(result.draftId).toEqual(DRAFT_ID);
            expect(result.expiresAt.getTime() - before).toBeGreaterThanOrEqual(ACTION_DRAFT_TTL_MS - 1000);
            // 草稿始终从 PENDING_CONFIRMATION 开始，确认前不可能被执行。
            const created = harness.prisma.assistantActionDraft.create.mock.calls[0][0] as { data: Record<string, unknown> };
            expect(created.data).not.toHaveProperty('status');
            expect(created.data.arguments).toEqual({ name: '华东销售部' });
            expect(created.data.preview).toEqual({ title: '新建部门', fields: [{ label: '部门名称', value: '华东销售部' }] });
        });
    });

    describe('confirm', () => {
        it('hides drafts that do not belong to the caller as 404', async () => {
            harness.prisma.assistantActionDraft.findFirst.mockResolvedValue(null);
            await expect(harness.service.confirm(DRAFT_ID)).rejects.toBeInstanceOf(NotFoundException);
            expect(harness.execute).not.toHaveBeenCalled();
        });

        it('refuses an expired draft instead of executing a stale snapshot', async () => {
            harness.prisma.assistantActionDraft.findFirst.mockResolvedValue(pendingDraft({ expiresAt: new Date(Date.now() - 1000) }));
            await expect(harness.service.confirm(DRAFT_ID)).rejects.toBeInstanceOf(ConflictException);
            expect(harness.execute).not.toHaveBeenCalled();
        });

        it('refuses a draft that is already resolved', async () => {
            harness.prisma.assistantActionDraft.findFirst.mockResolvedValue(pendingDraft({ status: DraftStatus.EXECUTED }));
            await expect(harness.service.confirm(DRAFT_ID)).rejects.toBeInstanceOf(ConflictException);
            expect(harness.execute).not.toHaveBeenCalled();
        });

        it('is idempotent: when another request already claimed the draft it fails with 409 and never executes twice', async () => {
            harness.prisma.assistantActionDraft.findFirst.mockResolvedValue(pendingDraft());
            harness.prisma.assistantActionDraft.updateMany.mockResolvedValue({ count: 0 });
            await expect(harness.service.confirm(DRAFT_ID)).rejects.toBeInstanceOf(ConflictException);
            expect(harness.execute).not.toHaveBeenCalled();
        });

        it('re-checks permissions at confirmation time and rejects when the permission was revoked', async () => {
            harness.prisma.assistantActionDraft.findFirst.mockResolvedValue(pendingDraft());
            mockedResolveAuthorization.mockResolvedValue({ roles: [], permissions: [] });

            await expect(harness.service.confirm(DRAFT_ID)).rejects.toBeInstanceOf(ForbiddenException);
            expect(harness.execute).not.toHaveBeenCalled();
            // 被回收权限的草稿会被就地置为 REJECTED，不会悬在待确认状态。
            const rejected = harness.prisma.assistantActionDraft.updateMany.mock.calls[0][0] as { data: { status: string } };
            expect(rejected.data.status).toEqual(DraftStatus.REJECTED);
        });

        it('refuses to execute when the membership was disabled while the draft was pending', async () => {
            harness.prisma.assistantActionDraft.findFirst.mockResolvedValue(pendingDraft());
            mockedIsActiveMembership.mockResolvedValue(false);
            await expect(harness.service.confirm(DRAFT_ID)).rejects.toBeInstanceOf(ForbiddenException);
            expect(harness.execute).not.toHaveBeenCalled();
        });

        it('claims the draft, executes the tool and settles tool call, message, audit and event in one transaction', async () => {
            harness.prisma.assistantActionDraft.findFirst.mockResolvedValue(pendingDraft());
            harness.prisma.assistantActionDraft.updateMany.mockResolvedValue({ count: 1 });
            harness.prisma.toolCall.updateMany.mockResolvedValue({ count: 1 });
            harness.prisma.conversationMessage.create.mockResolvedValue({});
            harness.prisma.auditLog.create.mockResolvedValue({});

            const result = await harness.service.confirm(DRAFT_ID);

            expect(result).toEqual({
                draftId: DRAFT_ID,
                status: 'EXECUTED',
                summary: '部门「华东销售部」已创建。',
                resource: null,
            });
            // 抢占：PENDING_CONFIRMATION → CONFIRMED 的条件更新必须带上过期时间兜底。
            const claim = harness.prisma.assistantActionDraft.updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: { status: string } };
            expect(claim.where).toEqual(expect.objectContaining({ id: DRAFT_ID, status: DraftStatus.PENDING_CONFIRMATION }));
            expect(claim.data.status).toEqual(DraftStatus.CONFIRMED);

            // 执行只信任草稿快照里的参数，客户端无法在确认时替换。
            expect(harness.execute).toHaveBeenCalledWith(
                expect.objectContaining({ tenantId: TENANT_ID, toolCallId: TOOL_CALL_ID, executionToken: DRAFT_ID }),
                { name: '华东销售部' },
            );

            const toolCallUpdate = harness.prisma.toolCall.updateMany.mock.calls[0][0] as { where: { status: string }; data: { status: string } };
            expect(toolCallUpdate.where.status).toEqual(ToolCallStatus.AWAITING_CONFIRMATION);
            expect(toolCallUpdate.data.status).toEqual(ToolCallStatus.COMPLETED);

            const audit = harness.prisma.auditLog.create.mock.calls[0][0] as { data: { action: string; metadata: Record<string, unknown> } };
            expect(audit.data.action).toEqual('ASSISTANT_ACTION_DRAFT_EXECUTED');
            // 审计元数据只记工具与资源标识，不落参数快照（可能含业务敏感信息）。
            expect(audit.data.metadata).not.toHaveProperty('arguments');

            expect(harness.appendInTransaction).toHaveBeenCalledWith(
                expect.anything(), TURN_ID, TENANT_ID, AssistantEventType.TOOL_RESULT,
                expect.objectContaining({ type: 'tool_result', status: 'completed', error: null }),
            );
        });

        it('keeps internal tool data for the model but exposes only userSummary to the user', async () => {
            harness.prisma.assistantActionDraft.findFirst.mockResolvedValue(pendingDraft());
            harness.prisma.assistantActionDraft.updateMany.mockResolvedValue({ count: 1 });
            harness.prisma.toolCall.updateMany.mockResolvedValue({ count: 1 });
            harness.prisma.conversationMessage.create.mockResolvedValue({});
            harness.prisma.auditLog.create.mockResolvedValue({});
            const internalSummary = JSON.stringify({
                type: 'knowledge_base_created',
                knowledge_base_id: 'kb-secret',
                instruction: 'use MANAGER and save_to_knowledge',
            });
            harness.execute.mockResolvedValue({
                resourceType: null,
                resourceId: null,
                summary: internalSummary,
                userSummary: '知识库「产品知识库」已创建，你是该知识库的管理员。',
            });

            const result = await harness.service.confirm(DRAFT_ID);

            expect(result.summary).toBe('知识库「产品知识库」已创建，你是该知识库的管理员。');
            const toolCallUpdate = harness.prisma.toolCall.updateMany.mock.calls[0][0] as {
                data: { result: { summary: string } };
            };
            expect(toolCallUpdate.data.result.summary).toBe(internalSummary);
            const persistedMessages = harness.prisma.conversationMessage.create.mock.calls.map((call) => call[0] as {
                data: { role: string; content: string; toolCallId?: string };
            });
            const internalMessage = persistedMessages.find((message) => message.data.role === 'TOOL');
            expect(internalMessage?.data.content).toBe(internalSummary);
            expect(internalMessage?.data.toolCallId).toBe(TOOL_CALL_ID);
            const visibleMessage = persistedMessages.find((message) => message.data.role === 'ASSISTANT')!;
            expect(visibleMessage.data.content).toBe('知识库「产品知识库」已创建，你是该知识库的管理员。');
            expect(visibleMessage.data.content).not.toContain('knowledge_base_id');
            expect(visibleMessage.data.content).not.toContain('MANAGER');
            const draftUpdate = harness.prisma.assistantActionDraft.updateMany.mock.calls[1][0] as {
                data: { resultSummary: string };
            };
            expect(draftUpdate.data.resultSummary).toBe('知识库「产品知识库」已创建，你是该知识库的管理员。');
        });

        it('reports a failed execution with a safe summary and never leaks the raw error', async () => {
            harness.prisma.assistantActionDraft.findFirst.mockResolvedValue(pendingDraft());
            harness.prisma.assistantActionDraft.updateMany.mockResolvedValue({ count: 1 });
            harness.prisma.toolCall.updateMany.mockResolvedValue({ count: 1 });
            harness.prisma.conversationMessage.create.mockResolvedValue({});
            harness.prisma.auditLog.create.mockResolvedValue({});
            harness.execute.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

            const result = await harness.service.confirm(DRAFT_ID);

            expect(result.status).toEqual('FAILED');
            expect(result.summary).not.toContain('ECONNREFUSED');
            const draftUpdate = harness.prisma.assistantActionDraft.updateMany.mock.calls[1][0] as { data: { status: string; errorCode: string } };
            expect(draftUpdate.data.status).toEqual(DraftStatus.FAILED);
            expect(draftUpdate.data.errorCode).toEqual('ACTION_EXECUTION_FAILED');
        });

        it('executes the same draft only once across repeated confirmations', async () => {
            harness.prisma.assistantActionDraft.findFirst
                .mockResolvedValueOnce(pendingDraft())
                .mockResolvedValueOnce(pendingDraft({ status: DraftStatus.EXECUTED }));
            harness.prisma.assistantActionDraft.updateMany.mockResolvedValue({ count: 1 });
            harness.prisma.toolCall.updateMany.mockResolvedValue({ count: 1 });
            harness.prisma.conversationMessage.create.mockResolvedValue({});
            harness.prisma.auditLog.create.mockResolvedValue({});

            await harness.service.confirm(DRAFT_ID);
            await expect(harness.service.confirm(DRAFT_ID)).rejects.toBeInstanceOf(ConflictException);
            expect(harness.execute).toHaveBeenCalledTimes(1);
        });
    });

    describe('cancel', () => {
        it('marks the draft as rejected without executing the tool', async () => {
            harness.prisma.assistantActionDraft.findFirst.mockResolvedValue(pendingDraft());
            harness.prisma.assistantActionDraft.updateMany.mockResolvedValue({ count: 0 });
            harness.prisma.toolCall.updateMany.mockResolvedValue({ count: 1 });
            harness.prisma.conversationMessage.create.mockResolvedValue({});
            harness.prisma.auditLog.create.mockResolvedValue({});

            const result = await harness.service.cancel(DRAFT_ID);

            expect(result.status).toEqual('REJECTED');
            expect(harness.execute).not.toHaveBeenCalled();
            const audit = harness.prisma.auditLog.create.mock.calls[0][0] as { data: { action: string } };
            expect(audit.data.action).toEqual('ASSISTANT_ACTION_DRAFT_CANCELLED');
        });
    });

    describe('listPending', () => {
        it('returns only unexpired pending drafts of the current membership and no argument snapshot', async () => {
            harness.prisma.assistantActionDraft.findMany.mockResolvedValue([
                {
                    id: DRAFT_ID,
                    toolName: 'create_department',
                    preview: { title: '新建部门', fields: [{ label: '部门名称', value: '研发部' }] },
                    expiresAt: new Date('2026-09-24T09:00:00.000Z'),
                    conversationId: '50000000-0000-4000-8000-000000000005',
                    createdAt: new Date('2026-09-24T08:50:00.000Z'),
                },
            ]);

            const items = await harness.service.listPending();

            expect(items).toEqual([{
                draftId: DRAFT_ID,
                toolName: 'create_department',
                title: '新建部门',
                fields: [{ label: '部门名称', value: '研发部' }],
                expiresAt: new Date('2026-09-24T09:00:00.000Z'),
                conversationId: '50000000-0000-4000-8000-000000000005',
                createdAt: new Date('2026-09-24T08:50:00.000Z'),
            }]);
            // 只查本人、只查未决策、只查未过期：过期的待办不该出现在抽屉里误导用户。
            const query = harness.prisma.assistantActionDraft.findMany.mock.calls[0][0] as { where: Record<string, unknown>; select: Record<string, unknown> };
            expect(query.where).toEqual(expect.objectContaining({
                tenantId: TENANT_ID,
                membershipId: 'm-1',
                status: DraftStatus.PENDING_CONFIRMATION,
                expiresAt: { gt: expect.any(Date) },
            }));
            // 列表接口不返回参数快照，确认时仍以服务端快照为准。
            expect(query.select).not.toHaveProperty('arguments');
        });
    });
});
