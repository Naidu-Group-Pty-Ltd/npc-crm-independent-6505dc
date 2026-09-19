import { describe, expect, it } from 'vitest';
import {
  canonicalOutcome, isUnusableCapture,
} from '../../../supabase/functions/_shared/aml/verificationOutcome.pure.ts';

/**
 * The single contract both writers of `aml.verification_checks` obey — the
 * outbox worker and the staff re-run in `aml-verification`. They had drifted,
 * and every difference cost the customer.
 */

const MAX = 3;
const at = (attemptsConsumed: number) => ({ attemptsConsumed, maxAttempts: MAX });

describe('canonical verification outcome', () => {
  it('records a real failure as one consumed attempt', () => {
    const o = canonicalOutcome({ status: 'failed' }, at(0));
    expect(o).toMatchObject({
      status: 'failed', processingStatus: 'completed', attemptConsumed: true,
    });
  });

  it('sends a referral to a human without exhausting anybody', () => {
    const o = canonicalOutcome({ status: 'manual_review' }, at(2));
    expect(o.status).toBe('referred');
    expect(o.attemptConsumed).toBe(true);
  });

  it('exhausts only when a real failure spends the last attempt', () => {
    expect(canonicalOutcome({ status: 'failed' }, at(1)).status).toBe('failed');
    expect(canonicalOutcome({ status: 'failed' }, at(2)).status).toBe('exhausted');
  });

  it('does not exhaust a client whose earlier captures were merely unusable', () => {
    // The staff path decided this from `attempt_number` — the capture
    // sequence — so three unreadable photos followed by one genuine failure
    // exhausted somebody who had used a single attempt.
    const afterThreeUnusableCaptures = at(0);
    expect(canonicalOutcome({ status: 'failed' }, afterThreeUnusableCaptures).status).toBe('failed');
  });

  it('leaves the identity status untouched for an unusable capture', () => {
    for (const status of ['pending', 'in_progress']) {
      const o = canonicalOutcome({ status }, at(0));
      expect(o.status, status).toBeNull();
      expect(o.processingStatus).toBe('capture_unusable');
      expect(o.attemptConsumed).toBe(false);
      expect(o.providerErrorCategory).toBe('capture_unusable');
    }
  });

  it('treats an unusable face verdict as a capture problem whatever the status', () => {
    const o = canonicalOutcome(
      { status: 'failed', raw: { face: { verdict: 'unusable' } } }, at(0));
    expect(o.status).toBeNull();
    expect(o.attemptConsumed).toBe(false);
  });

  it('never charges an attempt for a capture nobody could examine', () => {
    // Three unusable captures in a row must leave every attempt available.
    let consumed = 0;
    for (let i = 0; i < 3; i++) {
      const o = canonicalOutcome({ status: 'pending' }, at(consumed));
      if (o.attemptConsumed) consumed += 1;
    }
    expect(consumed).toBe(0);
  });

  it('sends an unrecognised provider status to a human rather than guessing', () => {
    expect(canonicalOutcome({ status: 'something_new' }, at(0)).status).toBe('referred');
  });

  it('identifies an unusable capture from either signal', () => {
    expect(isUnusableCapture({ status: 'pending' })).toBe(true);
    expect(isUnusableCapture({ status: 'failed', raw: { face: { verdict: 'unusable' } } })).toBe(true);
    expect(isUnusableCapture({ status: 'failed', raw: { face: { verdict: 'no_match' } } })).toBe(false);
    expect(isUnusableCapture({ status: 'manual_review', raw: {} })).toBe(false);
  });
});
