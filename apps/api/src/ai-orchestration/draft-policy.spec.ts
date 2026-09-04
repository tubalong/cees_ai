import { assertDraftExecutable } from './draft-policy';

describe('AI action draft policy', () => {
  it('rejects execution before confirmation', () => {
    expect(() => assertDraftExecutable('PENDING_CONFIRMATION')).toThrow('AI_ACTION_DRAFT_NOT_CONFIRMED');
  });

  it('allows confirmed drafts', () => {
    expect(() => assertDraftExecutable('CONFIRMED')).not.toThrow();
  });
});