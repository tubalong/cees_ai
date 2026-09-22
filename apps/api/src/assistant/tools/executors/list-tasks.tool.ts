import { Injectable, OnModuleInit } from '@nestjs/common';
import { TaskService } from '../../../task/task.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { ToolRegistryService } from '../tool-registry';
import { runAsTenant, type ToolDefinition, type ToolExecutionContext, type ToolExecutionResult } from '../tool.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * list_tasks 工具（发现层）：列出指定项目下的任务。
 * `update_task_status` 需要 task_id，而 task_id 只能从本工具获得。
 */
@Injectable()
export class ListTasksTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly taskService: TaskService,
        private readonly tenantContext: TenantContext,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'list_tasks',
        version: '1.0.0',
        displayName: '查看项目任务',
        description: '列出指定项目下的任务（可按状态、优先级、关键字筛选），返回 task_id 供 update_task_status 等工具引用。'
            + 'project_id 必须先通过 list_projects 获得。用户询问任务清单、或要改某个任务状态时必须先调用本工具定位唯一任务；'
            + '标题相近的多个任务要列出候选让用户选择。',
        parameters: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: '项目 ID，取自 list_projects，必填' },
                status: {
                    type: 'string',
                    enum: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'],
                    description: '按任务状态筛选，可选',
                },
                keyword: { type: 'string', description: '按任务标题模糊筛选，可选' },
            },
            required: ['project_id'],
            additionalProperties: false,
        },
        requiredPermissions: ['task.read'],
        riskLevel: 'READ',
        validate: validateListTasksArguments,
        execute: (context, input) => this.executeList(context, input),
    };

    private async executeList(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const projectId = input.project_id as string;
        const result = await runAsTenant(this.tenantContext, context, () => this.taskService.listTasks(projectId, {
            keyword: input.keyword as string | undefined,
            status: input.status as never,
            // 含子任务：用户可能要求变更的是某个子任务的状态。
            rootOnly: false,
            limit: 50,
        }));
        const tasks = result.items ?? [];
        const summary = JSON.stringify({
            type: 'task_candidates',
            tasks: tasks.map((task) => ({
                task_id: task.id,
                title: task.title,
                status: task.status,
                priority: task.priority,
                due_date: task.dueDate ?? null,
            })),
            instruction: '回答用户时只讲任务标题、状态与截止时间，不要输出 task_id 等内部标识。'
                + '用户要变更任务状态时，task_id 只能取自本结果；标题相近的多个任务必须列出候选让用户确认。',
        });
        return { resourceType: null, resourceId: null, summary };
    }
}

function validateListTasksArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;
    if (typeof raw.project_id !== 'string' || !UUID_PATTERN.test(raw.project_id)) {
        throw new Error('project_id 必须是取自 list_projects 的 UUID');
    }
    const parsed: Record<string, unknown> = { project_id: raw.project_id };
    if (raw.status !== undefined && raw.status !== null) {
        const allowed = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'];
        if (typeof raw.status !== 'string' || !allowed.includes(raw.status)) {
            throw new Error(`status 只能是 ${allowed.join(' / ')}`);
        }
        parsed.status = raw.status;
    }
    if (raw.keyword !== undefined && raw.keyword !== null) {
        if (typeof raw.keyword !== 'string') throw new Error('keyword 必须是字符串');
        if (raw.keyword.length > 100) throw new Error('keyword 不能超过 100 字符');
        if (raw.keyword.trim()) parsed.keyword = raw.keyword.trim();
    }
    return parsed;
}
