import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
    AuditOutcome, HrAttendanceSource, HrAttendanceStatus, HrEmployeeChangeStatus, HrEmployeeChangeType,
    HrLeaveRequestStatus, HrOvertimeRequestStatus, HrProfileStatus, MembershipStatus, Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DataScopeResolverService } from '../rbac/data-scope-resolver.service';
import { TenantContext } from '../tenant/tenant-context';
import {
    AdjustHrLeaveBalanceDto, CancelHrLeaveRequestDto, CreateHrAttendanceRecordDto, CreateHrEmployeeChangeDto,
    CreateHrLeaveRequestDto, CreateHrLeaveTypeDto, CreateHrOvertimeRequestDto, CreateHrProfileDto,
    DateRangeReportQueryDto, HeadcountReportQueryDto, ImportHrAttendanceRecordsDto, LeaveSummaryReportQueryDto,
    ListHrAttendanceRecordsQueryDto, ListHrEmployeeChangesQueryDto, ListHrLeaveBalancesQueryDto,
    ListHrLeaveRequestsQueryDto, ListHrOvertimeRequestsQueryDto, ListHrProfilesQueryDto, ReviewRequestDto,
    UpdateHrAttendanceRecordDto, UpdateHrLeaveTypeDto, UpdateHrProfileDto,
} from './dto';

type DbClient = PrismaService | Prisma.TransactionClient;
type JsonRecord = Record<string, unknown>;

@Injectable()
export class HrService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly dataScopeResolver: DataScopeResolverService,
    ) { }

    async listProfiles(query: ListHrProfilesQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const membershipIds = await this.scopedMembershipIds(query.departmentId);
        await this.validateCursor('hrProfile', query.cursor, context.tenantId);
        const items = await this.prisma.hrProfile.findMany({
            where: {
                tenantId: context.tenantId,
                deletedAt: null,
                membershipId: membershipIds ? { in: membershipIds } : undefined,
                departmentId: query.departmentId,
                OR: query.keyword?.trim() ? [
                    { displayName: { contains: query.keyword.trim(), mode: 'insensitive' } },
                    { employeeNo: { contains: query.keyword.trim(), mode: 'insensitive' } },
                    { position: { contains: query.keyword.trim(), mode: 'insensitive' } },
                ] : undefined,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        return cursorPage(items, query.limit, toProfile);
    }

    async createProfile(input: CreateHrProfileDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const membership = await this.requireMembership(input.membershipId);
        await this.assertMembershipAccess(input.membershipId);
        await this.validateProfileReferences(input.departmentId, input.managerMembershipId);
        try {
            const profile = await this.prisma.$transaction(async (transaction) => {
                const created = await transaction.hrProfile.create({
                    data: {
                        tenantId: context.tenantId,
                        membershipId: input.membershipId,
                        displayName: membership.displayName ?? membership.user.displayName,
                        ...profileData(input),
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    } as Prisma.HrProfileUncheckedCreateInput,
                });
                await this.audit(transaction, 'HR_PROFILE_CREATED', 'HR_PROFILE', created.id, { membershipId: input.membershipId });
                return created;
            });
            return toProfile(profile);
        } catch (error) {
            this.handleUniqueConflict(error, 'HR_PROFILE_CONFLICT', '该成员已有员工档案或工号已被使用');
        }
    }

    async getProfile(membershipId: string): Promise<JsonRecord> {
        await this.assertMembershipAccess(membershipId);
        return toProfile(await this.requireProfile(membershipId));
    }

    async updateProfile(membershipId: string, input: UpdateHrProfileDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        await this.assertMembershipAccess(membershipId);
        await this.requireProfile(membershipId);
        await this.validateProfileReferences(input.departmentId, input.managerMembershipId);
        try {
            const profile = await this.prisma.$transaction(async (transaction) => {
                const updated = await transaction.hrProfile.updateMany({
                    where: { tenantId: context.tenantId, membershipId, deletedAt: null, version: input.version },
                    data: { ...profileData(input), status: input.status, updatedBy: context.userId, version: { increment: 1 } },
                });
                if (updated.count !== 1) throw this.versionConflict();
                const result = await transaction.hrProfile.findFirstOrThrow({ where: { tenantId: context.tenantId, membershipId, deletedAt: null } });
                await this.audit(transaction, 'HR_PROFILE_UPDATED', 'HR_PROFILE', result.id, { membershipId });
                return result;
            });
            return toProfile(profile);
        } catch (error) {
            this.handleUniqueConflict(error, 'HR_PROFILE_CONFLICT', '员工工号已被使用');
        }
    }

    async listLeaveTypes(): Promise<JsonRecord> {
        const { tenantId } = this.tenantContext.require();
        const items = await this.prisma.hrLeaveType.findMany({ where: { tenantId, deletedAt: null }, orderBy: [{ enabled: 'desc' }, { name: 'asc' }] });
        return { items: items.map(toLeaveType) };
    }

    async createLeaveType(input: CreateHrLeaveTypeDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        try {
            const item = await this.prisma.$transaction(async (transaction) => {
                const created = await transaction.hrLeaveType.create({ data: {
                    tenantId: context.tenantId, code: normalizeCode(input.code), name: input.name.trim(), unit: input.unit,
                    paid: input.paid, defaultDays: input.defaultDays, enabled: input.enabled,
                    createdBy: context.userId, updatedBy: context.userId,
                } });
                await this.audit(transaction, 'HR_LEAVE_TYPE_CREATED', 'HR_LEAVE_TYPE', created.id);
                return created;
            });
            return toLeaveType(item);
        } catch (error) {
            this.handleUniqueConflict(error, 'HR_LEAVE_TYPE_CODE_CONFLICT', '请假类型编码已存在');
        }
    }

    async updateLeaveType(id: string, input: UpdateHrLeaveTypeDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        await this.requireLeaveType(id);
        try {
            return await this.prisma.$transaction(async (transaction) => {
                const changed = await transaction.hrLeaveType.updateMany({
                    where: { id, tenantId: context.tenantId, deletedAt: null, version: input.version },
                    data: { code: input.code ? normalizeCode(input.code) : undefined, name: input.name?.trim(), unit: input.unit,
                        paid: input.paid, defaultDays: input.defaultDays, enabled: input.enabled,
                        updatedBy: context.userId, version: { increment: 1 } },
                });
                if (changed.count !== 1) throw this.versionConflict();
                const item = await transaction.hrLeaveType.findFirstOrThrow({ where: { id, tenantId: context.tenantId } });
                await this.audit(transaction, 'HR_LEAVE_TYPE_UPDATED', 'HR_LEAVE_TYPE', id);
                return toLeaveType(item);
            });
        } catch (error) {
            this.handleUniqueConflict(error, 'HR_LEAVE_TYPE_CODE_CONFLICT', '请假类型编码已存在');
        }
    }

    async deleteLeaveType(id: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        await this.requireLeaveType(id);
        const active = await this.prisma.hrLeaveRequest.findFirst({ where: {
            tenantId: context.tenantId, leaveTypeId: id, deletedAt: null,
            status: { in: [HrLeaveRequestStatus.SUBMITTED, HrLeaveRequestStatus.APPROVED] },
        }, select: { id: true } });
        if (active) throw new ConflictException({ code: 'HR_LEAVE_TYPE_IN_USE', message: '存在有效请假申请，无法删除该类型' });
        await this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.hrLeaveType.updateMany({
                where: { id, tenantId: context.tenantId, deletedAt: null, version },
                data: { deletedAt: new Date(), enabled: false, updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await this.audit(transaction, 'HR_LEAVE_TYPE_DELETED', 'HR_LEAVE_TYPE', id);
        });
    }

    async listLeaveBalances(query: ListHrLeaveBalancesQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const membershipIds = await this.scopedMembershipIds();
        if (query.membershipId) await this.assertMembershipAccess(query.membershipId);
        const items = await this.prisma.hrLeaveBalance.findMany({ where: {
            tenantId: context.tenantId, deletedAt: null,
            membershipId: query.membershipId ?? (membershipIds ? { in: membershipIds } : undefined), year: query.year,
        }, orderBy: [{ year: 'desc' }, { createdAt: 'asc' }] });
        return { items: items.map(toLeaveBalance) };
    }

    async adjustLeaveBalance(input: AdjustHrLeaveBalanceDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        await this.assertMembershipAccess(input.membershipId);
        await this.requireMembership(input.membershipId);
        const leaveType = await this.requireLeaveType(input.leaveTypeId);
        const result = await this.prisma.$transaction(async (transaction) => {
            const existing = await transaction.hrLeaveBalance.findFirst({ where: {
                tenantId: context.tenantId, membershipId: input.membershipId, leaveTypeId: input.leaveTypeId,
                year: input.year, deletedAt: null,
            } });
            const totalDays = decimal(existing?.totalDays) + input.deltaDays;
            const remainingDays = decimal(existing?.remainingDays) + input.deltaDays;
            if (totalDays < 0 || remainingDays < 0) throw new BadRequestException({ code: 'HR_LEAVE_BALANCE_NEGATIVE', message: '调整后假期余额不能为负数' });
            const balance = existing ? await transaction.hrLeaveBalance.update({ where: { id: existing.id }, data: {
                totalDays, remainingDays, updatedBy: context.userId, version: { increment: 1 },
            } }) : await transaction.hrLeaveBalance.create({ data: {
                tenantId: context.tenantId, membershipId: input.membershipId, leaveTypeId: input.leaveTypeId,
                year: input.year, totalDays: input.deltaDays, remainingDays: input.deltaDays, unit: leaveType.unit,
                createdBy: context.userId, updatedBy: context.userId,
            } });
            await this.audit(transaction, 'HR_LEAVE_BALANCE_ADJUSTED', 'HR_LEAVE_BALANCE', balance.id, { deltaDays: input.deltaDays, reason: input.reason });
            return balance;
        });
        return toLeaveBalance(result);
    }

    async listLeaveRequests(query: ListHrLeaveRequestsQueryDto): Promise<JsonRecord> {
        return this.listMemberResource('hrLeaveRequest', query, query.status, toLeaveRequest);
    }

    async createLeaveRequest(input: CreateHrLeaveRequestDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const startAt = parseDate(input.startAt);
        const endAt = parseDate(input.endAt);
        if (startAt >= endAt) throw new BadRequestException({ code: 'HR_DATE_RANGE_INVALID', message: '请假结束时间必须晚于开始时间' });
        const leaveType = await this.requireLeaveType(input.leaveTypeId);
        if (!leaveType.enabled) throw new BadRequestException({ code: 'HR_LEAVE_TYPE_DISABLED', message: '请假类型已停用' });
        const item = await this.prisma.$transaction(async (transaction) => {
            const balance = await transaction.hrLeaveBalance.findFirst({ where: {
                tenantId: context.tenantId, membershipId: context.membershipId, leaveTypeId: input.leaveTypeId,
                year: startAt.getUTCFullYear(), deletedAt: null,
            } });
            if (!balance || decimal(balance.remainingDays) < input.durationDays) {
                throw new ConflictException({ code: 'HR_LEAVE_BALANCE_INSUFFICIENT', message: '可用假期余额不足' });
            }
            const request = await transaction.hrLeaveRequest.create({ data: {
                tenantId: context.tenantId, membershipId: context.membershipId, leaveTypeId: input.leaveTypeId,
                startAt, endAt, durationDays: input.durationDays, reason: normalizeNullable(input.reason),
                status: HrLeaveRequestStatus.SUBMITTED, createdBy: context.userId, updatedBy: context.userId,
            } });
            await transaction.hrLeaveBalance.update({ where: { id: balance.id }, data: {
                pendingDays: { increment: input.durationDays }, remainingDays: { decrement: input.durationDays },
                updatedBy: context.userId, version: { increment: 1 },
            } });
            await this.audit(transaction, 'HR_LEAVE_REQUEST_SUBMITTED', 'HR_LEAVE_REQUEST', request.id);
            return request;
        });
        return toLeaveRequest(item);
    }

    async getLeaveRequest(id: string): Promise<JsonRecord> {
        const item = await this.requireLeaveRequest(id);
        await this.assertMembershipAccess(item.membershipId);
        return toLeaveRequest(item);
    }

    async reviewLeaveRequest(id: string, input: ReviewRequestDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const request = await this.requireLeaveRequest(id);
        await this.assertMembershipAccess(request.membershipId);
        if (request.status !== HrLeaveRequestStatus.SUBMITTED) throw this.stateConflict('请假申请不是待审批状态');
        const status = input.decision === 'APPROVE' ? HrLeaveRequestStatus.APPROVED : HrLeaveRequestStatus.REJECTED;
        const item = await this.prisma.$transaction(async (transaction) => {
            const balance = await this.requireBalanceForRequest(transaction, request);
            const changed = await transaction.hrLeaveRequest.updateMany({
                where: { id, tenantId: context.tenantId, status: HrLeaveRequestStatus.SUBMITTED, version: input.version },
                data: { status, reviewedBy: context.membershipId, reviewedAt: new Date(),
                    reviewComment: normalizeNullable(input.comment), updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await transaction.hrLeaveBalance.update({ where: { id: balance.id }, data: input.decision === 'APPROVE'
                ? { pendingDays: { decrement: request.durationDays }, usedDays: { increment: request.durationDays }, version: { increment: 1 } }
                : { pendingDays: { decrement: request.durationDays }, remainingDays: { increment: request.durationDays }, version: { increment: 1 } },
            });
            await this.audit(transaction, 'HR_LEAVE_REQUEST_REVIEWED', 'HR_LEAVE_REQUEST', id, { decision: input.decision });
            return transaction.hrLeaveRequest.findUniqueOrThrow({ where: { id } });
        });
        return toLeaveRequest(item);
    }

    async cancelLeaveRequest(id: string, input: CancelHrLeaveRequestDto): Promise<JsonRecord> {
        const request = await this.requireLeaveRequest(id);
        await this.assertMembershipAccess(request.membershipId);
        return this.releaseLeaveRequest(request, input.version, 'HR_LEAVE_REQUEST_CANCELLED', input.reason);
    }

    async withdrawLeaveRequest(id: string, version: number): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const request = await this.requireLeaveRequest(id);
        if (request.membershipId !== context.membershipId) throw new ForbiddenException({ code: 'HR_REQUEST_OWNER_REQUIRED', message: '只能撤回自己的请假申请' });
        if (request.status !== HrLeaveRequestStatus.SUBMITTED) throw this.stateConflict('只有待审批请假申请可以撤回');
        return this.releaseLeaveRequest(request, version, 'HR_LEAVE_REQUEST_WITHDRAWN');
    }

    async listAttendanceRecords(query: ListHrAttendanceRecordsQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const membershipIds = await this.scopedMembershipIds();
        if (query.membershipId) await this.assertMembershipAccess(query.membershipId);
        await this.validateCursor('hrAttendanceRecord', query.cursor, context.tenantId);
        this.assertDateRange(query.dateFrom, query.dateTo);
        const items = await this.prisma.hrAttendanceRecord.findMany({ where: {
            tenantId: context.tenantId, deletedAt: null,
            membershipId: query.membershipId ?? (membershipIds ? { in: membershipIds } : undefined),
            workDate: query.dateFrom || query.dateTo ? { gte: dateOnly(query.dateFrom), lte: dateOnly(query.dateTo) } : undefined,
            status: query.status,
        }, orderBy: [{ workDate: 'desc' }, { id: 'desc' }], cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0, take: query.limit + 1 });
        return cursorPage(items, query.limit, toAttendanceRecord);
    }

    async createAttendanceRecord(input: CreateHrAttendanceRecordDto): Promise<JsonRecord> {
        return toAttendanceRecord(await this.createAttendance(input, HrAttendanceSource.MANUAL));
    }

    async importAttendanceRecords(input: ImportHrAttendanceRecordsDto): Promise<JsonRecord> {
        const failures: Array<{ index: number; code: string; message: string }> = [];
        let imported = 0;
        for (const [index, record] of input.records.entries()) {
            try {
                await this.createAttendance(record, HrAttendanceSource.IMPORT);
                imported += 1;
            } catch (error) {
                const response = error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException
                    ? error.getResponse() as { code?: string; message?: string } : {};
                failures.push({ index, code: response.code ?? 'HR_ATTENDANCE_IMPORT_FAILED', message: response.message ?? '导入失败' });
            }
        }
        return { total: input.records.length, imported, failed: failures.length, failures };
    }

    async getAttendanceRecord(id: string): Promise<JsonRecord> {
        const item = await this.requireAttendance(id);
        await this.assertMembershipAccess(item.membershipId);
        return toAttendanceRecord(item);
    }

    async updateAttendanceRecord(id: string, input: UpdateHrAttendanceRecordDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const existing = await this.requireAttendance(id);
        await this.assertMembershipAccess(existing.membershipId);
        const item = await this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.hrAttendanceRecord.updateMany({
                where: { id, tenantId: context.tenantId, deletedAt: null, version: input.version },
                data: { checkInAt: optionalDate(input.checkInAt), checkOutAt: optionalDate(input.checkOutAt), status: input.status,
                    note: input.note === undefined ? undefined : normalizeNullable(input.note), updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await this.audit(transaction, 'HR_ATTENDANCE_UPDATED', 'HR_ATTENDANCE_RECORD', id);
            return transaction.hrAttendanceRecord.findUniqueOrThrow({ where: { id } });
        });
        return toAttendanceRecord(item);
    }

    async reviewAttendanceRecord(id: string, input: ReviewRequestDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const existing = await this.requireAttendance(id);
        await this.assertMembershipAccess(existing.membershipId);
        const item = await this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.hrAttendanceRecord.updateMany({
                where: { id, tenantId: context.tenantId, deletedAt: null, version: input.version },
                data: { status: input.decision === 'APPROVE' ? HrAttendanceStatus.CORRECTED : HrAttendanceStatus.EXCEPTION,
                    note: normalizeNullable(input.comment) ?? existing.note, reviewedBy: context.membershipId,
                    reviewedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await this.audit(transaction, 'HR_ATTENDANCE_REVIEWED', 'HR_ATTENDANCE_RECORD', id, { decision: input.decision });
            return transaction.hrAttendanceRecord.findUniqueOrThrow({ where: { id } });
        });
        return toAttendanceRecord(item);
    }

    async listOvertimeRequests(query: ListHrOvertimeRequestsQueryDto): Promise<JsonRecord> {
        return this.listMemberResource('hrOvertimeRequest', query, query.status, toOvertimeRequest);
    }

    async createOvertimeRequest(input: CreateHrOvertimeRequestDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const startAt = parseDate(input.startAt);
        const endAt = parseDate(input.endAt);
        if (startAt >= endAt) throw new BadRequestException({ code: 'HR_DATE_RANGE_INVALID', message: '加班结束时间必须晚于开始时间' });
        const item = await this.prisma.$transaction(async (transaction) => {
            const created = await transaction.hrOvertimeRequest.create({ data: {
                tenantId: context.tenantId, membershipId: context.membershipId, startAt, endAt,
                durationHours: input.durationHours, reason: input.reason.trim(), status: HrOvertimeRequestStatus.SUBMITTED,
                createdBy: context.userId, updatedBy: context.userId,
            } });
            await this.audit(transaction, 'HR_OVERTIME_SUBMITTED', 'HR_OVERTIME_REQUEST', created.id);
            return created;
        });
        return toOvertimeRequest(item);
    }

    async getOvertimeRequest(id: string): Promise<JsonRecord> {
        const item = await this.requireOvertime(id);
        await this.assertMembershipAccess(item.membershipId);
        return toOvertimeRequest(item);
    }

    async cancelOvertimeRequest(id: string, version: number): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const item = await this.requireOvertime(id);
        if (item.membershipId !== context.membershipId) throw new ForbiddenException({ code: 'HR_REQUEST_OWNER_REQUIRED', message: '只能撤销自己的加班申请' });
        if (![HrOvertimeRequestStatus.DRAFT, HrOvertimeRequestStatus.SUBMITTED].includes(item.status)) throw this.stateConflict('当前加班申请不能撤销');
        return toOvertimeRequest(await this.transitionRequest('hrOvertimeRequest', id, version, HrOvertimeRequestStatus.CANCELLED, 'HR_OVERTIME_CANCELLED'));
    }

    async reviewOvertimeRequest(id: string, input: ReviewRequestDto): Promise<JsonRecord> {
        const item = await this.requireOvertime(id);
        await this.assertMembershipAccess(item.membershipId);
        if (item.status !== HrOvertimeRequestStatus.SUBMITTED) throw this.stateConflict('加班申请不是待审批状态');
        const status = input.decision === 'APPROVE' ? HrOvertimeRequestStatus.APPROVED : HrOvertimeRequestStatus.REJECTED;
        return toOvertimeRequest(await this.reviewOvertime(id, input, status));
    }

    async listEmployeeChanges(query: ListHrEmployeeChangesQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const membershipIds = await this.scopedMembershipIds();
        if (query.membershipId) await this.assertMembershipAccess(query.membershipId);
        await this.validateCursor('hrEmployeeChange', query.cursor, context.tenantId);
        const items = await this.prisma.hrEmployeeChange.findMany({ where: {
            tenantId: context.tenantId, deletedAt: null,
            membershipId: query.membershipId ?? (membershipIds ? { in: membershipIds } : undefined),
            type: query.type, status: query.status,
        }, orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }], cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0, take: query.limit + 1 });
        return cursorPage(items, query.limit, toEmployeeChange);
    }

    async createEmployeeChange(input: CreateHrEmployeeChangeDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        await this.assertMembershipAccess(input.membershipId);
        const profile = await this.requireProfile(input.membershipId);
        await this.validateProfileReferences(input.toDepartmentId, input.toManagerMembershipId);
        const item = await this.prisma.$transaction(async (transaction) => {
            const created = await transaction.hrEmployeeChange.create({ data: {
                tenantId: context.tenantId, membershipId: input.membershipId, type: input.type,
                effectiveDate: dateOnly(input.effectiveDate)!, fromDepartmentId: input.fromDepartmentId ?? profile.departmentId,
                toDepartmentId: input.toDepartmentId, fromPosition: normalizeNullable(input.fromPosition) ?? profile.position,
                toPosition: normalizeNullable(input.toPosition), fromManagerMembershipId: input.fromManagerMembershipId ?? profile.managerMembershipId,
                toManagerMembershipId: input.toManagerMembershipId, reason: normalizeNullable(input.reason),
                status: HrEmployeeChangeStatus.SUBMITTED, createdBy: context.userId, updatedBy: context.userId,
            } });
            await this.audit(transaction, 'HR_EMPLOYEE_CHANGE_SUBMITTED', 'HR_EMPLOYEE_CHANGE', created.id);
            return created;
        });
        return toEmployeeChange(item);
    }

    async getEmployeeChange(id: string): Promise<JsonRecord> {
        const item = await this.requireEmployeeChange(id);
        await this.assertMembershipAccess(item.membershipId);
        return toEmployeeChange(item);
    }

    async cancelEmployeeChange(id: string, version: number): Promise<JsonRecord> {
        const item = await this.requireEmployeeChange(id);
        await this.assertMembershipAccess(item.membershipId);
        if (![HrEmployeeChangeStatus.DRAFT, HrEmployeeChangeStatus.SUBMITTED, HrEmployeeChangeStatus.APPROVED].includes(item.status)) throw this.stateConflict('当前人事异动不能撤销');
        return toEmployeeChange(await this.transitionRequest('hrEmployeeChange', id, version, HrEmployeeChangeStatus.CANCELLED, 'HR_EMPLOYEE_CHANGE_CANCELLED'));
    }

    async reviewEmployeeChange(id: string, input: ReviewRequestDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const item = await this.requireEmployeeChange(id);
        await this.assertMembershipAccess(item.membershipId);
        if (item.status !== HrEmployeeChangeStatus.SUBMITTED) throw this.stateConflict('人事异动不是待审批状态');
        const result = await this.prisma.$transaction(async (transaction) => {
            const status = input.decision === 'APPROVE' ? HrEmployeeChangeStatus.EFFECTIVE : HrEmployeeChangeStatus.REJECTED;
            const changed = await transaction.hrEmployeeChange.updateMany({
                where: { id, tenantId: context.tenantId, status: HrEmployeeChangeStatus.SUBMITTED, version: input.version },
                data: { status, reviewedBy: context.membershipId, reviewedAt: new Date(), reviewComment: normalizeNullable(input.comment),
                    updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            if (input.decision === 'APPROVE') await this.applyEmployeeChange(transaction, item);
            await this.audit(transaction, 'HR_EMPLOYEE_CHANGE_REVIEWED', 'HR_EMPLOYEE_CHANGE', id, { decision: input.decision });
            return transaction.hrEmployeeChange.findUniqueOrThrow({ where: { id } });
        });
        return toEmployeeChange(result);
    }

    async getHeadcountReport(query: HeadcountReportQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const membershipIds = await this.scopedMembershipIds(query.departmentId);
        const asOf = dateOnly(query.asOf) ?? dateOnly(new Date().toISOString())!;
        const profiles = await this.prisma.hrProfile.findMany({ where: {
            tenantId: context.tenantId, deletedAt: null, membershipId: membershipIds ? { in: membershipIds } : undefined,
            departmentId: query.departmentId,
            AND: [
                { OR: [{ entryDate: null }, { entryDate: { lte: asOf } }] },
                { OR: [{ leaveDate: null }, { leaveDate: { gt: asOf } }] },
            ],
            status: { in: [HrProfileStatus.ACTIVE, HrProfileStatus.ON_LEAVE] },
        }, select: { departmentId: true } });
        const departmentIds = [...new Set(profiles.map((profile) => profile.departmentId).filter(Boolean))] as string[];
        const departments = await this.prisma.department.findMany({ where: { tenantId: context.tenantId, id: { in: departmentIds } }, select: { id: true, name: true } });
        const names = new Map(departments.map((department) => [department.id, department.name]));
        const counts = new Map<string, number>();
        for (const profile of profiles) if (profile.departmentId) counts.set(profile.departmentId, (counts.get(profile.departmentId) ?? 0) + 1);
        return { asOf: formatDate(asOf), total: profiles.length,
            byDepartment: [...counts].map(([departmentId, headcount]) => ({ departmentId, departmentName: names.get(departmentId) ?? '未知部门', headcount })) };
    }

    async getLeaveSummaryReport(query: LeaveSummaryReportQueryDto): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const membershipIds = await this.scopedMembershipIds(query.departmentId);
        const requests = await this.prisma.hrLeaveRequest.findMany({ where: {
            tenantId: context.tenantId, deletedAt: null, membershipId: membershipIds ? { in: membershipIds } : undefined,
            leaveTypeId: query.leaveTypeId, startAt: { gte: new Date(Date.UTC(query.year, 0, 1)), lt: new Date(Date.UTC(query.year + 1, 0, 1)) },
            status: { not: HrLeaveRequestStatus.CANCELLED },
        }, include: { leaveType: { select: { name: true } } } });
        const grouped = new Map<string, { leaveTypeId: string; leaveTypeName: string; requestedDays: number; approvedDays: number }>();
        for (const request of requests) {
            const current = grouped.get(request.leaveTypeId) ?? { leaveTypeId: request.leaveTypeId, leaveTypeName: request.leaveType.name, requestedDays: 0, approvedDays: 0 };
            current.requestedDays += decimal(request.durationDays);
            if (request.status === HrLeaveRequestStatus.APPROVED) current.approvedDays += decimal(request.durationDays);
            grouped.set(request.leaveTypeId, current);
        }
        const byLeaveType = [...grouped.values()];
        return { year: query.year, totalRequestedDays: sum(byLeaveType.map((item) => item.requestedDays)),
            totalApprovedDays: sum(byLeaveType.map((item) => item.approvedDays)), byLeaveType };
    }

    async getAttendanceSummaryReport(query: DateRangeReportQueryDto): Promise<JsonRecord> {
        this.assertDateRange(query.dateFrom, query.dateTo);
        const context = this.tenantContext.require();
        const membershipIds = await this.scopedMembershipIds(query.departmentId);
        const records = await this.prisma.hrAttendanceRecord.findMany({ where: {
            tenantId: context.tenantId, deletedAt: null, membershipId: membershipIds ? { in: membershipIds } : undefined,
            workDate: { gte: dateOnly(query.dateFrom), lte: dateOnly(query.dateTo) },
        }, select: { status: true } });
        const count = (status: HrAttendanceStatus): number => records.filter((record) => record.status === status).length;
        return { dateFrom: query.dateFrom, dateTo: query.dateTo, normalDays: count(HrAttendanceStatus.NORMAL) + count(HrAttendanceStatus.CORRECTED),
            lateCount: count(HrAttendanceStatus.LATE), earlyLeaveCount: count(HrAttendanceStatus.EARLY_LEAVE),
            absentDays: count(HrAttendanceStatus.ABSENT), leaveDays: count(HrAttendanceStatus.LEAVE) };
    }

    async getOvertimeSummaryReport(query: DateRangeReportQueryDto): Promise<JsonRecord> {
        this.assertDateRange(query.dateFrom, query.dateTo);
        const context = this.tenantContext.require();
        const membershipIds = await this.scopedMembershipIds(query.departmentId);
        const requests = await this.prisma.hrOvertimeRequest.findMany({ where: {
            tenantId: context.tenantId, deletedAt: null, membershipId: membershipIds ? { in: membershipIds } : undefined,
            status: HrOvertimeRequestStatus.APPROVED,
            startAt: { gte: parseDate(`${query.dateFrom}T00:00:00.000Z`), lte: parseDate(`${query.dateTo}T23:59:59.999Z`) },
        }, include: { membership: { include: { user: { select: { displayName: true } } } } } });
        const grouped = new Map<string, { membershipId: string; displayName: string; overtimeHours: number }>();
        for (const request of requests) {
            const current = grouped.get(request.membershipId) ?? { membershipId: request.membershipId,
                displayName: request.membership.displayName ?? request.membership.user.displayName, overtimeHours: 0 };
            current.overtimeHours += decimal(request.durationHours);
            grouped.set(request.membershipId, current);
        }
        const byMember = [...grouped.values()];
        return { dateFrom: query.dateFrom, dateTo: query.dateTo, totalHours: sum(byMember.map((item) => item.overtimeHours)), byMember };
    }

    private async createAttendance(input: CreateHrAttendanceRecordDto, source: HrAttendanceSource): Promise<Record<string, any>> {
        const context = this.tenantContext.require();
        await this.assertMembershipAccess(input.membershipId);
        await this.requireMembership(input.membershipId);
        try {
            return await this.prisma.$transaction(async (transaction) => {
                const item = await transaction.hrAttendanceRecord.create({ data: {
                    tenantId: context.tenantId, membershipId: input.membershipId, workDate: dateOnly(input.workDate)!,
                    checkInAt: optionalDate(input.checkInAt), checkOutAt: optionalDate(input.checkOutAt),
                    status: input.status, source, note: normalizeNullable(input.note),
                    createdBy: context.userId, updatedBy: context.userId,
                } });
                await this.audit(transaction, 'HR_ATTENDANCE_CREATED', 'HR_ATTENDANCE_RECORD', item.id, { source });
                return item;
            });
        } catch (error) {
            this.handleUniqueConflict(error, 'HR_ATTENDANCE_DUPLICATE', '该成员当天已有考勤记录');
        }
    }

    private async releaseLeaveRequest(request: Record<string, any>, version: number, action: string, reason?: string | null): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        if (![HrLeaveRequestStatus.SUBMITTED, HrLeaveRequestStatus.APPROVED].includes(request.status)) throw this.stateConflict('当前请假申请不能取消');
        const item = await this.prisma.$transaction(async (transaction) => {
            const balance = await this.requireBalanceForRequest(transaction, request);
            const changed = await transaction.hrLeaveRequest.updateMany({
                where: { id: request.id, tenantId: context.tenantId, status: request.status, version },
                data: { status: HrLeaveRequestStatus.CANCELLED, reviewComment: normalizeNullable(reason) ?? request.reviewComment,
                    updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await transaction.hrLeaveBalance.update({ where: { id: balance.id }, data: request.status === HrLeaveRequestStatus.SUBMITTED
                ? { pendingDays: { decrement: request.durationDays }, remainingDays: { increment: request.durationDays }, version: { increment: 1 } }
                : { usedDays: { decrement: request.durationDays }, remainingDays: { increment: request.durationDays }, version: { increment: 1 } },
            });
            await this.audit(transaction, action, 'HR_LEAVE_REQUEST', request.id);
            return transaction.hrLeaveRequest.findUniqueOrThrow({ where: { id: request.id } });
        });
        return toLeaveRequest(item);
    }

    private async reviewOvertime(id: string, input: ReviewRequestDto, status: HrOvertimeRequestStatus): Promise<Record<string, any>> {
        const context = this.tenantContext.require();
        return this.prisma.$transaction(async (transaction) => {
            const changed = await transaction.hrOvertimeRequest.updateMany({
                where: { id, tenantId: context.tenantId, status: HrOvertimeRequestStatus.SUBMITTED, version: input.version },
                data: { status, reviewedBy: context.membershipId, reviewedAt: new Date(), reviewComment: normalizeNullable(input.comment),
                    updatedBy: context.userId, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw this.versionConflict();
            await this.audit(transaction, 'HR_OVERTIME_REVIEWED', 'HR_OVERTIME_REQUEST', id, { decision: input.decision });
            return transaction.hrOvertimeRequest.findUniqueOrThrow({ where: { id } });
        });
    }

    private async transitionRequest(
        model: 'hrOvertimeRequest' | 'hrEmployeeChange', id: string, version: number,
        status: HrOvertimeRequestStatus | HrEmployeeChangeStatus, action: string,
    ): Promise<Record<string, any>> {
        const context = this.tenantContext.require();
        return this.prisma.$transaction(async (transaction) => {
            const delegate = transaction[model] as any;
            const changed = await delegate.updateMany({ where: { id, tenantId: context.tenantId, version, deletedAt: null },
                data: { status, updatedBy: context.userId, version: { increment: 1 } } });
            if (changed.count !== 1) throw this.versionConflict();
            await this.audit(transaction, action, model === 'hrOvertimeRequest' ? 'HR_OVERTIME_REQUEST' : 'HR_EMPLOYEE_CHANGE', id);
            return delegate.findUniqueOrThrow({ where: { id } });
        });
    }

    private async applyEmployeeChange(transaction: Prisma.TransactionClient, item: Record<string, any>): Promise<void> {
        const context = this.tenantContext.require();
        const data: Prisma.HrProfileUpdateManyMutationInput = { updatedBy: context.userId, version: { increment: 1 } };
        if (item.toDepartmentId !== null) data.departmentId = item.toDepartmentId;
        if (item.toPosition !== null) data.position = item.toPosition;
        if (item.toManagerMembershipId !== null) data.managerMembershipId = item.toManagerMembershipId;
        if (item.type === HrEmployeeChangeType.ONBOARD) { data.entryDate = item.effectiveDate; data.status = HrProfileStatus.ACTIVE; }
        if (item.type === HrEmployeeChangeType.PROBATION) data.regularDate = item.effectiveDate;
        if ([HrEmployeeChangeType.RESIGNATION, HrEmployeeChangeType.TERMINATION].includes(item.type)) {
            data.leaveDate = item.effectiveDate;
            data.status = HrProfileStatus.TERMINATED;
        }
        await transaction.hrProfile.updateMany({ where: { tenantId: context.tenantId, membershipId: item.membershipId, deletedAt: null }, data });
        if (item.toDepartmentId !== null) await transaction.tenantMembership.updateMany({
            where: { tenantId: context.tenantId, id: item.membershipId, deletedAt: null },
            data: { departmentId: item.toDepartmentId, updatedBy: context.userId, version: { increment: 1 } },
        });
    }

    private async listMemberResource(
        model: 'hrLeaveRequest' | 'hrOvertimeRequest',
        query: ListHrLeaveRequestsQueryDto | ListHrOvertimeRequestsQueryDto,
        status: HrLeaveRequestStatus | HrOvertimeRequestStatus | undefined,
        mapper: (item: Record<string, any>) => JsonRecord,
    ): Promise<JsonRecord> {
        const context = this.tenantContext.require();
        const membershipIds = await this.scopedMembershipIds();
        if (query.membershipId) await this.assertMembershipAccess(query.membershipId);
        await this.validateCursor(model, query.cursor, context.tenantId);
        const items = await (this.prisma[model] as any).findMany({ where: {
            tenantId: context.tenantId, deletedAt: null,
            membershipId: query.membershipId ?? (membershipIds ? { in: membershipIds } : undefined), status,
        }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0, take: query.limit + 1 });
        return cursorPage(items, query.limit, mapper);
    }

    private async scopedMembershipIds(departmentId?: string): Promise<string[] | undefined> {
        const scope = await this.dataScopeResolver.resolve();
        if (scope.tenantWide) return departmentId ? this.membersInDepartment(departmentId) : undefined;
        if (!departmentId) return scope.membershipIds;
        const departmentMembers = new Set(await this.membersInDepartment(departmentId));
        return scope.membershipIds.filter((id) => departmentMembers.has(id));
    }

    private async membersInDepartment(departmentId: string): Promise<string[]> {
        const { tenantId } = this.tenantContext.require();
        const department = await this.prisma.department.findFirst({ where: { id: departmentId, tenantId, deletedAt: null }, select: { id: true } });
        if (!department) throw new NotFoundException({ code: 'DEPARTMENT_NOT_FOUND', message: '部门不存在' });
        const members = await this.prisma.tenantMembership.findMany({
            where: { tenantId, departmentId, deletedAt: null, status: MembershipStatus.ACTIVE }, select: { id: true },
        });
        return members.map((member) => member.id);
    }

    private async assertMembershipAccess(membershipId: string): Promise<void> {
        const scope = await this.dataScopeResolver.resolve();
        if (!scope.tenantWide && !scope.membershipIds.includes(membershipId)) {
            throw new ForbiddenException({ code: 'DATA_SCOPE_FORBIDDEN', message: '无权访问该成员的人事数据' });
        }
    }

    private async requireMembership(id: string): Promise<Record<string, any>> {
        const { tenantId } = this.tenantContext.require();
        const item = await this.prisma.tenantMembership.findFirst({
            where: { id, tenantId, deletedAt: null, status: MembershipStatus.ACTIVE }, include: { user: { select: { displayName: true } } },
        });
        if (!item) throw new NotFoundException({ code: 'MEMBERSHIP_NOT_FOUND', message: '有效租户成员不存在' });
        return item;
    }

    private async requireProfile(membershipId: string): Promise<Record<string, any>> {
        const { tenantId } = this.tenantContext.require();
        const item = await this.prisma.hrProfile.findFirst({ where: { tenantId, membershipId, deletedAt: null } });
        if (!item) throw new NotFoundException({ code: 'HR_PROFILE_NOT_FOUND', message: '员工档案不存在' });
        return item;
    }

    private async requireLeaveType(id: string): Promise<Record<string, any>> {
        const { tenantId } = this.tenantContext.require();
        const item = await this.prisma.hrLeaveType.findFirst({ where: { id, tenantId, deletedAt: null } });
        if (!item) throw new NotFoundException({ code: 'HR_LEAVE_TYPE_NOT_FOUND', message: '请假类型不存在' });
        return item;
    }

    private requireLeaveRequest(id: string): Promise<Record<string, any>> { return this.requireResource('hrLeaveRequest', id, 'HR_LEAVE_REQUEST_NOT_FOUND', '请假申请不存在'); }
    private requireAttendance(id: string): Promise<Record<string, any>> { return this.requireResource('hrAttendanceRecord', id, 'HR_ATTENDANCE_NOT_FOUND', '考勤记录不存在'); }
    private requireOvertime(id: string): Promise<Record<string, any>> { return this.requireResource('hrOvertimeRequest', id, 'HR_OVERTIME_NOT_FOUND', '加班申请不存在'); }
    private requireEmployeeChange(id: string): Promise<Record<string, any>> { return this.requireResource('hrEmployeeChange', id, 'HR_EMPLOYEE_CHANGE_NOT_FOUND', '人事异动不存在'); }

    private async requireResource(model: string, id: string, code: string, message: string): Promise<Record<string, any>> {
        const { tenantId } = this.tenantContext.require();
        const item = await (this.prisma as any)[model].findFirst({ where: { id, tenantId, deletedAt: null } });
        if (!item) throw new NotFoundException({ code, message });
        return item;
    }

    private async requireBalanceForRequest(transaction: Prisma.TransactionClient, request: Record<string, any>): Promise<Record<string, any>> {
        const balance = await transaction.hrLeaveBalance.findFirst({ where: {
            tenantId: request.tenantId, membershipId: request.membershipId, leaveTypeId: request.leaveTypeId,
            year: request.startAt.getUTCFullYear(), deletedAt: null,
        } });
        if (!balance) throw new ConflictException({ code: 'HR_LEAVE_BALANCE_NOT_FOUND', message: '请假余额记录不存在' });
        return balance;
    }

    private async validateProfileReferences(departmentId?: string | null, managerId?: string | null): Promise<void> {
        if (departmentId) await this.membersInDepartment(departmentId);
        if (managerId) await this.requireMembership(managerId);
    }

    private async validateCursor(model: string, cursor: string | undefined, tenantId: string): Promise<void> {
        if (!cursor) return;
        const item = await (this.prisma as any)[model].findFirst({ where: { id: cursor, tenantId, deletedAt: null }, select: { id: true } });
        if (!item) throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
    }

    private assertDateRange(from?: string, to?: string): void {
        if (from && to && parseDate(from) > parseDate(to)) throw new BadRequestException({ code: 'HR_DATE_RANGE_INVALID', message: '开始日期不能晚于结束日期' });
    }

    private async audit(transaction: DbClient, action: string, resourceType: string, resourceId: string, metadata?: JsonRecord): Promise<void> {
        const context = this.tenantContext.require();
        await transaction.auditLog.create({ data: {
            tenantId: context.tenantId, actorUserId: context.userId, actorMembershipId: context.membershipId,
            action, outcome: AuditOutcome.SUCCESS, resourceType, resourceId, requestId: context.requestId,
            metadata: metadata as Prisma.InputJsonValue | undefined,
        } });
    }

    private versionConflict(): ConflictException { return new ConflictException({ code: 'VERSION_CONFLICT', message: '数据已被其他操作修改，请刷新后重试' }); }
    private stateConflict(message: string): ConflictException { return new ConflictException({ code: 'HR_STATE_CONFLICT', message }); }

    private handleUniqueConflict(error: unknown, code: string, message: string): never {
        if (error instanceof ConflictException) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException({ code, message });
        throw error;
    }
}

function profileData(input: CreateHrProfileDto | UpdateHrProfileDto): Prisma.HrProfileUpdateManyMutationInput {
    return {
        employeeNo: input.employeeNo === undefined ? undefined : normalizeNullable(input.employeeNo),
        departmentId: input.departmentId,
        position: input.position === undefined ? undefined : normalizeNullable(input.position),
        employmentType: input.employmentType === undefined ? undefined : normalizeNullable(input.employmentType),
        managerMembershipId: input.managerMembershipId,
        entryDate: optionalDate(input.entryDate), leaveDate: optionalDate(input.leaveDate),
        phone: input.phone === undefined ? undefined : normalizeNullable(input.phone),
        email: input.email === undefined ? undefined : normalizeNullable(input.email),
        idType: input.idType === undefined ? undefined : normalizeNullable(input.idType),
        idNumber: input.idNumber === undefined ? undefined : normalizeNullable(input.idNumber),
        emergencyContactName: input.emergencyContactName === undefined ? undefined : normalizeNullable(input.emergencyContactName),
        emergencyContactPhone: input.emergencyContactPhone === undefined ? undefined : normalizeNullable(input.emergencyContactPhone),
        educationLevel: input.educationLevel === undefined ? undefined : normalizeNullable(input.educationLevel),
        costCenter: input.costCenter === undefined ? undefined : normalizeNullable(input.costCenter),
        jobLevel: input.jobLevel === undefined ? undefined : normalizeNullable(input.jobLevel),
        probationEndDate: optionalDate(input.probationEndDate), regularDate: optionalDate(input.regularDate),
        workLocation: input.workLocation === undefined ? undefined : normalizeNullable(input.workLocation),
    };
}

function cursorPage(items: Record<string, any>[], limit: number, mapper: (item: Record<string, any>) => JsonRecord): JsonRecord {
    const hasNext = items.length > limit;
    const page = hasNext ? items.slice(0, limit) : items;
    return { items: page.map(mapper), nextCursor: hasNext ? page[page.length - 1]?.id ?? null : null };
}

function toProfile(item: Record<string, any>): JsonRecord {
    return { ...base(item), membershipId: item.membershipId, employeeNo: item.employeeNo, displayName: item.displayName,
        departmentId: item.departmentId, position: item.position, employmentType: item.employmentType,
        managerMembershipId: item.managerMembershipId, entryDate: formatOptionalDate(item.entryDate), leaveDate: formatOptionalDate(item.leaveDate),
        phone: item.phone, email: item.email, idType: item.idType, idNumber: item.idNumber,
        emergencyContactName: item.emergencyContactName, emergencyContactPhone: item.emergencyContactPhone,
        educationLevel: item.educationLevel, costCenter: item.costCenter, jobLevel: item.jobLevel,
        probationEndDate: formatOptionalDate(item.probationEndDate), regularDate: formatOptionalDate(item.regularDate),
        workLocation: item.workLocation, status: item.status };
}

function toLeaveType(item: Record<string, any>): JsonRecord {
    return { ...base(item), code: item.code, name: item.name, unit: item.unit, paid: item.paid,
        defaultDays: nullableDecimal(item.defaultDays), enabled: item.enabled };
}

function toLeaveBalance(item: Record<string, any>): JsonRecord {
    return { ...base(item), membershipId: item.membershipId, leaveTypeId: item.leaveTypeId, year: item.year,
        totalDays: decimal(item.totalDays), usedDays: decimal(item.usedDays), pendingDays: decimal(item.pendingDays),
        remainingDays: decimal(item.remainingDays), unit: item.unit };
}

function toLeaveRequest(item: Record<string, any>): JsonRecord {
    return { ...base(item), membershipId: item.membershipId, leaveTypeId: item.leaveTypeId,
        startAt: item.startAt.toISOString(), endAt: item.endAt.toISOString(), durationDays: decimal(item.durationDays),
        reason: item.reason, status: item.status, reviewedBy: item.reviewedBy,
        reviewedAt: item.reviewedAt?.toISOString() ?? null, reviewComment: item.reviewComment };
}

function toAttendanceRecord(item: Record<string, any>): JsonRecord {
    return { ...base(item), membershipId: item.membershipId, workDate: formatDate(item.workDate),
        checkInAt: item.checkInAt?.toISOString() ?? null, checkOutAt: item.checkOutAt?.toISOString() ?? null,
        status: item.status, source: item.source, note: item.note, reviewedBy: item.reviewedBy,
        reviewedAt: item.reviewedAt?.toISOString() ?? null };
}

function toOvertimeRequest(item: Record<string, any>): JsonRecord {
    return { ...base(item), membershipId: item.membershipId, startAt: item.startAt.toISOString(), endAt: item.endAt.toISOString(),
        durationHours: decimal(item.durationHours), reason: item.reason, status: item.status, reviewedBy: item.reviewedBy,
        reviewedAt: item.reviewedAt?.toISOString() ?? null, reviewComment: item.reviewComment };
}

function toEmployeeChange(item: Record<string, any>): JsonRecord {
    return { ...base(item), membershipId: item.membershipId, type: item.type, effectiveDate: formatDate(item.effectiveDate),
        fromDepartmentId: item.fromDepartmentId, toDepartmentId: item.toDepartmentId, fromPosition: item.fromPosition,
        toPosition: item.toPosition, fromManagerMembershipId: item.fromManagerMembershipId,
        toManagerMembershipId: item.toManagerMembershipId, reason: item.reason, status: item.status,
        reviewedBy: item.reviewedBy, reviewedAt: item.reviewedAt?.toISOString() ?? null, reviewComment: item.reviewComment };
}

function base(item: Record<string, any>): JsonRecord {
    return { id: item.id, tenantId: item.tenantId, version: item.version,
        createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
}

function parseDate(value: string): Date {
    const result = new Date(value);
    if (Number.isNaN(result.getTime())) throw new BadRequestException({ code: 'HR_DATE_INVALID', message: '日期格式无效' });
    return result;
}

function dateOnly(value?: string | null): Date | undefined {
    if (!value) return undefined;
    return parseDate(value.length === 10 ? `${value}T00:00:00.000Z` : value);
}

function optionalDate(value?: string | null): Date | null | undefined {
    return value === undefined ? undefined : value === null ? null : parseDate(value);
}

function formatDate(value: Date): string { return value.toISOString().slice(0, 10); }
function formatOptionalDate(value?: Date | null): string | null { return value ? formatDate(value) : null; }
function normalizeNullable(value?: string | null): string | null { const normalized = value?.trim(); return normalized ? normalized : null; }
function normalizeCode(value: string): string { return value.trim().toUpperCase(); }
function decimal(value: Prisma.Decimal | number | string | null | undefined): number { return value === null || value === undefined ? 0 : Number(value); }
function nullableDecimal(value: Prisma.Decimal | number | string | null | undefined): number | null { return value === null || value === undefined ? null : Number(value); }
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
