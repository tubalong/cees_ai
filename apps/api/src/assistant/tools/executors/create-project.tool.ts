import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { OrganizationService } from '../../../organization/organization.service';
import { ProjectService } from '../../../project/project.service';
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

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * create_project 工具（动作层 + 写操作确认）。
 *
 * 项目是组织级可见对象（创建后成员可见、带负责人与成员），因此不直接落库：
 * 声明 `buildConfirmation` 后由 TurnRunner 落为待确认草稿，用户确认才写入。
 * 执行复用 `ProjectService.createProject`，负责人/数据范围/审计仍由业务层裁决。
 */
@Injectable()
export class CreateProjectTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly projectService: ProjectService,
        private readonly organizationService: OrganizationService,
        private readonly tenantContext: TenantContext,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'create_project',
        version: '1.0.0',
        displayName: '新建项目',
        description: '在当前租户内新建项目，当前用户默认为项目负责人。'
            + '仅在用户明确要求创建/新建项目时调用；name 必须来自用户表达，不得替用户编造。'
            + 'department_id 若用户提到归属部门，必须取自 list_departments 的结果，不确定时先询问。'
            + '本工具不会立即写入：系统会让用户在对话中确认参数后再执行。',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '项目名称，来自用户表达，最长 120 字' },
                description: { type: 'string', description: '项目说明，可选' },
                department_id: { type: 'string', description: '归属部门 ID，取自 list_departments；省略表示不指定' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        requiredPermissions: ['project.create'],
        riskLevel: 'WRITE',
        validate: validateCreateProjectArguments,
        buildConfirmation: (context, input) => this.buildConfirmation(context, input),
        execute: (context, input) => this.executeCreate(context, input),
    };

    private async buildConfirmation(
        context: ToolConfirmationContext,
        input: Record<string, unknown>,
    ): Promise<ToolConfirmationRequest> {
        const departmentId = input.department_id as string | undefined;
        let departmentName = '（未指定）';
        if (departmentId) {
            const departments = await this.organizationService.listDepartmentsForAssistant(context.tenantId);
            const department = departments.find((item) => item.id === departmentId);
            // 部门在确认前被删除：直接拒绝，不生成注定失败的草稿。
            if (!department) throw new BadRequestException({ code: 'DEPARTMENT_NOT_FOUND', message: '指定的归属部门不存在' });
            departmentName = department.name;
        }
        const name = input.name as string;
        return {
            title: '新建项目',
            fields: [
                { label: '项目名称', value: name },
                { label: '归属部门', value: departmentName },
                { label: '项目说明', value: (input.description as string | undefined) ?? '（未填写）' },
                { label: '项目负责人', value: '你（当前账号）' },
            ],
            summary: `已生成待确认草稿：新建项目「${name}」。`
                + '请告知用户这一步还没有真正创建，需要用户在对话中确认后才会写入；'
                + '不要输出 department_id 等内部标识。',
        };
    }

    private async executeCreate(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const project = await runAsTenant(this.tenantContext, context, () => this.projectService.createProject({
            name: input.name as string,
            description: (input.description as string | undefined) ?? null,
            departmentId: (input.department_id as string | undefined) ?? null,
        }));
        return {
            resourceType: null,
            resourceId: null,
            summary: `项目「${project.name}」已创建，你已成为该项目负责人。`,
        };
    }
}

function validateCreateProjectArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;
    if (typeof raw.name !== 'string' || raw.name.trim().length === 0) throw new Error('name 必须是非空字符串');
    if (raw.name.length > MAX_NAME_LENGTH) throw new Error(`name 不能超过 ${MAX_NAME_LENGTH} 字符`);
    const parsed: Record<string, unknown> = { name: raw.name.trim() };

    if (raw.description !== undefined && raw.description !== null) {
        if (typeof raw.description !== 'string') throw new Error('description 必须是字符串');
        if (raw.description.length > MAX_DESCRIPTION_LENGTH) {
            throw new Error(`description 不能超过 ${MAX_DESCRIPTION_LENGTH} 字符`);
        }
        if (raw.description.trim()) parsed.description = raw.description.trim();
    }
    if (raw.department_id !== undefined && raw.department_id !== null) {
        if (typeof raw.department_id !== 'string' || !UUID_PATTERN.test(raw.department_id)) {
            throw new Error('department_id 必须是取自 list_departments 的 UUID');
        }
        parsed.department_id = raw.department_id;
    }
    return parsed;
}
