import { Injectable, OnModuleInit } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { OrganizationService } from '../../../organization/organization.service';
import { ToolRegistryService } from '../tool-registry';
import type {
    ToolConfirmationContext,
    ToolConfirmationRequest,
    ToolDefinition,
    ToolExecutionContext,
    ToolExecutionResult,
} from '../tool.types';

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_SORT_ORDER = 10000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * create_department 工具（动作层 + 写操作确认）。
 *
 * 声明了 `buildConfirmation`，因此**不会直接执行**：TurnRunner 会把参数快照与预览落为
 * AssistantActionDraft 并把 ToolCall 置为 AWAITING_CONFIRMATION，用户在对话里确认后
 * 才真正写入。这样模型无法单方面改变组织架构——最终的裁量权在用户手里。
 *
 * 执行复用 OrganizationService 的同一实现（父部门校验、同级重名冲突、事务与审计），
 * 因此对话路径不会绕过任何业务规则，也不需要为 AI 单独维护一套写入逻辑。
 */
@Injectable()
export class CreateDepartmentTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly organizationService: OrganizationService,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'create_department',
        version: '1.0.0',
        displayName: '新建部门',
        description: '在当前租户内新建一个部门，可指定上级部门。'
            + '仅在用户明确要求新建部门时调用；name 必须来自用户表达，不得替用户编造。'
            + 'parent_department_id 必须取自 list_departments 的返回结果，不确定时先询问用户，不要猜测。'
            + '本工具不会立即写入：系统会让用户在对话中确认参数后再执行。',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '部门名称，来自用户表达，最长 100 字',
                },
                parent_department_id: {
                    type: 'string',
                    description: '上级部门 ID，必须取自 list_departments 返回结果；省略表示创建顶级部门',
                },
                description: {
                    type: 'string',
                    description: '部门说明，可选；省略时为空',
                },
                sort_order: {
                    type: 'integer',
                    description: '同级排序值，可选；省略时由服务端取默认值',
                },
            },
            required: ['name'],
            additionalProperties: false,
        },
        requiredPermissions: ['department.create'],
        riskLevel: 'WRITE',
        validate: validateCreateDepartmentArguments,
        buildConfirmation: (context, input) => this.buildConfirmation(context, input),
        execute: (context, input) => this.executeCreate(context, input),
    };

    /**
     * 生成确认预览。这里多做一件事：把 parent_department_id 译成上级部门名，
     * 否则用户看到的确认卡片只有一串 UUID，无法核对参数是否正确。
     */
    private async buildConfirmation(
        context: ToolConfirmationContext,
        input: Record<string, unknown>,
    ): Promise<ToolConfirmationRequest> {
        const parentId = input.parent_department_id as string | undefined;
        let parentName = '（顶级部门）';
        if (parentId) {
            const departments = await this.organizationService.listDepartmentsForAssistant(context.tenantId);
            const parent = departments.find((department) => department.id === parentId);
            if (!parent) {
                // 参数指向的部门在确认前被删除：直接拒绝，不生成一份注定失败的草稿。
                throw new BadRequestException({ code: 'DEPARTMENT_NOT_FOUND', message: '指定的上级部门不存在' });
            }
            parentName = parent.name;
        }
        const name = input.name as string;
        return {
            title: '新建部门',
            fields: [
                { label: '部门名称', value: name },
                { label: '上级部门', value: parentName },
                { label: '部门说明', value: (input.description as string | undefined) ?? '（未填写）' },
                {
                    label: '排序值',
                    value: input.sort_order === undefined ? '（默认）' : String(input.sort_order),
                },
            ],
            summary: `已生成待确认草稿：新建部门「${name}」（上级部门：${parentName}）。`
                + '请告知用户这一步还没有真正创建，需要用户在对话中确认后才会写入；'
                + '不要输出 parent_department_id 等内部标识。',
        };
    }

    private async executeCreate(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const department = await this.organizationService.createDepartmentForContext(
            {
                tenantId: context.tenantId,
                userId: context.userId,
                membershipId: context.membershipId,
                requestId: context.requestId,
                roles: [],
                permissions: context.permissions,
            },
            {
                name: input.name as string,
                parentId: (input.parent_department_id as string | undefined) ?? null,
                description: (input.description as string | undefined) ?? null,
                sortOrder: (input.sort_order as number | undefined) ?? 0,
            },
        );
        return {
            resourceType: null,
            resourceId: null,
            summary: `部门「${department.name}」已创建。`,
        };
    }
}

/** 校验并解析模型参数；非法输入抛错，由 ToolPolicy 统一映射为 INVALID_ARGUMENTS 拒绝。 */
function validateCreateDepartmentArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('工具参数必须为对象');
    }
    const raw = input as Record<string, unknown>;

    if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
        throw new Error('name 必须是非空字符串');
    }
    if (raw.name.length > MAX_NAME_LENGTH) {
        throw new Error(`name 不能超过 ${MAX_NAME_LENGTH} 字符`);
    }
    const parsed: Record<string, unknown> = { name: raw.name.trim() };

    if (raw.parent_department_id !== undefined && raw.parent_department_id !== null) {
        if (typeof raw.parent_department_id !== 'string' || !UUID_PATTERN.test(raw.parent_department_id)) {
            throw new Error('parent_department_id 必须是取自 list_departments 的 UUID');
        }
        parsed.parent_department_id = raw.parent_department_id;
    }

    if (raw.description !== undefined && raw.description !== null) {
        if (typeof raw.description !== 'string') throw new Error('description 必须是字符串');
        if (raw.description.length > MAX_DESCRIPTION_LENGTH) {
            throw new Error(`description 不能超过 ${MAX_DESCRIPTION_LENGTH} 字符`);
        }
        const trimmed = raw.description.trim();
        if (trimmed.length > 0) parsed.description = trimmed;
    }

    if (raw.sort_order !== undefined && raw.sort_order !== null) {
        if (typeof raw.sort_order !== 'number' || !Number.isInteger(raw.sort_order)) {
            throw new Error('sort_order 必须是整数');
        }
        if (raw.sort_order < 0 || raw.sort_order > MAX_SORT_ORDER) {
            throw new Error(`sort_order 必须在 0 到 ${MAX_SORT_ORDER} 之间`);
        }
        parsed.sort_order = raw.sort_order;
    }

    return parsed;
}
