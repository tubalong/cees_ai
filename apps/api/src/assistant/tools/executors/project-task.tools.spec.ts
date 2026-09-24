import { TaskPriority, TaskStatus } from '@prisma/client';
import { ProjectService } from '../../../project/project.service';
import { TaskService } from '../../../task/task.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { OrganizationService } from '../../../organization/organization.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolExecutionContext } from '../tool.types';
import { CreateProjectTool } from './create-project.tool';
import { CreateTaskTool } from './create-task.tool';
import { ListProjectsTool } from './list-projects.tool';
import { ListTasksTool } from './list-tasks.tool';
import { UpdateTaskStatusTool } from './update-task-status.tool';

const TENANT_ID = '1e1c1f0e-0000-4000-8000-000000000001';
const PROJECT_ID = '2e1c1f0e-0000-4000-8000-000000000002';
const TASK_ID = '3e1c1f0e-0000-4000-8000-000000000003';
const DEPARTMENT_ID = '4e1c1f0e-0000-4000-8000-000000000004';

const context = {
    tenantId: TENANT_ID,
    userId: 'u-1',
    membershipId: 'm-1',
    requestId: 'r-1',
    conversationId: 'c-1',
    turnId: 't-1',
    toolCallId: 'tc-1',
    executionOwner: 'owner-1',
    executionToken: 'token-1',
    permissions: ['project.read', 'project.create', 'task.read', 'task.create', 'task.status.update'],
    roles: ['tenant_admin'],
    knowledgeBaseEnabled: false,
    webSearchEnabled: false,
} as ToolExecutionContext;

const confirmationContext = {
    tenantId: TENANT_ID, userId: 'u-1', membershipId: 'm-1', requestId: 'r-1',
    turnId: context.turnId,
    permissions: context.permissions, roles: context.roles,
};

function projectResult(overrides: Record<string, unknown> = {}) {
    return {
        id: PROJECT_ID, name: '官网改版', status: 'ACTIVE', memberCount: 3, taskCount: 5,
        version: 1, ...overrides,
    } as never;
}

function taskResult(overrides: Record<string, unknown> = {}) {
    return {
        id: TASK_ID, title: '完成首页设计', status: TaskStatus.TODO, priority: TaskPriority.MEDIUM,
        dueDate: null, version: 7, ...overrides,
    } as never;
}

describe('project & task assistant tools', () => {
    let registry: ToolRegistryService;
    let projectService: jest.Mocked<Pick<ProjectService, 'listProjects' | 'getProject' | 'createProject'>>;
    let taskService: jest.Mocked<Pick<TaskService, 'listTasks' | 'getTask' | 'createTask' | 'transitionTask'>>;
    let organizationService: jest.Mocked<Pick<OrganizationService, 'listDepartmentsForAssistant'>>;

    beforeEach(() => {
        registry = new ToolRegistryService();
        projectService = {
            listProjects: jest.fn(async () => ({ items: [projectResult()], nextCursor: null })),
            getProject: jest.fn(async () => projectResult()),
            createProject: jest.fn(async () => projectResult()),
        } as unknown as typeof projectService;
        taskService = {
            listTasks: jest.fn(async () => ({ items: [taskResult()], nextCursor: null })),
            getTask: jest.fn(async () => taskResult()),
            createTask: jest.fn(async () => taskResult()),
            transitionTask: jest.fn(async () => taskResult({ status: TaskStatus.DONE })),
        } as unknown as typeof taskService;
        organizationService = {
            listDepartmentsForAssistant: jest.fn(async () => []),
        } as unknown as typeof organizationService;

        const tenantContext = new TenantContext();
        const projects = projectService as unknown as ProjectService;
        const tasks = taskService as unknown as TaskService;
        const organization = organizationService as unknown as OrganizationService;
        new ListProjectsTool(registry, projects, tenantContext).onModuleInit();
        new CreateProjectTool(registry, projects, organization, tenantContext).onModuleInit();
        new ListTasksTool(registry, tasks, tenantContext).onModuleInit();
        new CreateTaskTool(registry, tasks, projects, tenantContext).onModuleInit();
        new UpdateTaskStatusTool(registry, tasks, projects, tenantContext).onModuleInit();
    });

    it('registers the discovery tools as READ and the writing tools as confirmed WRITE', () => {
        expect(registry.get('list_projects')?.riskLevel).toEqual('READ');
        expect(registry.get('list_tasks')?.riskLevel).toEqual('READ');
        // 只读工具不应带确认钩子（有权限就直接查）。
        expect(registry.get('list_projects')?.buildConfirmation).toBeUndefined();
        expect(registry.get('list_tasks')?.buildConfirmation).toBeUndefined();

        for (const [name, permission] of [
            ['create_project', 'project.create'],
            ['create_task', 'task.create'],
            ['update_task_status', 'task.status.update'],
        ] as const) {
            const definition = registry.get(name);
            expect(definition?.riskLevel).toEqual('WRITE');
            expect(definition?.requiredPermissions).toEqual([permission]);
            expect(typeof definition?.buildConfirmation).toEqual('function');
        }
    });

    it('lists projects with ids for follow-up calls and keeps ids away from the user', async () => {
        const result = await registry.get('list_projects')!.execute(context, {});
        const payload = JSON.parse(result.summary) as { projects: Array<Record<string, unknown>>; instruction: string };
        expect(payload.projects).toEqual([
            { project_id: PROJECT_ID, name: '官网改版', status: 'ACTIVE', member_count: 3, task_count: 5 },
        ]);
        expect(payload.instruction).toContain('不要输出 project_id');
    });

    it('rejects list arguments that the model could invent', () => {
        expect(() => registry.get('list_projects')!.validate({ status: 'UNKNOWN' })).toThrow('status 只能是');
        expect(() => registry.get('list_tasks')!.validate({})).toThrow('project_id 必须是取自 list_projects 的 UUID');
        expect(() => registry.get('list_tasks')!.validate({ project_id: 'not-uuid' })).toThrow('project_id 必须是取自 list_projects 的 UUID');
    });

    it('builds a project confirmation preview and resolves the department name', async () => {
        organizationService.listDepartmentsForAssistant.mockResolvedValue([
            { id: DEPARTMENT_ID, name: '产品部', parentId: null, parentName: null, memberCount: 1, status: 'ACTIVE' },
        ] as never);
        const confirmation = await registry.get('create_project')!.buildConfirmation!(
            confirmationContext,
            { name: '官网改版', department_id: DEPARTMENT_ID },
        );
        expect(confirmation.title).toEqual('新建项目');
        expect(confirmation.fields).toContainEqual({ label: '归属部门', value: '产品部' });
        expect(confirmation.summary).toContain('还没有真正创建');
    });

    it('creates the project through the existing service with an explicit tenant context', async () => {
        const definition = registry.get('create_project')!;
        const result = await definition.execute(context, { name: '官网改版', description: '改版说明' });
        expect(projectService.createProject).toHaveBeenCalledWith(
            expect.objectContaining({ name: '官网改版', description: '改版说明', departmentId: null }),
        );
        expect(result.summary).toContain('官网改版');
    });

    it('defaults the task assignee to the requester and says so on the confirmation card', async () => {
        const confirmation = await registry.get('create_task')!.buildConfirmation!(
            confirmationContext,
            { project_id: PROJECT_ID, title: '完成首页设计' },
        );
        expect(confirmation.fields).toContainEqual({ label: '所属项目', value: '官网改版' });
        expect(confirmation.fields).toContainEqual({ label: '执行人', value: '你（当前账号）' });
        // 必须提示用户「可以改派」，避免误以为默认就是派给他人。
        expect(confirmation.summary).toContain('派给他人');
    });

    it('creates the task with the requester as owner and validates priority/date', async () => {
        const definition = registry.get('create_task')!;
        expect(() => definition.validate({ project_id: PROJECT_ID, title: 'x', priority: 'HUGE' })).toThrow('priority 只能是');
        expect(() => definition.validate({ project_id: PROJECT_ID, title: 'x', due_date: 'not-a-date' })).toThrow('due_date 必须是 ISO 8601');

        await definition.execute(context, { project_id: PROJECT_ID, title: '完成首页设计', priority: 'HIGH', due_date: '2026-09-30' });
        expect(taskService.createTask).toHaveBeenCalledWith(PROJECT_ID, expect.objectContaining({
            title: '完成首页设计',
            priority: TaskPriority.HIGH,
            dueDate: '2026-09-30',
            ownerMembershipId: 'm-1',
            collaboratorMembershipIds: [],
        }));
    });

    it('previews a task status change with the human-readable current and target status', async () => {
        const confirmation = await registry.get('update_task_status')!.buildConfirmation!(
            confirmationContext,
            { project_id: PROJECT_ID, task_id: TASK_ID, status: 'DONE' },
        );
        expect(confirmation.fields).toContainEqual({ label: '任务', value: '完成首页设计' });
        expect(confirmation.fields).toContainEqual({ label: '当前状态', value: '待开始' });
        expect(confirmation.fields).toContainEqual({ label: '变更后', value: '已完成' });
    });

    it('re-reads the task version at execution time instead of trusting a stale snapshot', async () => {
        taskService.getTask.mockResolvedValue(taskResult({ version: 9 }) as never);
        const definition = registry.get('update_task_status')!;
        const result = await definition.execute(context, { project_id: PROJECT_ID, task_id: TASK_ID, status: 'DONE' });

        expect(taskService.transitionTask).toHaveBeenCalledWith(PROJECT_ID, TASK_ID, expect.objectContaining({
            status: TaskStatus.DONE,
            version: 9,
        }));
        expect(result.summary).toContain('已完成');
    });

    it('refuses to build a confirmation for a task that cannot be read', async () => {
        taskService.getTask.mockRejectedValue(new Error('not found'));
        await expect(registry.get('update_task_status')!.buildConfirmation!(
            confirmationContext,
            { project_id: PROJECT_ID, task_id: TASK_ID, status: 'DONE' },
        )).rejects.toThrow('指定的项目或任务不存在');
    });
});
