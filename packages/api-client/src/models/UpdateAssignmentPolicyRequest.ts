/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssignmentCandidatePool } from './AssignmentCandidatePool';
import type { AssignmentPolicyFallbackMode } from './AssignmentPolicyFallbackMode';
export type UpdateAssignmentPolicyRequest = {
    name?: string;
    description?: string | null;
    candidatePool?: AssignmentCandidatePool;
    skipOnLeave?: boolean;
    fallbackMode?: AssignmentPolicyFallbackMode;
    enabled?: boolean;
    version: number;
};

