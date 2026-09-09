/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskTransitionTarget } from './TaskTransitionTarget';
export type TaskTransitionRequest = {
    status: TaskTransitionTarget;
    /**
     * BLOCKED 和 CANCELLED 时必填
     */
    reason?: string | null;
    version: number;
};

