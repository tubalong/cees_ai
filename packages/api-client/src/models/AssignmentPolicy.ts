/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssignmentCandidatePool } from './AssignmentCandidatePool';
import type { AssignmentPolicyDomain } from './AssignmentPolicyDomain';
import type { AssignmentPolicyFallbackMode } from './AssignmentPolicyFallbackMode';
import type { AssignmentPolicyLevel } from './AssignmentPolicyLevel';
export type AssignmentPolicy = {
    id: string;
    tenantId: string;
    domain: AssignmentPolicyDomain;
    level: AssignmentPolicyLevel;
    projectId?: string | null;
    name: string;
    description?: string | null;
    candidatePool: AssignmentCandidatePool;
    skipOnLeave: boolean;
    fallbackMode: AssignmentPolicyFallbackMode;
    enabled: boolean;
    version: number;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: string;
    updatedAt: string;
};

