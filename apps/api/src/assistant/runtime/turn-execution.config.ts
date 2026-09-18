export const ASSISTANT_TURN_LEASE_MS = 60_000;
export const ASSISTANT_HEARTBEAT_INTERVAL_MS = 15_000;
export const ASSISTANT_RECOVERY_INTERVAL_MS = 30_000;
/** completed 之后等待 related_questions 事件到达的 SSE 宽限窗口。 */
export const RELATED_QUESTIONS_LINGER_MS = 10_000;

export function nextTurnLease(now = new Date()): Date {
  return new Date(now.getTime() + ASSISTANT_TURN_LEASE_MS);
}
