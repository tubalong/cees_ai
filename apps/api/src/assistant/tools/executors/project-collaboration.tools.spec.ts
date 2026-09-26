import { MembershipStatus, ProjectMemberRole, TaskPriority, TaskStatus } from '@prisma/client';
import { TenantContext } from '../../../tenant/tenant-context';
import { TenantService } from '../../../tenant/tenant.service';
import { OrganizationService } from '../../../organization/organization.service';
import { ProjectService } from '../../../project/project.service';
import { TaskService } from '../../../task/task.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolExecutionContext } from '../tool.types';
import { AddProjectMemberTool } from './add-project-member.tool';
import { AssignTaskTool } from './assign-task.tool';
import { ListTenantMembersTool } from './list-tenant-members.tool';

const PROJECT_ID = '2e1c1f0e-0000-4000-8000-000000000002';
const TASK_ID = '3e1c1f0e-0000-4000-8000-000000000003';
const MEMBER_ID = '4e1c1f0e-0000-4000-8000-000000000004';
const PROJECT_MEMBER_ID = '5e1c1f0e-0000-4000-8000-000000000005';

const context = {
    tenantId: '1e1c1f0e-0000-4000-8000-000000000001', userId: 'u-1', membershipId: 'm-1', requestId: 'r-1',
    conversationId: 'c-1', turnId: 't-1', toolCallId: 'tc-1', executionOwner: 'owner-1', executionToken: 'token-1',
    permissions: ['member.read', 'project.member.manage', 'task.assignee.manage'], roles: ['tenant_admin'],
    knowledgeBaseEnabled: false, webSearchEnabled: false,
} as ToolExecutionContext;

const confirmationContext = {
    tenantId: context.tenantId, userId: context.userId, membershipId: context.membershipId,
    requestId: context.requestId, turnId: context.turnId, permissions: context.permissions, roles: context.roles,
};

function member() {
    return { id: MEMBER_ID, account: 'linbo', user: { id: 'user-1', displayName: '林波' }, departmentId: 'dept-1', status: MembershipStatus.ACTIVE, roles: [], joinedAt: new Date(), version: 1 } as never;
}

function project() {
    return { id: PROJECT_ID, name: '官网改版', status: 'ACTIVE', owner: { displayName: '当前用户' }, version: 2 } as never;
}

function task() {
    return { id: TASK_ID, projectId: PROJECT_ID, title: '完成首页设计', status: TaskStatus.TODO, priority: TaskPriority.MEDIUM, version: 7, owner: { membershipId: 'old-owner', displayName: '旧负责人' }, collaborators: [{ membershipId: 'collaborator-1' }] } as never;
}

describe('project collaboration assistant tools', () => {
    it('registers member discovery and confirmed write tools with dedicated permissions', () => {
        const registry = new ToolRegistryService();
        const tenantService = { listMembers: jest.fn(async () => ({ items: [member()], nextCursor: null })) } as unknown as TenantService;
        const organizationService = { listDepartmentsForAssistant: jest.fn(async () => [{ id: 'dept-1', name: '产品部' }]) } as unknown as OrganizationService;
        const projectService = { getProject: jest.fn(async () => project()), addMember: jest.fn(), listMembers: jest.fn() } as unknown as ProjectService;
        const taskService = { getTask: jest.fn(async () => task()), replaceAssignees: jest.fn(async () => task()) } as unknown as TaskService;
        const tenantContext = new TenantContext();
        new ListTenantMembersTool(registry, tenantService, organizationService, tenantContext).onModuleInit();
        new AddProjectMemberTool(registry, projectService, tenantService, tenantContext, organizationService).onModuleInit();
        new AssignTaskTool(registry, taskService, projectService, tenantService, tenantContext).onModuleInit();

        expect(registry.get('list_tenant_members')).toMatchObject({ riskLevel: 'READ', requiredPermissions: ['member.read'] });
        expect(registry.get('add_project_member')).toMatchObject({ riskLevel: 'WRITE', requiredPermissions: ['project.member.manage'] });
        expect(registry.get('assign_task')).toMatchObject({ riskLevel: 'WRITE', requiredPermissions: ['task.assignee.manage'] });
    });

    it('builds a human-readable add-member confirmation without internal IDs', async () => {
        const registry = new ToolRegistryService();
        const tenantService = { getMember: jest.fn(async () => member()) } as unknown as TenantService;
        const organizationService = { listDepartmentsForAssistant: jest.fn(async () => [{ id: 'dept-1', name: '产品部' }]) } as unknown as OrganizationService;
        const projectService = { getProject: jest.fn(async () => project()), addMember: jest.fn() } as unknown as ProjectService;
        new AddProjectMemberTool(registry, projectService, tenantService, new TenantContext(), organizationService).onModuleInit();

        const confirmation = await registry.get('add_project_member')!.buildConfirmation!(confirmationContext, { project_id: PROJECT_ID, membership_id: MEMBER_ID, role: 'MEMBER' });
        expect(confirmation.fields).toEqual(expect.arrayContaining([
            { label: '项目', value: '官网改版' },
            { label: '成员', value: '林波' },
            { label: '部门', value: '产品部' },
        ]));
        expect(confirmation.summary).not.toContain(MEMBER_ID);
    });

    it('builds task assignment confirmation only for an existing project member', async () => {
        const registry = new ToolRegistryService();
        const tenantService = { getMember: jest.fn(async () => member()) } as unknown as TenantService;
        const projectService = {
            getProject: jest.fn(async () => project()),
            listMembers: jest.fn(async () => ({ items: [{ membershipId: MEMBER_ID, displayName: '林波', role: ProjectMemberRole.MEMBER }] })),
        } as unknown as ProjectService;
        const taskService = { getTask: jest.fn(async () => task()), replaceAssignees: jest.fn() } as unknown as TaskService;
        new AssignTaskTool(registry, taskService, projectService, tenantService, new TenantContext()).onModuleInit();

        const confirmation = await registry.get('assign_task')!.buildConfirmation!(confirmationContext, { project_id: PROJECT_ID, task_id: TASK_ID, membership_id: MEMBER_ID });
        expect(confirmation.fields).toEqual(expect.arrayContaining([
            { label: '任务', value: '完成首页设计' },
            { label: '新负责人', value: '林波' },
        ]));
    });

    it('preserves existing collaborators when changing the task owner', async () => {
        const registry = new ToolRegistryService();
        const tenantService = {} as TenantService;
        const taskService = { getTask: jest.fn(async () => task()), replaceAssignees: jest.fn(async () => task()) } as unknown as TaskService;
        const projectService = {} as ProjectService;
        new AssignTaskTool(registry, taskService, projectService, tenantService, new TenantContext()).onModuleInit();

        await registry.get('assign_task')!.execute(context, { project_id: PROJECT_ID, task_id: TASK_ID, membership_id: MEMBER_ID });
        expect(taskService.replaceAssignees).toHaveBeenCalledWith(PROJECT_ID, TASK_ID, {
            ownerMembershipId: MEMBER_ID,
            collaboratorMembershipIds: ['old-owner', 'collaborator-1'],
            version: 7,
        });
    });
});
