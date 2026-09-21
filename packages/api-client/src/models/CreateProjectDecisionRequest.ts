/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreateProjectDecisionRequest = {
    title: string;
    problem: string;
    background?: string | null;
    recommendation?: string | null;
    conclusion?: string | null;
    rationale?: string | null;
    risks?: Array<string>;
    nextActions?: Array<string>;
    participantMembershipIds?: Array<string>;
    sourceConversationId?: string | null;
};
