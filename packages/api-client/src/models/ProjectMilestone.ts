/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectDecisionStatus } from './ProjectDecisionStatus';
import type { ProjectMemberIdentity } from './ProjectMemberIdentity';
import type { ProjectMilestoneStatus } from './ProjectMilestoneStatus';
export type ProjectMilestone = {
    id: string;
    projectId: string;
    title: string;
    objective: string;
    targetDate: string;
    owner: ProjectMemberIdentity;
    acceptanceCriteria: Array<string>;
    acceptanceNote?: string | null;
    status: ProjectMilestoneStatus;
    startedAt?: string | null;
    acceptanceStartedAt?: string | null;
    completedAt?: string | null;
    cancelledAt?: string | null;
    cancellationReason?: string | null;
    tasks: Array<{
        id: string;
        title: string;
        status: string;
        required: boolean;
    }>;
    taskCount: number;
    completedTaskCount: number;
    openTaskCount: number;
    progressPercent: number;
    overdue: boolean;
    health: ProjectMilestone.health;
    decisions: Array<{
        id: string;
        title: string;
        status: ProjectDecisionStatus;
    }>;
    createdAt: string;
    updatedAt: string;
    version: number;
};
export namespace ProjectMilestone {
    export enum health {
        NORMAL = 'NORMAL',
        AT_RISK = 'AT_RISK',
        OVERDUE = 'OVERDUE',
    }
}

