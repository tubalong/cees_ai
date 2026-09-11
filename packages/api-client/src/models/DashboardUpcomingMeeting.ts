/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MeetingStatus } from './MeetingStatus';
export type DashboardUpcomingMeeting = {
    id: string;
    title: string;
    startsAt: string;
    durationMinutes: number;
    status: MeetingStatus;
    projectId?: string | null;
    responseStatus: string | null;
};

