import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
    MeetingAttendanceStatus,
    MeetingMinutesStatus,
    MeetingParticipantRole,
    MeetingResponseStatus,
    MeetingStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { MeetingService } from './meeting.service';

describe('MeetingService', () => {
    it('limits normal members to organized or participating meetings', async () => {
        const prisma = createPrismaMock();
        prisma.meeting.findMany.mockResolvedValue([]);
        const service = createService(prisma);

        await service.listMeetings({ includeCancelled: false, limit: 20 });

        expect(prisma.meeting.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: TENANT_ID,
                AND: expect.arrayContaining([expect.objectContaining({
                    OR: [
                        { organizerMembershipId: CURRENT_MEMBERSHIP_ID },
                        { participants: { some: { membershipId: CURRENT_MEMBERSHIP_ID, deletedAt: null } } },
                    ],
                })]),
            }),
        }));
    });

    it('allows meeting.manage_all to query the whole tenant scope', async () => {
        const prisma = createPrismaMock();
        prisma.meeting.findMany.mockResolvedValue([]);
        const service = createService(prisma, ['meeting.manage_all']);

        await service.listMeetings({ includeCancelled: true, limit: 20 });

        const where = prisma.meeting.findMany.mock.calls[0][0].where;
        expect(where.tenantId).toBe(TENANT_ID);
        expect(where.AND[0]).toEqual({});
    });

    it('hides meetings from same-tenant non-participants', async () => {
        const prisma = createPrismaMock();
        prisma.meeting.findFirst.mockResolvedValue(null);
        const service = createService(prisma);

        await expect(service.getMeeting(MEETING_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates the organizer as an accepted host and writes audit in one transaction', async () => {
        const prisma = createPrismaMock();
        prisma.meeting.create.mockResolvedValue({ id: MEETING_ID });
        prisma.meeting.findUniqueOrThrow.mockResolvedValue(meetingRecord());
        const service = createService(prisma);

        await service.createMeeting(createMeetingInput());

        expect(prisma.meetingParticipant.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                meetingId: MEETING_ID,
                membershipId: CURRENT_MEMBERSHIP_ID,
                role: MeetingParticipantRole.HOST,
                responseStatus: MeetingResponseStatus.ACCEPTED,
            }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'MEETING_CREATED', resourceId: MEETING_ID }),
        });
    });

    it('locks an associated project before checking project membership', async () => {
        const prisma = createPrismaMock();
        let releaseLock: (() => void) | undefined;
        prisma.$queryRaw.mockImplementation(() => new Promise((resolve) => {
            releaseLock = () => resolve([{ id: PROJECT_ID }]);
        }));
        prisma.project.findFirst.mockResolvedValue({ id: PROJECT_ID, members: [{ id: 'project-member-id' }] });
        prisma.meeting.create.mockResolvedValue({ id: MEETING_ID });
        prisma.meeting.findUniqueOrThrow.mockResolvedValue(meetingRecord({ projectId: PROJECT_ID }));
        const service = createService(prisma);

        const creation = service.createMeeting(createMeetingInput({ projectId: PROJECT_ID }));

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.project.findFirst).not.toHaveBeenCalled();
        releaseLock?.();
        await creation;
        expect(prisma.$queryRaw.mock.invocationCallOrder[0])
            .toBeLessThan(prisma.project.findFirst.mock.invocationCallOrder[0]);
    });

    it('rechecks meeting state only after acquiring the meeting row lock', async () => {
        const prisma = createPrismaMock();
        let releaseLock: (() => void) | undefined;
        prisma.$queryRaw.mockImplementation(() => new Promise((resolve) => {
            releaseLock = () => resolve([{ id: MEETING_ID }]);
        }));
        prisma.meeting.findFirst.mockResolvedValue(meetingRecord({ status: MeetingStatus.COMPLETED }));
        const service = createService(prisma);

        const update = service.updateMeeting(MEETING_ID, { title: '修改后会议', version: 1 });

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.meeting.findFirst).not.toHaveBeenCalled();
        releaseLock?.();
        await expect(update).rejects.toMatchObject({ response: expect.objectContaining({ code: 'MEETING_STATE_CONFLICT' }) });
        expect(prisma.meeting.updateMany).not.toHaveBeenCalled();
    });

    it('requires a reason when cancelling a meeting', async () => {
        const prisma = createPrismaMock();
        prisma.meeting.findFirst.mockResolvedValue(meetingRecord());
        const service = createService(prisma);

        await expect(service.transitionMeeting(MEETING_ID, {
            status: MeetingStatus.CANCELLED,
            reason: '  ',
            version: 1,
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'MEETING_CANCEL_REASON_REQUIRED' }) });
    });

    it('prevents downgrading the organizer host role', async () => {
        const prisma = createPrismaMock();
        prisma.meeting.findFirst.mockResolvedValue(meetingRecord());
        prisma.meetingParticipant.findFirst.mockResolvedValue(participantRecord());
        const service = createService(prisma);

        await expect(service.updateParticipant(MEETING_ID, CURRENT_MEMBERSHIP_ID, {
            role: MeetingParticipantRole.PARTICIPANT,
            version: 1,
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'MEETING_ORGANIZER_ROLE_REQUIRED' }) });
    });

    it('updates only the current participants own invitation response', async () => {
        const prisma = createPrismaMock();
        prisma.meeting.findFirst.mockResolvedValue(meetingRecord({
            organizerMembershipId: OTHER_MEMBERSHIP_ID,
            participants: [{
                membershipId: CURRENT_MEMBERSHIP_ID,
                role: MeetingParticipantRole.PARTICIPANT,
                responseStatus: MeetingResponseStatus.INVITED,
            }],
        }));
        prisma.meetingParticipant.findFirst.mockResolvedValue(participantRecord({
            responseStatus: MeetingResponseStatus.INVITED,
        }));
        prisma.meetingParticipant.updateMany.mockResolvedValue({ count: 1 });
        prisma.meetingParticipant.findUniqueOrThrow.mockResolvedValue(participantRecord({
            responseStatus: MeetingResponseStatus.ACCEPTED,
            version: 2,
        }));
        const service = createService(prisma);

        await service.respondToInvitation(MEETING_ID, {
            responseStatus: MeetingResponseStatus.ACCEPTED,
            version: 1,
        });

        expect(prisma.meetingParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: PARTICIPANT_ID, version: 1 }),
            data: expect.objectContaining({ responseStatus: MeetingResponseStatus.ACCEPTED }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'MEETING_PARTICIPANT_RESPONDED' }),
        });
    });

    it('allows a recorder to create minutes after the meeting starts', async () => {
        const prisma = createPrismaMock();
        prisma.meeting.findFirst.mockResolvedValue(meetingRecord({
            status: MeetingStatus.IN_PROGRESS,
            organizerMembershipId: OTHER_MEMBERSHIP_ID,
            participants: [{
                membershipId: CURRENT_MEMBERSHIP_ID,
                role: MeetingParticipantRole.RECORDER,
                responseStatus: MeetingResponseStatus.ACCEPTED,
            }],
        }));
        prisma.meetingMinutes.findFirst.mockResolvedValue(null);
        prisma.meetingMinutes.create.mockResolvedValue(minutesRecord());
        const service = createService(prisma);

        await service.upsertMinutes(MEETING_ID, { content: minutesContent() });

        expect(prisma.meetingMinutes.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ recorderMembershipId: CURRENT_MEMBERSHIP_ID }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ action: 'MEETING_MINUTES_CREATED' }),
        });
    });

    it('does not allow a recorder without host rights to publish minutes', async () => {
        const prisma = createPrismaMock();
        prisma.meeting.findFirst.mockResolvedValue(meetingRecord({
            status: MeetingStatus.COMPLETED,
            organizerMembershipId: OTHER_MEMBERSHIP_ID,
            participants: [{
                membershipId: CURRENT_MEMBERSHIP_ID,
                role: MeetingParticipantRole.RECORDER,
                responseStatus: MeetingResponseStatus.ACCEPTED,
            }],
        }));
        const service = createService(prisma);

        await expect(service.publishMinutes(MEETING_ID, 1)).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.meetingMinutes.findFirst).not.toHaveBeenCalled();
    });

    it('requires completed meetings before publishing minutes', async () => {
        const prisma = createPrismaMock();
        prisma.meeting.findFirst.mockResolvedValue(meetingRecord({ status: MeetingStatus.IN_PROGRESS }));
        const service = createService(prisma);

        await expect(service.publishMinutes(MEETING_ID, 1))
            .rejects.toMatchObject({ response: expect.objectContaining({ code: 'MEETING_MINUTES_MEETING_NOT_COMPLETED' }) });
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const CURRENT_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000001';
const OTHER_MEMBERSHIP_ID = '20000000-0000-0000-0000-000000000002';
const MEETING_ID = '30000000-0000-0000-0000-000000000001';
const PROJECT_ID = '30000000-0000-0000-0000-000000000002';
const PARTICIPANT_ID = '40000000-0000-0000-0000-000000000001';
const MINUTES_ID = '50000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-09-09T00:00:00.000Z');

function createService(prisma: Record<string, any>, permissions: string[] = []): MeetingService {
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: CURRENT_MEMBERSHIP_ID,
            requestId: 'request-id',
            roles: [],
            permissions,
        }),
    } as unknown as TenantContext;
    return new MeetingService(prisma as unknown as PrismaService, tenantContext);
}

function createPrismaMock(): Record<string, any> {
    const prisma: Record<string, any> = {
        department: { findFirst: jest.fn() },
        project: { findFirst: jest.fn() },
        tenantMembership: { findFirst: jest.fn() },
        meeting: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            findUniqueOrThrow: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
        },
        meetingParticipant: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findUniqueOrThrow: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            count: jest.fn().mockResolvedValue(0),
        },
        meetingMinutes: {
            findFirst: jest.fn(),
            findUniqueOrThrow: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
        },
        auditLog: { create: jest.fn() },
        $queryRaw: jest.fn().mockResolvedValue([{ id: MEETING_ID }]),
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => callback(prisma));
    return prisma;
}

function createMeetingInput(overrides: Record<string, unknown> = {}): any {
    return {
        title: '周例会',
        description: null,
        projectId: null,
        departmentId: null,
        startsAt: '2026-09-10T01:00:00.000Z',
        durationMinutes: 60,
        location: null,
        meetingUrl: null,
        agenda: [],
        ...overrides,
    };
}

function meetingRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: MEETING_ID,
        tenantId: TENANT_ID,
        projectId: null,
        departmentId: null,
        organizerMembershipId: CURRENT_MEMBERSHIP_ID,
        title: '周例会',
        description: null,
        startsAt: NOW,
        durationMinutes: 60,
        location: null,
        meetingUrl: null,
        agenda: [],
        status: MeetingStatus.DRAFT,
        cancelReason: null,
        startedAt: null,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
        organizerMembership: membershipRecord(),
        participants: [{
            membershipId: CURRENT_MEMBERSHIP_ID,
            role: MeetingParticipantRole.HOST,
            responseStatus: MeetingResponseStatus.ACCEPTED,
        }],
        ...overrides,
    };
}

function participantRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: PARTICIPANT_ID,
        meetingId: MEETING_ID,
        membershipId: CURRENT_MEMBERSHIP_ID,
        role: MeetingParticipantRole.HOST,
        responseStatus: MeetingResponseStatus.ACCEPTED,
        attendanceStatus: MeetingAttendanceStatus.PENDING,
        respondedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
        membership: membershipRecord(),
        ...overrides,
    };
}

function minutesRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: MINUTES_ID,
        meetingId: MEETING_ID,
        content: minutesContent(),
        status: MeetingMinutesStatus.DRAFT,
        recorderMembershipId: CURRENT_MEMBERSHIP_ID,
        publishedAt: null,
        publishedByMembershipId: null,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
        recorderMembership: membershipRecord(),
        publishedByMembership: null,
        ...overrides,
    };
}

function minutesContent(): any {
    return { summary: '会议总结', decisions: [], actionItems: [], notes: null };
}

function membershipRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: CURRENT_MEMBERSHIP_ID,
        account: 'zhangsan',
        displayName: '张三',
        departmentId: null,
        user: { displayName: '张三' },
        ...overrides,
    };
}
