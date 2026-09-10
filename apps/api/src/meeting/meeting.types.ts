import {
    MeetingAttendanceStatus,
    MeetingMinutesStatus,
    MeetingParticipantRole,
    MeetingResponseStatus,
    MeetingStatus,
} from '@prisma/client';

export interface MeetingMemberIdentityResult {
    membershipId: string;
    account: string;
    displayName: string;
    departmentId: string | null;
}

export interface MeetingAgendaItemResult {
    title: string;
    description: string | null;
    sortOrder: number;
}

export interface MeetingMinutesActionItemResult {
    title: string;
    ownerMembershipId: string | null;
    dueDate: string | null;
}

export interface MeetingMinutesContentResult {
    summary: string;
    decisions: string[];
    actionItems: MeetingMinutesActionItemResult[];
    notes: string | null;
}

export interface MeetingResult {
    id: string;
    title: string;
    description: string | null;
    projectId: string | null;
    departmentId: string | null;
    organizer: MeetingMemberIdentityResult;
    startsAt: Date;
    durationMinutes: number;
    location: string | null;
    meetingUrl: string | null;
    agenda: MeetingAgendaItemResult[];
    status: MeetingStatus;
    cancelReason: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    participantCount: number;
    myRole: MeetingParticipantRole | null;
    myResponseStatus: MeetingResponseStatus | null;
    createdAt: Date;
    updatedAt: Date;
    version: number;
}

export interface MeetingListResult {
    items: MeetingResult[];
    nextCursor: string | null;
}

export interface MeetingParticipantResult {
    id: string;
    meetingId: string;
    member: MeetingMemberIdentityResult;
    role: MeetingParticipantRole;
    responseStatus: MeetingResponseStatus;
    attendanceStatus: MeetingAttendanceStatus;
    respondedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    version: number;
}

export interface MeetingParticipantListResult {
    items: MeetingParticipantResult[];
}

export interface MeetingMinutesResult {
    id: string;
    meetingId: string;
    content: MeetingMinutesContentResult;
    status: MeetingMinutesStatus;
    recorder: MeetingMemberIdentityResult | null;
    publishedAt: Date | null;
    publishedBy: MeetingMemberIdentityResult | null;
    createdAt: Date;
    updatedAt: Date;
    version: number;
}
