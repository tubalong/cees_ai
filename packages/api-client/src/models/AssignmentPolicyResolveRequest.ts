/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssignmentPolicyAvailabilityWindow } from './AssignmentPolicyAvailabilityWindow';
import type { AssignmentPolicyDomain } from './AssignmentPolicyDomain';
import type { AssignmentPolicyResolveContext } from './AssignmentPolicyResolveContext';
export type AssignmentPolicyResolveRequest = {
    domain: AssignmentPolicyDomain;
    projectId?: string | null;
    context?: AssignmentPolicyResolveContext;
    availabilityWindow?: AssignmentPolicyAvailabilityWindow;
};

