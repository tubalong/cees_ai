/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectMemberIdentity } from './ProjectMemberIdentity';
export type ProjectActivity = {
    id: string;
    projectId: string;
    type: string;
    resourceType: string;
    resourceId?: string | null;
    summary: string;
    metadata: Record<string, any>;
    actor?: (ProjectMemberIdentity | null);
    createdAt: string;
};

