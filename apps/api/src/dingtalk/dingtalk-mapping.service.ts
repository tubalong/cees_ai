import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    AuditOutcome,
    DingTalkIntegrationStatus,
    DepartmentStatus,
    MembershipStatus,
    Prisma,
    TenantInvitationStatus,
    UserStatus,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
    appendAccountSuffix,
    generateAccountFromDisplayName,
    isReservedAccount,
    normalizeAccount,
} from '../auth/account';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import {
    ApplyDingTalkMappingDto,
    PreviewDingTalkMappingDto,
} from './dto';
import {
    DingTalkDepartmentMappingPreview,
    DingTalkMappingCredential,
    DingTalkMappingPreviewResult,
    DingTalkMappingResult,
    DingTalkUserMappingPreview,
} from './dingtalk.types';

const ROOT_EXTERNAL_DEPARTMENT_ID = '1';
const EMPLOYEE_ROLE_CODE = 'employee';

type DepartmentRecord = {
    id: string;
    parentId: string | null;
    name: string;
    normalizedName: string;
};

type MembershipRecord = {
    id: string;
    departmentId: string | null;
    displayName: string | null;
    account: string;
    normalizedAccount: string;
    status: MembershipStatus;
    user: { displayName: string };
};

type DepartmentPlan = DingTalkDepartmentMappingPreview & {
    record: {
        id: string;
        externalDepartmentId: string;
        parentExternalDepartmentId: string | null;
        departmentId: string | null;
        name: string;
        displayOrder: number;
        isDeleted: boolean;
    };
};

type UserPlan = DingTalkUserMappingPreview & {
    record: {
        id: string;
        externalUserId: string;
        name: string;
        departmentExternalIds: Prisma.JsonValue;
        membershipId: string | null;
    };
};

type MappingPlan = {
    preview: DingTalkMappingPreviewResult;
    departmentPlans: DepartmentPlan[];
    userPlans: UserPlan[];
    departments: DepartmentRecord[];
    memberships: MembershipRecord[];
    tenantCode: string;
    employeeRoleId: string | null;
};

@Injectable()
export class DingTalkMappingService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async preview(input: PreviewDingTalkMappingDto): Promise<DingTalkMappingPreviewResult> {
        const plan = await this.buildPlan(input);
        return plan.preview;
    }

    async apply(input: ApplyDingTalkMappingDto): Promise<DingTalkMappingResult> {
        const context = this.tenantContext.require();
        const plan = await this.buildPlan(input);
        const departmentResolutions = new Map(
            input.departmentResolutions.map((resolution) => [resolution.dingtalkDepartmentId, resolution]),
        );
        this.assertKnownResolutions(input.departmentResolutions, plan.departmentPlans.map((item) => item.dingtalkDepartmentId), '部门');
        const userResolutions = new Map(
            input.userResolutions.map((resolution) => [resolution.dingtalkUserId, resolution]),
        );
        this.assertKnownResolutions(input.userResolutions, plan.userPlans.map((item) => item.dingtalkUserId), '人员');
        const unresolvedDepartments = plan.departmentPlans.filter((item) => item.action === 'CONFLICT')
            .filter((item) => !departmentResolutions.has(item.dingtalkDepartmentId));
        const unresolvedUsers = plan.userPlans.filter((item) => item.action === 'CONFLICT')
            .filter((item) => !userResolutions.has(item.dingtalkUserId));
        if (unresolvedDepartments.length > 0 || unresolvedUsers.length > 0) {
            throw new BadRequestException({
                code: 'DINGTALK_MAPPING_CONFIRMATION_REQUIRED',
                message: '存在需要管理员确认的部门或人员映射',
                details: {
                    departmentIds: unresolvedDepartments.map((item) => item.dingtalkDepartmentId),
                    userIds: unresolvedUsers.map((item) => item.dingtalkUserId),
                },
            });
        }
        if (input.createMissingMembers && plan.userPlans.some((item) => item.action === 'CREATE') && !plan.employeeRoleId) {
            throw new BadRequestException({ code: 'DINGTALK_MAPPING_EMPLOYEE_ROLE_NOT_FOUND', message: '当前租户缺少 employee 默认角色' });
        }

        try {
            return await this.prisma.$transaction(async (transaction) => {
                const departmentIds = new Map<string, string>();
                const departmentSkipped = new Set<string>();
                const orderedDepartments = [...plan.departmentPlans].sort((left, right) => left.path.split('/').length - right.path.split('/').length);
                for (const item of orderedDepartments) {
                    const resolution = departmentResolutions.get(item.dingtalkDepartmentId);
                    const action = resolution?.action ?? (item.action === 'MATCH_EXISTING' ? 'BIND_EXISTING' : item.action);
                    if (action === 'SKIP') {
                        departmentSkipped.add(item.dingtalkDepartmentId);
                        continue;
                    }
                    if (action === 'BIND_EXISTING') {
                        const departmentId = resolution?.departmentId ?? item.departmentId;
                        if (!departmentId) throw this.invalidResolution('部门绑定必须提供 departmentId');
                        await this.requireDepartment(transaction, context.tenantId, departmentId);
                        departmentIds.set(item.record.externalDepartmentId, departmentId);
                    } else if (action === 'CREATE') {
                        if (!input.createMissingDepartments && !resolution) {
                            departmentSkipped.add(item.dingtalkDepartmentId);
                            continue;
                        }
                        const parentId = item.record.parentExternalDepartmentId
                            ? departmentIds.get(item.record.parentExternalDepartmentId) ?? null
                            : null;
                        const created = await transaction.department.create({
                            data: {
                                tenantId: context.tenantId,
                                parentId,
                                name: item.name,
                                normalizedName: normalizeName(item.name),
                                sortOrder: item.record.displayOrder,
                                status: DepartmentStatus.ACTIVE,
                                createdBy: context.userId,
                                updatedBy: context.userId,
                            },
                            select: { id: true },
                        });
                        departmentIds.set(item.record.externalDepartmentId, created.id);
                    } else {
                        throw this.invalidResolution('部门映射动作无效');
                    }
                    await transaction.dingTalkDepartment.updateMany({
                        where: { id: item.record.id, tenantId: context.tenantId },
                        data: { departmentId: departmentIds.get(item.record.externalDepartmentId) ?? null },
                    });
                }

                const credentials: DingTalkMappingCredential[] = [];
                const occupiedAccounts = new Set([
                    ...plan.memberships.map((membership) => membership.normalizedAccount),
                    ...await this.pendingInvitationAccounts(transaction, context.tenantId),
                ]);
                const mappedMemberships = new Set<string>();
                for (const item of plan.userPlans) {
                    const resolution = userResolutions.get(item.dingtalkUserId);
                    const action = resolution?.action ?? (item.action === 'MATCH_EXISTING' ? 'BIND_EXISTING' : item.action);
                    if (action === 'SKIP') continue;
                    if (action === 'BIND_EXISTING') {
                        const membershipId = resolution?.membershipId ?? item.membershipId;
                        if (!membershipId) throw this.invalidResolution('人员绑定必须提供 membershipId');
                        if (mappedMemberships.has(membershipId)) {
                            throw new ConflictException({ code: 'DINGTALK_MAPPING_MEMBER_ALREADY_SELECTED', message: '同一个 CEES 成员不能绑定多个钉钉人员' });
                        }
                        await this.requireMembership(transaction, context.tenantId, membershipId);
                        mappedMemberships.add(membershipId);
                        await transaction.dingTalkUser.updateMany({
                            where: { id: item.record.id, tenantId: context.tenantId },
                            data: { membershipId },
                        });
                        continue;
                    }
                    if (action !== 'CREATE') throw this.invalidResolution('人员映射动作无效');
                    if (!input.createMissingMembers && !resolution) continue;
                    const account = this.allocateAccount(resolution?.account ?? item.suggestedAccount, occupiedAccounts);
                    const primaryDepartmentId = this.resolvePrimaryDepartment(item.record.departmentExternalIds, departmentIds);
                    const userId = randomUUID();
                    const membershipId = randomUUID();
                    const invitationId = randomUUID();
                    const activationToken = randomBytes(48).toString('base64url');
                    const activationExpiresAt = new Date(Date.now() + input.activationExpiresInDays * 24 * 60 * 60 * 1000);
                    await transaction.user.create({
                        data: {
                            id: userId,
                            displayName: item.name,
                            status: UserStatus.ACTIVE,
                            createdBy: context.userId,
                        },
                    });
                    await transaction.tenantMembership.create({
                        data: {
                            id: membershipId,
                            tenantId: context.tenantId,
                            userId,
                            departmentId: primaryDepartmentId,
                            displayName: item.name,
                            account,
                            normalizedAccount: account,
                            passwordHash: null,
                            status: MembershipStatus.PENDING_ACTIVATION,
                            createdBy: context.userId,
                            updatedBy: context.userId,
                        },
                    });
                    await transaction.membershipRole.create({
                        data: {
                            tenantId: context.tenantId,
                            membershipId,
                            roleId: plan.employeeRoleId!,
                        },
                    });
                    await transaction.tenantInvitation.create({
                        data: {
                            id: invitationId,
                            tenantId: context.tenantId,
                            account,
                            normalizedAccount: account,
                            displayName: item.name,
                            targetMembershipId: membershipId,
                            tokenHash: hashToken(activationToken),
                            status: TenantInvitationStatus.PENDING,
                            expiresAt: activationExpiresAt,
                            invitedByUserId: context.userId,
                            roles: { create: [{ roleId: plan.employeeRoleId! }] },
                        },
                    });
                    await transaction.dingTalkUser.updateMany({
                        where: { id: item.record.id, tenantId: context.tenantId },
                        data: { membershipId },
                    });
                    occupiedAccounts.add(account);
                    mappedMemberships.add(membershipId);
                    credentials.push({
                        dingtalkUserId: item.record.id,
                        membershipId,
                        displayName: item.name,
                        account,
                        departmentId: primaryDepartmentId,
                        tenantCode: plan.tenantCode,
                        activationToken,
                        activationExpiresAt,
                    });
                }

                await this.writeAudit(transaction, context, 'DINGTALK_ORGANIZATION_MAPPING_APPLIED', 'DINGTALK_INTEGRATION', context.tenantId, {
                    departmentMatchedCount: plan.preview.summary.departmentMatchedCount,
                    departmentCreateCount: plan.preview.summary.departmentCreateCount,
                    userMatchedCount: plan.preview.summary.userMatchedCount,
                    userCreateCount: credentials.length,
                    credentialCount: credentials.length,
                });
                return {
                    preview: plan.preview,
                    credentials,
                    summary: {
                        ...plan.preview.summary,
                        departmentSkippedCount: departmentSkipped.size,
                        userSkippedCount: plan.userPlans.filter((item) => {
                            const resolution = userResolutions.get(item.dingtalkUserId);
                            return (resolution?.action ?? item.action) === 'SKIP';
                        }).length,
                    },
                };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (isPrismaError(error, 'P2002') || isPrismaError(error, 'P2034')) {
                throw new ConflictException({ code: 'DINGTALK_MAPPING_CONFLICT', message: '映射或账号已被其他请求修改，请重新预览后重试' });
            }
            throw error;
        }
    }

    private async buildPlan(input: PreviewDingTalkMappingDto): Promise<MappingPlan> {
        const context = this.tenantContext.require();
        const integration = await this.prisma.dingTalkIntegration.findUnique({ where: { tenantId: context.tenantId }, select: { id: true, status: true } });
        if (!integration) throw new NotFoundException({ code: 'DINGTALK_INTEGRATION_NOT_FOUND', message: '当前租户尚未绑定钉钉企业' });
        if (integration.status !== DingTalkIntegrationStatus.ACTIVE) throw new ConflictException({ code: 'DINGTALK_INTEGRATION_NOT_ACTIVE', message: '钉钉集成未启用或连接异常' });
        const [tenant, dingtalkDepartments, dingtalkUsers, departments, memberships, pendingInvitations, employeeRole] = await Promise.all([
            this.prisma.tenant.findUniqueOrThrow({ where: { id: context.tenantId }, select: { code: true } }),
            this.prisma.dingTalkDepartment.findMany({ where: { tenantId: context.tenantId, integrationId: integration.id, isDeleted: false }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
            this.prisma.dingTalkUser.findMany({ where: { tenantId: context.tenantId, integrationId: integration.id, isDeleted: false }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
            this.prisma.department.findMany({ where: { tenantId: context.tenantId, status: DepartmentStatus.ACTIVE, deletedAt: null }, select: { id: true, parentId: true, name: true, normalizedName: true } }),
            this.prisma.tenantMembership.findMany({ where: { tenantId: context.tenantId, deletedAt: null }, select: { id: true, departmentId: true, displayName: true, account: true, normalizedAccount: true, status: true, user: { select: { displayName: true } } } }),
            this.prisma.tenantInvitation.findMany({ where: { tenantId: context.tenantId, status: TenantInvitationStatus.PENDING, expiresAt: { gt: new Date() } }, select: { normalizedAccount: true } }),
            this.prisma.role.findFirst({ where: { tenantId: context.tenantId, code: EMPLOYEE_ROLE_CODE, deletedAt: null }, select: { id: true } }),
        ]);
        const departmentRecords = departments as DepartmentRecord[];
        const membershipRecords = memberships as MembershipRecord[];
        const mappedDepartments = new Map<string, string>();
        const departmentPlans: DepartmentPlan[] = [];
        const pending = new Set(dingtalkDepartments.map((item) => item.id));
        const byExternalId = new Map(dingtalkDepartments.map((item) => [item.externalDepartmentId, item]));
        let guard = 0;
        while (pending.size > 0 && guard < dingtalkDepartments.length + 1) {
            guard += 1;
            let progressed = false;
            for (const item of dingtalkDepartments) {
                if (!pending.has(item.id)) continue;
                const parentExternalId = item.parentExternalDepartmentId;
                if (parentExternalId && parentExternalId !== ROOT_EXTERNAL_DEPARTMENT_ID && byExternalId.has(parentExternalId) && !mappedDepartments.has(parentExternalId)) continue;
                const parentId = parentExternalId && parentExternalId !== ROOT_EXTERNAL_DEPARTMENT_ID ? mappedDepartments.get(parentExternalId) ?? null : null;
                const path = buildExternalPath(item.externalDepartmentId, byExternalId);
                const existingMapping = item.departmentId ? departmentRecords.find((department) => department.id === item.departmentId) : undefined;
                const candidates = existingMapping ? [existingMapping] : departmentRecords.filter((department) => department.parentId === parentId && normalizeName(department.name) === normalizeName(item.name));
                const action = existingMapping || candidates.length === 1 ? 'MATCH_EXISTING' : candidates.length > 1 ? 'CONFLICT' : 'CREATE';
                const departmentId = existingMapping?.id ?? (candidates.length === 1 ? candidates[0].id : null);
                const candidateDepartmentIds = candidates.map((candidate) => candidate.id);
                if (departmentId) mappedDepartments.set(item.externalDepartmentId, departmentId);
                const preview: DepartmentPlan = {
                    record: item,
                    dingtalkDepartmentId: item.id,
                    externalDepartmentId: item.externalDepartmentId,
                    name: item.name,
                    path,
                    action,
                    departmentId,
                    candidateDepartmentIds,
                    reason: existingMapping ? 'EXISTING_MAPPING' : candidates.length === 1 ? 'SAME_PARENT_AND_NAME' : candidates.length > 1 ? 'MULTIPLE_CANDIDATES' : 'NOT_FOUND',
                };
                departmentPlans.push(preview);
                pending.delete(item.id);
                progressed = true;
            }
            if (!progressed) break;
        }
        for (const item of dingtalkDepartments) {
            if (pending.has(item.id)) {
                departmentPlans.push({
                    record: item,
                    dingtalkDepartmentId: item.id,
                    externalDepartmentId: item.externalDepartmentId,
                    name: item.name,
                    path: buildExternalPath(item.externalDepartmentId, byExternalId),
                    action: 'CONFLICT',
                    departmentId: null,
                    candidateDepartmentIds: [],
                    reason: 'PARENT_MAPPING_MISSING',
                });
            }
        }
        const mappedDepartmentByExternalId = new Map(
            departmentPlans.filter((item) => item.departmentId).map((item) => [item.externalDepartmentId, item.departmentId!]),
        );
        const occupiedAccounts = new Set([
            ...membershipRecords.map((membership) => membership.normalizedAccount),
            ...pendingInvitations.map((invitation) => invitation.normalizedAccount),
        ]);
        const userPlans: UserPlan[] = dingtalkUsers.map((item) => {
            const departmentIds = jsonStrings(item.departmentExternalIds)
                .map((externalId) => mappedDepartmentByExternalId.get(externalId))
                .filter((departmentId): departmentId is string => Boolean(departmentId));
            const departmentPaths = jsonStrings(item.departmentExternalIds).map((externalId) => buildExternalPath(externalId, byExternalId)).filter(Boolean);
            const existingMapping = item.membershipId ? membershipRecords.find((membership) => membership.id === item.membershipId) : undefined;
            const sameNameCandidates = existingMapping ? [existingMapping] : membershipRecords.filter((membership) => {
                const displayName = membership.displayName ?? membership.user.displayName;
                return normalizeName(displayName) === normalizeName(item.name) && (departmentIds.length > 0 ? departmentIds.includes(membership.departmentId ?? '') : jsonStrings(item.departmentExternalIds).length === 0);
            });
            const action = existingMapping || sameNameCandidates.length === 1 ? 'MATCH_EXISTING' : sameNameCandidates.length > 1 ? 'CONFLICT' : 'CREATE';
            const account = allocateAccountPreview(item.name, occupiedAccounts);
            if (action === 'CREATE') occupiedAccounts.add(account);
            return {
                record: item,
                dingtalkUserId: item.id,
                externalUserId: item.externalUserId,
                name: item.name,
                departmentPaths,
                action,
                membershipId: existingMapping?.id ?? (sameNameCandidates.length === 1 ? sameNameCandidates[0].id : null),
                candidateMembershipIds: sameNameCandidates.map((candidate) => candidate.id),
                suggestedAccount: account,
                reason: existingMapping ? 'EXISTING_MAPPING' : sameNameCandidates.length === 1 ? 'SAME_PARENT_DEPARTMENT_AND_NAME' : sameNameCandidates.length > 1 ? 'MULTIPLE_CANDIDATES' : 'NOT_FOUND',
            };
        });
        const summary = {
            departmentMatchedCount: departmentPlans.filter((item) => item.action === 'MATCH_EXISTING').length,
            departmentCreateCount: departmentPlans.filter((item) => item.action === 'CREATE').length,
            departmentConflictCount: departmentPlans.filter((item) => item.action === 'CONFLICT').length,
            userMatchedCount: userPlans.filter((item) => item.action === 'MATCH_EXISTING').length,
            userCreateCount: userPlans.filter((item) => item.action === 'CREATE').length,
            userConflictCount: userPlans.filter((item) => item.action === 'CONFLICT').length,
        };
        return {
            preview: { activationExpiresInDays: input.activationExpiresInDays, departments: departmentPlans.map(({ record: _record, ...item }) => item), users: userPlans.map(({ record: _record, ...item }) => item), summary },
            departmentPlans,
            userPlans,
            departments: departmentRecords,
            memberships: membershipRecords,
            tenantCode: tenant.code,
            employeeRoleId: employeeRole?.id ?? null,
        };
    }

    private async pendingInvitationAccounts(transaction: Prisma.TransactionClient, tenantId: string): Promise<string[]> {
        const records = await transaction.tenantInvitation.findMany({
            where: { tenantId, status: TenantInvitationStatus.PENDING, expiresAt: { gt: new Date() } },
            select: { normalizedAccount: true },
        });
        return records.map((record) => record.normalizedAccount);
    }

    private async requireDepartment(transaction: Prisma.TransactionClient, tenantId: string, departmentId: string): Promise<void> {
        const record = await transaction.department.findFirst({ where: { id: departmentId, tenantId, status: DepartmentStatus.ACTIVE, deletedAt: null }, select: { id: true, status: true } });
        if (!record) throw new NotFoundException({ code: 'DEPARTMENT_NOT_FOUND', message: '目标 CEES 部门不存在或不可用' });
    }

    private async requireMembership(transaction: Prisma.TransactionClient, tenantId: string, membershipId: string): Promise<void> {
        const record = await transaction.tenantMembership.findFirst({ where: { id: membershipId, tenantId, deletedAt: null }, select: { id: true, status: true } });
        if (!record) throw new NotFoundException({ code: 'TENANT_MEMBER_NOT_FOUND', message: '目标 CEES 成员不存在或不可用' });
    }

    private allocateAccount(account: string, occupied: Set<string>): string {
        const normalized = normalizeAccount(account);
        if (!occupied.has(normalized) && !isReservedAccount(normalized)) return normalized;
        for (let suffix = 2; suffix < 100000; suffix += 1) {
            const candidate = appendAccountSuffix(normalized, suffix);
            if (!occupied.has(candidate) && !isReservedAccount(candidate)) return candidate;
        }
        throw new ConflictException({ code: 'DINGTALK_MAPPING_ACCOUNT_EXHAUSTED', message: `无法为账号 ${normalized} 生成可用后缀` });
    }

    private resolvePrimaryDepartment(value: Prisma.JsonValue, mappedDepartments: Map<string, string>): string | null {
        for (const externalId of jsonStrings(value)) {
            const departmentId = mappedDepartments.get(externalId);
            if (departmentId) return departmentId;
        }
        return null;
    }

    private assertKnownResolutions(
        resolutions: Array<{ dingtalkDepartmentId?: string; dingtalkUserId?: string }>,
        knownIds: string[],
        resourceName: string,
    ): void {
        const known = new Set(knownIds);
        const unknown = resolutions
            .map((resolution) => resolution.dingtalkDepartmentId ?? resolution.dingtalkUserId)
            .filter((id): id is string => typeof id === 'string')
            .filter((id) => !known.has(id));
        if (unknown.length > 0) {
            throw new BadRequestException({
                code: 'DINGTALK_MAPPING_RESOLUTION_UNKNOWN',
                message: `${resourceName}映射处理项不属于当前同步结果`,
                details: { ids: unknown },
            });
        }
    }
    private invalidResolution(message: string): BadRequestException {
        return new BadRequestException({ code: 'DINGTALK_MAPPING_RESOLUTION_INVALID', message });
    }

    private async writeAudit(
        transaction: Prisma.TransactionClient,
        context: ReturnType<TenantContext['require']>,
        action: string,
        resourceType: string,
        resourceId: string,
        metadata: Record<string, unknown>,
    ): Promise<void> {
        await transaction.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                actorMembershipId: context.membershipId,
                action,
                outcome: AuditOutcome.SUCCESS,
                resourceType,
                resourceId,
                requestId: context.requestId,
                metadata: metadata as Prisma.InputJsonValue,
            },
        });
    }
}

function normalizeName(value: string): string {
    return value.trim().toLocaleLowerCase();
}

function allocateAccountPreview(displayName: string, occupied: Set<string>): string {
    const base = generateAccountFromDisplayName(displayName);
    if (!occupied.has(base) && !isReservedAccount(base)) return base;
    for (let suffix = 2; suffix < 100000; suffix += 1) {
        const candidate = appendAccountSuffix(base, suffix);
        if (!occupied.has(candidate) && !isReservedAccount(candidate)) return candidate;
    }
    return `${base}99`;
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function jsonStrings(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function buildExternalPath(externalId: string, departments: Map<string, { externalDepartmentId: string; parentExternalDepartmentId: string | null; name: string }>): string {
    const names: string[] = [];
    const visited = new Set<string>();
    let current: string | null = externalId;
    while (current && current !== ROOT_EXTERNAL_DEPARTMENT_ID && !visited.has(current)) {
        visited.add(current);
        const department = departments.get(current);
        if (!department) break;
        names.unshift(department.name);
        current = department.parentExternalDepartmentId;
    }
    return names.join('/');
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
