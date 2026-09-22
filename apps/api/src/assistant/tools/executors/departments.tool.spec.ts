import { BadRequestException } from '@nestjs/common';
import { DepartmentStatus } from '@prisma/client';
import { OrganizationService } from '../../../organization/organization.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolConfirmationContext, ToolExecutionContext } from '../tool.types';
import { CreateDepartmentTool } from './create-department.tool';
import { ListDepartmentsTool } from './list-departments.tool';

const TENANT_ID = '1e1c1f0e-0000-4000-8000-000000000001';
const PARENT_ID = '2e1c1f0e-0000-4000-8000-000000000002';
const DEPARTMENT_ID = '3e1c1f0e-0000-4000-8000-000000000003';

const context = {
    tenantId: TENANT_ID,
    userId: 'u-1',
    membershipId: 'm-1',
    requestId: 'r-1',
    conversationId: 'c-1',
    turnId: 'turn-1',
    toolCallId: 'tc-1',
    executionOwner: 'owner-1',
    executionToken: 'token-1',
    permissions: ['department.read', 'department.create'],
    knowledgeBaseEnabled: false,
    webSearchEnabled: false,
} as ToolExecutionContext;

const confirmationContext: ToolConfirmationContext = {
    tenantId: TENANT_ID,
    userId: 'u-1',
    membershipId: 'm-1',
    requestId: 'r-1',
    permissions: ['department.read', 'department.create'],
};

function departments() {
    return [
        { id: PARENT_ID, name: '销售中心', parentId: null, parentName: null, memberCount: 12, status: DepartmentStatus.ACTIVE },
        { id: DEPARTMENT_ID, name: '华东大区', parentId: PARENT_ID, parentName: '销售中心', memberCount: 4, status: DepartmentStatus.ACTIVE },
    ];
}

describe('department assistant tools', () => {
    let registry: ToolRegistryService;
    let organization: jest.Mocked<Pick<OrganizationService, 'listDepartmentsForAssistant' | 'createDepartmentForContext'>>;

    beforeEach(() => {
        registry = new ToolRegistryService();
        organization = {
            listDepartmentsForAssistant: jest.fn(async (_tenantId: string) => departments()),
            createDepartmentForContext: jest.fn(),
        };
        const service = organization as unknown as OrganizationService;
        new ListDepartmentsTool(registry, service).onModuleInit();
        new CreateDepartmentTool(registry, service).onModuleInit();
    });

    describe('list_departments', () => {
        it('self-registers as a READ tool gated by department.read', () => {
            const definition = registry.get('list_departments');
            expect(definition).toBeDefined();
            expect(definition?.requiredPermissions).toEqual(['department.read']);
            expect(definition?.riskLevel).toEqual('READ');
            // 只读工具不需要用户确认，直接执行。
            expect(definition?.buildConfirmation).toBeUndefined();
        });

        it('rejects any argument so the model cannot invent filters', () => {
            const definition = registry.get('list_departments');
            expect(() => definition?.validate(null)).toThrow('工具参数必须为对象');
            expect(() => definition?.validate({ keyword: '销售' })).toThrow('本工具不接受参数：keyword');
            expect(definition?.validate({})).toEqual({});
        });

        it('returns department ids for follow-up calls and keeps ids away from the user', async () => {
            const definition = registry.get('list_departments');
            const result = await definition!.execute(context, {});
            const payload = JSON.parse(result.summary) as {
                departments: Array<Record<string, unknown>>;
                instruction: string;
            };
            expect(payload.departments).toEqual([
                { department_id: PARENT_ID, name: '销售中心', parent_department_id: null, parent_department_name: '', member_count: 12, status: 'enabled' },
                { department_id: DEPARTMENT_ID, name: '华东大区', parent_department_id: PARENT_ID, parent_department_name: '销售中心', member_count: 4, status: 'enabled' },
            ]);
            expect(payload.instruction).toContain('不要输出 department_id');
        });
    });

    describe('create_department', () => {
        it('self-registers as a WRITE tool that requires user confirmation', () => {
            const definition = registry.get('create_department');
            expect(definition).toBeDefined();
            expect(definition?.requiredPermissions).toEqual(['department.create']);
            expect(definition?.riskLevel).toEqual('WRITE');
            // 声明了确认钩子 → TurnRunner 只会落草稿，不会执行写入。
            expect(typeof definition?.buildConfirmation).toEqual('function');
        });

        it('validates name, parent id, description and sort order', () => {
            const validate = registry.get('create_department')!.validate;
            expect(() => validate({})).toThrow('name 必须是非空字符串');
            expect(() => validate({ name: '销售部', parent_department_id: 'not-a-uuid' }))
                .toThrow('parent_department_id 必须是取自 list_departments 的 UUID');
            expect(() => validate({ name: '销售部', sort_order: 1.5 })).toThrow('sort_order 必须是整数');
            expect(() => validate({ name: '销售部', sort_order: -1 })).toThrow('sort_order 必须在 0 到 10000 之间');
            expect(validate({ name: '  华东销售部  ', parent_department_id: PARENT_ID, description: '  负责华东  ', sort_order: 3 }))
                .toEqual({ name: '华东销售部', parent_department_id: PARENT_ID, description: '负责华东', sort_order: 3 });
        });

        it('builds a confirmation preview that resolves the parent name instead of exposing an id', async () => {
            const build = registry.get('create_department')!.buildConfirmation!;
            const confirmation = await build(confirmationContext, { name: '华东销售部', parent_department_id: PARENT_ID });
            expect(confirmation.title).toEqual('新建部门');
            expect(confirmation.fields).toEqual([
                { label: '部门名称', value: '华东销售部' },
                { label: '上级部门', value: '销售中心' },
                { label: '部门说明', value: '（未填写）' },
                { label: '排序值', value: '（默认）' },
            ]);
            // 摘要必须明确「还没创建」，避免模型对用户说已经建好了。
            expect(confirmation.summary).toContain('还没有真正创建');
            expect(confirmation.summary).not.toContain(PARENT_ID);
        });

        it('marks a top-level department explicitly and rejects an unknown parent', async () => {
            const build = registry.get('create_department')!.buildConfirmation!;
            const topLevel = await build(confirmationContext, { name: '市场部' });
            expect(topLevel.fields).toContainEqual({ label: '上级部门', value: '（顶级部门）' });

            await expect(build(confirmationContext, { name: '市场部', parent_department_id: DEPARTMENT_ID })).resolves.toBeDefined();
            await expect(build(confirmationContext, { name: '市场部', parent_department_id: '4e1c1f0e-0000-4000-8000-000000000004' }))
                .rejects.toBeInstanceOf(BadRequestException);
        });

        it('executes through OrganizationService with an explicit trusted context', async () => {
            organization.createDepartmentForContext.mockResolvedValue({
                id: DEPARTMENT_ID, tenantId: TENANT_ID, parentId: PARENT_ID, name: '华东销售部', normalizedName: '华东销售部',
                description: null, sortOrder: 0, status: DepartmentStatus.ACTIVE, version: 1,
                createdAt: new Date(), updatedAt: new Date(), childrenCount: 0, memberCount: 0,
            } as never);

            const definition = registry.get('create_department')!;
            const result = await definition.execute(context, { name: '华东销售部', parent_department_id: PARENT_ID });
            expect(organization.createDepartmentForContext).toHaveBeenCalledWith(
                expect.objectContaining({ tenantId: TENANT_ID, userId: 'u-1', membershipId: 'm-1', requestId: 'r-1' }),
                expect.objectContaining({ name: '华东销售部', parentId: PARENT_ID }),
            );
            expect(result.summary).toContain('华东销售部');
            expect(result.resourceType).toBeNull();
        });
    });
});
