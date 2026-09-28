/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTask } from './AssistantTask';
export type AssistantTaskListResult = {
    items: Array<AssistantTask>;
    /**
     * 下一页游标；没有更多数据时为 null
     */
    nextCursor: string | null;
};

