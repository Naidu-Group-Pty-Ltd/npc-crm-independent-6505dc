/**
 * The wizard's draft-loading rule, isolated.
 *
 * The wizard reloads the stored draft into the form whenever the server copy
 * changes. That is right for a fresh load and wrong mid-edit: every save
 * invalidates the detail query, so the refetch lands a moment after the step
 * advances, and an unguarded reload wiped whatever the user had already typed
 * on the next step. The rule below is the fix, extracted so it can be tested
 * without mounting eight steps of form.
 */
import { describe, expect, it } from 'vitest';
import { shouldLoadDraft } from '@/lib/agreements/wizardDraft.pure';

const STAMP_A = 'agreement-1:2026-08-08T00:00:00Z';
const STAMP_B = 'agreement-1:2026-08-08T00:05:00Z';

describe('wizard draft loading', () => {
  it('loads on first paint', () => {
    expect(shouldLoadDraft(STAMP_A, { loaded: null, dirty: false })).toBe(true);
  });

  it('loads a first draft even if the form was touched before it arrived', () => {
    // A user can type on step 1 before the created row comes back; that row
    // is the same data they just submitted, so taking it is correct.
    expect(shouldLoadDraft(STAMP_A, { loaded: null, dirty: true })).toBe(true);
  });

  it('does not reload the copy already in the form', () => {
    expect(shouldLoadDraft(STAMP_A, { loaded: STAMP_A, dirty: false })).toBe(false);
    expect(shouldLoadDraft(STAMP_A, { loaded: STAMP_A, dirty: true })).toBe(false);
  });

  it('takes a newer server copy when the form is clean', () => {
    expect(shouldLoadDraft(STAMP_B, { loaded: STAMP_A, dirty: false })).toBe(true);
  });

  it('never discards unsaved edits — the regression this guards', () => {
    // Save on step change → invalidate → refetch lands while the user is
    // already typing on the next step. Before the guard, this returned true
    // and their keystrokes vanished.
    expect(shouldLoadDraft(STAMP_B, { loaded: STAMP_A, dirty: true })).toBe(false);
  });
});
