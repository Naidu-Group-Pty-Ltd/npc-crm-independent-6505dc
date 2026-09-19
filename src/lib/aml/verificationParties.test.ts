import { describe, expect, it } from 'vitest';
import {
  projectParty, type VerificationCheckRow,
} from '../../../supabase/functions/_shared/aml/verificationParties.pure.ts';

/**
 * The portal's electronic-verification projection.
 *
 * These are written as the client's experience, because that is where the
 * defect showed: somebody who had failed nothing was told they had no attempts
 * left, and somebody whose photo could not be read was told their case was
 * with our team.
 */

const MAX = 3;
const me = { id: null, label: 'You' };

const unusableCapture = (sequence: number): VerificationCheckRow => ({
  party_id: null, check_type: 'electronic_idv', status: 'pending',
  attempt_number: sequence, capture_sequence: sequence,
  attempt_consumed: false, processing_status: 'capture_unusable',
});

const settled = (sequence: number, status: string): VerificationCheckRow => ({
  party_id: null, check_type: 'electronic_idv', status,
  attempt_number: sequence, capture_sequence: sequence,
  attempt_consumed: true, processing_status: 'completed',
});

describe('electronic verification, as the client sees it', () => {
  it('charges nothing for a capture the provider could not examine', () => {
    const p = projectParty(me, [unusableCapture(1)], MAX, true);
    expect(p.attempts_used).toBe(0);
    expect(p.attempts_remaining).toBe(MAX);
  });

  it('does not lock a client out after three unusable captures', () => {
    // The reported lockout. Three rows, no attempts consumed: the upload gate
    // (verification_attempts_used) would still accept a submission, so the
    // portal must not be the thing that stops them.
    const rows = [unusableCapture(1), unusableCapture(2), unusableCapture(3)];
    const p = projectParty(me, rows, MAX, true);
    expect(p.attempts_used).toBe(0);
    expect(p.can_attempt, 'still open to them — they have failed nothing').toBe(true);
  });

  it('asks for a new photo rather than saying the case is under review', () => {
    // status stays `pending` on an unusable capture, which used to render as
    // "With our team" — a review nobody was going to perform.
    const p = projectParty(me, [unusableCapture(1)], MAX, true);
    expect(p.status).toBe('action_required');
    expect(p.retake_required).toBe(true);
  });

  it('counts a real outcome as an attempt', () => {
    const p = projectParty(me, [settled(1, 'failed')], MAX, true);
    expect(p.attempts_used).toBe(1);
    expect(p.attempts_remaining).toBe(2);
    expect(p.can_attempt).toBe(true);
  });

  it('closes the flow once every attempt has genuinely been spent', () => {
    const rows = [settled(1, 'failed'), settled(2, 'failed'), settled(3, 'failed')];
    const p = projectParty(me, rows, MAX, true);
    expect(p.attempts_used).toBe(3);
    expect(p.can_attempt).toBe(false);
  });

  it('counts only the attempts that were actually consumed when both kinds mix', () => {
    const rows = [unusableCapture(1), settled(2, 'referred'), unusableCapture(3)];
    const p = projectParty(me, rows, MAX, true);
    expect(p.attempts_used).toBe(1);
    expect(p.can_attempt).toBe(true);
    // The latest row is the unusable one, so a retake is what is being asked.
    expect(p.retake_required).toBe(true);
  });

  it('charges nothing for any technical condition', () => {
    // Every one of these leaves `attempt_consumed` false by contract: the
    // customer was never examined, so there is nothing to have failed.
    const technical = (sequence: number, processing_status: string): VerificationCheckRow => ({
      party_id: null, check_type: 'electronic_idv', status: 'pending',
      attempt_number: sequence, capture_sequence: sequence,
      attempt_consumed: false, processing_status,
    });
    const rows = [
      technical(1, 'technical_failure'),   // provider outage
      technical(2, 'technical_failure'),   // storage unreadable
      technical(3, 'technical_failure'),   // timeout
      technical(4, 'retry_scheduled'),     // duplicate worker delivery, requeued
      unusableCapture(5),
    ];
    const p = projectParty(me, rows, MAX, true);
    expect(p.attempts_used).toBe(0);
    expect(p.attempts_remaining).toBe(MAX);
    expect(p.can_attempt).toBe(true);
  });

  it('charges nothing for a simulated run', () => {
    // A simulator result is not an authoritative outcome and never sets
    // attempt_consumed, so it cannot spend a real customer's attempt.
    const simulated: VerificationCheckRow = {
      party_id: null, check_type: 'electronic_idv', status: 'referred',
      attempt_number: 1, capture_sequence: 1,
      attempt_consumed: false, processing_status: 'completed',
    };
    expect(projectParty(me, [simulated], MAX, true).attempts_used).toBe(0);
  });

  it('reports a verified party as done, with nothing further to do', () => {
    const p = projectParty(me, [settled(1, 'passed')], MAX, true);
    expect(p.status).toBe('verified');
    expect(p.can_attempt).toBe(false);
  });

  it('lets a staff document sighting settle a party who ran out of attempts', () => {
    const rows: VerificationCheckRow[] = [
      settled(1, 'failed'), settled(2, 'failed'), settled(3, 'failed'),
      { party_id: null, check_type: 'document_sighting', status: 'passed', attempt_number: 1 },
    ];
    const p = projectParty(me, rows, MAX, true);
    expect(p.status).toBe('verified');
    expect(p.retake_required).toBe(false);
  });

  it('keeps one party out of another party\'s accounting', () => {
    const other = 'a0000000-0000-4000-8000-000000000001';
    const rows: VerificationCheckRow[] = [
      settled(1, 'failed'),
      { ...settled(1, 'failed'), party_id: other },
      { ...settled(2, 'failed'), party_id: other },
    ];
    expect(projectParty(me, rows, MAX, true).attempts_used).toBe(1);
    expect(projectParty({ id: other, label: 'Partner' }, rows, MAX, true).attempts_used).toBe(2);
  });

  it('starts a party with no checks at not_started', () => {
    const p = projectParty(me, [], MAX, true);
    expect(p.status).toBe('not_started');
    expect(p.attempts_used).toBe(0);
    expect(p.can_attempt).toBe(true);
  });

  it('falls back to authoritative statuses before the canonical columns exist', () => {
    // Pre-migration rows carry no attempt_consumed. An outcome that left
    // `pending` is the only signal available, and it is the right one.
    const rows: VerificationCheckRow[] = [
      { party_id: null, check_type: 'electronic_idv', status: 'pending', attempt_number: 1 },
      { party_id: null, check_type: 'electronic_idv', status: 'failed', attempt_number: 2 },
    ];
    const p = projectParty(me, rows, MAX, false);
    expect(p.attempts_used).toBe(1);
    expect(p.can_attempt).toBe(true);
  });
});
