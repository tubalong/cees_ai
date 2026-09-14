import {
    BadGatewayException,
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    AuditOutcome,
    DingTalkIntegrationStatus,
    DingTalkSyncJobStatus,
    DingTalkSyncType,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import {
    CreateDingTalkIntegrationDto,
    ListDingTalkOrganizationQueryDto,
    ListDingTalkSyncJobsQueryDto,
    UpdateDingTalkIntegrationDto,
} from './dto';
import { DingTalkClient } from './dingtalk.client';
import { DingTalkCredentialCipher } from './dingtalk-credential-cipher';
import {
    CursorListResult,
    DingTalkDepartmentResult,
    DingTalkIntegrationResult,
    DingTalkSyncJobResult,
    DingTalkUserResult,
} from './dingtalk.types';

const integrationSelect = {
    id: true,
    tenantId: true,
    corpId: true,
    appKey: true,
    appSecretCiphertext: true,
    status: true,
    lastVerifiedAt: true,
    lastSyncedAt: true,
    lastErrorCode: true,
    lastErrorMessage: true,
    version: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.DingTalkIntegrationSelect;

type IntegrationRecord = Prisma.DingTalkIntegrationGetPayload<{ select: typeof integrationSelect }>;

@Injectable()
export class DingTalkService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly client: DingTalkClient,
        private readonly credentialCipher: DingTalkCredentialCipher,
    ) { }

    async getIntegration(): Promise<DingTalkIntegrationResult> {
        const { tenantId } = this.tenantContext.require();
        return toIntegrationResult(await this.requireIntegration(tenantId));
    }

    async createIntegration(input: CreateDingTalkIntegrationDto): Promise<DingTalkIntegrationResult> {
        const context = this.tenantContext.require();
        const existing = await this.prisma.dingTalkIntegration.findUnique({
            where: { tenantId: context.tenantId },
            select: { id: true },
        });
        if (existing) throw this.integrationExists();
        await this.client.verify({ appKey: input.appKey.trim(), appSecret: input.appSecret });
        const now = new Date();
        try {
            const integration = await this.prisma.$transaction(async (transaction) => {
                const created = await transaction.dingTalkIntegration.create({
                    data: {
                        tenantId: context.tenantId,
                        corpId: input.corpId.trim(),
                        appKey: input.appKey.trim(),
                        appSecretCiphertext: this.credentialCipher.encrypt(input.appSecret),
                        status: DingTalkIntegrationStatus.ACTIVE,
                        lastVerifiedAt: now,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                    select: integrationSelect,
                });
                await this.writeAudit(transaction, context, 'DINGTALK_INTEGRATION_CREATED', 'DINGTALK_INTEGRATION', created.id, {
                    corpId: created.corpId,
                    appKey: created.appKey,
                });
                return created;
            });
            return toIntegrationResult(integration);
        } catch (error) {
            if (isPrismaError(error, 'P2002')) throw this.integrationConflict();
            throw error;
        }
    }

    async updateIntegration(input: UpdateDingTalkIntegrationDto): Promise<DingTalkIntegrationResult> {
        const context = this.tenantContext.require();
        const current = await this.requireIntegration(context.tenantId);
        if (input.appKey === undefined && input.appSecret === undefined && input.status === undefined) {
            throw new BadRequestException({ code: 'DINGTALK_INTEGRATION_UPDATE_EMPTY', message: '至少提供一个需要修改的字段' });
        }
        const appKey = input.appKey?.trim() ?? current.appKey;
        const appSecret = input.appSecret ?? this.credentialCipher.decrypt(current.appSecretCiphertext);
        if (input.status !== DingTalkIntegrationStatus.DISABLED) {
            await this.client.verify({ appKey, appSecret });
        }
        const now = new Date();
        const updated = await this.prisma.$transaction(async (transaction) => {
            const result = await transaction.dingTalkIntegration.updateMany({
                where: { id: current.id, tenantId: context.tenantId, version: input.version },
                data: {
                    appKey,
                    appSecretCiphertext: input.appSecret === undefined
                        ? current.appSecretCiphertext
                        : this.credentialCipher.encrypt(input.appSecret),
                    status: input.status ?? DingTalkIntegrationStatus.ACTIVE,
                    lastVerifiedAt: input.status === DingTalkIntegrationStatus.DISABLED ? current.lastVerifiedAt : now,
                    lastErrorCode: null,
                    lastErrorMessage: null,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (result.count !== 1) throw this.versionConflict();
            await this.writeAudit(transaction, context, 'DINGTALK_INTEGRATION_UPDATED', 'DINGTALK_INTEGRATION', current.id, {
                appKeyChanged: appKey !== current.appKey,
                secretChanged: input.appSecret !== undefined,
                status: input.status ?? DingTalkIntegrationStatus.ACTIVE,
            });
            return transaction.dingTalkIntegration.findUniqueOrThrow({ where: { id: current.id }, select: integrationSelect });
        });
        return toIntegrationResult(updated);
    }

    async verifyIntegration(): Promise<DingTalkIntegrationResult> {
        const context = this.tenantContext.require();
        const current = await this.requireIntegration(context.tenantId);
        try {
            await this.client.verify({
                appKey: current.appKey,
                appSecret: this.credentialCipher.decrypt(current.appSecretCiphertext),
            });
        } catch (error) {
            await this.prisma.dingTalkIntegration.update({
                where: { id: current.id },
                data: {
                    status: DingTalkIntegrationStatus.ERROR,
                    lastErrorCode: errorCode(error),
                    lastErrorMessage: errorMessage(error),
                    version: { increment: 1 },
                },
            });
            throw error;
        }
        const verifiedAt = new Date();
        const updated = await this.prisma.$transaction(async (transaction) => {
            const integration = await transaction.dingTalkIntegration.update({
                where: { id: current.id },
                data: {
                    status: DingTalkIntegrationStatus.ACTIVE,
                    lastVerifiedAt: verifiedAt,
                    lastErrorCode: null,
                    lastErrorMessage: null,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
                select: integrationSelect,
            });
            await this.writeAudit(transaction, context, 'DINGTALK_INTEGRATION_VERIFIED', 'DINGTALK_INTEGRATION', current.id, {
                verifiedAt: verifiedAt.toISOString(),
            });
            return integration;
        });
        return toIntegrationResult(updated);
    }

    async syncOrganization(): Promise<DingTalkSyncJobResult> {
        const context = this.tenantContext.require();
        const integration = await this.requireIntegration(context.tenantId);
        if (integration.status !== DingTalkIntegrationStatus.ACTIVE) {
            throw new ConflictException({ code: 'DINGTALK_INTEGRATION_NOT_ACTIVE', message: '钉钉集成未启用或连接异常' });
        }
        let job: Awaited<ReturnType<typeof this.prisma.dingTalkSyncJob.create>>;
        try {
            job = await this.prisma.dingTalkSyncJob.create({
                data: {
                    tenantId: context.tenantId,
                    integrationId: integration.id,
                    type: DingTalkSyncType.FULL_ORGANIZATION,
                    status: DingTalkSyncJobStatus.RUNNING,
                    createdBy: context.userId,
                },
            });
        } catch (error) {
            if (isPrismaError(error, 'P2002')) {
                throw new ConflictException({ code: 'DINGTALK_SYNC_ALREADY_RUNNING', message: '当前租户已有钉钉组织同步任务正在执行' });
            }
            throw error;
        }
        try {
            const snapshot = await this.client.fetchOrganization({
                appKey: integration.appKey,
                appSecret: this.credentialCipher.decrypt(integration.appSecretCiphertext),
            });
            const completedAt = new Date();
            const completed = await this.prisma.$transaction(async (transaction) => {
                for (const department of snapshot.departments) {
                    await transaction.dingTalkDepartment.upsert({
                        where: {
                            integrationId_externalDepartmentId: {
                                integrationId: integration.id,
                                externalDepartmentId: department.externalDepartmentId,
                            },
                        },
                        create: {
                            tenantId: context.tenantId,
                            integrationId: integration.id,
                            externalDepartmentId: department.externalDepartmentId,
                            parentExternalDepartmentId: department.parentExternalDepartmentId,
                            name: department.name,
                            displayOrder: department.displayOrder,
                            isDeleted: false,
                            lastSeenAt: completedAt,
                        },
                        update: {
                            parentExternalDepartmentId: department.parentExternalDepartmentId,
                            name: department.name,
                            displayOrder: department.displayOrder,
                            isDeleted: false,
                            lastSeenAt: completedAt,
                        },
                    });
                }
                for (const user of snapshot.users) {
                    await transaction.dingTalkUser.upsert({
                        where: {
                            integrationId_externalUserId: {
                                integrationId: integration.id,
                                externalUserId: user.externalUserId,
                            },
                        },
                        create: {
                            tenantId: context.tenantId,
                            integrationId: integration.id,
                            externalUserId: user.externalUserId,
                            unionId: user.unionId,
                            name: user.name,
                            title: user.title,
                            jobNumber: user.jobNumber,
                            departmentExternalIds: user.departmentExternalIds,
                            active: user.active,
                            admin: user.admin,
                            boss: user.boss,
                            isDeleted: false,
                            lastSeenAt: completedAt,
                        },
                        update: {
                            unionId: user.unionId,
                            name: user.name,
                            title: user.title,
                            jobNumber: user.jobNumber,
                            departmentExternalIds: user.departmentExternalIds,
                            active: user.active,
                            admin: user.admin,
                            boss: user.boss,
                            isDeleted: false,
                            lastSeenAt: completedAt,
                        },
                    });
                }
                await transaction.dingTalkDepartment.updateMany({
                    where: { integrationId: integration.id, lastSeenAt: { lt: completedAt }, isDeleted: false },
                    data: { isDeleted: true },
                });
                await transaction.dingTalkUser.updateMany({
                    where: { integrationId: integration.id, lastSeenAt: { lt: completedAt }, isDeleted: false },
                    data: { isDeleted: true, active: false },
                });
                await transaction.dingTalkIntegration.update({
                    where: { id: integration.id },
                    data: {
                        status: DingTalkIntegrationStatus.ACTIVE,
                        lastSyncedAt: completedAt,
                        lastErrorCode: null,
                        lastErrorMessage: null,
                        updatedBy: context.userId,
                        version: { increment: 1 },
                    },
                });
                const finished = await transaction.dingTalkSyncJob.update({
                    where: { id: job.id },
                    data: {
                        status: DingTalkSyncJobStatus.SUCCEEDED,
                        departmentCount: snapshot.departments.length,
                        userCount: snapshot.users.length,
                        completedAt,
                    },
                });
                await this.writeAudit(transaction, context, 'DINGTALK_ORGANIZATION_SYNCED', 'DINGTALK_SYNC_JOB', job.id, {
                    integrationId: integration.id,
                    departmentCount: snapshot.departments.length,
                    userCount: snapshot.users.length,
                });
                return finished;
            });
            return toSyncJobResult(completed);
        } catch (error) {
            const completedAt = new Date();
            const code = errorCode(error);
            const message = errorMessage(error);
            const failed = await this.prisma.$transaction(async (transaction) => {
                await transaction.dingTalkIntegration.update({
                    where: { id: integration.id },
                    data: {
                        status: DingTalkIntegrationStatus.ERROR,
                        lastErrorCode: code,
                        lastErrorMessage: message,
                        updatedBy: context.userId,
                        version: { increment: 1 },
                    },
                });
                const result = await transaction.dingTalkSyncJob.update({
                    where: { id: job.id },
                    data: { status: DingTalkSyncJobStatus.FAILED, errorCode: code, errorMessage: message, completedAt },
                });
                await this.writeAudit(transaction, context, 'DINGTALK_ORGANIZATION_SYNC_FAILED', 'DINGTALK_SYNC_JOB', job.id, {
                    integrationId: integration.id,
                    code,
                }, AuditOutcome.FAILURE);
                return result;
            });
            if (error instanceof BadGatewayException) throw error;
            throw new BadGatewayException({ code: failed.errorCode ?? 'DINGTALK_SYNC_FAILED', message });
        }
    }

    async listDepartments(query: ListDingTalkOrganizationQueryDto): Promise<CursorListResult<DingTalkDepartmentResult>> {
        const { tenantId } = this.tenantContext.require();
        const integration = await this.requireIntegration(tenantId);
        await this.validateCursor('department', integration.id, query.cursor);
        const records = await this.prisma.dingTalkDepartment.findMany({
            where: { tenantId, integrationId: integration.id, isDeleted: query.includeDeleted ? undefined : false },
            orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        return paginate(records, query.limit, toDepartmentResult);
    }

    async listUsers(query: ListDingTalkOrganizationQueryDto): Promise<CursorListResult<DingTalkUserResult>> {
        const { tenantId } = this.tenantContext.require();
        const integration = await this.requireIntegration(tenantId);
        await this.validateCursor('user', integration.id, query.cursor);
        const records = await this.prisma.dingTalkUser.findMany({
            where: { tenantId, integrationId: integration.id, isDeleted: query.includeDeleted ? undefined : false },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        return paginate(records, query.limit, toUserResult);
    }

    async listSyncJobs(query: ListDingTalkSyncJobsQueryDto): Promise<CursorListResult<DingTalkSyncJobResult>> {
        const { tenantId } = this.tenantContext.require();
        const integration = await this.requireIntegration(tenantId);
        await this.validateCursor('job', integration.id, query.cursor);
        const records = await this.prisma.dingTalkSyncJob.findMany({
            where: { tenantId, integrationId: integration.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        return paginate(records, query.limit, toSyncJobResult);
    }

    private async validateCursor(type: 'department' | 'user' | 'job', integrationId: string, cursor?: string): Promise<void> {
        if (!cursor) return;
        const record = type === 'department'
            ? await this.prisma.dingTalkDepartment.findFirst({ where: { id: cursor, integrationId }, select: { id: true } })
            : type === 'user'
                ? await this.prisma.dingTalkUser.findFirst({ where: { id: cursor, integrationId }, select: { id: true } })
                : await this.prisma.dingTalkSyncJob.findFirst({ where: { id: cursor, integrationId }, select: { id: true } });
        if (!record) throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
    }

    private async requireIntegration(tenantId: string): Promise<IntegrationRecord> {
        const integration = await this.prisma.dingTalkIntegration.findUnique({ where: { tenantId }, select: integrationSelect });
        if (!integration) {
            throw new NotFoundException({ code: 'DINGTALK_INTEGRATION_NOT_FOUND', message: '当前租户尚未绑定钉钉企业' });
        }
        return integration;
    }

    private async writeAudit(
        transaction: Prisma.TransactionClient,
        context: ReturnType<TenantContext['require']>,
        action: string,
        resourceType: string,
        resourceId: string,
        metadata: Record<string, unknown>,
        outcome: AuditOutcome = AuditOutcome.SUCCESS,
    ): Promise<void> {
        await transaction.auditLog.create({
            data: {
                tenantId: context.tenantId,
                actorUserId: context.userId,
                actorMembershipId: context.membershipId,
                action,
                outcome,
                resourceType,
                resourceId,
                requestId: context.requestId,
                metadata: metadata as Prisma.InputJsonValue,
            },
        });
    }

    private integrationExists(): ConflictException {
        return new ConflictException({ code: 'DINGTALK_INTEGRATION_EXISTS', message: '当前租户已经绑定钉钉企业' });
    }

    private integrationConflict(): ConflictException {
        return new ConflictException({ code: 'DINGTALK_CORP_ALREADY_BOUND', message: '该钉钉企业已经绑定其他租户' });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'RESOURCE_VERSION_CONFLICT', message: '数据已被其他请求修改，请刷新后重试' });
    }
}

function toIntegrationResult(record: IntegrationRecord): DingTalkIntegrationResult {
    const { appSecretCiphertext: _appSecretCiphertext, ...result } = record;
    return result;
}

function toDepartmentResult(record: {
    id: string;
    externalDepartmentId: string;
    parentExternalDepartmentId: string | null;
    departmentId: string | null;
    name: string;
    displayOrder: number;
    isDeleted: boolean;
    lastSeenAt: Date;
    createdAt: Date;
    updatedAt: Date;
}): DingTalkDepartmentResult {
    return record;
}

function toUserResult(record: {
    id: string;
    externalUserId: string;
    unionId: string | null;
    membershipId: string | null;
    name: string;
    title: string | null;
    jobNumber: string | null;
    departmentExternalIds: Prisma.JsonValue;
    active: boolean;
    admin: boolean;
    boss: boolean;
    isDeleted: boolean;
    lastSeenAt: Date;
    createdAt: Date;
    updatedAt: Date;
}): DingTalkUserResult {
    return {
        ...record,
        departmentExternalIds: Array.isArray(record.departmentExternalIds)
            ? record.departmentExternalIds.filter((value): value is string => typeof value === 'string')
            : [],
    };
}

function toSyncJobResult(record: {
    id: string;
    integrationId: string;
    type: DingTalkSyncType;
    status: DingTalkSyncJobStatus;
    departmentCount: number;
    userCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: Date;
    completedAt: Date | null;
    createdAt: Date;
}): DingTalkSyncJobResult {
    return record;
}

function paginate<T extends { id: string }, R>(records: T[], limit: number, mapper: (record: T) => R): CursorListResult<R> {
    const hasNextPage = records.length > limit;
    const page = hasNextPage ? records.slice(0, limit) : records;
    return {
        items: page.map(mapper),
        nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
    };
}

function isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function errorCode(error: unknown): string {
    if (error instanceof BadGatewayException) {
        const response = error.getResponse();
        if (typeof response === 'object' && response && 'code' in response && typeof response.code === 'string') {
            return response.code;
        }
    }
    return 'DINGTALK_SYNC_FAILED';
}

function errorMessage(error: unknown): string {
    if (error instanceof BadGatewayException) {
        const response = error.getResponse();
        if (typeof response === 'object' && response && 'message' in response && typeof response.message === 'string') {
            return response.message;
        }
    }
    return error instanceof Error ? error.message : '钉钉组织同步失败';
}

