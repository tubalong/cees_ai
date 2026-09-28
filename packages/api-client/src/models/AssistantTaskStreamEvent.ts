/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskCancelledEvent } from './AssistantTaskCancelledEvent';
import type { AssistantTaskCompletedEvent } from './AssistantTaskCompletedEvent';
import type { AssistantTaskCreatedEvent } from './AssistantTaskCreatedEvent';
import type { AssistantTaskFailedEvent } from './AssistantTaskFailedEvent';
import type { AssistantTaskPlanConfirmedEvent } from './AssistantTaskPlanConfirmedEvent';
import type { AssistantTaskPlanReadyEvent } from './AssistantTaskPlanReadyEvent';
export type AssistantTaskStreamEvent = (AssistantTaskCreatedEvent | AssistantTaskPlanReadyEvent | AssistantTaskPlanConfirmedEvent | AssistantTaskCompletedEvent | AssistantTaskFailedEvent | AssistantTaskCancelledEvent);

