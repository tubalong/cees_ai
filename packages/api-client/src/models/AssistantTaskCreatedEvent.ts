/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskStatus } from './AssistantTaskStatus';
export type AssistantTaskCreatedEvent = {
    type: 'task_created';
    /**
     * 任务内递增事件序号
     */
    seq: number;
    status: AssistantTaskStatus;
};

