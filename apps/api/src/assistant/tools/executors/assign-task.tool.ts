import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { MembershipStatus } from '@prisma/client';
import { ProjectService } from '../../../project/project.service';
import { TaskService } from '../../../task/task.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { TenantService } from '../../../tenant/tenant.service';
import { ToolRegistryService } from '../tool-registry';
import { runAsTenant, type ToolConfirmationContext, type ToolConfirmationRequest, type ToolDefinition, type ToolExecutionContext, type ToolExecutionResult } from '../tool.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AssignTaskTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly taskService: TaskService,
        private readonly projectService: ProjectService,
        private readonly tenantService: TenantService,
        private readonly tenantContext: TenantContext,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'assign_task',
        version: '1.0.0',
        displayName: '分配任务',
        description: '把指定项目下的任务分配给项目成员。project_id、task_id、membership_id 必须来自前置查询结果。'
            + '这是写操作，必须生成确认草稿；执行时保留现有协作人，只替换任务负责人。目标成员尚未加入项目时，不要猜测或绕过项目成员权限，应先询问是否加入项目。',
        parameters: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: '项目 ID，取自 list_projects' },
                task_id: { type: 'string', description: '任务 ID，取自 list_tasks' },
                membership_id: { type: 'string', description: '负责人 membership ID，取自 list_tenant_members' },
            },
            required: ['project_id', 'task_id', 'membership_id'],
            additionalProperties: false,
        },
        requiredPermissions: ['task.assignee.manage'],
        riskLevel: 'WRITE',
        validate: validateArguments,
        buildConfirmation: (context, input) => this.buildConfirmation(context, input),
        execute: (context, input) => this.executeAssign(context, input),
    };

    private async buildConfirmation(context: ToolConfirmationContext, input: Record<string, unknown>): Promise<ToolConfirmationRequest> {
        const [project, task, member] = await runAsTenant(this.tenantContext, context, async () => Promise.all([
            this.projectService.getProject(input.project_id as string).catch(() => null),
            this.taskService.getTask(input.project_id as string, input.task_id as string).catch(() => null),
            this.tenantService.getMember(input.membership_id as string).then((member) => member.status === MembershipStatus.ACTIVE ? member : null).catch(() => null),
        ]));
        if (!project || !task) throw new NotFoundException({ code: 'PROJECT_TASK_NOT_FOUND', message: '指定的项目或任务不存在或无权访问' });
        if (!member) throw new NotFoundException({ code: 'TENANT_MEMBER_NOT_FOUND', message: '指定成员不存在或已失效' });
        const projectMember = await runAsTenant(this.tenantContext, context, () => this.projectService.listMembers(input.project_id as string));
        if (!projectMember.items.some((item) => item.membershipId === member.id)) {
            throw new NotFoundException({ code: 'PROJECT_MEMBER_REQUIRED', message: '目标成员尚未加入该项目，请先将成员加入项目' });
        }
        const currentOwner = task.owner?.displayName ?? '未分配';
        return {
            title: '分配任务',
            fields: [
                { label: '项目', value: project.name },
                { label: '任务', value: task.title },
                { label: '当前负责人', value: currentOwner },
                { label: '新负责人', value: member.user.displayName },
            ],
            summary: `已生成待确认草稿：将项目「${project.name}」中的任务「${task.title}」分配给「${member.user.displayName}」。确认前不会产生任何变更，不要输出内部 ID。`,
        };
    }

    private async executeAssign(context: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolExecutionResult> {
        const task = await runAsTenant(this.tenantContext, context, () => this.taskService.getTask(input.project_id as string, input.task_id as string));
        const owner = task.owner?.membershipId;
        const collaborators = task.collaborators.map((item) => item.membershipId).filter((id) => id !== input.membership_id);
        const updated = await runAsTenant(this.tenantContext, context, () => this.taskService.replaceAssignees(input.project_id as string, input.task_id as string, {
            ownerMembershipId: input.membership_id as string,
            collaboratorMembershipIds: owner && owner !== input.membership_id ? [owner, ...collaborators] : collaborators,
            version: task.version,
        }));
        return {
            resourceType: null,
            resourceId: updated.id,
            summary: `任务「${updated.title}」已分配给「${updated.owner?.displayName ?? '指定成员'}」。`,
        };
    }
}

function validateArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;
    for (const key of ['project_id', 'task_id', 'membership_id']) {
        if (typeof raw[key] !== 'string' || !UUID_PATTERN.test(raw[key] as string)) throw new Error(`${key} 必须是取自查询结果的 UUID`);
    }
    return { project_id: raw.project_id, task_id: raw.task_id, membership_id: raw.membership_id };
}
