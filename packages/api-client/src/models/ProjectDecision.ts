/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectDecisionStatus } from './ProjectDecisionStatus';
import type { ProjectMemberIdentity } from './ProjectMemberIdentity';
export type ProjectDecision = {
    id: string;
    projectId: string;
    title: string;
    problem: string;
    background?: string | null;
    recommendation?: string | null;
    conclusion?: string | null;
    rationale?: string | null;
    risks?: Array<string>;
    nextActions?: Array<string>;
    participantMembershipIds: Array<string>;
    participants: Array<ProjectMemberIdentity>;
    status: ProjectDecisionStatus;
    sourceConversationId?: string | null;
    publishedAt?: string | null;
    publishedBy?: (ProjectMemberIdentity | null);
    createdBy: ProjectMemberIdentity;
    createdAt: string;
    updatedAt: string;
    version: number;
};

