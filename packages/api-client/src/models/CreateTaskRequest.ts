/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskPriority } from './TaskPriority';
export type CreateTaskRequest = {
    title: string;
    description?: string | null;
    parentId?: string | null;
    priority?: TaskPriority;
    dueDate?: string | null;
    ownerMembershipId: string;
    collaboratorMembershipIds?: Array<string>;
    /**
     * 任务来源决策；必须属于当前项目
     */
    decisionId?: string | null;
};

