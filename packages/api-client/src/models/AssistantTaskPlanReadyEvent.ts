/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskClarification } from './AssistantTaskClarification';
import type { AssistantTaskPlanStep } from './AssistantTaskPlanStep';
export type AssistantTaskPlanReadyEvent = {
    type: 'plan_ready';
    seq: number;
    version: number;
    steps: Array<AssistantTaskPlanStep>;
    clarifications: Array<AssistantTaskClarification>;
};

