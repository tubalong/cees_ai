import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProjectDecisionStatus, ProjectMemberRole, ProjectMilestoneStatus, ProjectStatus, TaskStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { ProjectWorkflowService } from './project-workflow.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000001';
const OTHER_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000002';
const PROJECT_ID = '30000000-0000-0000-0000-000000000001';
const DECISION_ID = '40000000-0000-0000-0000-000000000001';
const MILESTONE_ID = '50000000-0000-0000-0000-000000000001';

describe('ProjectWorkflowService', () => {
    it('rejects milestone creation for ordinary project members', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess(ProjectMemberRole.MEMBER));
        const service = createService(prisma);
        await expect(service.createMilestone(PROJECT_ID, milestoneInput())).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.projectMilestone.create).not.toHaveBeenCalled();
    });

    it('allows a project member to create a decision draft and writes activity and audit', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess(ProjectMemberRole.MEMBER));
        prisma.projectDecision.create.mockResolvedValue({ id: DECISION_ID });
        prisma.projectDecision.findFirst.mockResolvedValue(decisionRecord());
        const service = createService(prisma);
        const result = await service.createDecision(PROJECT_ID, { title: '技术选型', problem: '选择 SSE 还是 WebSocket', risks: [], nextActions: [], participantMembershipIds: [] });
        expect(result.status).toBe(ProjectDecisionStatus.DRAFT);
        expect(prisma.projectActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'DECISION_CREATED' }) }));
        expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('computes overdue milestone health from the target date and task state', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess(ProjectMemberRole.OWNER));
        prisma.projectMilestone.findMany.mockResolvedValue([milestoneRecord({ targetDate: new Date('2026-09-20T00:00:00.000Z'), taskLinks: [{ required: true, task: { id: '60000000-0000-0000-0000-000000000001', title: '未完成任务', status: TaskStatus.IN_PROGRESS } }] })]);
        const result = await createService(prisma).listMilestones(PROJECT_ID);
        expect(result[0]).toMatchObject({ overdue: true, health: 'OVERDUE', progressPercent: 0 });
    });

    it('rejects repository URLs containing credentials', async () => {
        const prisma = createPrismaMock();
        prisma.project.findFirst.mockResolvedValue(projectAccess(ProjectMemberRole.OWNER));
        const service = createService(prisma);
        await expect(service.createRepository(PROJECT_ID, { url: 'https://user:password@github.com/acme/repo', defaultBranch: 'main' })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.projectRepository.create).not.toHaveBeenCalled();
    });
});

function createService(prisma: Record<string, any>): ProjectWorkflowService {
    const context = { require: jest.fn().mockReturnValue({ tenantId: TENANT_ID, userId: USER_ID, membershipId: MEMBERSHIP_ID, requestId: 'request', permissions: [] }) } as unknown as TenantContext;
    return new ProjectWorkflowService(prisma as unknown as PrismaService, context);
}
function projectAccess(role: ProjectMemberRole): Record<string, unknown> {
    return { id: PROJECT_ID, status: ProjectStatus.ACTIVE, ownerMembershipId: MEMBERSHIP_ID, tenant: { timezone: 'Asia/Shanghai' }, members: [{ membershipId: MEMBERSHIP_ID, role, membership: member(MEMBERSHIP_ID) }] };
}
function member(id: string): Record<string, unknown> { return { id, account: `${id.slice(0, 4)}@example.com`, displayName: '测试成员', user: { displayName: '测试成员' } }; }
function decisionRecord(): Record<string, unknown> {
    return { id: DECISION_ID, projectId: PROJECT_ID, title: '技术选型', problem: '选择 SSE 还是 WebSocket', background: null, recommendation: null, conclusion: null, rationale: null, risks: [], nextActions: [], participantMembershipIds: [], status: ProjectDecisionStatus.DRAFT, sourceConversationId: null, publishedAt: null, publishedByMembership: null, createdByMembership: member(MEMBERSHIP_ID), createdAt: new Date(), updatedAt: new Date(), version: 1 };
}
function milestoneRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: MILESTONE_ID, projectId: PROJECT_ID, title: '核心联调', objective: '闭环', targetDate: new Date('2026-10-04T00:00:00.000Z'), ownerMembership: member(MEMBERSHIP_ID), acceptanceCriteria: ['闭环'], acceptanceNote: null, status: ProjectMilestoneStatus.IN_PROGRESS, startedAt: null, acceptanceStartedAt: null, completedAt: null, cancelledAt: null, cancellationReason: null, taskLinks: [], decisionLinks: [], createdAt: new Date(), updatedAt: new Date(), version: 1, ...overrides };
}
function milestoneInput(): any { return { title: '核心联调', objective: '完成闭环', targetDate: '2026-10-04', ownerMembershipId: MEMBERSHIP_ID, acceptanceCriteria: ['闭环'], taskIds: [], decisionIds: [] }; }
function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        project: { findFirst: jest.fn() }, projectMember: { findMany: jest.fn(), findFirst: jest.fn() }, task: { findMany: jest.fn() },
        projectDecision: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
        projectMilestone: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
        projectMilestoneTask: { createMany: jest.fn(), deleteMany: jest.fn() }, projectMilestoneDecision: { createMany: jest.fn(), deleteMany: jest.fn() },
        projectRepository: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
        projectActivity: { create: jest.fn(), findMany: jest.fn() }, auditLog: { create: jest.fn() }, conversation: { findFirst: jest.fn() },
        $queryRaw: jest.fn().mockResolvedValue([]), $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}
