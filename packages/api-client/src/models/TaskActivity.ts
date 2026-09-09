/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskMemberIdentity } from './TaskMemberIdentity';
export type TaskActivity = {
    id: string;
    taskId: string;
    action: string;
    actor: (TaskMemberIdentity | null);
    metadata: any | null;
    createdAt: string;
};

