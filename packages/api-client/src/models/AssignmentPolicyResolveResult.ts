/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssignmentPolicyDomain } from './AssignmentPolicyDomain';
import type { AssignmentPolicyFallbackMode } from './AssignmentPolicyFallbackMode';
import type { AssignmentPolicyLevel } from './AssignmentPolicyLevel';
import type { AssignmentPolicySourceTrace } from './AssignmentPolicySourceTrace';
export type AssignmentPolicyResolveResult = {
    matchedPolicyId: string | null;
    domain: AssignmentPolicyDomain;
    level: AssignmentPolicyLevel;
    candidates: Array<string>;
    skippedOnLeave: Array<string>;
    fallbackMode: AssignmentPolicyFallbackMode;
    sourceTrace: AssignmentPolicySourceTrace;
    resolvedAt: string;
};

