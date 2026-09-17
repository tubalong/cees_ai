import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditOutcome, FilePurpose, LegalContractStatus, MembershipStatus, Prisma } from '@prisma/client';
import { calendarYear, dateKeyToUtcMidnight, DEFAULT_TENANT_TIMEZONE, localDateKey } from '../common/tenant-time';
import { PrismaService } from '../database/prisma.service';
import { DataScopeResolverService } from '../rbac/data-scope-resolver.service';
import { TenantContext } from '../tenant/tenant-context';
import {
    CreateLegalContractDto, LegalContractActionDto, LegalContractSummaryQueryDto,
    ListLegalContractsQueryDto, RenewLegalContractDto, TerminateLegalContractDto, UpdateLegalContractDto,
} from './dto';

type DbClient = PrismaService | Prisma.TransactionClient;
type JsonRecord = Record<string, unknown>;

const contractInclude = {
    attachments: { include: { fileObject: true }, orderBy: { createdAt: 'asc' as const } },
    statusHistory: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.LegalContractInclude;

type ContractRecord = Prisma.LegalContractGetPayload<{ include: typeof contractInclude }>;

const ACTIVE_LIFECYCLE_STATUSES: LegalContractStatus[] = [
    LegalContractStatus.ACTIVE,
    LegalContractStatus.PENDING_RENEWAL,
];

@Injectable()
export class LegalService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly dataScopeResolver: DataScopeResolverService,
    ) { }

    async listContracts(query: ListLegalContractsQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        await this.validateCursor(query.cursor);
        const currency = query.currency ? normalizeCurrency(query.currency) : undefined;
        const expiringRange = query.expiringWithinDays === undefined
            ? undefined
            : await this.expiringDateRange(query.expiringWithinDays);
        const contracts = await this.prisma.legalContract.findMany({
            where: {
                tenantId: context.tenantId,
                deletedAt: null,
                AND: [await this.contractScopeWhere()],
                status: expiringRange ? { in: ACTIVE_LIFECYCLE_STATUSES } : query.status,
                type: query.type,
                ownerMembershipId: query.ownerMembershipId,
                departmentId: query.departmentId,
                projectId: query.projectId,
                currency,
                endDate: expiringRange ?? optionalDateRange(query.endDateFrom, query.endDateTo),
                OR: query.keyword?.trim() ? [
                    { contractNo: { contains: query.keyword.trim(), mode: 'insensitive' } },
                    { name: { contains: query.keyword.trim(), mode: 'insensitive' } },
                    { counterparty: { contains: query.keyword.trim(), mode: 'insensitive' } },
                ] : undefined,
            },
            include: contractInclude,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNext = contracts.length > query.limit;
        const page = hasNext ? contracts.slice(0, query.limit) : contracts;
        return { items: page.map(toContract), nextCursor: hasNext ? page.at(-1)?.id ?? null : null };
    }

    async createContract(input: CreateLegalContractDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const prepared = await this.prepareCreateInput(input);
        try {
            const contract = await this.prisma.$transaction(async (transaction) => {
                const contractNo = input.contractNo
                    ? normalizeContractNo(input.contractNo)
                    : await this.nextContractNo(transaction);
                const created = await transaction.legalContract.create({
                    data: {
                        tenantId: context.tenantId,
                        contractNo,
                        name: input.name.trim(),
                        counterparty: input.counterparty.trim(),
                        type: input.type,
                        amount: input.amount == null ? null : new Prisma.Decimal(input.amount),
                        currency: normalizeCurrency(input.currency),
                        startDate: prepared.startDate,
                        endDate: prepared.endDate,
                        signedAt: prepared.signedAt,
                        description: normalizeNullable(input.description),
                        ownerMembershipId: input.ownerMembershipId,
                        departmentId: input.departmentId ?? null,
                        projectId: input.projectId ?? null,
                        renewalReminderDays: input.renewalReminderDays,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                        attachments: {
                            create: input.attachmentIds.map((fileObjectId) => ({ tenantId: context.tenantId, fileObjectId })),
                        },
                        statusHistory: {
                            create: {
                                tenantId: context.tenantId,
                                toStatus: LegalContractStatus.DRAFT,
                                actorMembershipId: context.membershipId,
                            },
                        },
                    },
                    include: contractInclude,
                });
                await this.audit(transaction, 'LEGAL_CONTRACT_CREATED', created.id, {
                    contractNo, status: LegalContractStatus.DRAFT,
                });
                return created;
            });
            return toContract(contract);
        } catch (error) {
            this.handleUniqueConflict(error);
        }
    }

    async getContract(contractId: string): Promise<JsonRecord> {
        return toContract(await this.requireScopedContract(contractId));
    }

    async updateContract(contractId: string, input: UpdateLegalContractDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const existing = await this.requireScopedContract(contractId);
        this.assertUpdateAllowed(existing.status, input);
        const ownerMembershipId = input.ownerMembershipId ?? existing.ownerMembershipId;
        const departmentId = input.departmentId === undefined ? existing.departmentId : input.departmentId;
        const projectId = input.projectId === undefined ? existing.projectId : input.projectId;
        const attachmentIds = input.attachmentIds ?? existing.attachments.map((attachment) => attachment.fileObjectId);
        const startDate = input.startDate === undefined ? existing.startDate : parseDateOnly(input.startDate);
        const endDate = input.endDate === undefined ? existing.endDate : nullableDate(input.endDate);
        const signedAt = input.signedAt === undefined ? existing.signedAt : nullableDate(input.signedAt);
        validateDateRange(startDate, endDate);
        await this.validateReferences(ownerMembershipId, departmentId, projectId, attachmentIds);
        await this.assertWriteScope(ownerMembershipId, departmentId, projectId);
        try {
            const contract = await this.prisma.$transaction(async (transaction) => {
                const changed = await transaction.legalContract.updateMany({
                    where: {
                        id: contractId, tenantId: context.tenantId, deletedAt: null,
                        status: existing.status, version: input.version,
                    },
                    data: {
                        contractNo: input.contractNo === undefined ? undefined : normalizeContractNo(input.contractNo),
                        name: input.name === undefined ? undefined : input.name.trim(),
                        counterparty: input.counterparty === undefined ? undefined : input.counterparty.trim(),
                        type: input.type,
                        amount: input.amount === undefined ? undefined : input.amount === null ? null : new Prisma.Decimal(input.amount),
                        currency: input.currency === undefined ? undefined : normalizeCurrency(input.currency),
                        startDate: input.startDate === undefined ? undefined : startDate,
                        endDate: input.endDate === undefined ? undefined : endDate,
                        signedAt: input.signedAt === undefined ? undefined : signedAt,
                        description: input.description === undefined ? undefined : normalizeNullable(input.description),
                        ownerMembershipId: input.ownerMembershipId,
                        departmentId: input.departmentId,
                        projectId: input.projectId,
                        renewalReminderDays: input.renewalReminderDays,
                        updatedBy: context.userId,
                        version: { increment: 1 },
                    },
                });
                if (changed.count !== 1) throw this.versionConflict();
                if (input.attachmentIds !== undefined) {
                    await transaction.legalContractAttachment.deleteMany({ where: { contractId, tenantId: context.tenantId } });
                    if (attachmentIds.length > 0) {
                        await transaction.legalContractAttachment.createMany({
                            data: attachmentIds.map((fileObjectId) => ({ tenantId: context.tenantId, contractId, fileObjectId })),
                        });
                    }
                }
                await this.audit(transaction, 'LEGAL_CONTRACT_UPDATED', contractId, {
                    fields: Object.keys(input).filter((field) => field !== 'version'),
                });
                return transaction.legalContract.findUniqueOrThrow({ where: { id: contractId }, include: contractInclude });
            });
            return toContract(contract);
        } catch (error) {
            this.handleUniqueConflict(error);
        }
    }

    async deleteContract(contractId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        const existing = await this.requireScopedContract(contractId);
        if (existing.status !== LegalContractStatus.DRAFT) {
            throw this.stateConflict('仅草稿合同可以删除，其他合同请终止或归档');
        }
        await this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.legalContract.updateMany({
                where: {
                    id: contractId, tenantId: context.tenantId, deletedAt: null,
                    status: LegalContractStatus.DRAFT, version,
                },
                data: { deletedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await this.audit(transaction, 'LEGAL_CONTRACT_DELETED', contractId, { contractNo: existing.contractNo });
        });
    }

    async activateContract(contractId: string, input: LegalContractActionDto): Promise<JsonRecord> {
        const existing = await this.requireScopedContract(contractId);
        if (existing.status !== LegalContractStatus.DRAFT) throw this.stateConflict('仅草稿合同可以激活');
        if (!existing.signedAt) {
            throw new BadRequestException({ code: 'LEGAL_CONTRACT_SIGNED_AT_REQUIRED', message: '合同激活前必须填写签署日期' });
        }
        await this.validateReferences(
            existing.ownerMembershipId,
            existing.departmentId,
            existing.projectId,
            existing.attachments.map((attachment) => attachment.fileObjectId),
        );
        await this.assertWriteScope(existing.ownerMembershipId, existing.departmentId, existing.projectId);
        return this.transition(existing, input.version, LegalContractStatus.ACTIVE, 'LEGAL_CONTRACT_ACTIVATED', {
            activatedAt: new Date(),
        }, input.comment);
    }

    async markPendingRenewal(contractId: string, input: LegalContractActionDto): Promise<JsonRecord> {
        const existing = await this.requireScopedContract(contractId);
        if (existing.status !== LegalContractStatus.ACTIVE) throw this.stateConflict('仅生效合同可以标记待续签');
        if (!existing.endDate) {
            throw new BadRequestException({ code: 'LEGAL_CONTRACT_END_DATE_REQUIRED', message: '无固定期限合同不能标记待续签' });
        }
        return this.transition(existing, input.version, LegalContractStatus.PENDING_RENEWAL,
            'LEGAL_CONTRACT_PENDING_RENEWAL', {}, input.comment);
    }

    async renewContract(contractId: string, input: RenewLegalContractDto): Promise<JsonRecord> {
        const existing = await this.requireScopedContract(contractId);
        if (!(<LegalContractStatus[]>[LegalContractStatus.PENDING_RENEWAL, LegalContractStatus.EXPIRED]).includes(existing.status)) {
            throw this.stateConflict('仅待续签或已到期合同可以续签');
        }
        if (!existing.endDate) throw this.stateConflict('无固定期限合同不能续签');
        const newEndDate = parseDateOnly(input.newEndDate);
        if (newEndDate <= existing.endDate) {
            throw new BadRequestException({ code: 'LEGAL_CONTRACT_RENEWAL_DATE_INVALID', message: '新到期日期必须晚于原到期日期' });
        }
        return this.transition(existing, input.version, LegalContractStatus.ACTIVE, 'LEGAL_CONTRACT_RENEWED', {
            endDate: newEndDate,
            renewalReminderDays: input.renewalReminderDays,
            activatedAt: new Date(),
        }, input.comment, { previousEndDate: dateOnly(existing.endDate), newEndDate: input.newEndDate });
    }

    async terminateContract(contractId: string, input: TerminateLegalContractDto): Promise<JsonRecord> {
        const existing = await this.requireScopedContract(contractId);
        if (!ACTIVE_LIFECYCLE_STATUSES.includes(existing.status)) {
            throw this.stateConflict('仅生效或待续签合同可以提前终止');
        }
        const effectiveDate = parseDateOnly(input.effectiveDate);
        const today = await this.currentTenantDate();
        if (effectiveDate < existing.startDate || effectiveDate > today) {
            throw new BadRequestException({ code: 'LEGAL_CONTRACT_TERMINATION_DATE_INVALID', message: '终止日期必须位于合同生效日期与当前租户日期之间' });
        }
        return this.transition(existing, input.version, LegalContractStatus.TERMINATED, 'LEGAL_CONTRACT_TERMINATED', {
            terminatedAt: effectiveDate,
            terminationReason: input.reason.trim(),
        }, input.reason);
    }

    async archiveContract(contractId: string, input: LegalContractActionDto): Promise<JsonRecord> {
        const existing = await this.requireScopedContract(contractId);
        if (!(<LegalContractStatus[]>[LegalContractStatus.EXPIRED, LegalContractStatus.TERMINATED]).includes(existing.status)) {
            throw this.stateConflict('仅已到期或已终止合同可以归档');
        }
        return this.transition(existing, input.version, LegalContractStatus.ARCHIVED, 'LEGAL_CONTRACT_ARCHIVED', {
            archivedAt: new Date(),
        }, input.comment);
    }

    async contractSummary(query: LegalContractSummaryQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const asOf = query.asOf ? parseDateOnly(query.asOf) : await this.currentTenantDate();
        const expiringEnd = addUtcDays(asOf, query.expiringWithinDays);
        const contracts = await this.prisma.legalContract.findMany({
            where: { tenantId: context.tenantId, deletedAt: null, AND: [await this.contractScopeWhere()] },
            select: { status: true, endDate: true, currency: true, amount: true },
        });
        const counts = new Map<LegalContractStatus, number>();
        const amountMap = new Map<string, { activeAmount: Prisma.Decimal; expiringAmount: Prisma.Decimal }>();
        let expiringCount = 0;
        for (const contract of contracts) {
            counts.set(contract.status, (counts.get(contract.status) ?? 0) + 1);
            const expiring = Boolean(
                contract.endDate
                && ACTIVE_LIFECYCLE_STATUSES.includes(contract.status)
                && contract.endDate >= asOf
                && contract.endDate <= expiringEnd,
            );
            if (expiring) expiringCount += 1;
            if (contract.amount === null) continue;
            const totals = amountMap.get(contract.currency) ?? {
                activeAmount: new Prisma.Decimal(0), expiringAmount: new Prisma.Decimal(0),
            };
            if (contract.status === LegalContractStatus.ACTIVE) totals.activeAmount = totals.activeAmount.add(contract.amount);
            if (expiring) totals.expiringAmount = totals.expiringAmount.add(contract.amount);
            amountMap.set(contract.currency, totals);
        }
        return {
            asOf: dateOnly(asOf), expiringWithinDays: query.expiringWithinDays, totalCount: contracts.length,
            draftCount: counts.get(LegalContractStatus.DRAFT) ?? 0,
            activeCount: counts.get(LegalContractStatus.ACTIVE) ?? 0,
            pendingRenewalCount: counts.get(LegalContractStatus.PENDING_RENEWAL) ?? 0,
            expiringCount,
            expiredCount: counts.get(LegalContractStatus.EXPIRED) ?? 0,
            terminatedCount: counts.get(LegalContractStatus.TERMINATED) ?? 0,
            archivedCount: counts.get(LegalContractStatus.ARCHIVED) ?? 0,
            amountsByCurrency: [...amountMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, totals]) => ({
                currency, activeAmount: totals.activeAmount.toNumber(), expiringAmount: totals.expiringAmount.toNumber(),
            })),
        };
    }

    async processLifecycle(now = new Date()): Promise<number> {
        const contracts = await this.prisma.legalContract.findMany({
            where: {
                deletedAt: null,
                status: { in: ACTIVE_LIFECYCLE_STATUSES },
                endDate: { not: null },
            },
            select: {
                id: true,
                tenantId: true,
                status: true,
                version: true,
                endDate: true,
                renewalReminderDays: true,
                tenant: { select: { timezone: true } },
            },
        });
        let transitioned = 0;
        for (const contract of contracts) {
            if (!contract.endDate) continue;
            const timeZone = contract.tenant.timezone || DEFAULT_TENANT_TIMEZONE;
            const today = dateKeyToUtcMidnight(localDateKey(timeZone, now));
            if (contract.endDate < today) {
                transitioned += await this.systemTransition(contract, LegalContractStatus.EXPIRED, now);
                continue;
            }
            const reminderStart = addUtcDays(contract.endDate, -contract.renewalReminderDays);
            if (contract.status === LegalContractStatus.ACTIVE && today >= reminderStart) {
                transitioned += await this.systemTransition(contract, LegalContractStatus.PENDING_RENEWAL, now);
            }
        }
        return transitioned;
    }

    private async transition(
        existing: ContractRecord,
        version: number,
        toStatus: LegalContractStatus,
        action: string,
        data: Prisma.LegalContractUpdateManyMutationInput,
        comment?: string | null,
        metadata?: Prisma.InputJsonObject,
    ): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const contract = await this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.legalContract.updateMany({
                where: {
                    id: existing.id,
                    tenantId: context.tenantId,
                    deletedAt: null,
                    status: existing.status,
                    version,
                },
                data: { ...data, status: toStatus, updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await transaction.legalContractStatusHistory.create({ data: {
                tenantId: context.tenantId,
                contractId: existing.id,
                fromStatus: existing.status,
                toStatus,
                actorMembershipId: context.membershipId,
                comment: normalizeNullable(comment),
                metadata,
            } });
            await this.audit(transaction, action, existing.id, metadata);
            return transaction.legalContract.findUniqueOrThrow({ where: { id: existing.id }, include: contractInclude });
        });
        return toContract(contract);
    }

    private async systemTransition(
        contract: { id: string; tenantId: string; status: LegalContractStatus; version: number },
        toStatus: LegalContractStatus,
        now: Date,
    ): Promise<number> {
        return this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.legalContract.updateMany({
                where: {
                    id: contract.id,
                    tenantId: contract.tenantId,
                    deletedAt: null,
                    status: contract.status,
                    version: contract.version,
                },
                data: { status: toStatus, version: { increment: 1 } },
            });
            if (changed.count !== 1) return 0;
            await transaction.legalContractStatusHistory.create({ data: {
                tenantId: contract.tenantId,
                contractId: contract.id,
                fromStatus: contract.status,
                toStatus,
                actorMembershipId: null,
                comment: toStatus === LegalContractStatus.EXPIRED ? '系统自动标记合同到期' : '系统自动进入续签提醒期',
                metadata: { trigger: 'BACKGROUND_JOB', evaluatedAt: now.toISOString() },
            } });
            await transaction.auditLog.create({ data: {
                tenantId: contract.tenantId,
                actorUserId: null,
                actorMembershipId: null,
                action: toStatus === LegalContractStatus.EXPIRED
                    ? 'LEGAL_CONTRACT_EXPIRED'
                    : 'LEGAL_CONTRACT_PENDING_RENEWAL',
                outcome: AuditOutcome.SUCCESS,
                resourceType: 'LEGAL_CONTRACT',
                resourceId: contract.id,
                requestId: `system:legal-lifecycle:${now.toISOString()}`,
                metadata: { fromStatus: contract.status, toStatus },
            } });
            return 1;
        });
    }

    private async prepareCreateInput(input: CreateLegalContractDto): Promise<{
        startDate: Date;
        endDate: Date | null;
        signedAt: Date | null;
    }> {
        const startDate = parseDateOnly(input.startDate);
        const endDate = nullableDate(input.endDate);
        const signedAt = nullableDate(input.signedAt);
        validateDateRange(startDate, endDate);
        await this.validateReferences(
            input.ownerMembershipId,
            input.departmentId ?? null,
            input.projectId ?? null,
            input.attachmentIds,
        );
        await this.assertWriteScope(input.ownerMembershipId, input.departmentId ?? null, input.projectId ?? null);
        return { startDate, endDate, signedAt };
    }

    private async validateReferences(
        ownerMembershipId: string,
        departmentId: string | null,
        projectId: string | null,
        attachmentIds: string[],
    ): Promise<void> {
        const context = this.tenantContext.require();
        const owner = await this.prisma.tenantMembership.findFirst({
            where: {
                id: ownerMembershipId,
                tenantId: context.tenantId,
                status: MembershipStatus.ACTIVE,
                deletedAt: null,
                user: { deletedAt: null },
            },
            select: { id: true },
        });
        if (!owner) {
            throw new BadRequestException({ code: 'LEGAL_CONTRACT_OWNER_INVALID', message: '合同负责人不是当前租户的有效成员' });
        }
        if (departmentId) {
            const department = await this.prisma.department.findFirst({
                where: { id: departmentId, tenantId: context.tenantId, deletedAt: null }, select: { id: true },
            });
            if (!department) {
                throw new BadRequestException({ code: 'LEGAL_CONTRACT_DEPARTMENT_INVALID', message: '合同所属部门无效' });
            }
        }
        if (projectId) {
            const project = await this.prisma.project.findFirst({
                where: { id: projectId, tenantId: context.tenantId, deletedAt: null }, select: { id: true },
            });
            if (!project) {
                throw new BadRequestException({ code: 'LEGAL_CONTRACT_PROJECT_INVALID', message: '合同关联项目无效' });
            }
        }
        const uniqueAttachmentIds = unique(attachmentIds);
        if (uniqueAttachmentIds.length > 0) {
            const count = await this.prisma.fileObject.count({ where: {
                id: { in: uniqueAttachmentIds },
                tenantId: context.tenantId,
                purpose: FilePurpose.ATTACHMENT,
                deletedAt: null,
            } });
            if (count !== uniqueAttachmentIds.length) {
                throw new BadRequestException({
                    code: 'LEGAL_CONTRACT_ATTACHMENT_INVALID',
                    message: '附件不存在、未完成上传或不属于当前租户',
                });
            }
        }
    }

    private async assertWriteScope(
        ownerMembershipId: string,
        departmentId: string | null,
        projectId: string | null,
    ): Promise<void> {
        const context = this.tenantContext.require();
        if (context.permissions.includes('legal.contract.manage_all')) return;
        const scope = await this.dataScopeResolver.resolve();
        if (scope.tenantWide) return;
        const allowed = scope.membershipIds.includes(ownerMembershipId)
            || Boolean(departmentId && scope.departmentIds.includes(departmentId))
            || Boolean(projectId && scope.projectIds.includes(projectId));
        if (!allowed) {
            throw new ForbiddenException({ code: 'LEGAL_CONTRACT_SCOPE_FORBIDDEN', message: '合同不在当前数据权限范围内' });
        }
    }

    private async contractScopeWhere(): Promise<Prisma.LegalContractWhereInput> {
        const context = this.tenantContext.require();
        if (context.permissions.includes('legal.contract.manage_all')) return {};
        const scope = await this.dataScopeResolver.resolve();
        if (scope.tenantWide) return {};
        const filters: Prisma.LegalContractWhereInput[] = [];
        if (scope.membershipIds.length > 0) filters.push({ ownerMembershipId: { in: scope.membershipIds } });
        if (scope.departmentIds.length > 0) filters.push({ departmentId: { in: scope.departmentIds } });
        if (scope.projectIds.length > 0) filters.push({ projectId: { in: scope.projectIds } });
        return filters.length > 0 ? { OR: filters } : { id: { in: [] } };
    }

    private async requireScopedContract(contractId: string): Promise<ContractRecord> {
        const context = this.tenantContext.require();
        const contract = await this.prisma.legalContract.findFirst({
            where: {
                id: contractId,
                tenantId: context.tenantId,
                deletedAt: null,
                AND: [await this.contractScopeWhere()],
            },
            include: contractInclude,
        });
        if (!contract) throw new NotFoundException({ code: 'LEGAL_CONTRACT_NOT_FOUND', message: '合同不存在' });
        return contract;
    }

    private assertUpdateAllowed(status: LegalContractStatus, input: UpdateLegalContractDto): void {
        if (status === LegalContractStatus.DRAFT) return;
        if (!ACTIVE_LIFECYCLE_STATUSES.includes(status)) {
            throw this.stateConflict('当前合同状态不允许修改');
        }
        const draftOnlyFields: (keyof UpdateLegalContractDto)[] = [
            'contractNo', 'name', 'counterparty', 'type', 'amount', 'currency', 'startDate', 'endDate', 'signedAt',
        ];
        if (draftOnlyFields.some((field) => input[field] !== undefined)) {
            throw this.stateConflict('生效或待续签合同仅允许修改描述、负责人、归属、附件与提醒天数');
        }
    }

    private async nextContractNo(transaction: Prisma.TransactionClient): Promise<string> {
        const context = this.tenantContext.require();
        const tenant = await transaction.tenant.findFirst({
            where: { id: context.tenantId, deletedAt: null }, select: { timezone: true },
        });
        if (!tenant) throw new BadRequestException({ code: 'TENANT_NOT_FOUND', message: '当前租户不存在' });
        const year = calendarYear(tenant.timezone || DEFAULT_TENANT_TIMEZONE, new Date());
        const sequence = await transaction.legalContractSequence.upsert({
            where: { tenantId_year: { tenantId: context.tenantId, year } },
            create: { tenantId: context.tenantId, year, lastNumber: 1 },
            update: { lastNumber: { increment: 1 } },
            select: { lastNumber: true },
        });
        return `HT-${year}-${String(sequence.lastNumber).padStart(6, '0')}`;
    }

    private async currentTenantDate(): Promise<Date> {
        const context = this.tenantContext.require();
        const tenant = await this.prisma.tenant.findFirst({
            where: { id: context.tenantId, deletedAt: null }, select: { timezone: true },
        });
        const timeZone = tenant?.timezone || DEFAULT_TENANT_TIMEZONE;
        return dateKeyToUtcMidnight(localDateKey(timeZone, new Date()));
    }

    private async expiringDateRange(days: number): Promise<Prisma.DateTimeNullableFilter> {
        const today = await this.currentTenantDate();
        return { gte: today, lte: addUtcDays(today, days) };
    }

    private async validateCursor(cursor?: string): Promise<void> {
        if (!cursor) return;
        const context = this.tenantContext.require();
        const exists = await this.prisma.legalContract.findFirst({
            where: { id: cursor, tenantId: context.tenantId, deletedAt: null, AND: [await this.contractScopeWhere()] },
            select: { id: true },
        });
        if (!exists) throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
    }

    private async audit(
        transaction: DbClient,
        action: string,
        resourceId: string,
        metadata?: Prisma.InputJsonObject,
    ): Promise<void> {
        const context = this.tenantContext.require();
        await transaction.auditLog.create({ data: {
            tenantId: context.tenantId,
            actorUserId: context.userId,
            actorMembershipId: context.membershipId,
            action,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'LEGAL_CONTRACT',
            resourceId,
            requestId: context.requestId,
            metadata,
        } });
    }

    private versionConflict(): ConflictException {
        return new ConflictException({ code: 'LEGAL_CONTRACT_VERSION_CONFLICT', message: '数据版本已变化，请刷新后重试' });
    }

    private stateConflict(message: string): ConflictException {
        return new ConflictException({ code: 'LEGAL_CONTRACT_STATE_CONFLICT', message });
    }

    private handleUniqueConflict(error: unknown): never {
        if (error instanceof ConflictException) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new ConflictException({ code: 'LEGAL_CONTRACT_NO_CONFLICT', message: '合同编号已存在' });
        }
        throw error;
    }
}

function toContract(contract: ContractRecord): JsonRecord {
    return {
        id: contract.id,
        tenantId: contract.tenantId,
        contractNo: contract.contractNo,
        name: contract.name,
        counterparty: contract.counterparty,
        type: contract.type,
        amount: contract.amount?.toNumber() ?? null,
        currency: contract.currency,
        startDate: dateOnly(contract.startDate),
        endDate: contract.endDate ? dateOnly(contract.endDate) : null,
        signedAt: contract.signedAt ? dateOnly(contract.signedAt) : null,
        status: contract.status,
        description: contract.description,
        ownerMembershipId: contract.ownerMembershipId,
        departmentId: contract.departmentId,
        projectId: contract.projectId,
        renewalReminderDays: contract.renewalReminderDays,
        activatedAt: iso(contract.activatedAt),
        terminatedAt: iso(contract.terminatedAt),
        terminationReason: contract.terminationReason,
        archivedAt: iso(contract.archivedAt),
        attachments: contract.attachments.map((attachment) => ({
            id: attachment.id,
            fileObjectId: attachment.fileObjectId,
            originalName: attachment.fileObject.originalName,
            mimeType: attachment.fileObject.mimeType,
            sizeBytes: Number(attachment.fileObject.sizeBytes),
            createdAt: attachment.createdAt.toISOString(),
        })),
        statusHistory: contract.statusHistory.map((history) => ({
            id: history.id,
            fromStatus: history.fromStatus,
            toStatus: history.toStatus,
            actorMembershipId: history.actorMembershipId,
            comment: history.comment,
            createdAt: history.createdAt.toISOString(),
        })),
        version: contract.version,
        createdAt: contract.createdAt.toISOString(),
        updatedAt: contract.updatedAt.toISOString(),
    };
}

function normalizeContractNo(value: string): string {
    return value.trim().toUpperCase();
}

function normalizeCurrency(value: string): string {
    return value.trim().toUpperCase();
}

function normalizeNullable(value?: string | null): string | null {
    if (value == null) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

function nullableDate(value?: string | null): Date | null {
    return value == null ? null : parseDateOnly(value);
}

function parseDateOnly(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || dateOnly(date) !== value) {
        throw new BadRequestException({ code: 'LEGAL_CONTRACT_DATE_INVALID', message: '日期格式无效' });
    }
    return date;
}

function validateDateRange(startDate: Date, endDate: Date | null): void {
    if (endDate && endDate < startDate) {
        throw new BadRequestException({ code: 'LEGAL_CONTRACT_DATE_RANGE_INVALID', message: '合同到期日期不能早于生效日期' });
    }
}

function optionalDateRange(from?: string, to?: string): Prisma.DateTimeNullableFilter | undefined {
    if (!from && !to) return undefined;
    const range: Prisma.DateTimeNullableFilter = {};
    if (from) range.gte = parseDateOnly(from);
    if (to) range.lte = parseDateOnly(to);
    if (range.gte && range.lte && range.gte > range.lte) {
        throw new BadRequestException({ code: 'LEGAL_CONTRACT_DATE_RANGE_INVALID', message: '到期日期筛选范围无效' });
    }
    return range;
}

function addUtcDays(value: Date, days: number): Date {
    const result = new Date(value);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function iso(value: Date | null): string | null {
    return value?.toISOString() ?? null;
}
