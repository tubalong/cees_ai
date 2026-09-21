/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectActivity } from './ProjectActivity';
export type ProjectWorkflowSummary = {
    decisions: {
        total: number;
        draft: number;
        published: number;
        superseded: number;
    };
    milestones: {
        total: number;
        planned: number;
        inProgress: number;
        acceptance: number;
        completed: number;
        cancelled: number;
        overdue: number;
    };
    repositories: {
        total: number;
        enabled: number;
    };
    activities: Array<ProjectActivity>;
};
