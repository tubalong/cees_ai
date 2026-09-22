import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 允许通过确认卡片推进的目标状态；TODO 是初始态，不作为变更目标。 */
const TRANSITION_TARGETS = ['IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'] as const;

const STATUS_LABELS: Record<string, string> = {
    TODO: '待开始',
    IN_PROGRESS: '进行中',
    BLOCKED: '受阻',
    DONE: '已完成',
    CANCELLED: '已取消',
};

/**
 * update_task_status 工具（动作层 + 写操作确认）：推进任务状态。
 *
 * 关于乐观锁（version）：任务变更接口要求 `version`。这里**不在草稿里存版本快照**，
 * 而是在执行瞬间重新读取任务取最新版本——因为用户确认的语义是「把任务标记为完成」，
 * 而不是"在我看到的那一版上完成"；若沿用陈旧版本，其他人刚改过标题就会导致这次
 * 状态变更莫名失败。状态机本身的合法性（ALLOWED_TRANSITIONS）与服务层校验保持不变。
 */
@Injectable()
export class UpdateTaskStatusTool implements OnModuleInit {
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
        name: 'update_task_status',
        version: '1.0.0',
        displayName: '变更任务状态',
        description: '把任务推进到进行中 / 受阻 / 已完成 / 已取消。'
            + 'project_id 必须取自 list_projects，task_id 必须取自 list_tasks；不确定时先查询再询问用户，不要猜测。'
            + '仅在用户明确要求变更状态时调用（例如「把这个任务标记为完成」）。'
            + '本工具不会立即写入：系统会让用户在对话中确认后再执行。',
        parameters: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: '项目 ID，取自 list_projects，必填' },
                task_id: { type: 'string', description: '任务 ID，取自 list_tasks，必填' },
                status: {
                    type: 'string',
                    enum: [...TRANSITION_TARGETS],
                    description: '目标状态：IN_PROGRESS 进行中 / BLOCKED 受阻 / DONE 已完成 / CANCELLED 已取消',
                },
                reason: { type: 'string', description: '变更说明，可选；取消或受阻时建议填写' },
            },
            required: ['project_id', 'task_id', 'status'],
            additionalProperties: false,
        },
        requiredPermissions: ['task.status.update'],
        riskLevel: 'WRITE',
        validate: validateUpdateTaskStatusArguments,
        buildConfirmation: (context, input) => this.buildConfirmation(context, input),
        execute: (context, input) => this.executeTransition(context, input),
    };

    private async buildConfirmation(
        context: ToolConfirmationContext,
        input: Record<string, unknown>,
    ): Promise<ToolConfirmationRequest> {
        const projectId = input.project_id as string;
        const taskId = input.task_id as string;
        const task = await runAsTenant(this.tenantContext, context, async () => {
            try {
                await this.projectService.getProject(projectId);
                return await this.taskService.getTask(projectId, taskId);
            } catch {
                return null;
            }
        });
        if (!task) throw new NotFoundException({ code: 'TASK_NOT_FOUND', message: '指定的项目或任务不存在' });

        const target = input.status as string;
        const targetLabel = STATUS_LABELS[target] ?? target;
        const currentLabel = STATUS_LABELS[task.status] ?? task.status;
        return {
            title: '变更任务状态',
            fields: [
                { label: '任务', value: task.title },
                { label: '当前状态', value: currentLabel },
                { label: '变更后', value: targetLabel },
                { label: '变更说明', value: (input.reason as string | undefined) ?? '（未填写）' },
            ],
            summary: `已生成待确认草稿：把任务「${task.title}」从「${currentLabel}」变更为「${targetLabel}」。`
                + '请告知用户这一步还没有真正生效，需要用户在对话中确认后才会写入；不要输出内部标识。',
        };
    }

    private async executeTransition(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const projectId = input.project_id as string;
        const taskId = input.task_id as string;
        const result = await runAsTenant(this.tenantContext, context, async () => {
            // 执行瞬间取最新版本，避免他人刚改过其它字段导致这次状态变更误报冲突。
            const latest = await this.taskService.getTask(projectId, taskId);
            return this.taskService.transitionTask(projectId, taskId, {
                status: input.status as TaskStatus,
                reason: (input.reason as string | undefined) ?? null,
                version: latest.version,
            });
        });
        const label = STATUS_LABELS[result.status] ?? result.status;
        return {
            resourceType: null,
            resourceId: null,
            summary: `任务「${result.title}」状态已更新为「${label}」。`,
        };
    }
}

function validateUpdateTaskStatusArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;

    if (typeof raw.project_id !== 'string' || !UUID_PATTERN.test(raw.project_id)) {
        throw new Error('project_id 必须是取自 list_projects 的 UUID');
    }
    if (typeof raw.task_id !== 'string' || !UUID_PATTERN.test(raw.task_id)) {
        throw new Error('task_id 必须是取自 list_tasks 的 UUID');
    }
    if (typeof raw.status !== 'string' || !(TRANSITION_TARGETS as readonly string[]).includes(raw.status)) {
        throw new Error(`status 只能是 ${TRANSITION_TARGETS.join(' / ')}`);
    }
    const parsed: Record<string, unknown> = { project_id: raw.project_id, task_id: raw.task_id, status: raw.status };

    if (raw.reason !== undefined && raw.reason !== null) {
        if (typeof raw.reason !== 'string') throw new Error('reason 必须是字符串');
        if (raw.reason.length > 500) throw new Error('reason 不能超过 500 字符');
        if (raw.reason.trim()) parsed.reason = raw.reason.trim();
    }
    return parsed;
}
