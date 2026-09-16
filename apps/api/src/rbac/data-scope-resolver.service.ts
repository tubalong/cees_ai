import { BadRequestException, Injectable } from '@nestjs/common';
import { DataScope, MembershipStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
import { DataScopeResolution } from './access-control';

@Injectable()
export class DataScopeResolverService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async resolve(): Promise<DataScopeResolution> {
        return this.resolveFor(this.tenantContext.require());
    }

    async resolveFor(context: RequestTenantContext): Promise<DataScopeResolution> {
        const membership = await this.prisma.tenantMembership.findFirst({
            where: {
                id: context.membershipId,
                tenantId: context.tenantId,
                deletedAt: null,
            },
            select: {
                id: true,
                departmentId: true,
                status: true,
            },
        });
        if (!membership || membership.status !== MembershipStatus.ACTIVE) {
            throw new BadRequestException({
                code: 'DATA_SCOPE_MEMBERSHIP_INVALID',
                message: '当前租户成员不可用',
            });
        }

        const roleScopes = await this.prisma.membershipRole.findMany({
            where: {
                tenantId: context.tenantId,
                membershipId: context.membershipId,
                role: { deletedAt: null },
            },
            select: {
                role: {
                    select: { dataScope: true },
                },
            },
        });
        const scopes = [...new Set(roleScopes.map((entry) => entry.role.dataScope))];
        if (scopes.length === 0) {
            return this.selfResolution(context.membershipId, membership.departmentId);
        }
        if (scopes.includes(DataScope.TENANT)) {
            return {
                scopes,
                tenantWide: true,
                membershipIds: [],
                departmentIds: [],
                projectIds: [],
            };
        }
        if (scopes.includes(DataScope.CUSTOM)) {
            throw new BadRequestException({
                code: 'DATA_SCOPE_CUSTOM_UNSUPPORTED',
                message: '自定义数据范围尚未实现，请改用其他数据范围',
            });
        }

        const membershipIds = new Set<string>();
        const departmentIds = new Set<string>();
        const projectIds = new Set<string>();

        if (scopes.includes(DataScope.SELF)) {
            membershipIds.add(context.membershipId);
        }

        if (
            (scopes.includes(DataScope.DEPARTMENT) || scopes.includes(DataScope.DEPARTMENT_TREE))
            && membership.departmentId
        ) {
            departmentIds.add(membership.departmentId);
            if (scopes.includes(DataScope.DEPARTMENT_TREE)) {
                const departments = await this.prisma.department.findMany({
                    where: { tenantId: context.tenantId, deletedAt: null },
                    select: { id: true, parentId: true },
                });
                for (const departmentId of collectDepartmentTree(departments, membership.departmentId)) {
                    departmentIds.add(departmentId);
                }
            }
        }

        if (scopes.includes(DataScope.PROJECT)) {
            const projectMembers = await this.prisma.projectMember.findMany({
                where: {
                    tenantId: context.tenantId,
                    membershipId: context.membershipId,
                    deletedAt: null,
                },
                select: { projectId: true },
            });
            for (const projectMember of projectMembers) {
                projectIds.add(projectMember.projectId);
            }
        }

        if (departmentIds.size > 0) {
            const members = await this.prisma.tenantMembership.findMany({
                where: {
                    tenantId: context.tenantId,
                    departmentId: { in: [...departmentIds] },
                    status: MembershipStatus.ACTIVE,
                    deletedAt: null,
                },
                select: { id: true },
            });
            for (const member of members) {
                membershipIds.add(member.id);
            }
        }

        return {
            scopes,
            tenantWide: false,
            membershipIds: [...membershipIds],
            departmentIds: [...departmentIds],
            projectIds: [...projectIds],
        };
    }

    private selfResolution(membershipId: string, departmentId: string | null): DataScopeResolution {
        return {
            scopes: [DataScope.SELF],
            tenantWide: false,
            membershipIds: [membershipId],
            departmentIds: departmentId ? [departmentId] : [],
            projectIds: [],
        };
    }
}

function collectDepartmentTree(
    departments: Array<{ id: string; parentId: string | null }>,
    rootId: string,
): string[] {
    const childrenByParent = new Map<string, string[]>();
    for (const department of departments) {
        if (!department.parentId) continue;
        const children = childrenByParent.get(department.parentId) ?? [];
        children.push(department.id);
        childrenByParent.set(department.parentId, children);
    }

    const result: string[] = [];
    const pending = [rootId];
    const visited = new Set<string>();
    while (pending.length > 0) {
        const currentId = pending.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        result.push(currentId);
        pending.push(...(childrenByParent.get(currentId) ?? []));
    }
    return result;
}
