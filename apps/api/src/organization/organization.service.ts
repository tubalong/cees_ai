import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditOutcome, DepartmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
import { TenantService } from '../tenant/tenant.service';
import { TenantMemberListResult, TenantMemberResult } from '../tenant/tenant.types';
import {
    AssignMemberDepartmentDto,
    CreateDepartmentDto,
    ListDepartmentMembersQueryDto,
    ListDepartmentsQueryDto,
    UpdateDepartmentDto,
} from './dto';
import { DepartmentResult, DepartmentTreeNodeResult, DepartmentTreeResult } from './organization.types';

const MAX_DEPARTMENT_DEPTH = 10;

const departmentSelect = {
    id: true,
    tenantId: true,
    parentId: true,
    name: true,
    normalizedName: true,
    description: true,
    sortOrder: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    version: true,
    _count: {
        select: {
            children: { where: { deletedAt: null } },
            memberships: { where: { deletedAt: null } },
        },
    },
} satisfies Prisma.DepartmentSelect;

type DepartmentRecord = Prisma.DepartmentGetPayload<{ select: typeof departmentSelect }>;
type DepartmentHierarchyRecord = Pick<DepartmentRecord, 'id' | 'parentId' | 'status'>;

/** 供 AI 助手部门工具使用的扁平摘要；不包含权限、审计等内部字段。 */
export interface AssistantDepartmentSummary {
    id: string;
    name: string;
    parentId: string | null;
    parentName: string | null;
    memberCount: number;
    status: DepartmentStatus;
}

@Injectable()
export class OrganizationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly tenantService: TenantService,
    ) { }

    async listDepartments(query: ListDepartmentsQueryDto): Promise<DepartmentTreeResult> {
        const { tenantId } = this.tenantContext.require();
        const departments = await this.prisma.department.findMany({
            where: { tenantId, deletedAt: null, status: query.status },
            select: departmentSelect,
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        });
        const nodes = new Map<string, DepartmentTreeNodeResult>();
        for (const department of departments) {
            nodes.set(department.id, { ...toDepartmentResult(department), children: [] });
        }
        const items: DepartmentTreeNodeResult[] = [];
        for (const department of departments) {
            const node = nodes.get(department.id)!;
            const parent = department.parentId ? nodes.get(department.parentId) : undefined;
            if (parent) parent.children.push(node);
            else items.push(node);
        }
        return { items };
    }

    async getDepartment(departmentId: string): Promise<DepartmentResult> {
        const { tenantId } = this.tenantContext.require();
        return toDepartmentResult(await this.requireDepartment(tenantId, departmentId));
    }

    async createDepartment(input: CreateDepartmentDto): Promise<DepartmentResult> {
        return this.createDepartmentRecord(this.tenantContext.require(), input);
    }

    /**
     * AI 助手写工具入口：不读 AsyncLocalStorage，显式接收可信上下文。
     * 与 `createDepartment` 共用同一实现（父部门校验、同级重名校验、审计、事务），
     * 因此对话路径不可能绕过业务规则；区别仅在于上下文来源。
     */
    async createDepartmentForContext(
        context: RequestTenantContext,
        input: CreateDepartmentDto,
    ): Promise<DepartmentResult> {
        return this.createDepartmentRecord(context, input);
    }

    /**
     * AI 助手发现工具入口：返回扁平部门列表（含上级部门名与成员数）。
     * 不建树是因为模型需要的是「可消歧的扁平候选 + 上级关系」，而不是展示结构。
     */
    async listDepartmentsForAssistant(tenantId: string): Promise<AssistantDepartmentSummary[]> {
        const departments = await this.prisma.department.findMany({
            where: { tenantId, deletedAt: null },
            select: departmentSelect,
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        });
        const nameById = new Map(departments.map((department) => [department.id, department.name]));
        return departments.map((department) => ({
            id: department.id,
            name: department.name,
            parentId: department.parentId,
            parentName: department.parentId ? nameById.get(department.parentId) ?? null : null,
            memberCount: department._count.memberships,
            status: department.status,
        }));
    }

    private async createDepartmentRecord(
        context: RequestTenantContext,
        input: CreateDepartmentDto,
    ): Promise<DepartmentResult> {
        const parentId = input.parentId ?? null;
        await this.validateParent(context.tenantId, parentId);
        const name = normalizeName(input.name);
        let departmentId: string;
        try {
            departmentId = await this.prisma.$transaction(async (transaction) => {
                const department = await transaction.department.create({
                    data: {
                        tenantId: context.tenantId,
                        parentId,
                        name,
                        normalizedName: normalizeDepartmentName(name),
                        description: normalizeDescription(input.description),
                        sortOrder: input.sortOrder,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                    select: { id: true },
                });
                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: 'DEPARTMENT_CREATED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'DEPARTMENT',
                        resourceId: department.id,
                        requestId: context.requestId,
                        metadata: {
                            parentId,
                            name,
                            description: normalizeDescription(input.description),
                            sortOrder: input.sortOrder,
                        },
                    },
                });
                return department.id;
            });
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.nameConflict();
            throw error;
        }
        // 显式用 context.tenantId 读回，不依赖 AsyncLocalStorage，
        // 使 AI 助手确认路径也能复用同一实现。
        return toDepartmentResult(await this.requireDepartment(context.tenantId, departmentId));
    }

    async updateDepartment(departmentId: string, input: UpdateDepartmentDto): Promise<DepartmentResult> {
        const context = this.tenantContext.require();
        if (
            input.name === undefined
            && input.parentId === undefined
            && input.description === undefined
            && input.sortOrder === undefined
            && input.status === undefined
        ) {
            throw new BadRequestException({ code: 'DEPARTMENT_UPDATE_EMPTY', message: '至少提供一个需要修改的字段' });
        }
        const current = await this.requireDepartment(context.tenantId, departmentId);
        const parentId = input.parentId === undefined ? current.parentId : input.parentId;
        if (input.parentId !== undefined) {
            const hierarchy = await this.validateParent(context.tenantId, parentId, departmentId);
            const subtreeHeight = calculateSubtreeHeight(hierarchy.departments, departmentId);
            if (hierarchy.targetDepth + subtreeHeight - 1 > MAX_DEPARTMENT_DEPTH) {
                throw this.depthExceeded();
            }
        }

        const data: Prisma.DepartmentUncheckedUpdateManyInput = {
            version: { increment: 1 },
            updatedBy: context.userId,
        };
        if (input.name !== undefined) {
            data.name = normalizeName(input.name);
            data.normalizedName = normalizeDepartmentName(input.name);
        }
        if (input.parentId !== undefined) data.parentId = input.parentId;
        if (input.description !== undefined) data.description = normalizeDescription(input.description);
        if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
        if (input.status !== undefined) data.status = input.status;

        try {
            await this.prisma.$transaction(async (transaction) => {
                const updated = await transaction.department.updateMany({
                    where: {
                        id: departmentId,
                        tenantId: context.tenantId,
                        version: input.version,
                        deletedAt: null,
                    },
                    data,
                });
                if (updated.count !== 1) throw this.versionConflict();
                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: input.parentId !== undefined && input.parentId !== current.parentId
                            ? 'DEPARTMENT_MOVED'
                            : 'DEPARTMENT_UPDATED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'DEPARTMENT',
                        resourceId: departmentId,
                        requestId: context.requestId,
                        metadata: {
                            before: departmentSnapshot(current),
                            changes: {
                                name: input.name ?? null,
                                parentId: input.parentId === undefined ? null : input.parentId,
                                description: input.description === undefined ? null : input.description,
                                sortOrder: input.sortOrder ?? null,
                                status: input.status ?? null,
                            },
                        },
                    },
                });
            });
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.nameConflict();
            throw error;
        }
        return this.getDepartment(departmentId);
    }

    async deleteDepartment(departmentId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        const current = await this.requireDepartment(context.tenantId, departmentId);
        await this.prisma.$transaction(async (transaction) => {
            const [childCount, memberCount] = await Promise.all([
                transaction.department.count({
                    where: { tenantId: context.tenantId, parentId: departmentId, deletedAt: null },
                }),
                transaction.tenantMembership.count({
                    where: { tenantId: context.tenantId, departmentId, deletedAt: null },
                }),
            ]);
            if (childCount > 0 || memberCount > 0) {
                throw new ConflictException({
                    code: 'DEPARTMENT_NOT_EMPTY',
                    message: '部门仍有未删除的子部门或成员，不能删除',
                    details: { childCount, memberCount },
                });
            }
            const deleted = await transaction.department.updateMany({
                where: {
                    id: departmentId,
                    tenantId: context.tenantId,
                    version,
                    deletedAt: null,
                },
                data: {
                    deletedAt: new Date(),
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (deleted.count !== 1) throw this.versionConflict();
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'DEPARTMENT_DELETED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'DEPARTMENT',
                    resourceId: departmentId,
                    requestId: context.requestId,
                    metadata: { before: departmentSnapshot(current) },
                },
            });
        });
    }

    async listDepartmentMembers(
        departmentId: string,
        query: ListDepartmentMembersQueryDto,
    ): Promise<TenantMemberListResult> {
        const { tenantId } = this.tenantContext.require();
        await this.requireDepartment(tenantId, departmentId);
        return this.tenantService.listMembers(query, departmentId);
    }

    async assignMemberDepartment(
        membershipId: string,
        input: AssignMemberDepartmentDto,
    ): Promise<TenantMemberResult> {
        return this.tenantService.updateMember(membershipId, {
            departmentId: input.departmentId,
            version: input.version,
        });
    }

    private async requireDepartment(tenantId: string, departmentId: string): Promise<DepartmentRecord> {
        const department = await this.prisma.department.findFirst({
            where: { id: departmentId, tenantId, deletedAt: null },
            select: departmentSelect,
        });
        if (!department) throw this.departmentNotFound();
        return department;
    }

    private async validateParent(
        tenantId: string,
        parentId: string | null,
        currentDepartmentId?: string,
    ): Promise<{ targetDepth: number; departments: DepartmentHierarchyRecord[] }> {
        const departments = await this.prisma.department.findMany({
            where: { tenantId, deletedAt: null },
            select: { id: true, parentId: true, status: true },
        });
        if (!parentId) return { targetDepth: 1, departments };

        const departmentsById = new Map(departments.map((department) => [department.id, department]));
        const parent = departmentsById.get(parentId);
        if (!parent) throw this.departmentNotFound('父部门不存在');
        if (parent.status !== DepartmentStatus.ACTIVE) {
            throw new BadRequestException({ code: 'DEPARTMENT_DISABLED', message: '不能在已停用部门下创建或移动部门' });
        }

        let targetDepth = 1;
        let cursorId: string | null = parentId;
        const visited = new Set<string>();
        while (cursorId) {
            if (cursorId === currentDepartmentId || visited.has(cursorId)) {
                throw new BadRequestException({ code: 'DEPARTMENT_HIERARCHY_INVALID', message: '部门父子关系不能形成循环' });
            }
            visited.add(cursorId);
            const department = departmentsById.get(cursorId);
            if (!department) throw this.departmentNotFound('父部门不存在');
            targetDepth += 1;
            cursorId = department.parentId;
        }
        if (targetDepth > MAX_DEPARTMENT_DEPTH) throw this.depthExceeded();
        return { targetDepth, departments };
    }

    private departmentNotFound(message = '当前租户内部门不存在'): NotFoundException {
        return new NotFoundException({ code: 'TENANT_DEPARTMENT_NOT_FOUND', message });
    }

    private nameConflict(): ConflictException {
        return new ConflictException({ code: 'DEPARTMENT_NAME_CONFLICT', message: '同一上级部门下已存在同名部门' });
    }

    private depthExceeded(): BadRequestException {
        return new BadRequestException({
            code: 'DEPARTMENT_DEPTH_EXCEEDED',
            message: `部门层级不能超过 ${MAX_DEPARTMENT_DEPTH} 级`,
        });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }
}

function toDepartmentResult(department: DepartmentRecord): DepartmentResult {
    return {
        id: department.id,
        parentId: department.parentId,
        name: department.name,
        description: department.description,
        sortOrder: department.sortOrder,
        status: department.status,
        memberCount: department._count.memberships,
        childCount: department._count.children,
        version: department.version,
        createdAt: department.createdAt,
        updatedAt: department.updatedAt,
    };
}

function normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
}

function normalizeDepartmentName(name: string): string {
    return normalizeName(name).toLocaleLowerCase();
}

function normalizeDescription(description: string | null | undefined): string | null {
    const normalized = description?.trim();
    return normalized ? normalized : null;
}

function calculateSubtreeHeight(departments: DepartmentHierarchyRecord[], rootId: string): number {
    const childrenByParent = new Map<string, string[]>();
    for (const department of departments) {
        if (!department.parentId) continue;
        const children = childrenByParent.get(department.parentId) ?? [];
        children.push(department.id);
        childrenByParent.set(department.parentId, children);
    }
    let maximumHeight = 1;
    const queue: Array<{ id: string; height: number }> = [{ id: rootId, height: 1 }];
    const visited = new Set<string>();
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current.id)) {
            throw new BadRequestException({ code: 'DEPARTMENT_HIERARCHY_INVALID', message: '部门父子关系不能形成循环' });
        }
        visited.add(current.id);
        maximumHeight = Math.max(maximumHeight, current.height);
        for (const childId of childrenByParent.get(current.id) ?? []) {
            queue.push({ id: childId, height: current.height + 1 });
        }
    }
    return maximumHeight;
}

function departmentSnapshot(department: DepartmentRecord): Prisma.InputJsonObject {
    return {
        departmentId: department.id,
        parentId: department.parentId,
        name: department.name,
        description: department.description,
        sortOrder: department.sortOrder,
        status: department.status,
        version: department.version,
    };
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
