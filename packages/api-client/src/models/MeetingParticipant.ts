/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MeetingAttendanceStatus } from './MeetingAttendanceStatus';
import type { MeetingMemberIdentity } from './MeetingMemberIdentity';
import type { MeetingParticipantRole } from './MeetingParticipantRole';
import type { MeetingResponseStatus } from './MeetingResponseStatus';
export type MeetingParticipant = {
    id: string;
    meetingId: string;
    member: MeetingMemberIdentity;
    role: MeetingParticipantRole;
    responseStatus: MeetingResponseStatus;
    attendanceStatus: MeetingAttendanceStatus;
    respondedAt: string | null;
    createdAt: string;
    updatedAt: string;
    version: number;
};

