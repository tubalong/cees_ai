/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskAssignee } from './TaskAssignee';
import type { TaskPriority } from './TaskPriority';
import type { TaskStatus } from './TaskStatus';
export type TaskSummary = {
    id: string;
    projectId: string;
    parentId: string | null;
    decisionId: string | null;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    owner: (TaskAssignee | null);
    collaborators: Array<TaskAssignee>;
    subtaskCount: number;
    commentCount: number;
    attachmentCount: number;
    createdAt: string;
    updatedAt: string;
    version: number;
};

