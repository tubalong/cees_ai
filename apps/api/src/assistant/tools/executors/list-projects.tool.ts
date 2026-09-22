import { Injectable, OnModuleInit } from '@nestjs/common';
import { ProjectService } from '../../../project/project.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { ToolRegistryService } from '../tool-registry';
import { runAsTenant, type ToolDefinition, type ToolExecutionContext, type ToolExecutionResult } from '../tool.types';

/**
 * list_projects 工具（发现层）：列出当前用户可见的项目及状态。
 *
 * 与 `list_departments` 同样的定位：模型负责把「那个项目」映射到唯一 ID，
 * 但歧义由用户裁决。`create_task` / `update_task_status` 都必须先拿到这里的
 * `project_id`，因此它是项目域的入口工具。
 */
@Injectable()
export class ListProjectsTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly projectService: ProjectService,
        private readonly tenantContext: TenantContext,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'list_projects',
        version: '1.0.0',
        displayName: '查看项目',
        description: '列出当前用户可见的项目（含状态与关键字筛选），返回 project_id 供 create_task / update_task_status 等工具引用。'
            + '用户问「我有哪些项目」时使用；用户要在某个项目下建任务或改任务状态时，必须先确认项目唯一 ID，'
            + '同名或含义相近的多个项目要列出候选让用户选择，不要自行挑选。',
        parameters: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '按项目名称模糊筛选，可选' },
                status: {
                    type: 'string',
                    enum: ['PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED'],
                    description: '按项目状态筛选，可选；默认不筛选',
                },
                include_archived: { type: 'boolean', description: '是否包含已归档项目，默认 false' },
            },
            additionalProperties: false,
        },
        requiredPermissions: ['project.read'],
        riskLevel: 'READ',
        validate: validateListProjectsArguments,
        execute: (context, input) => this.executeList(context, input),
    };

    private async executeList(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        // 复用既有 ProjectService：通过 runAsTenant 把工具上下文注回 ALS，
        // 因此业务侧无需为 AI 单独提供入口，权限与数据范围仍由业务层裁决。
        const result = await runAsTenant(this.tenantContext, context, () => this.projectService.listProjects({
            keyword: input.keyword as string | undefined,
            status: input.status as never,
            includeArchived: (input.include_archived as boolean | undefined) ?? false,
            // 候选清单要覆盖常见的「几十个项目」场景，同时避免把整库项目塞进模型上下文。
            limit: 50,
        }));
        const projects = result.items ?? [];
        const summary = JSON.stringify({
            type: 'project_candidates',
            projects: projects.map((project) => ({
                project_id: project.id,
                name: project.name,
                status: project.status,
                member_count: project.memberCount,
                task_count: project.taskCount,
            })),
            instruction: '回答用户时只讲项目名称与状态，不要输出 project_id 等内部标识。'
                + '用户要建任务或改任务状态时，project_id 只能取自本结果；'
                + '若用户说的项目名匹配到多个候选，列出候选让用户选择，绝不替用户决定。',
        });
        return { resourceType: null, resourceId: null, summary };
    }
}

function validateListProjectsArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;
    const parsed: Record<string, unknown> = {};
    if (raw.keyword !== undefined && raw.keyword !== null) {
        if (typeof raw.keyword !== 'string') throw new Error('keyword 必须是字符串');
        if (raw.keyword.length > 100) throw new Error('keyword 不能超过 100 字符');
        if (raw.keyword.trim()) parsed.keyword = raw.keyword.trim();
    }
    if (raw.status !== undefined && raw.status !== null) {
        const allowed = ['PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED'];
        if (typeof raw.status !== 'string' || !allowed.includes(raw.status)) {
            throw new Error(`status 只能是 ${allowed.join(' / ')}`);
        }
        parsed.status = raw.status;
    }
    if (raw.include_archived !== undefined && raw.include_archived !== null) {
        if (typeof raw.include_archived !== 'boolean') throw new Error('include_archived 必须是布尔值');
        parsed.include_archived = raw.include_archived;
    }
    return parsed;
}
