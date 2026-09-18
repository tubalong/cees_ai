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
    /**
     * 是否实际使用 availabilityWindow 查询并过滤已批准请假
     */
    leaveFilterApplied: boolean;
    fallbackMode: AssignmentPolicyFallbackMode;
    sourceTrace: AssignmentPolicySourceTrace;
    resolvedAt: string;
};

