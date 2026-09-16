/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssignmentCandidatePool } from './AssignmentCandidatePool';
import type { AssignmentPolicyDomain } from './AssignmentPolicyDomain';
import type { AssignmentPolicyFallbackMode } from './AssignmentPolicyFallbackMode';
import type { AssignmentPolicyLevel } from './AssignmentPolicyLevel';
export type CreateAssignmentPolicyRequest = {
    domain: AssignmentPolicyDomain;
    level: AssignmentPolicyLevel;
    projectId?: string | null;
    name: string;
    description?: string | null;
    candidatePool: AssignmentCandidatePool;
    skipOnLeave: boolean;
    fallbackMode: AssignmentPolicyFallbackMode;
    enabled?: boolean;
};

