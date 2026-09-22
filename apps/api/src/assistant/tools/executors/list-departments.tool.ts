import { Injectable, OnModuleInit } from '@nestjs/common';
import { OrganizationService } from '../../../organization/organization.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

/**
 * list_departments 工具（发现层）：列出当前租户的全部部门（含上级部门与成员数）。
 *
 * 为什么单独做成发现工具而不是让模型直接按名字写：模型负责「自然语言 → ID」的消歧，
 * 但同名部门必须由用户而不是模型裁决。工具只提供带 ID 的候选，不替用户挑选，
 * 也不做服务端名称模糊匹配（歧义责任不清，见 assistant-tool-loop.md 第 14 节）。
 */
@Injectable()
export class ListDepartmentsTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly organizationService: OrganizationService,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'list_departments',
        version: '1.0.0',
        displayName: '查看部门',
        description: '列出当前租户的全部部门，包含每个部门的上级部门名称与成员数，并返回 department_id 供其它工具引用。'
            + '用户询问组织架构/有哪些部门时使用；用户要把新部门挂到某个上级部门下时，必须先用本工具确认上级部门的唯一 ID；'
            + '用户给出的部门名对应多个候选时，必须列出候选让用户选择，不要自行挑选。',
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        requiredPermissions: ['department.read'],
        riskLevel: 'READ',
        validate: validateNoArguments,
        execute: (context) => this.executeList(context),
    };

    private async executeList(context: ToolExecutionContext): Promise<ToolExecutionResult> {
        const departments = await this.organizationService.listDepartmentsForAssistant(context.tenantId);
        // department_id 是 create_department 的参数引用，必须进模型上下文；
        // 其余只放业务内容（名称、上级名、成员数）。
        const summary = JSON.stringify({
            type: 'department_candidates',
            departments: departments.map((department) => ({
                department_id: department.id,
                name: department.name,
                parent_department_id: department.parentId,
                parent_department_name: department.parentName ?? '',
                member_count: department.memberCount,
                status: department.status === 'ACTIVE' ? 'enabled' : 'disabled',
            })),
            instruction: '回答用户时如实列出部门名称与上级关系，不要输出 department_id 等内部标识。'
                + '用户要创建部门：若未说明上级部门，先用一句话问清楚是放在某个上级部门下还是作为顶级部门；'
                + '若用户说的上级部门名匹配到多个候选，列出候选（含上级部门名）让用户选择，绝不替用户决定。'
                + '参数齐全且经用户确认后调用 create_department，parent_department_id 只能取自本结果。',
        });
        return { resourceType: null, resourceId: null, summary };
    }
}

/** 本工具不接受任何参数；多余参数一律拒绝，避免模型臆造筛选条件。 */
function validateNoArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('工具参数必须为对象');
    }
    const keys = Object.keys(input as Record<string, unknown>);
    if (keys.length > 0) throw new Error(`本工具不接受参数：${keys.join('、')}`);
    return {};
}
