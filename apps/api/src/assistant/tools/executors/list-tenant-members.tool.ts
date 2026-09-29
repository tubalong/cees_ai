import { Injectable, OnModuleInit } from '@nestjs/common';
import { MembershipStatus } from '@prisma/client';
import { OrganizationService } from '../../../organization/organization.service';
import { TenantService } from '../../../tenant/tenant.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { ToolRegistryService } from '../tool-registry';
import { runAsTenant, type ToolDefinition, type ToolExecutionContext, type ToolExecutionResult } from '../tool.types';

const MAX_KEYWORD_LENGTH = 100;

@Injectable()
export class ListTenantMembersTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly tenantService: TenantService,
        private readonly organizationService: OrganizationService,
        private readonly tenantContext: TenantContext,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'list_tenant_members',
        version: '1.0.0',
        displayName: '查找企业成员',
        description: '按姓名或账号查找当前租户的有效成员，返回 membership_id 供 add_project_member 和 assign_task 使用。'
            + '用户说“把某人加入项目”或“把任务分配给某人”时必须先调用；同名或多候选时必须让用户选择，不得自行猜测。',
        parameters: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '姓名或账号关键字，可选；建议使用用户提到的人名' },
            },
            additionalProperties: false,
        },
        requiredPermissions: ['member.read'],
        riskLevel: 'READ',
        validate: validateArguments,
        execute: (context, input) => this.executeList(context, input),
    };

    private async executeList(context: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolExecutionResult> {
        const [result, departments] = await runAsTenant(this.tenantContext, context, () => Promise.all([
            this.tenantService.listMembers({
                keyword: input.keyword as string | undefined,
                status: MembershipStatus.ACTIVE,
                limit: 50,
            }),
            this.organizationService.listDepartmentsForAssistant(context.tenantId),
        ]));
        const departmentNames = new Map(departments.map((department) => [department.id, department.name]));
        return {
            resourceType: null,
            resourceId: null,
            summary: JSON.stringify({
                type: 'tenant_member_candidates',
                members: result.items.map((member) => ({
                    membership_id: member.id,
                    display_name: member.user.displayName,
                    account: member.account,
                    department_name: member.departmentId ? departmentNames.get(member.departmentId) ?? '' : '',
                })),
                instruction: 'membership_id 仅供后续工具调用，不要向用户展示。没有候选时说明未找到；多个候选时按姓名、账号和部门列出并请用户选择。',
            }),
        };
    }
}

function validateArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;
    const parsed: Record<string, unknown> = {};
    if (raw.keyword !== undefined && raw.keyword !== null) {
        if (typeof raw.keyword !== 'string') throw new Error('keyword 必须是字符串');
        const keyword = raw.keyword.trim();
        if (!keyword) throw new Error('keyword 不能为空字符串');
        if (keyword.length > MAX_KEYWORD_LENGTH) throw new Error(`keyword 不能超过 ${MAX_KEYWORD_LENGTH} 字符`);
        parsed.keyword = keyword;
    }
    return parsed;
}
