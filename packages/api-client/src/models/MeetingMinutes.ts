/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MeetingMemberIdentity } from './MeetingMemberIdentity';
import type { MeetingMinutesContent } from './MeetingMinutesContent';
import type { MeetingMinutesStatus } from './MeetingMinutesStatus';
export type MeetingMinutes = {
    id: string;
    meetingId: string;
    content: MeetingMinutesContent;
    status: MeetingMinutesStatus;
    recorder: (MeetingMemberIdentity | null);
    publishedAt: string | null;
    publishedBy: (MeetingMemberIdentity | null);
    createdAt: string;
    updatedAt: string;
    version: number;
};

