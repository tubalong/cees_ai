export const ASSISTANT_TURN_LEASE_MS = 60_000;
export const ASSISTANT_HEARTBEAT_INTERVAL_MS = 15_000;
export const ASSISTANT_RECOVERY_INTERVAL_MS = 30_000;

export function nextTurnLease(now = new Date()): Date {
  return new Date(now.getTime() + ASSISTANT_TURN_LEASE_MS);
}
