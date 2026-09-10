/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MeetingAgendaItem } from './MeetingAgendaItem';
import type { MeetingMemberIdentity } from './MeetingMemberIdentity';
import type { MeetingParticipantRole } from './MeetingParticipantRole';
import type { MeetingResponseStatus } from './MeetingResponseStatus';
import type { MeetingStatus } from './MeetingStatus';
export type Meeting = {
    id: string;
    title: string;
    description: string | null;
    projectId: string | null;
    departmentId: string | null;
    organizer: MeetingMemberIdentity;
    startsAt: string;
    durationMinutes: number;
    location: string | null;
    meetingUrl: string | null;
    agenda: Array<MeetingAgendaItem>;
    status: MeetingStatus;
    cancelReason: string | null;
    startedAt: string | null;
    completedAt: string | null;
    participantCount: number;
    myRole: (MeetingParticipantRole | null);
    myResponseStatus: (MeetingResponseStatus | null);
    createdAt: string;
    updatedAt: string;
    version: number;
};

