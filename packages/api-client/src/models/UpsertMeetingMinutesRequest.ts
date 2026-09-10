/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MeetingMinutesContent } from './MeetingMinutesContent';
export type UpsertMeetingMinutesRequest = {
    content: MeetingMinutesContent;
    /**
     * 首次创建时不传；修改已有草稿时必传
     */
    version?: number;
};

