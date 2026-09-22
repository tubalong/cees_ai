import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { TaskPriority } from '@prisma/client';
import { ProjectService } from '../../../project/project.service';
import { TaskService } from '../../../task/task.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { ToolRegistryService } from '../tool-registry';
import {
    runAsTenant,
    type ToolConfirmationContext,
    type ToolConfirmationRequest,
    type ToolDefinition,
    type ToolExecutionContext,
    type ToolExecutionResult,
} from '../tool.types';

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 10000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

/**
 * create_task 工具（动作层 + 写操作确认）。
 *
 * 设计取舍：任务**必须**有执行人（业务 DTO 要求 ownerMembershipId）。
 * 对话场景里「提醒我做某事」占绝大多数，因此省略执行人时默认取**发起人本人**，
 * 并在确认卡片上明确写出「执行人：你（当前账号）」，避免用户误以为派给了别人。
 * 要派给他人时必须显式给出 assignee_membership_id（后续可加成员发现工具支持）。
 */
@Injectable()
export class CreateTaskTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly taskService: TaskService,
        private readonly projectService: ProjectService,
        private readonly tenantContext: TenantContext,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'create_task',
        version: '1.0.0',
        displayName: '新建任务',
        description: '在指定项目下新建任务，省略执行人时执行人默认为当前用户本人。'
            + '仅在用户明确要求创建任务/待办时调用；title 必须来自用户表达，不得替用户编造。'
            + 'project_id 必须取自 list_projects，不确定时先询问用户要放到哪个项目。'
            + '本工具不会立即写入：系统会让用户在对话中确认参数后再执行。',
        parameters: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: '项目 ID，取自 list_projects，必填' },
                title: { type: 'string', description: '任务标题，来自用户表达，最长 200 字' },
                description: { type: 'string', description: '任务说明，可选' },
                priority: { type: 'string', enum: [...PRIORITIES], description: '优先级，默认 MEDIUM' },
                due_date: { type: 'string', description: '截止日期，ISO 8601（例如 2026-09-30），可选' },
            },
            required: ['project_id', 'title'],
            additionalProperties: false,
        },
        requiredPermissions: ['task.create'],
        riskLevel: 'WRITE',
        validate: validateCreateTaskArguments,
        buildConfirmation: (context, input) => this.buildConfirmation(context, input),
        execute: (context, input) => this.executeCreate(context, input),
    };

    private async buildConfirmation(
        context: ToolConfirmationContext,
        input: Record<string, unknown>,
    ): Promise<ToolConfirmationRequest> {
        const projectId = input.project_id as string;
        // 译出项目名供用户核对；项目不存在直接拒绝，不生成注定失败的草稿。
        const project = await runAsTenant(this.tenantContext, context, async () => {
            try {
                return await this.projectService.getProject(projectId);
            } catch {
                return null;
            }
        });
        if (!project) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '指定的项目不存在或无权访问' });

        const title = input.title as string;
        return {
            title: '新建任务',
            fields: [
                { label: '任务标题', value: title },
                { label: '所属项目', value: project.name },
                { label: '执行人', value: '你（当前账号）' },
                { label: '优先级', value: (input.priority as string | undefined) ?? 'MEDIUM' },
                { label: '截止日期', value: (input.due_date as string | undefined) ?? '（未设置）' },
                { label: '任务说明', value: (input.description as string | undefined) ?? '（未填写）' },
            ],
            summary: `已生成待确认草稿：在项目「${project.name}」下新建任务「${title}」。`
                + '请告知用户这一步还没有真正创建，需要用户在对话中确认后才会写入；'
                + '不要输出 project_id 等内部标识。若用户其实想派给他人，请提示用户改为明确指定执行人。',
        };
    }

    private async executeCreate(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const task = await runAsTenant(this.tenantContext, context, () => this.taskService.createTask(
            input.project_id as string,
            {
                title: input.title as string,
                description: (input.description as string | undefined) ?? null,
                priority: (input.priority as TaskPriority | undefined) ?? TaskPriority.MEDIUM,
                dueDate: (input.due_date as string | undefined) ?? null,
                // 执行人默认是发起人本人：这一决定同时写在确认预览里，用户确认的是同一事实。
                ownerMembershipId: context.membershipId,
                collaboratorMembershipIds: [],
            },
        ));
        return {
            resourceType: null,
            resourceId: null,
            summary: `任务「${task.title}」已创建，执行人是你。`,
        };
    }
}

function validateCreateTaskArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;

    if (typeof raw.project_id !== 'string' || !UUID_PATTERN.test(raw.project_id)) {
        throw new Error('project_id 必须是取自 list_projects 的 UUID');
    }
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) throw new Error('title 必须是非空字符串');
    if (raw.title.length > MAX_TITLE_LENGTH) throw new Error(`title 不能超过 ${MAX_TITLE_LENGTH} 字符`);
    const parsed: Record<string, unknown> = { project_id: raw.project_id, title: raw.title.trim() };

    if (raw.description !== undefined && raw.description !== null) {
        if (typeof raw.description !== 'string') throw new Error('description 必须是字符串');
        if (raw.description.length > MAX_DESCRIPTION_LENGTH) {
            throw new Error(`description 不能超过 ${MAX_DESCRIPTION_LENGTH} 字符`);
        }
        if (raw.description.trim()) parsed.description = raw.description.trim();
    }
    if (raw.priority !== undefined && raw.priority !== null) {
        if (typeof raw.priority !== 'string' || !(PRIORITIES as readonly string[]).includes(raw.priority)) {
            throw new Error(`priority 只能是 ${PRIORITIES.join(' / ')}`);
        }
        parsed.priority = raw.priority;
    }
    if (raw.due_date !== undefined && raw.due_date !== null) {
        if (typeof raw.due_date !== 'string' || Number.isNaN(Date.parse(raw.due_date))) {
            throw new Error('due_date 必须是 ISO 8601 日期字符串，例如 2026-09-30');
        }
        parsed.due_date = raw.due_date;
    }
    return parsed;
}
