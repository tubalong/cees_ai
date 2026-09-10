/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MeetingAgendaItem } from './MeetingAgendaItem';
export type CreateMeetingRequest = {
    title: string;
    description?: string | null;
    projectId?: string | null;
    departmentId?: string | null;
    startsAt: string;
    durationMinutes: number;
    location?: string | null;
    meetingUrl?: string | null;
    agenda?: Array<MeetingAgendaItem>;
};

