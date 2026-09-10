/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MeetingTransitionTarget } from './MeetingTransitionTarget';
export type MeetingTransitionRequest = {
    status: MeetingTransitionTarget;
    /**
     * CANCELLED 时必填
     */
    reason?: string | null;
    version: number;
};

