/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ChatStreamCompletedEvent } from './ChatStreamCompletedEvent';
import type { ChatStreamContentDeltaEvent } from './ChatStreamContentDeltaEvent';
import type { ChatStreamErrorEvent } from './ChatStreamErrorEvent';
import type { ChatStreamStartedEvent } from './ChatStreamStartedEvent';
import type { ChatStreamStatusEvent } from './ChatStreamStatusEvent';
import type { ChatStreamUsageEvent } from './ChatStreamUsageEvent';
export type ChatStreamEvent = (ChatStreamStartedEvent | ChatStreamStatusEvent | ChatStreamContentDeltaEvent | ChatStreamUsageEvent | ChatStreamCompletedEvent | ChatStreamErrorEvent);

