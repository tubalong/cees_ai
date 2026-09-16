import { AssignmentPolicyDomain, AssignmentPolicyFallbackMode, AssignmentPolicyLevel } from '@prisma/client';

export interface AssignmentCandidatePool {
    membershipIds: string[];
    departmentIds: string[];
    projectIds: string[];
}

export interface AssignmentPolicy {
    id: string;
    tenantId: string;
    projectId: string | null;
    domain: AssignmentPolicyDomain;
    level: AssignmentPolicyLevel;
    name: string;
    description: string | null;
    candidatePool: AssignmentCandidatePool;
    skipOnLeave: boolean;
    fallbackMode: AssignmentPolicyFallbackMode;
    enabled: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface AssignmentPolicyList {
    items: AssignmentPolicy[];
    nextCursor: string | null;
}

export interface AssignmentPolicySourceTrace {
    policyId: string | null;
    projectId: string | null;
    domain: AssignmentPolicyDomain;
    level: AssignmentPolicyLevel;
}

export interface AssignmentPolicyResolveResult {
    matchedPolicyId: string | null;
    domain: AssignmentPolicyDomain;
    level: AssignmentPolicyLevel;
    candidates: string[];
    skippedOnLeave: string[];
    fallbackMode: AssignmentPolicyFallbackMode;
    sourceTrace: AssignmentPolicySourceTrace;
    resolvedAt: string;
}