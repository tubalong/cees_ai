/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskPriority } from './TaskPriority';
export type UpdateTaskRequest = {
    title?: string;
    description?: string | null;
    parentId?: string | null;
    priority?: TaskPriority;
    dueDate?: string | null;
    version: number;
};

