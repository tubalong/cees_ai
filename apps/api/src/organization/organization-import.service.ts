import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import {
    AuditOutcome,
    DepartmentStatus,
    MembershipStatus,
    Prisma,
    TenantInvitationStatus,
    UserStatus,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { normalizeAccount } from '../auth/account';
import { PrismaService } from '../database/prisma.service';
import { TENANT_ADMIN_ROLE_CODE } from '../rbac/permission-catalog';
import { TenantContext } from '../tenant/tenant-context';
import {
    ORGANIZATION_IMPORT_MAX_DEPTH,
    OrganizationImportDepartmentDto,
    OrganizationImportDto,
    OrganizationImportMemberDto,
} from './organization-import.dto';
import {
    OrganizationImportDepartmentAction,
    OrganizationImportIssue,
    OrganizationImportMemberPreview,
    OrganizationImportResult,
    OrganizationImportSummary,
    OrganizationImportValidationResult,
} from './organization-import.types';

const ROOT_PARENT_KEY = '__root__';

type OrganizationImportDb = PrismaService | Prisma.TransactionClient;

interface ExistingDepartment {
    id: string;
    parentId: string | null;
    name: string;
    normalizedName: string;
    status: DepartmentStatus;
}

interface ResolvedDepartment {
    input: OrganizationImportDepartmentDto;
    normalizedName: string;
    normalizedDescription: string | null;
    action: OrganizationImportDepartmentAction;
    existingDepartmentId: string | null;
    path: string;
    depth: number;
}

interface ResolvedMember {
    input: OrganizationImportMemberDto;
    account: string;
    displayName: string;
    department: ResolvedDepartment;
    effectiveRoleIds: string[];
}

interface OrganizationImportAnalysis {
    validation: OrganizationImportValidationResult;
    resolvedDepartments: ResolvedDepartment[];
    resolvedMembers: ResolvedMember[];
}

interface PreparedMember {
    resolved: ResolvedMember;
    userId: string;
    membershipId: string;
    invitationId: string;
    activationToken: string;
    activationExpiresAt: Date;
    departmentId: string;
}

@Injectable()
export class OrganizationImportService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async validate(input: OrganizationImportDto): Promise<OrganizationImportValidationResult> {
        const { tenantId } = this.tenantContext.require();
        return (await this.analyze(this.prisma, tenantId, input)).validation;
    }

    async confirm(input: OrganizationImportDto): Promise<OrganizationImportResult> {
        const context = this.tenantContext.require();
        try {
            return await this.prisma.$transaction(async (transaction) => {
                const analysis = await this.analyze(transaction, context.tenantId, input);
                this.assertValid(analysis.validation);

                const tenant = await transaction.tenant.findUnique({
                    where: { id: context.tenantId },
                    select: { id: true, code: true },
                });
                if (!tenant) {
                    throw new BadRequestException({
                        code: 'TENANT_NOT_FOUND',
                        message: '当前租户不存在',
                    });
                }

                const departmentIdByClientRef = new Map<string, string>();
                for (const department of analysis.resolvedDepartments) {
                    if (department.action === 'REUSE') {
                        departmentIdByClientRef.set(department.input.clientRef, department.existingDepartmentId!);
                        continue;
                    }
                    const departmentId = randomUUID();
                    const parentId = department.input.parentClientRef
                        ? departmentIdByClientRef.get(department.input.parentClientRef)
                        : null;
                    if (department.input.parentClientRef && !parentId) {
                        throw new BadRequestException({
                            code: 'ORGANIZATION_IMPORT_INVALID',
                            message: '批量导入数据校验失败',
                        });
                    }
                    await transaction.department.create({
                        data: {
                            id: departmentId,
                            tenantId: context.tenantId,
                            parentId,
                            name: normalizeName(department.input.name),
                            normalizedName: department.normalizedName,
                            description: department.normalizedDescription,
                            sortOrder: department.input.sortOrder ?? 0,
                            createdBy: context.userId,
                            updatedBy: context.userId,
                        },
                    });
                    departmentIdByClientRef.set(department.input.clientRef, departmentId);
                }

                const activationExpiresInDays = input.activationExpiresInDays ?? 7;
                const activationExpiresAt = new Date(Date.now() + activationExpiresInDays * 24 * 60 * 60 * 1000);
                const preparedMembers = analysis.resolvedMembers.map((member): PreparedMember => ({
                    resolved: member,
                    userId: randomUUID(),
                    membershipId: randomUUID(),
                    invitationId: randomUUID(),
                    activationToken: randomBytes(48).toString('base64url'),
                    activationExpiresAt,
                    departmentId: departmentIdByClientRef.get(member.input.departmentClientRef)!,
                }));

                await transaction.user.createMany({
                    data: preparedMembers.map((member) => ({
                        id: member.userId,
                        displayName: member.resolved.displayName,
                        status: UserStatus.ACTIVE,
                        createdBy: context.userId,
                    })),
                });
                await transaction.tenantMembership.createMany({
                    data: preparedMembers.map((member) => ({
                        id: member.membershipId,
                        tenantId: context.tenantId,
                        userId: member.userId,
                        departmentId: member.departmentId,
                        displayName: member.resolved.displayName,
                        account: member.resolved.account,
                        normalizedAccount: member.resolved.account,
                        passwordHash: null,
                        status: MembershipStatus.PENDING_ACTIVATION,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    })),
                });

                const membershipRoles = preparedMembers.flatMap((member) => member.resolved.effectiveRoleIds.map((roleId) => ({
                    tenantId: context.tenantId,
                    membershipId: member.membershipId,
                    roleId,
                })));
                await transaction.membershipRole.createMany({ data: membershipRoles });

                await transaction.tenantInvitation.createMany({
                    data: preparedMembers.map((member) => ({
                        id: member.invitationId,
                        tenantId: context.tenantId,
                        account: member.resolved.account,
                        normalizedAccount: member.resolved.account,
                        displayName: member.resolved.displayName,
                        targetMembershipId: member.membershipId,
                        tokenHash: hashToken(member.activationToken),
                        status: TenantInvitationStatus.PENDING,
                        expiresAt: member.activationExpiresAt,
                        invitedByUserId: context.userId,
                    })),
                });
                await transaction.tenantInvitationRole.createMany({
                    data: preparedMembers.flatMap((member) => member.resolved.effectiveRoleIds.map((roleId) => ({
                        invitationId: member.invitationId,
                        roleId,
                    }))),
                });

                await transaction.auditLog.create({
                    data: {
                        tenantId: context.tenantId,
                        actorUserId: context.userId,
                        actorMembershipId: context.membershipId,
                        action: 'ORGANIZATION_MEMBERS_IMPORTED',
                        outcome: AuditOutcome.SUCCESS,
                        resourceType: 'TENANT',
                        resourceId: context.tenantId,
                        requestId: context.requestId,
                        metadata: {
                            departmentCount: input.departments.length,
                            departmentCreateCount: analysis.validation.summary.departmentCreateCount,
                            departmentReuseCount: analysis.validation.summary.departmentReuseCount,
                            memberCount: preparedMembers.length,
                            activationExpiresAt: activationExpiresAt.toISOString(),
                        },
                    },
                });

                return {
                    summary: analysis.validation.summary,
                    departments: input.departments.map((department) => {
                        const resolved = analysis.resolvedDepartments.find(
                            (candidate) => candidate.input.clientRef === department.clientRef,
                        )!;
                        return {
                            clientRef: department.clientRef,
                            departmentId: departmentIdByClientRef.get(department.clientRef)!,
                            action: resolved.action,
                            path: resolved.path,
                        };
                    }),
                    members: preparedMembers.map((member) => ({
                        clientRef: member.resolved.input.clientRef,
                        membershipId: member.membershipId,
                        displayName: member.resolved.displayName,
                        account: member.resolved.account,
                        departmentId: member.departmentId,
                        departmentPath: member.resolved.department.path,
                        tenantCode: tenant.code,
                        activationToken: member.activationToken,
                        activationExpiresAt: member.activationExpiresAt,
                    })),
                };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (isPrismaError(error, 'P2002') || isPrismaError(error, 'P2034')) {
                throw new ConflictException({
                    code: 'ORGANIZATION_IMPORT_CONFLICT',
                    message: '部门或成员账号已被其他请求创建，请重新校验后再导入',
                });
            }
            throw error;
        }
    }

    private async analyze(
        database: OrganizationImportDb,
        tenantId: string,
        input: OrganizationImportDto,
    ): Promise<OrganizationImportAnalysis> {
        const issues: OrganizationImportIssue[] = [];
        const issueKeys = new Set<string>();
        const addIssue = (issue: OrganizationImportIssue): void => {
            const key = `${issue.scope}:${issue.clientRef ?? ''}:${issue.field ?? ''}:${issue.code}`;
            if (issueKeys.has(key)) return;
            issueKeys.add(key);
            issues.push(issue);
        };

        const now = new Date();
        const accounts = [...new Set(input.members.map((member) => normalizeAccount(member.account)))];
        const requestedRoleIds = [...new Set([
            ...input.defaultRoleIds,
            ...input.members.flatMap((member) => member.roleIds ?? []),
        ])];
        const [existingDepartments, existingMemberships, pendingInvitations, roles] = await Promise.all([
            database.department.findMany({
                where: { tenantId, deletedAt: null },
                select: { id: true, parentId: true, name: true, normalizedName: true, status: true },
            }),
            database.tenantMembership.findMany({
                where: { tenantId, normalizedAccount: { in: accounts }, deletedAt: null },
                select: { normalizedAccount: true },
            }),
            database.tenantInvitation.findMany({
                where: {
                    tenantId,
                    normalizedAccount: { in: accounts },
                    status: TenantInvitationStatus.PENDING,
                    expiresAt: { gt: now },
                },
                select: { normalizedAccount: true },
            }),
            database.role.findMany({
                where: { tenantId, id: { in: requestedRoleIds }, deletedAt: null },
                select: { id: true, code: true },
            }),
        ]);

        const roleById = new Map(roles.map((role) => [role.id, role]));
        for (const roleId of input.defaultRoleIds) {
            const role = roleById.get(roleId);
            if (!role) {
                addIssue(requestIssue('defaultRoleIds', 'ORGANIZATION_IMPORT_ROLE_NOT_FOUND', `默认角色 ${roleId} 不存在`));
            } else if (role.code === TENANT_ADMIN_ROLE_CODE) {
                addIssue(requestIssue(
                    'defaultRoleIds',
                    'ORGANIZATION_IMPORT_TENANT_ADMIN_FORBIDDEN',
                    '批量导入不能分配租户管理员角色',
                ));
            }
        }

        const departmentCounts = countBy(input.departments, (department) => department.clientRef);
        const duplicateDepartmentRefs = new Set(
            [...departmentCounts.entries()].filter(([, count]) => count > 1).map(([clientRef]) => clientRef),
        );
        for (const clientRef of duplicateDepartmentRefs) {
            addIssue(departmentIssue(
                clientRef,
                'clientRef',
                'ORGANIZATION_IMPORT_CLIENT_REF_DUPLICATE',
                '部门 clientRef 在当前批次中重复',
            ));
        }

        const memberRefCounts = countBy(input.members, (member) => member.clientRef);
        for (const [clientRef, count] of memberRefCounts) {
            if (count > 1) {
                addIssue(memberIssue(
                    clientRef,
                    'clientRef',
                    'ORGANIZATION_IMPORT_CLIENT_REF_DUPLICATE',
                    '成员 clientRef 在当前批次中重复',
                ));
            }
        }

        const importedSiblingCounts = countBy(input.departments, (department) => (
            `${department.parentClientRef ?? ROOT_PARENT_KEY}\u0000${normalizeDepartmentName(department.name)}`
        ));
        for (const department of input.departments) {
            const siblingKey = `${department.parentClientRef ?? ROOT_PARENT_KEY}\u0000${normalizeDepartmentName(department.name)}`;
            if ((importedSiblingCounts.get(siblingKey) ?? 0) > 1) {
                addIssue(departmentIssue(
                    department.clientRef,
                    'name',
                    'ORGANIZATION_IMPORT_DEPARTMENT_DUPLICATE',
                    '当前批次中同一上级部门下存在重名部门',
                ));
            }
        }

        const importedDepartmentByRef = new Map<string, OrganizationImportDepartmentDto>();
        for (const department of input.departments) {
            if (!importedDepartmentByRef.has(department.clientRef)) {
                importedDepartmentByRef.set(department.clientRef, department);
            }
        }
        const existingByParentAndName = new Map<string, ExistingDepartment>();
        for (const department of existingDepartments) {
            existingByParentAndName.set(departmentKey(department.parentId, department.normalizedName), department);
        }

        const resolvedByRef = new Map<string, ResolvedDepartment>();
        const resolving = new Set<string>();
        const resolvedDepartments: ResolvedDepartment[] = [];
        const resolveDepartment = (clientRef: string): ResolvedDepartment | null => {
            const cached = resolvedByRef.get(clientRef);
            if (cached) return cached;
            if (duplicateDepartmentRefs.has(clientRef)) return null;
            const department = importedDepartmentByRef.get(clientRef);
            if (!department) return null;
            if (resolving.has(clientRef)) {
                addIssue(departmentIssue(
                    clientRef,
                    'parentClientRef',
                    'ORGANIZATION_IMPORT_DEPARTMENT_CYCLE',
                    '部门父子关系不能形成循环',
                ));
                return null;
            }
            resolving.add(clientRef);

            let parent: ResolvedDepartment | null = null;
            if (department.parentClientRef) {
                if (!importedDepartmentByRef.has(department.parentClientRef)) {
                    addIssue(departmentIssue(
                        clientRef,
                        'parentClientRef',
                        'ORGANIZATION_IMPORT_PARENT_NOT_FOUND',
                        '上级部门 clientRef 不存在',
                    ));
                    resolving.delete(clientRef);
                    return null;
                }
                parent = resolveDepartment(department.parentClientRef);
                if (!parent) {
                    resolving.delete(clientRef);
                    return null;
                }
            }

            const normalizedName = normalizeDepartmentName(department.name);
            const existing = parent?.existingDepartmentId || !parent
                ? existingByParentAndName.get(departmentKey(parent?.existingDepartmentId ?? null, normalizedName))
                : undefined;
            const depth = parent ? parent.depth + 1 : 1;
            if (depth > ORGANIZATION_IMPORT_MAX_DEPTH) {
                addIssue(departmentIssue(
                    clientRef,
                    'parentClientRef',
                    'ORGANIZATION_IMPORT_DEPARTMENT_DEPTH_EXCEEDED',
                    `部门层级不能超过 ${ORGANIZATION_IMPORT_MAX_DEPTH} 级`,
                ));
            }
            if (existing?.status === DepartmentStatus.DISABLED) {
                addIssue(departmentIssue(
                    clientRef,
                    'name',
                    'ORGANIZATION_IMPORT_DEPARTMENT_DISABLED',
                    '匹配到的已有部门已停用，不能用于批量导入',
                ));
            }

            const canonicalName = existing?.name ?? normalizeName(department.name);
            const resolved: ResolvedDepartment = {
                input: department,
                normalizedName,
                normalizedDescription: normalizeDescription(department.description),
                action: existing ? 'REUSE' : 'CREATE',
                existingDepartmentId: existing?.id ?? null,
                path: parent ? `${parent.path}/${canonicalName}` : canonicalName,
                depth,
            };
            resolving.delete(clientRef);
            resolvedByRef.set(clientRef, resolved);
            resolvedDepartments.push(resolved);
            return resolved;
        };

        for (const department of input.departments) resolveDepartment(department.clientRef);

        const occupiedAccounts = new Set([
            ...existingMemberships.map((membership) => membership.normalizedAccount),
            ...pendingInvitations.map((invitation) => invitation.normalizedAccount),
        ]);
        const accountCounts = countBy(input.members, (member) => normalizeAccount(member.account));
        const resolvedMembers: ResolvedMember[] = [];
        const memberPreviews: OrganizationImportMemberPreview[] = [];
        for (const member of input.members) {
            const account = normalizeAccount(member.account);
            const displayName = normalizeName(member.displayName);
            if ((accountCounts.get(account) ?? 0) > 1) {
                addIssue(memberIssue(
                    member.clientRef,
                    'account',
                    'ORGANIZATION_IMPORT_ACCOUNT_DUPLICATE',
                    `账号 ${account} 在当前批次中重复`,
                ));
            }
            if (occupiedAccounts.has(account)) {
                addIssue(memberIssue(
                    member.clientRef,
                    'account',
                    'ORGANIZATION_IMPORT_ACCOUNT_EXISTS',
                    `账号 ${account} 已被当前租户使用或存在有效邀请`,
                ));
            }

            const department = resolvedByRef.get(member.departmentClientRef);
            if (!department) {
                addIssue(memberIssue(
                    member.clientRef,
                    'departmentClientRef',
                    'ORGANIZATION_IMPORT_MEMBER_DEPARTMENT_NOT_FOUND',
                    '成员关联的部门不存在或部门数据无效',
                ));
                continue;
            }

            const effectiveRoleIds = [...new Set(member.roleIds ?? input.defaultRoleIds)];
            for (const roleId of effectiveRoleIds) {
                const role = roleById.get(roleId);
                if (!role) {
                    addIssue(memberIssue(
                        member.clientRef,
                        'roleIds',
                        'ORGANIZATION_IMPORT_ROLE_NOT_FOUND',
                        `角色 ${roleId} 不存在`,
                    ));
                } else if (role.code === TENANT_ADMIN_ROLE_CODE) {
                    addIssue(memberIssue(
                        member.clientRef,
                        'roleIds',
                        'ORGANIZATION_IMPORT_TENANT_ADMIN_FORBIDDEN',
                        '批量导入不能分配租户管理员角色',
                    ));
                }
            }

            const resolvedMember: ResolvedMember = {
                input: member,
                account,
                displayName,
                department,
                effectiveRoleIds,
            };
            resolvedMembers.push(resolvedMember);
            memberPreviews.push({
                clientRef: member.clientRef,
                account,
                displayName,
                departmentClientRef: member.departmentClientRef,
                departmentPath: department.path,
                effectiveRoleIds,
            });
        }

        const departmentPreviews = input.departments.flatMap((department) => {
            const resolved = resolvedByRef.get(department.clientRef);
            return resolved ? [{
                clientRef: department.clientRef,
                action: resolved.action,
                departmentId: resolved.existingDepartmentId,
                path: resolved.path,
            }] : [];
        });
        const summary: OrganizationImportSummary = {
            departmentCount: input.departments.length,
            departmentCreateCount: departmentPreviews.filter((department) => department.action === 'CREATE').length,
            departmentReuseCount: departmentPreviews.filter((department) => department.action === 'REUSE').length,
            memberCount: input.members.length,
        };
        const validation: OrganizationImportValidationResult = {
            valid: issues.length === 0,
            summary,
            departments: departmentPreviews,
            members: memberPreviews,
            issues,
        };
        return { validation, resolvedDepartments, resolvedMembers };
    }

    private assertValid(validation: OrganizationImportValidationResult): void {
        if (validation.valid) return;
        const containsTenantAdmin = validation.issues.some(
            (issue) => issue.code === 'ORGANIZATION_IMPORT_TENANT_ADMIN_FORBIDDEN',
        );
        const exception = containsTenantAdmin ? ForbiddenException : BadRequestException;
        throw new exception({
            code: 'ORGANIZATION_IMPORT_INVALID',
            message: '批量导入数据校验失败',
            details: validation.issues,
        });
    }
}

function departmentKey(parentId: string | null, normalizedName: string): string {
    return `${parentId ?? ROOT_PARENT_KEY}\u0000${normalizedName}`;
}

function normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

function normalizeDepartmentName(value: string): string {
    return normalizeName(value).toLocaleLowerCase();
}

function normalizeDescription(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function countBy<T>(items: T[], keySelector: (item: T) => string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) {
        const key = keySelector(item);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

function requestIssue(field: string, code: string, message: string): OrganizationImportIssue {
    return { scope: 'REQUEST', clientRef: null, field, code, message };
}

function departmentIssue(
    clientRef: string,
    field: string,
    code: string,
    message: string,
): OrganizationImportIssue {
    return { scope: 'DEPARTMENT', clientRef, field, code, message };
}

function memberIssue(clientRef: string, field: string, code: string, message: string): OrganizationImportIssue {
    return { scope: 'MEMBER', clientRef, field, code, message };
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
