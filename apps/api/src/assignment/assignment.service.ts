import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    AssignmentPolicyDomain,
    AssignmentPolicyFallbackMode,
    AssignmentPolicyLevel,
    AuditOutcome,
    MembershipStatus,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { AssignmentCandidatePool, AssignmentPolicy, AssignmentPolicyResolveResult } from './assignment.types';
import {
    CreateAssignmentPolicyDto,
    ListAssignmentPoliciesQueryDto,
    ResolveAssignmentPolicyDto,
    UpdateAssignmentPolicyDto,
} from './dto';

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AssignmentService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async listPolicies(query: ListAssignmentPoliciesQueryDto): Promise<{ items: AssignmentPolicy[]; nextCursor: string | null }> {
        const { tenantId } = this.tenantContext.require();
        if (query.cursor) {
            const cursorExists = await this.prisma.assignmentPolicy.findFirst({
                where: { id: query.cursor, tenantId, deletedAt: null },
                select: { id: true },
            });
            if (!cursorExists) {
                throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
            }
        }

        const policies = await this.prisma.assignmentPolicy.findMany({
            where: {
                tenantId,
                deletedAt: null,
                domain: query.domain,
                projectId: query.projectId ?? undefined,
            },
            orderBy: [{ level: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = policies.length > query.limit;
        const page = hasNextPage ? policies.slice(0, query.limit) : policies;
        return {
            items: page.map(toAssignmentPolicy),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async getPolicy(policyId: string): Promise<AssignmentPolicy> {
        const { tenantId } = this.tenantContext.require();
        return toAssignmentPolicy(await this.requirePolicy(tenantId, policyId));
    }

    async createPolicy(input: CreateAssignmentPolicyDto): Promise<AssignmentPolicy> {
        const context = this.tenantContext.require();
        this.assertPolicyLevelAndProject(input.level, input.projectId);
        if (input.projectId) {
            await this.requireProject(context.tenantId, input.projectId);
        }

        const candidatePool = normalizeCandidatePool(input.candidatePool);
        const policy = await this.prisma.$transaction(async (transaction) => {
            const conflict = await transaction.assignmentPolicy.findFirst({
                where: {
                    tenantId: context.tenantId,
                    domain: input.domain,
                    level: input.level,
                    projectId: input.projectId ?? null,
                    deletedAt: null,
                },
                select: { id: true },
            });
            if (conflict) throw this.policyConflict();

            const created = await transaction.assignmentPolicy.create({
                data: {
                    tenantId: context.tenantId,
                    domain: input.domain,
                    level: input.level,
                    projectId: input.projectId ?? null,
                    name: input.name.trim(),
                    description: normalizeDescription(input.description),
                    candidatePool: candidatePool as unknown as Prisma.InputJsonValue,
                    skipOnLeave: input.skipOnLeave,
                    fallbackMode: input.fallbackMode,
                    enabled: input.enabled,
                    createdBy: context.userId,
                    updatedBy: context.userId,
                },
            });
            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'ASSIGNMENT_POLICY_CREATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'ASSIGNMENT_POLICY',
                    resourceId: created.id,
                    requestId: context.requestId,
                    metadata: {
                        actorMembershipId: context.membershipId,
                        domain: input.domain,
                        level: input.level,
                        projectId: input.projectId ?? null,
                        candidatePool: candidatePool as unknown as Prisma.InputJsonValue,
                        skipOnLeave: input.skipOnLeave,
                        fallbackMode: input.fallbackMode,
                    },
                },
            });
            return created;
        });
        return toAssignmentPolicy(policy);
    }

    async updatePolicy(policyId: string, input: UpdateAssignmentPolicyDto): Promise<AssignmentPolicy> {
        const context = this.tenantContext.require();
        const current = await this.requirePolicy(context.tenantId, policyId);
        const candidatePool = input.candidatePool ? normalizeCandidatePool(input.candidatePool) : undefined;

        await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.assignmentPolicy.updateMany({
                where: {
                    id: policyId,
                    tenantId: context.tenantId,
                    version: input.version,
                    deletedAt: null,
                },
                data: {
                    name: input.name?.trim(),
                    description: input.description === undefined ? undefined : normalizeDescription(input.description),
                    candidatePool: candidatePool as unknown as Prisma.InputJsonValue,
                    skipOnLeave: input.skipOnLeave,
                    fallbackMode: input.fallbackMode,
                    enabled: input.enabled,
                    version: { increment: 1 },
                    updatedBy: context.userId,
                },
            });
            if (updated.count !== 1) throw this.versionConflict();

            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'ASSIGNMENT_POLICY_UPDATED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'ASSIGNMENT_POLICY',
                    resourceId: policyId,
                    requestId: context.requestId,
                    metadata: {
                        actorMembershipId: context.membershipId,
                        before: policySnapshot(current),
                        changes: {
                            name: input.name ?? null,
                            description: input.description === undefined ? null : input.description,
                            candidatePool: candidatePool ? (candidatePool as unknown as Prisma.InputJsonValue) : null,
                            skipOnLeave: input.skipOnLeave ?? null,
                            fallbackMode: input.fallbackMode ?? null,
                            enabled: input.enabled ?? null,
                        },
                    },
                },
            });
        });
        return this.getPolicy(policyId);
    }

    async deletePolicy(policyId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        const current = await this.requirePolicy(context.tenantId, policyId);

        await this.prisma.$transaction(async (transaction) => {
            const deleted = await transaction.assignmentPolicy.updateMany({
                where: {
                    id: policyId,
                    tenantId: context.tenantId,
                    version,
                    deletedAt: null,
                },
                data: {
                    deletedAt: new Date(),
                    updatedBy: context.userId,
                },
            });
            if (deleted.count !== 1) throw this.versionConflict();

            await transaction.auditLog.create({
                data: {
                    tenantId: context.tenantId,
                    actorUserId: context.userId,
                    actorMembershipId: context.membershipId,
                    action: 'ASSIGNMENT_POLICY_DELETED',
                    outcome: AuditOutcome.SUCCESS,
                    resourceType: 'ASSIGNMENT_POLICY',
                    resourceId: policyId,
                    requestId: context.requestId,
                    metadata: {
                        actorMembershipId: context.membershipId,
                        before: policySnapshot(current),
                    },
                },
            });
        });
    }

    async resolvePolicy(input: ResolveAssignmentPolicyDto): Promise<AssignmentPolicyResolveResult> {
        const context = this.tenantContext.require();
        if (input.projectId) {
            await this.requireProject(context.tenantId, input.projectId);
        }

        const resolvedAt = new Date().toISOString();
        let policy = input.projectId
            ? await this.findActivePolicy(context.tenantId, input.domain, AssignmentPolicyLevel.PROJECT, input.projectId)
            : null;

        if (!policy) {
            policy = await this.findActivePolicy(context.tenantId, input.domain, AssignmentPolicyLevel.TENANT, null);
        }

        if (!policy) {
            return {
                matchedPolicyId: null,
                domain: input.domain,
                level: input.projectId ? AssignmentPolicyLevel.PROJECT : AssignmentPolicyLevel.TENANT,
                candidates: [],
                skippedOnLeave: [],
                fallbackMode: AssignmentPolicyFallbackMode.NONE,
                sourceTrace: {
                    policyId: null,
                    projectId: input.projectId ?? null,
                    domain: input.domain,
                    level: input.projectId ? AssignmentPolicyLevel.PROJECT : AssignmentPolicyLevel.TENANT,
                },
                resolvedAt,
            };
        }

        const candidatePool = normalizeCandidatePool(policy.candidatePool as Prisma.JsonValue);
        let candidates = await this.expandCandidatePool(context.tenantId, candidatePool);
        const skippedOnLeave: string[] = [];

        if (policy.skipOnLeave) {
            // P2 接入真实请假数据后，这里按当前日期/任务时间过滤候选成员。
            // 本阶段只保留规则字段和返回结构，不静默过滤或写入结果。
        }

        if (candidates.length === 0) {
            candidates = await this.expandFallback(context.tenantId, policy.fallbackMode, input.projectId ?? null);
        }

        const result: AssignmentPolicyResolveResult = {
            matchedPolicyId: policy.id,
            domain: policy.domain,
            level: policy.level,
            candidates: [...new Set(candidates)].sort(),
            skippedOnLeave,
            fallbackMode: policy.fallbackMode,
            sourceTrace: {
                policyId: policy.id,
                projectId: policy.projectId,
                domain: policy.domain,
                level: policy.level,
            },
            resolvedAt,
        };

        await this.prisma.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                actorMembershipId: context.membershipId,
                action: 'ASSIGNMENT_POLICY_RESOLVED',
                outcome: AuditOutcome.SUCCESS,
                resourceType: 'ASSIGNMENT_POLICY',
                resourceId: policy.id,
                requestId: context.requestId,
                metadata: {
                    actorMembershipId: context.membershipId,
                    sourceType: input.context?.sourceType ?? null,
                    sourceId: input.context?.sourceId ?? null,
                    matchedPolicyId: result.matchedPolicyId,
                    matchedLevel: result.level,
                    candidatesCount: result.candidates.length,
                    skippedOnLeaveCount: result.skippedOnLeave.length,
                    fallbackMode: result.fallbackMode,
                },
            },
        });

        return result;
    }

    private async requirePolicy(tenantId: string, policyId: string): Promise<Prisma.AssignmentPolicyGetPayload<Record<string, never>>> {
        const policy = await this.prisma.assignmentPolicy.findFirst({
            where: { id: policyId, tenantId, deletedAt: null },
        });
        if (!policy) throw this.policyNotFound();
        return policy;
    }

    private async requireProject(tenantId: string, projectId: string): Promise<void> {
        const project = await this.prisma.project.findFirst({
            where: { id: projectId, tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!project) {
            throw new NotFoundException({ code: 'ASSIGNMENT_PROJECT_NOT_FOUND', message: '项目不存在或不属于当前租户' });
        }
    }

    private findActivePolicy(
        tenantId: string,
        domain: AssignmentPolicyDomain,
        level: AssignmentPolicyLevel,
        projectId: string | null,
    ): Promise<Prisma.AssignmentPolicyGetPayload<Record<string, never>> | null> {
        return this.prisma.assignmentPolicy.findFirst({
            where: {
                tenantId,
                domain,
                level,
                projectId,
                enabled: true,
                deletedAt: null,
            },
        });
    }

    private async expandCandidatePool(tenantId: string, pool: AssignmentCandidatePool): Promise<string[]> {
        const ids = new Set<string>();
        const [explicitMembers, departmentMembers, projectMembers] = await Promise.all([
            pool.membershipIds.length > 0
                ? this.prisma.tenantMembership.findMany({
                    where: {
                        tenantId,
                        id: { in: pool.membershipIds },
                        status: MembershipStatus.ACTIVE,
                        deletedAt: null,
                    },
                    select: { id: true },
                })
                : Promise.resolve([]),
            pool.departmentIds.length > 0
                ? this.prisma.tenantMembership.findMany({
                    where: {
                        tenantId,
                        departmentId: { in: pool.departmentIds },
                        status: MembershipStatus.ACTIVE,
                        deletedAt: null,
                        department: { deletedAt: null },
                    },
                    select: { id: true },
                })
                : Promise.resolve([]),
            pool.projectIds.length > 0
                ? this.prisma.projectMember.findMany({
                    where: {
                        tenantId,
                        projectId: { in: pool.projectIds },
                        deletedAt: null,
                        membership: { status: MembershipStatus.ACTIVE, deletedAt: null },
                        project: { deletedAt: null },
                    },
                    select: { membershipId: true },
                })
                : Promise.resolve([]),
        ]);

        for (const member of explicitMembers) ids.add(member.id);
        for (const member of departmentMembers) ids.add(member.id);
        for (const member of projectMembers) ids.add(member.membershipId);
        return [...ids].sort();
    }

    private async expandFallback(tenantId: string, mode: AssignmentPolicyFallbackMode, projectId: string | null): Promise<string[]> {
        if (mode === AssignmentPolicyFallbackMode.PROJECT_MEMBERS && projectId) {
            const members = await this.prisma.projectMember.findMany({
                where: {
                    tenantId,
                    projectId,
                    deletedAt: null,
                    membership: { status: MembershipStatus.ACTIVE, deletedAt: null },
                },
                select: { membershipId: true },
            });
            return [...new Set(members.map((member) => member.membershipId))].sort();
        }
        if (mode === AssignmentPolicyFallbackMode.TENANT_MEMBERS) {
            const members = await this.prisma.tenantMembership.findMany({
                where: { tenantId, status: MembershipStatus.ACTIVE, deletedAt: null },
                select: { id: true },
            });
            return members.map((member) => member.id).sort();
        }
        return [];
    }

    private assertPolicyLevelAndProject(level: AssignmentPolicyLevel, projectId: string | undefined): void {
        if (level === AssignmentPolicyLevel.PROJECT && !projectId) {
            throw new BadRequestException({ code: 'ASSIGNMENT_PROJECT_ID_REQUIRED', message: '项目覆盖策略必须指定项目' });
        }
        if (level === AssignmentPolicyLevel.TENANT && projectId) {
            throw new BadRequestException({ code: 'ASSIGNMENT_TENANT_POLICY_NO_PROJECT', message: '租户默认策略不能指定项目' });
        }
    }

    private policyNotFound(): NotFoundException {
        return new NotFoundException({ code: 'ASSIGNMENT_POLICY_NOT_FOUND', message: '分配策略不存在或不属于当前租户' });
    }

    private policyConflict(): ConflictException {
        return new ConflictException({ code: 'ASSIGNMENT_POLICY_CONFLICT', message: '同一领域下已存在同层策略' });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }
}

function toAssignmentPolicy(record: Prisma.AssignmentPolicyGetPayload<Record<string, never>>): AssignmentPolicy {
    return {
        id: record.id,
        tenantId: record.tenantId,
        projectId: record.projectId,
        domain: record.domain,
        level: record.level,
        name: record.name,
        description: record.description,
        candidatePool: normalizeCandidatePool(record.candidatePool as Prisma.JsonValue),
        skipOnLeave: record.skipOnLeave,
        fallbackMode: record.fallbackMode,
        enabled: record.enabled,
        version: record.version,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

function normalizeCandidatePool(input: unknown): AssignmentCandidatePool {
    const value = (input ?? {}) as Partial<AssignmentCandidatePool>;
    return {
        membershipIds: uniqueUuids(value.membershipIds),
        departmentIds: uniqueUuids(value.departmentIds),
        projectIds: uniqueUuids(value.projectIds),
    };
}

function uniqueUuids(value: unknown): string[] {
    return [...new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])];
}

function normalizeDescription(description: string | null | undefined): string | null {
    const normalized = description?.trim();
    return normalized ? normalized : null;
}

function policySnapshot(policy: Prisma.AssignmentPolicyGetPayload<Record<string, never>>): Prisma.InputJsonObject {
    return {
        id: policy.id,
        domain: policy.domain,
        level: policy.level,
        projectId: policy.projectId,
        name: policy.name,
        description: policy.description,
        candidatePool: policy.candidatePool,
        skipOnLeave: policy.skipOnLeave,
        fallbackMode: policy.fallbackMode,
        enabled: policy.enabled,
        version: policy.version,
    };
}