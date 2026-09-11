/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TurnStreamCompletedEvent } from './TurnStreamCompletedEvent';
import type { TurnStreamContentDeltaEvent } from './TurnStreamContentDeltaEvent';
import type { TurnStreamErrorEvent } from './TurnStreamErrorEvent';
import type { TurnStreamStartedEvent } from './TurnStreamStartedEvent';
import type { TurnStreamStatusEvent } from './TurnStreamStatusEvent';
import type { TurnStreamToolCallEvent } from './TurnStreamToolCallEvent';
import type { TurnStreamToolResultEvent } from './TurnStreamToolResultEvent';
import type { TurnStreamUsageEvent } from './TurnStreamUsageEvent';
export type TurnStreamEvent = (TurnStreamStartedEvent | TurnStreamStatusEvent | TurnStreamContentDeltaEvent | TurnStreamToolCallEvent | TurnStreamToolResultEvent | TurnStreamUsageEvent | TurnStreamCompletedEvent | TurnStreamErrorEvent);

