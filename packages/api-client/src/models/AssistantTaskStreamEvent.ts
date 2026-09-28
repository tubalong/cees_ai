/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskCancelledEvent } from './AssistantTaskCancelledEvent';
import type { AssistantTaskCompletedEvent } from './AssistantTaskCompletedEvent';
import type { AssistantTaskCreatedEvent } from './AssistantTaskCreatedEvent';
import type { AssistantTaskFailedEvent } from './AssistantTaskFailedEvent';
import type { AssistantTaskInteractionRequestedEvent } from './AssistantTaskInteractionRequestedEvent';
import type { AssistantTaskInteractionResolvedEvent } from './AssistantTaskInteractionResolvedEvent';
import type { AssistantTaskPlanConfirmedEvent } from './AssistantTaskPlanConfirmedEvent';
import type { AssistantTaskPlanReadyEvent } from './AssistantTaskPlanReadyEvent';
import type { AssistantTaskStepCompletedEvent } from './AssistantTaskStepCompletedEvent';
import type { AssistantTaskStepFailedEvent } from './AssistantTaskStepFailedEvent';
import type { AssistantTaskStepProgressEvent } from './AssistantTaskStepProgressEvent';
import type { AssistantTaskStepSkippedEvent } from './AssistantTaskStepSkippedEvent';
import type { AssistantTaskStepStartedEvent } from './AssistantTaskStepStartedEvent';
export type AssistantTaskStreamEvent = (AssistantTaskCreatedEvent | AssistantTaskPlanReadyEvent | AssistantTaskPlanConfirmedEvent | AssistantTaskStepStartedEvent | AssistantTaskStepProgressEvent | AssistantTaskStepCompletedEvent | AssistantTaskStepFailedEvent | AssistantTaskStepSkippedEvent | AssistantTaskInteractionRequestedEvent | AssistantTaskInteractionResolvedEvent | AssistantTaskCompletedEvent | AssistantTaskFailedEvent | AssistantTaskCancelledEvent);

