import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { MembershipStatus, ProjectMemberRole } from '@prisma/client';
import { OrganizationService } from '../../../organization/organization.service';
import { ProjectService } from '../../../project/project.service';
import { TenantService } from '../../../tenant/tenant.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { ToolRegistryService } from '../tool-registry';
import { runAsTenant, type ToolConfirmationContext, type ToolConfirmationRequest, type ToolDefinition, type ToolExecutionContext, type ToolExecutionResult } from '../tool.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['MEMBER', 'MANAGER'] as const;

type MemberRole = (typeof ROLES)[number];

@Injectable()
export class AddProjectMemberTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly projectService: ProjectService,
        private readonly tenantService: TenantService,
        private readonly tenantContext: TenantContext,
        private readonly organizationService: OrganizationService,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'add_project_member',
        version: '1.0.0',
        displayName: '添加项目成员',
        description: '把当前租户的有效成员加入指定项目。project_id 和 membership_id 必须分别来自 list_projects 与 list_tenant_members。'
            + '这是写操作，必须生成确认草稿，用户确认后才执行；只有项目负责人/项目经理或具备相应权限者可以成功。',
        parameters: {
            type: 'object',
            properties: {
                project_id: { type: 'string', description: '项目 ID，取自 list_projects' },
                membership_id: { type: 'string', description: '成员 membership ID，取自 list_tenant_members' },
                role: { type: 'string', enum: [...ROLES], description: '项目角色，默认 MEMBER' },
            },
            required: ['project_id', 'membership_id'],
            additionalProperties: false,
        },
        requiredPermissions: ['project.member.manage'],
        riskLevel: 'WRITE',
        validate: validateArguments,
        buildConfirmation: (context, input) => this.buildConfirmation(context, input),
        execute: (context, input) => this.executeAdd(context, input),
    };

    private async buildConfirmation(context: ToolConfirmationContext, input: Record<string, unknown>): Promise<ToolConfirmationRequest> {
        const project = await runAsTenant(this.tenantContext, context, async () => {
            try { return await this.projectService.getProject(input.project_id as string); } catch { return null; }
        });
        if (!project) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '指定的项目不存在或无权访问' });
        const member = await this.findMember(context, input.membership_id as string);
        if (!member) throw new NotFoundException({ code: 'TENANT_MEMBER_NOT_FOUND', message: '指定成员不存在或已失效' });
        const role = (input.role as MemberRole | undefined) ?? 'MEMBER';
        return {
            title: '添加项目成员',
            fields: [
                { label: '项目', value: project.name },
                { label: '成员', value: member.displayName },
                { label: '部门', value: member.departmentName || '未设置部门' },
                { label: '项目角色', value: role === 'MANAGER' ? '项目经理' : '项目成员' },
            ],
            summary: `已生成待确认草稿：把「${member.displayName}」加入项目「${project.name}」。请告知用户确认前不会产生任何变更，不要输出内部 ID。`,
        };
    }

    private async executeAdd(context: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolExecutionResult> {
        const member = await this.findMember(context, input.membership_id as string);
        if (!member) throw new NotFoundException({ code: 'TENANT_MEMBER_NOT_FOUND', message: '指定成员不存在或已失效' });
        const projectMember = await runAsTenant(this.tenantContext, context, () => this.projectService.addMember(input.project_id as string, {
            membershipId: input.membership_id as string,
            role: (input.role as ProjectMemberRole | undefined) ?? ProjectMemberRole.MEMBER,
        }));
        return {
            resourceType: null,
            resourceId: projectMember.id,
            summary: `成员「${projectMember.displayName}」已加入项目，项目角色为${projectMember.role === ProjectMemberRole.MANAGER ? '项目经理' : '项目成员'}。`,
        };
    }

    private async findMember(context: ToolConfirmationContext | ToolExecutionContext, membershipId: string): Promise<{ displayName: string; departmentName: string } | null> {
        return runAsTenant(this.tenantContext, context, async () => {
            const member = await this.tenantService.getMember(membershipId).catch(() => null);
            if (!member) return null;
            if (member.status !== MembershipStatus.ACTIVE) return null;
            const departments = await this.organizationService.listDepartmentsForAssistant(context.tenantId);
            return { displayName: member.user.displayName, departmentName: departments.find((department) => department.id === member.departmentId)?.name ?? '' };
        });
    }
}

function validateArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;
    if (typeof raw.project_id !== 'string' || !UUID_PATTERN.test(raw.project_id)) throw new Error('project_id 必须是取自 list_projects 的 UUID');
    if (typeof raw.membership_id !== 'string' || !UUID_PATTERN.test(raw.membership_id)) throw new Error('membership_id 必须是取自 list_tenant_members 的 UUID');
    const parsed: Record<string, unknown> = { project_id: raw.project_id, membership_id: raw.membership_id };
    if (raw.role !== undefined && raw.role !== null) {
        if (typeof raw.role !== 'string' || !(ROLES as readonly string[]).includes(raw.role)) throw new Error(`role 只能是 ${ROLES.join(' / ')}`);
        parsed.role = raw.role;
    }
    return parsed;
}
