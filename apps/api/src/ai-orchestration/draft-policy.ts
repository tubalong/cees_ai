export type ExecutableDraftStatus = 'CONFIRMED';

export function assertDraftExecutable(status: string): asserts status is ExecutableDraftStatus {
  if (status !== 'CONFIRMED') throw new Error('AI_ACTION_DRAFT_NOT_CONFIRMED');
}