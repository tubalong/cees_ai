import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
    AuditOutcome,
    DepartmentStatus,
    MeetingAttendanceStatus,
    MeetingMinutesStatus,
    MeetingParticipantRole,
    MeetingResponseStatus,
    MeetingStatus,
    MembershipStatus,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { lockProjectForUpdate } from '../project/project-transaction-lock';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
import {
    AddMeetingParticipantDto,
    CreateMeetingDto,
    ListMeetingsQueryDto,
    MeetingAgendaItemDto,
    MeetingMinutesContentDto,
    MeetingTransitionDto,
    RespondMeetingParticipantDto,
    UpdateMeetingDto,
    UpdateMeetingParticipantDto,
    UpsertMeetingMinutesDto,
} from './dto';
import { lockMeetingForUpdate } from './meeting-transaction-lock';
import {
    MeetingAgendaItemResult,
    MeetingListResult,
    MeetingMemberIdentityResult,
    MeetingMinutesContentResult,
    MeetingMinutesResult,
    MeetingParticipantListResult,
    MeetingParticipantResult,
    MeetingResult,
} from './meeting.types';

const EDITABLE_MEETING_STATUSES = new Set<MeetingStatus>([MeetingStatus.DRAFT, MeetingStatus.SCHEDULED]);
const ATTENDANCE_MEETING_STATUSES = new Set<MeetingStatus>([MeetingStatus.IN_PROGRESS, MeetingStatus.COMPLETED]);
const MINUTES_MEETING_STATUSES = new Set<MeetingStatus>([MeetingStatus.IN_PROGRESS, MeetingStatus.COMPLETED]);
const ALLOWED_TRANSITIONS: Record<MeetingStatus, ReadonlySet<MeetingStatus>> = {
    [MeetingStatus.DRAFT]: new Set([MeetingStatus.SCHEDULED, MeetingStatus.CANCELLED]),
    [MeetingStatus.SCHEDULED]: new Set([MeetingStatus.IN_PROGRESS, MeetingStatus.CANCELLED]),
    [MeetingStatus.IN_PROGRESS]: new Set([MeetingStatus.COMPLETED, MeetingStatus.CANCELLED]),
    [MeetingStatus.COMPLETED]: new Set(),
    [MeetingStatus.CANCELLED]: new Set(),
};

const memberIdentitySelect = {
    id: true,
    account: true,
    displayName: true,
    departmentId: true,
    user: { select: { displayName: true } },
} satisfies Prisma.TenantMembershipSelect;

const meetingSelect = {
    id: true,
    tenantId: true,
    projectId: true,
    departmentId: true,
    organizerMembershipId: true,
    title: true,
    description: true,
    startsAt: true,
    durationMinutes: true,
    location: true,
    meetingUrl: true,
    agenda: true,
    status: true,
    cancelReason: true,
    startedAt: true,
    completedAt: true,
    createdAt: true,
    updatedAt: true,
    version: true,
    organizerMembership: { select: memberIdentitySelect },
    participants: {
        where: { deletedAt: null },
        select: { membershipId: true, role: true, responseStatus: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    },
} satisfies Prisma.MeetingSelect;

const participantSelect = {
    id: true,
    meetingId: true,
    membershipId: true,
    role: true,
    responseStatus: true,
    attendanceStatus: true,
    respondedAt: true,
    createdAt: true,
    updatedAt: true,
    version: true,
    membership: { select: memberIdentitySelect },
} satisfies Prisma.MeetingParticipantSelect;

const minutesSelect = {
    id: true,
    meetingId: true,
    content: true,
    status: true,
    recorderMembershipId: true,
    publishedAt: true,
    publishedByMembershipId: true,
    createdAt: true,
    updatedAt: true,
    version: true,
    recorderMembership: { select: memberIdentitySelect },
    publishedByMembership: { select: memberIdentitySelect },
} satisfies Prisma.MeetingMinutesSelect;

type MeetingRecord = Prisma.MeetingGetPayload<{ select: typeof meetingSelect }>;
type MeetingParticipantRecord = Prisma.MeetingParticipantGetPayload<{ select: typeof participantSelect }>;
type MeetingMinutesRecord = Prisma.MeetingMinutesGetPayload<{ select: typeof minutesSelect }>;
type MeetingDb = PrismaService | Prisma.TransactionClient;

@Injectable()
export class MeetingService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
    ) { }

    async listMeetings(query: ListMeetingsQueryDto): Promise<MeetingListResult> {
        const context = this.tenantContext.require();
        const startsFrom = query.startsFrom ? new Date(query.startsFrom) : undefined;
        const startsTo = query.startsTo ? new Date(query.startsTo) : undefined;
        if (startsFrom && startsTo && startsFrom > startsTo) {
            throw new BadRequestException({ code: 'MEETING_DATE_RANGE_INVALID', message: '会议开始时间范围无效' });
        }
        const keyword = normalizeOptionalText(query.keyword);
        const where = this.visibleMeetingWhere(context, {
            status: query.status ?? (!query.includeCancelled ? { not: MeetingStatus.CANCELLED } : undefined),
            projectId: query.projectId,
            departmentId: query.departmentId,
            startsAt: startsFrom || startsTo ? { gte: startsFrom, lte: startsTo } : undefined,
            OR: keyword ? [
                { title: { contains: keyword, mode: 'insensitive' } },
                { description: { contains: keyword, mode: 'insensitive' } },
            ] : undefined,
        });
        if (query.cursor) {
            const cursor = await this.prisma.meeting.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } });
            if (!cursor) throw new BadRequestException({ code: 'PAGINATION_CURSOR_INVALID', message: '分页游标无效' });
        }
        const meetings = await this.prisma.meeting.findMany({
            where,
            select: meetingSelect,
            orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
            cursor: query.cursor ? { id: query.cursor } : undefined,
            skip: query.cursor ? 1 : 0,
            take: query.limit + 1,
        });
        const hasNextPage = meetings.length > query.limit;
        const page = hasNextPage ? meetings.slice(0, query.limit) : meetings;
        return {
            items: page.map((meeting) => toMeetingResult(meeting, context.membershipId)),
            nextCursor: hasNextPage ? page[page.length - 1]?.id ?? null : null,
        };
    }

    async createMeeting(input: CreateMeetingDto): Promise<MeetingResult> {
        const context = this.tenantContext.require();
        const title = normalizeRequiredText(input.title, 'MEETING_TITLE_REQUIRED', '会议标题不能为空');
        const meeting = await this.prisma.$transaction(async (transaction) => {
            if (input.projectId) await lockProjectForUpdate(transaction, context.tenantId, input.projectId);
            await this.validateDepartment(context, input.departmentId, transaction);
            await this.validateProjectAssociation(context, input.projectId, transaction);
            const created = await transaction.meeting.create({
                data: {
                    tenantId: context.tenantId,
                    projectId: input.projectId,
                    departmentId: input.departmentId,
                    organizerMembershipId: context.membershipId,
                    title,
                    description: normalizeOptionalText(input.description),
                    startsAt: new Date(input.startsAt),
                    durationMinutes: input.durationMinutes,
                    location: normalizeOptionalText(input.location),
                    meetingUrl: normalizeOptionalText(input.meetingUrl),
                    agenda: normalizeAgenda(input.agenda) as unknown as Prisma.InputJsonValue,
                    createdBy: context.userId,
                    updatedBy: context.userId,
                },
                select: { id: true },
            });
            await transaction.meetingParticipant.create({
                data: {
                    tenantId: context.tenantId,
                    meetingId: created.id,
                    membershipId: context.membershipId,
                    role: MeetingParticipantRole.HOST,
                    responseStatus: MeetingResponseStatus.ACCEPTED,
                    respondedAt: new Date(),
                    createdBy: context.userId,
                    updatedBy: context.userId,
                },
            });
            await transaction.auditLog.create({
                data: auditData(context, 'MEETING_CREATED', 'MEETING', created.id, {
                    projectId: input.projectId,
                    departmentId: input.departmentId,
                }),
            });
            return transaction.meeting.findUniqueOrThrow({ where: { id: created.id }, select: meetingSelect });
        });
        return toMeetingResult(meeting, context.membershipId);
    }

    async getMeeting(meetingId: string): Promise<MeetingResult> {
        const context = this.tenantContext.require();
        return toMeetingResult(await this.requireVisibleMeeting(context, meetingId), context.membershipId);
    }

    async updateMeeting(meetingId: string, input: UpdateMeetingDto): Promise<MeetingResult> {
        const context = this.tenantContext.require();
        if (!hasMeetingChanges(input)) {
            throw new BadRequestException({ code: 'MEETING_UPDATE_EMPTY', message: '至少需要修改一个会议字段' });
        }
        const updated = await this.prisma.$transaction(async (transaction) => {
            await lockMeetingForUpdate(transaction, context.tenantId, meetingId);
            const meeting = await this.requireVisibleMeeting(context, meetingId, transaction);
            this.requireMeetingManager(context, meeting);
            this.requireEditableMeeting(meeting);
            this.requireVersion(meeting.version, input.version, 'MEETING_VERSION_CONFLICT');
            if (input.departmentId !== undefined) await this.validateDepartment(context, input.departmentId, transaction);
            if (input.projectId !== undefined) {
                if (input.projectId) await lockProjectForUpdate(transaction, context.tenantId, input.projectId);
                await this.validateProjectAssociation(context, input.projectId, transaction);
            }
            const result = await transaction.meeting.updateMany({
                where: { id: meetingId, tenantId: context.tenantId, deletedAt: null, version: input.version },
                data: {
                    title: input.title === undefined
                        ? undefined
                        : normalizeRequiredText(input.title, 'MEETING_TITLE_REQUIRED', '会议标题不能为空'),
                    description: input.description === undefined ? undefined : normalizeOptionalText(input.description),
                    projectId: input.projectId,
                    departmentId: input.departmentId,
                    startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
                    durationMinutes: input.durationMinutes,
                    location: input.location === undefined ? undefined : normalizeOptionalText(input.location),
                    meetingUrl: input.meetingUrl === undefined ? undefined : normalizeOptionalText(input.meetingUrl),
                    agenda: input.agenda === undefined
                        ? undefined
                        : normalizeAgenda(input.agenda) as unknown as Prisma.InputJsonValue,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (result.count !== 1) throw this.versionConflict('MEETING_VERSION_CONFLICT');
            await transaction.auditLog.create({
                data: auditData(context, 'MEETING_UPDATED', 'MEETING', meetingId, { version: input.version }),
            });
            return transaction.meeting.findUniqueOrThrow({ where: { id: meetingId }, select: meetingSelect });
        });
        return toMeetingResult(updated, context.membershipId);
    }

    async deleteMeeting(meetingId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            await lockMeetingForUpdate(transaction, context.tenantId, meetingId);
            const meeting = await this.requireVisibleMeeting(context, meetingId, transaction);
            if (!this.canDeleteMeeting(context, meeting)) {
                throw new ForbiddenException({ code: 'MEETING_DELETE_FORBIDDEN', message: '只有会议组织者可以删除会议' });
            }
            if (meeting.status !== MeetingStatus.DRAFT) {
                throw new ConflictException({ code: 'MEETING_STATE_CONFLICT', message: '只有草稿会议可以删除' });
            }
            this.requireVersion(meeting.version, version, 'MEETING_VERSION_CONFLICT');
            const now = new Date();
            const result = await transaction.meeting.updateMany({
                where: { id: meetingId, tenantId: context.tenantId, deletedAt: null, version },
                data: { deletedAt: now, updatedBy: context.userId, version: { increment: 1 } },
            });
            if (result.count !== 1) throw this.versionConflict('MEETING_VERSION_CONFLICT');
            await transaction.meetingParticipant.updateMany({
                where: { meetingId, tenantId: context.tenantId, deletedAt: null },
                data: { deletedAt: now, updatedBy: context.userId, version: { increment: 1 } },
            });
            await transaction.meetingMinutes.updateMany({
                where: { meetingId, tenantId: context.tenantId, deletedAt: null },
                data: { deletedAt: now, updatedBy: context.userId, version: { increment: 1 } },
            });
            await transaction.auditLog.create({
                data: auditData(context, 'MEETING_DELETED', 'MEETING', meetingId, { version }),
            });
        });
    }

    async transitionMeeting(meetingId: string, input: MeetingTransitionDto): Promise<MeetingResult> {
        const context = this.tenantContext.require();
        const transitioned = await this.prisma.$transaction(async (transaction) => {
            await lockMeetingForUpdate(transaction, context.tenantId, meetingId);
            const meeting = await this.requireVisibleMeeting(context, meetingId, transaction);
            this.requireMeetingManager(context, meeting);
            this.requireVersion(meeting.version, input.version, 'MEETING_VERSION_CONFLICT');
            if (!ALLOWED_TRANSITIONS[meeting.status].has(input.status)) {
                throw new ConflictException({
                    code: 'MEETING_TRANSITION_INVALID',
                    message: `会议不能从 ${meeting.status} 流转到 ${input.status}`,
                });
            }
            const reason = normalizeOptionalText(input.reason);
            if (input.status === MeetingStatus.CANCELLED && !reason) {
                throw new BadRequestException({ code: 'MEETING_CANCEL_REASON_REQUIRED', message: '取消会议时必须填写原因' });
            }
            const now = new Date();
            const result = await transaction.meeting.updateMany({
                where: { id: meetingId, tenantId: context.tenantId, deletedAt: null, version: input.version },
                data: {
                    status: input.status,
                    cancelReason: input.status === MeetingStatus.CANCELLED ? reason : null,
                    startedAt: input.status === MeetingStatus.IN_PROGRESS ? now : undefined,
                    completedAt: input.status === MeetingStatus.COMPLETED ? now : undefined,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (result.count !== 1) throw this.versionConflict('MEETING_VERSION_CONFLICT');
            await transaction.auditLog.create({
                data: auditData(context, 'MEETING_STATUS_CHANGED', 'MEETING', meetingId, {
                    from: meeting.status,
                    to: input.status,
                    reason,
                }),
            });
            return transaction.meeting.findUniqueOrThrow({ where: { id: meetingId }, select: meetingSelect });
        });
        return toMeetingResult(transitioned, context.membershipId);
    }

    async listParticipants(meetingId: string): Promise<MeetingParticipantListResult> {
        const context = this.tenantContext.require();
        await this.requireVisibleMeeting(context, meetingId);
        const participants = await this.prisma.meetingParticipant.findMany({
            where: { tenantId: context.tenantId, meetingId, deletedAt: null },
            select: participantSelect,
            orderBy: [{ role: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        });
        return { items: participants.map(toMeetingParticipantResult) };
    }

    async addParticipant(meetingId: string, input: AddMeetingParticipantDto): Promise<MeetingParticipantResult> {
        const context = this.tenantContext.require();
        return this.prisma.$transaction(async (transaction) => {
            await lockMeetingForUpdate(transaction, context.tenantId, meetingId);
            const meeting = await this.requireVisibleMeeting(context, meetingId, transaction);
            this.requireMeetingManager(context, meeting);
            this.requireEditableMeeting(meeting);
            await this.requireActiveMembership(context, input.membershipId, transaction);
            const existing = await transaction.meetingParticipant.findUnique({
                where: {
                    tenantId_meetingId_membershipId: {
                        tenantId: context.tenantId,
                        meetingId,
                        membershipId: input.membershipId,
                    },
                },
                select: { id: true, deletedAt: true },
            });
            if (existing && !existing.deletedAt) {
                throw new ConflictException({ code: 'MEETING_PARTICIPANT_EXISTS', message: '该成员已经是会议参会人' });
            }
            const selfAdded = input.membershipId === context.membershipId;
            const participant = existing
                ? await transaction.meetingParticipant.update({
                    where: { id: existing.id },
                    data: {
                        role: input.role,
                        responseStatus: selfAdded ? MeetingResponseStatus.ACCEPTED : MeetingResponseStatus.INVITED,
                        attendanceStatus: MeetingAttendanceStatus.PENDING,
                        respondedAt: selfAdded ? new Date() : null,
                        deletedAt: null,
                        updatedBy: context.userId,
                        version: { increment: 1 },
                    },
                    select: participantSelect,
                })
                : await transaction.meetingParticipant.create({
                    data: {
                        tenantId: context.tenantId,
                        meetingId,
                        membershipId: input.membershipId,
                        role: input.role,
                        responseStatus: selfAdded ? MeetingResponseStatus.ACCEPTED : MeetingResponseStatus.INVITED,
                        respondedAt: selfAdded ? new Date() : null,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                    select: participantSelect,
                });
            await transaction.auditLog.create({
                data: auditData(context, 'MEETING_PARTICIPANT_ADDED', 'MEETING_PARTICIPANT', participant.id, {
                    meetingId,
                    membershipId: input.membershipId,
                    role: input.role,
                }),
            });
            return toMeetingParticipantResult(participant);
        });
    }

    async updateParticipant(
        meetingId: string,
        membershipId: string,
        input: UpdateMeetingParticipantDto,
    ): Promise<MeetingParticipantResult> {
        const context = this.tenantContext.require();
        if (input.role === undefined && input.attendanceStatus === undefined) {
            throw new BadRequestException({ code: 'MEETING_PARTICIPANT_UPDATE_EMPTY', message: '至少需要修改一个参会人字段' });
        }
        return this.prisma.$transaction(async (transaction) => {
            await lockMeetingForUpdate(transaction, context.tenantId, meetingId);
            const meeting = await this.requireVisibleMeeting(context, meetingId, transaction);
            this.requireMeetingManager(context, meeting);
            const participant = await this.requireParticipant(context, meetingId, membershipId, transaction);
            if (input.role !== undefined && !EDITABLE_MEETING_STATUSES.has(meeting.status)) {
                throw new ConflictException({ code: 'MEETING_STATE_CONFLICT', message: '当前会议状态不允许修改参会角色' });
            }
            if (input.attendanceStatus !== undefined && !ATTENDANCE_MEETING_STATUSES.has(meeting.status)) {
                throw new ConflictException({ code: 'MEETING_STATE_CONFLICT', message: '会议开始后才能登记实际出席情况' });
            }
            if (membershipId === meeting.organizerMembershipId
                && input.role !== undefined
                && input.role !== MeetingParticipantRole.HOST) {
                throw new ConflictException({ code: 'MEETING_ORGANIZER_ROLE_REQUIRED', message: '会议组织者必须保持主持人角色' });
            }
            this.requireVersion(participant.version, input.version, 'MEETING_PARTICIPANT_VERSION_CONFLICT');
            const result = await transaction.meetingParticipant.updateMany({
                where: { id: participant.id, tenantId: context.tenantId, deletedAt: null, version: input.version },
                data: {
                    role: input.role,
                    attendanceStatus: input.attendanceStatus,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (result.count !== 1) throw this.versionConflict('MEETING_PARTICIPANT_VERSION_CONFLICT');
            await transaction.auditLog.create({
                data: auditData(context, 'MEETING_PARTICIPANT_UPDATED', 'MEETING_PARTICIPANT', participant.id, {
                    meetingId,
                    membershipId,
                    role: input.role ?? participant.role,
                    attendanceStatus: input.attendanceStatus ?? participant.attendanceStatus,
                }),
            });
            return toMeetingParticipantResult(await transaction.meetingParticipant.findUniqueOrThrow({
                where: { id: participant.id },
                select: participantSelect,
            }));
        });
    }

    async removeParticipant(meetingId: string, membershipId: string, version: number): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            await lockMeetingForUpdate(transaction, context.tenantId, meetingId);
            const meeting = await this.requireVisibleMeeting(context, meetingId, transaction);
            this.requireMeetingManager(context, meeting);
            this.requireEditableMeeting(meeting);
            if (membershipId === meeting.organizerMembershipId) {
                throw new ConflictException({ code: 'MEETING_ORGANIZER_REMOVE_FORBIDDEN', message: '不能移除会议组织者' });
            }
            const participant = await this.requireParticipant(context, meetingId, membershipId, transaction);
            this.requireVersion(participant.version, version, 'MEETING_PARTICIPANT_VERSION_CONFLICT');
            const result = await transaction.meetingParticipant.updateMany({
                where: { id: participant.id, tenantId: context.tenantId, deletedAt: null, version },
                data: { deletedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } },
            });
            if (result.count !== 1) throw this.versionConflict('MEETING_PARTICIPANT_VERSION_CONFLICT');
            await transaction.auditLog.create({
                data: auditData(context, 'MEETING_PARTICIPANT_REMOVED', 'MEETING_PARTICIPANT', participant.id, {
                    meetingId,
                    membershipId,
                }),
            });
        });
    }

    async respondToInvitation(
        meetingId: string,
        input: RespondMeetingParticipantDto,
    ): Promise<MeetingParticipantResult> {
        const context = this.tenantContext.require();
        return this.prisma.$transaction(async (transaction) => {
            await lockMeetingForUpdate(transaction, context.tenantId, meetingId);
            const meeting = await this.requireVisibleMeeting(context, meetingId, transaction);
            this.requireEditableMeeting(meeting);
            if (meeting.organizerMembershipId === context.membershipId) {
                throw new ConflictException({ code: 'MEETING_ORGANIZER_RESPONSE_FIXED', message: '会议组织者默认接受邀请' });
            }
            const participant = await this.requireParticipant(context, meetingId, context.membershipId, transaction);
            this.requireVersion(participant.version, input.version, 'MEETING_PARTICIPANT_VERSION_CONFLICT');
            const result = await transaction.meetingParticipant.updateMany({
                where: { id: participant.id, tenantId: context.tenantId, deletedAt: null, version: input.version },
                data: {
                    responseStatus: input.responseStatus,
                    respondedAt: new Date(),
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (result.count !== 1) throw this.versionConflict('MEETING_PARTICIPANT_VERSION_CONFLICT');
            await transaction.auditLog.create({
                data: auditData(context, 'MEETING_PARTICIPANT_RESPONDED', 'MEETING_PARTICIPANT', participant.id, {
                    meetingId,
                    responseStatus: input.responseStatus,
                }),
            });
            return toMeetingParticipantResult(await transaction.meetingParticipant.findUniqueOrThrow({
                where: { id: participant.id },
                select: participantSelect,
            }));
        });
    }

    async getMinutes(meetingId: string): Promise<MeetingMinutesResult | null> {
        const context = this.tenantContext.require();
        const meeting = await this.requireVisibleMeeting(context, meetingId);
        const minutes = await this.prisma.meetingMinutes.findFirst({
            where: { tenantId: context.tenantId, meetingId, deletedAt: null },
            select: minutesSelect,
        });
        if (!minutes) return null;
        if (minutes.status === MeetingMinutesStatus.DRAFT && !this.canEditMinutes(context, meeting)) {
            throw new ForbiddenException({ code: 'MEETING_MINUTES_DRAFT_FORBIDDEN', message: '当前成员无权查看会议纪要草稿' });
        }
        return toMeetingMinutesResult(minutes);
    }

    async upsertMinutes(meetingId: string, input: UpsertMeetingMinutesDto): Promise<MeetingMinutesResult> {
        const context = this.tenantContext.require();
        return this.prisma.$transaction(async (transaction) => {
            await lockMeetingForUpdate(transaction, context.tenantId, meetingId);
            const meeting = await this.requireVisibleMeeting(context, meetingId, transaction);
            if (!this.canEditMinutes(context, meeting)) {
                throw new ForbiddenException({ code: 'MEETING_MINUTES_MANAGE_FORBIDDEN', message: '当前成员无权编辑会议纪要' });
            }
            if (!MINUTES_MEETING_STATUSES.has(meeting.status)) {
                throw new ConflictException({ code: 'MEETING_MINUTES_STATE_CONFLICT', message: '会议开始后才能编辑会议纪要' });
            }
            await this.validateMinutesOwners(context, meetingId, input.content, transaction);
            const existing = await transaction.meetingMinutes.findFirst({
                where: { tenantId: context.tenantId, meetingId, deletedAt: null },
                select: minutesSelect,
            });
            let minutes: MeetingMinutesRecord;
            let action: string;
            if (!existing) {
                if (input.version !== undefined) {
                    throw new BadRequestException({
                        code: 'MEETING_MINUTES_VERSION_UNEXPECTED',
                        message: '首次创建会议纪要时不能传 version',
                    });
                }
                minutes = await transaction.meetingMinutes.create({
                    data: {
                        tenantId: context.tenantId,
                        meetingId,
                        content: normalizeMinutesContent(input.content) as unknown as Prisma.InputJsonValue,
                        recorderMembershipId: context.membershipId,
                        createdBy: context.userId,
                        updatedBy: context.userId,
                    },
                    select: minutesSelect,
                });
                action = 'MEETING_MINUTES_CREATED';
            } else {
                if (input.version === undefined) {
                    throw new BadRequestException({
                        code: 'MEETING_MINUTES_VERSION_REQUIRED',
                        message: '修改会议纪要时必须传 version',
                    });
                }
                if (existing.status !== MeetingMinutesStatus.DRAFT) {
                    throw new ConflictException({
                        code: 'MEETING_MINUTES_PUBLISHED',
                        message: '已发布纪要需要重新打开后才能修改',
                    });
                }
                this.requireVersion(existing.version, input.version, 'MEETING_MINUTES_VERSION_CONFLICT');
                const result = await transaction.meetingMinutes.updateMany({
                    where: { id: existing.id, tenantId: context.tenantId, deletedAt: null, version: input.version },
                    data: {
                        content: normalizeMinutesContent(input.content) as unknown as Prisma.InputJsonValue,
                        recorderMembershipId: context.membershipId,
                        updatedBy: context.userId,
                        version: { increment: 1 },
                    },
                });
                if (result.count !== 1) throw this.versionConflict('MEETING_MINUTES_VERSION_CONFLICT');
                minutes = await transaction.meetingMinutes.findUniqueOrThrow({
                    where: { id: existing.id },
                    select: minutesSelect,
                });
                action = 'MEETING_MINUTES_UPDATED';
            }
            await transaction.auditLog.create({
                data: auditData(context, action, 'MEETING_MINUTES', minutes.id, { meetingId }),
            });
            return toMeetingMinutesResult(minutes);
        });
    }

    async publishMinutes(meetingId: string, version: number): Promise<MeetingMinutesResult> {
        return this.changeMinutesStatus(meetingId, version, MeetingMinutesStatus.PUBLISHED);
    }

    async reopenMinutes(meetingId: string, version: number): Promise<MeetingMinutesResult> {
        return this.changeMinutesStatus(meetingId, version, MeetingMinutesStatus.DRAFT);
    }

    private async changeMinutesStatus(
        meetingId: string,
        version: number,
        targetStatus: MeetingMinutesStatus,
    ): Promise<MeetingMinutesResult> {
        const context = this.tenantContext.require();
        return this.prisma.$transaction(async (transaction) => {
            await lockMeetingForUpdate(transaction, context.tenantId, meetingId);
            const meeting = await this.requireVisibleMeeting(context, meetingId, transaction);
            this.requireMeetingManager(context, meeting);
            if (meeting.status !== MeetingStatus.COMPLETED) {
                throw new ConflictException({
                    code: 'MEETING_MINUTES_MEETING_NOT_COMPLETED',
                    message: '会议完成后才能发布或重新打开纪要',
                });
            }
            const minutes = await transaction.meetingMinutes.findFirst({
                where: { tenantId: context.tenantId, meetingId, deletedAt: null },
                select: minutesSelect,
            });
            if (!minutes) throw new NotFoundException({ code: 'MEETING_MINUTES_NOT_FOUND', message: '会议纪要不存在' });
            const expectedStatus = targetStatus === MeetingMinutesStatus.PUBLISHED
                ? MeetingMinutesStatus.DRAFT
                : MeetingMinutesStatus.PUBLISHED;
            if (minutes.status !== expectedStatus) {
                throw new ConflictException({
                    code: 'MEETING_MINUTES_STATUS_CONFLICT',
                    message: targetStatus === MeetingMinutesStatus.PUBLISHED ? '会议纪要已经发布' : '会议纪要不是已发布状态',
                });
            }
            this.requireVersion(minutes.version, version, 'MEETING_MINUTES_VERSION_CONFLICT');
            const publishing = targetStatus === MeetingMinutesStatus.PUBLISHED;
            const result = await transaction.meetingMinutes.updateMany({
                where: { id: minutes.id, tenantId: context.tenantId, deletedAt: null, version },
                data: {
                    status: targetStatus,
                    publishedAt: publishing ? new Date() : null,
                    publishedByMembershipId: publishing ? context.membershipId : null,
                    updatedBy: context.userId,
                    version: { increment: 1 },
                },
            });
            if (result.count !== 1) throw this.versionConflict('MEETING_MINUTES_VERSION_CONFLICT');
            await transaction.auditLog.create({
                data: auditData(
                    context,
                    publishing ? 'MEETING_MINUTES_PUBLISHED' : 'MEETING_MINUTES_REOPENED',
                    'MEETING_MINUTES',
                    minutes.id,
                    { meetingId },
                ),
            });
            return toMeetingMinutesResult(await transaction.meetingMinutes.findUniqueOrThrow({
                where: { id: minutes.id },
                select: minutesSelect,
            }));
        });
    }

    private visibleMeetingWhere(
        context: RequestTenantContext,
        additional: Prisma.MeetingWhereInput = {},
    ): Prisma.MeetingWhereInput {
        const accessScope: Prisma.MeetingWhereInput = this.hasPermission(context, 'meeting.manage_all')
            ? {}
            : {
                OR: [
                    { organizerMembershipId: context.membershipId },
                    { participants: { some: { membershipId: context.membershipId, deletedAt: null } } },
                ],
            };
        return { tenantId: context.tenantId, deletedAt: null, AND: [accessScope, additional] };
    }

    private async requireVisibleMeeting(
        context: RequestTenantContext,
        meetingId: string,
        db: MeetingDb = this.prisma,
    ): Promise<MeetingRecord> {
        const meeting = await db.meeting.findFirst({
            where: this.visibleMeetingWhere(context, { id: meetingId }),
            select: meetingSelect,
        });
        if (!meeting) throw this.meetingNotFound();
        return meeting;
    }

    private async requireParticipant(
        context: RequestTenantContext,
        meetingId: string,
        membershipId: string,
        db: MeetingDb = this.prisma,
    ): Promise<MeetingParticipantRecord> {
        const participant = await db.meetingParticipant.findFirst({
            where: { tenantId: context.tenantId, meetingId, membershipId, deletedAt: null },
            select: participantSelect,
        });
        if (!participant) {
            throw new NotFoundException({ code: 'MEETING_PARTICIPANT_NOT_FOUND', message: '会议参会人不存在' });
        }
        return participant;
    }

    private async requireActiveMembership(
        context: RequestTenantContext,
        membershipId: string,
        db: MeetingDb = this.prisma,
    ): Promise<void> {
        const membership = await db.tenantMembership.findFirst({
            where: {
                id: membershipId,
                tenantId: context.tenantId,
                status: MembershipStatus.ACTIVE,
                deletedAt: null,
            },
            select: { id: true },
        });
        if (!membership) {
            throw new BadRequestException({ code: 'MEETING_MEMBER_INVALID', message: '目标成员不是当前租户有效成员' });
        }
    }

    private async validateDepartment(
        context: RequestTenantContext,
        departmentId: string | null | undefined,
        db: MeetingDb = this.prisma,
    ): Promise<void> {
        if (!departmentId) return;
        const department = await db.department.findFirst({
            where: { id: departmentId, tenantId: context.tenantId, status: DepartmentStatus.ACTIVE, deletedAt: null },
            select: { id: true },
        });
        if (!department) {
            throw new BadRequestException({ code: 'MEETING_DEPARTMENT_INVALID', message: '会议归属部门不存在或不可用' });
        }
    }

    private async validateProjectAssociation(
        context: RequestTenantContext,
        projectId: string | null | undefined,
        db: MeetingDb = this.prisma,
    ): Promise<void> {
        if (!projectId) return;
        const project = await db.project.findFirst({
            where: { id: projectId, tenantId: context.tenantId, deletedAt: null },
            select: {
                id: true,
                members: { where: { membershipId: context.membershipId, deletedAt: null }, select: { id: true } },
            },
        });
        if (!project) throw new BadRequestException({ code: 'MEETING_PROJECT_INVALID', message: '关联项目不存在' });
        if (!this.hasPermission(context, 'project.manage_all') && project.members.length === 0) {
            throw new ForbiddenException({ code: 'MEETING_PROJECT_ACCESS_FORBIDDEN', message: '只有项目成员才能关联该项目' });
        }
    }

    private async validateMinutesOwners(
        context: RequestTenantContext,
        meetingId: string,
        content: MeetingMinutesContentDto,
        db: MeetingDb,
    ): Promise<void> {
        const membershipIds = [...new Set(content.actionItems
            .map((item) => item.ownerMembershipId)
            .filter((membershipId): membershipId is string => Boolean(membershipId)))];
        if (membershipIds.length === 0) return;
        const count = await db.meetingParticipant.count({
            where: {
                tenantId: context.tenantId,
                meetingId,
                membershipId: { in: membershipIds },
                deletedAt: null,
                membership: { status: MembershipStatus.ACTIVE, deletedAt: null },
            },
        });
        if (count !== membershipIds.length) {
            throw new BadRequestException({
                code: 'MEETING_MINUTES_OWNER_INVALID',
                message: '行动项负责人必须是当前会议的有效参会人',
            });
        }
    }

    private requireMeetingManager(context: RequestTenantContext, meeting: MeetingRecord): void {
        if (!this.canManageMeeting(context, meeting)) {
            throw new ForbiddenException({ code: 'MEETING_MANAGE_FORBIDDEN', message: '当前成员不是会议管理者' });
        }
    }

    private requireEditableMeeting(meeting: MeetingRecord): void {
        if (!EDITABLE_MEETING_STATUSES.has(meeting.status)) {
            throw new ConflictException({ code: 'MEETING_STATE_CONFLICT', message: '当前会议状态不允许修改会议资料或参会人' });
        }
    }

    private requireVersion(actual: number, expected: number, code: string): void {
        if (actual !== expected) throw this.versionConflict(code);
    }

    private canManageMeeting(context: RequestTenantContext, meeting: MeetingRecord): boolean {
        return this.hasPermission(context, 'meeting.manage_all')
            || meeting.organizerMembershipId === context.membershipId
            || meeting.participants.some((participant) => (
                participant.membershipId === context.membershipId
                && participant.role === MeetingParticipantRole.HOST
            ));
    }

    private canDeleteMeeting(context: RequestTenantContext, meeting: MeetingRecord): boolean {
        return this.hasPermission(context, 'meeting.manage_all')
            || meeting.organizerMembershipId === context.membershipId;
    }

    private canEditMinutes(context: RequestTenantContext, meeting: MeetingRecord): boolean {
        if (this.canManageMeeting(context, meeting)) return true;
        return meeting.participants.some((participant) => (
            participant.membershipId === context.membershipId
            && participant.role === MeetingParticipantRole.RECORDER
        ));
    }

    private hasPermission(context: RequestTenantContext, permission: string): boolean {
        return context.permissions.includes(permission);
    }

    private meetingNotFound(): NotFoundException {
        return new NotFoundException({ code: 'MEETING_NOT_FOUND', message: '会议不存在或当前成员不可见' });
    }

    private versionConflict(code: string): ConflictException {
        return new ConflictException({ code, message: '数据已被其他请求修改，请刷新后重试' });
    }
}

function toMeetingResult(meeting: MeetingRecord, currentMembershipId: string): MeetingResult {
    const currentParticipant = meeting.participants.find((participant) => participant.membershipId === currentMembershipId);
    return {
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        projectId: meeting.projectId,
        departmentId: meeting.departmentId,
        organizer: toMeetingMemberIdentity(meeting.organizerMembership),
        startsAt: meeting.startsAt,
        durationMinutes: meeting.durationMinutes,
        location: meeting.location,
        meetingUrl: meeting.meetingUrl,
        agenda: meeting.agenda as unknown as MeetingAgendaItemResult[],
        status: meeting.status,
        cancelReason: meeting.cancelReason,
        startedAt: meeting.startedAt,
        completedAt: meeting.completedAt,
        participantCount: meeting.participants.length,
        myRole: currentParticipant?.role ?? null,
        myResponseStatus: currentParticipant?.responseStatus ?? null,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
        version: meeting.version,
    };
}

function toMeetingParticipantResult(participant: MeetingParticipantRecord): MeetingParticipantResult {
    return {
        id: participant.id,
        meetingId: participant.meetingId,
        member: toMeetingMemberIdentity(participant.membership),
        role: participant.role,
        responseStatus: participant.responseStatus,
        attendanceStatus: participant.attendanceStatus,
        respondedAt: participant.respondedAt,
        createdAt: participant.createdAt,
        updatedAt: participant.updatedAt,
        version: participant.version,
    };
}

function toMeetingMinutesResult(minutes: MeetingMinutesRecord): MeetingMinutesResult {
    return {
        id: minutes.id,
        meetingId: minutes.meetingId,
        content: minutes.content as unknown as MeetingMinutesContentResult,
        status: minutes.status,
        recorder: minutes.recorderMembership ? toMeetingMemberIdentity(minutes.recorderMembership) : null,
        publishedAt: minutes.publishedAt,
        publishedBy: minutes.publishedByMembership ? toMeetingMemberIdentity(minutes.publishedByMembership) : null,
        createdAt: minutes.createdAt,
        updatedAt: minutes.updatedAt,
        version: minutes.version,
    };
}

function toMeetingMemberIdentity(member: {
    id: string;
    account: string;
    displayName: string | null;
    departmentId: string | null;
    user: { displayName: string };
}): MeetingMemberIdentityResult {
    return {
        membershipId: member.id,
        account: member.account,
        displayName: member.displayName?.trim() || member.user.displayName,
        departmentId: member.departmentId,
    };
}

function normalizeAgenda(agenda: MeetingAgendaItemDto[]): MeetingAgendaItemResult[] {
    return agenda.map((item) => ({
        title: item.title.trim(),
        description: normalizeOptionalText(item.description),
        sortOrder: item.sortOrder,
    })).sort((left, right) => left.sortOrder - right.sortOrder);
}

function normalizeMinutesContent(content: MeetingMinutesContentDto): MeetingMinutesContentResult {
    return {
        summary: content.summary.trim(),
        decisions: content.decisions.map((decision) => decision.trim()),
        actionItems: content.actionItems.map((item) => ({
            title: item.title.trim(),
            ownerMembershipId: item.ownerMembershipId,
            dueDate: item.dueDate,
        })),
        notes: normalizeOptionalText(content.notes),
    };
}

function hasMeetingChanges(input: UpdateMeetingDto): boolean {
    return input.title !== undefined
        || input.description !== undefined
        || input.projectId !== undefined
        || input.departmentId !== undefined
        || input.startsAt !== undefined
        || input.durationMinutes !== undefined
        || input.location !== undefined
        || input.meetingUrl !== undefined
        || input.agenda !== undefined;
}

function normalizeRequiredText(value: string, code: string, message: string): string {
    const normalized = value.trim();
    if (!normalized) throw new BadRequestException({ code, message });
    return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function auditData(
    context: RequestTenantContext,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Prisma.InputJsonObject,
): Prisma.AuditLogUncheckedCreateInput {
    return {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action,
        outcome: AuditOutcome.SUCCESS,
        resourceType,
        resourceId,
        requestId: context.requestId,
        metadata,
    };
}
