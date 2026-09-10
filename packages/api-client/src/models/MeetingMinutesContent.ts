/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MeetingMinutesActionItem } from './MeetingMinutesActionItem';
export type MeetingMinutesContent = {
    summary: string;
    decisions: Array<string>;
    actionItems: Array<MeetingMinutesActionItem>;
    notes?: string | null;
};

