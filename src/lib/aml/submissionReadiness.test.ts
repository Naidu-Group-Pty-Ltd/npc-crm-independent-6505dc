import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  documentsJourneyStatus, stepHoldsSubmission, submissionBlockers,
} from '../../../supabase/functions/_shared/aml/portalJourney.pure.ts';
import {
  buildVendorData, parseVendorData, vendorDataMatches,
} from '../../../supabase/functions/_shared/aml/providers/didit.pure.ts';

/**
 * Submission readiness has ONE calculation, and a paid identity attempt is
 * never minted for a party who is already verified.
 *
 * ## The two production defects these lock out
 *
 * 1. A case with zero document requirements, zero documents and an unfinished
 *    identity check read "Documents — not started" on its progress card while
 *    the same page said "Everything we need from you has been received" over an
 *    enabled Submit button — and `submit_for_review` accepted it. Three
 *    submissions on one production case proved the backend agreed with the
 *    button, not the card. Readiness is now `submissionBlockers` in
 *    `portalJourney.pure.ts`, rendered by the journey and enforced by the op.
 *
 * 2. `prepare_verification_attempt` refused an exhausted party but not a
 *    VERIFIED one. A verified party has typically consumed one of three
 *    attempts, so nothing stopped a stale tab or a direct call from buying a
 *    fresh three-call Didit sequence for an identity already settled.
 *
 * Wiring is asserted from source, the same way `hostedIdvSession.test.ts`
 * does: whether the op consults the shared rule is a property of which code
 * exists, and a unit test around the pure function cannot see an op that
 * declines to call it.
 */

const root = resolve(__dirname, '../../..');
const PORTAL_FN = readFileSync(
  resolve(root, 'supabase/functions/aml-client-portal/index.ts'), 'utf8');

const opBlock = (op: string, nextOp: string | null) => {
  const start = PORTAL_FN.indexOf(`case '${op}'`);
  expect(start, `op ${op} exists`).toBeGreaterThan(-1);
  const end = nextOp ? PORTAL_FN.indexOf(`case '${nextOp}'`) : PORTAL_FN.length;
  expect(end, `op ${nextOp} exists`).toBeGreaterThan(start);
  return PORTAL_FN.slice(start, end);
};

describe('submit_for_review enforces the canonical readiness rule', () => {
  const block = () => opBlock('submit_for_review', null);

  it('consults submissionBlockers — the same rule the journey renders', () => {
    expect(block()).toContain('submissionBlockers({');
    expect(block()).toContain('submission_requirements_incomplete');
  });

  it('derives documents and verification from the shared journey functions', () => {
    // Not a re-implementation: the op calls the exact functions buildJourney
    // uses, so the banner, the cards, the button and the 400 cannot disagree.
    expect(block()).toContain('documentsJourneyStatus({');
    expect(block()).toContain('verificationJourneyStatus(await verificationParties(');
  });
});

describe('the canonical rule itself', () => {
  const ready = {
    consent: 'complete', questionnaire: 'complete',
    documents: 'complete', verification: 'complete',
  } as const;

  // The full documents pipeline, end to end: what `documentsJourneyStatus`
  // derives from requirement and document rows is exactly what
  // `stepHoldsSubmission` reads, so these run the pair together.
  const documentsHold = (args: Parameters<typeof documentsJourneyStatus>[0]) =>
    stepHoldsSubmission('documents', documentsJourneyStatus(args));

  it('A: no requirements and no uploads — optional documents never block', () => {
    // Requirements exist only when staff raise them (`seed_default_requirements`
    // / `upsert_requirement`, both write-role gated). Zero rows means nothing
    // was asked for; the step's own copy is "There is nothing we need from
    // you here right now", and it must not hold the pack.
    expect(documentsHold({ requirements: [], documents: [] })).toBe(false);
    expect(submissionBlockers({ ...ready, documents: 'not_started' })).toEqual([]);
  });

  it('B: an outstanding required document blocks', () => {
    expect(documentsHold({
      requirements: [{ id: 'r1', required: true, status: 'pending' }],
      documents: [],
    })).toBe(true);
    expect(submissionBlockers({ ...ready, documents: 'action_required' }))
      .toEqual(['documents']);
  });

  it('C: required documents met — submission allowed when all else is complete', () => {
    expect(documentsHold({
      requirements: [{ id: 'r1', required: true, status: 'accepted' }],
      documents: [],
    })).toBe(false);
    expect(submissionBlockers(ready)).toEqual([]);
  });

  it('D: a rejected required document blocks', () => {
    expect(documentsHold({
      requirements: [{ id: 'r1', required: true, status: 'uploaded' }],
      documents: [{ requirement_id: 'r1', status: 'rejected' }],
    })).toBe(true);
  });

  it('E: an identity check short of complete blocks, whatever the documents say', () => {
    for (const verification of ['not_started', 'in_progress', 'action_required', 'blocked'] as const) {
      for (const documents of ['complete', 'not_started'] as const) {
        expect(submissionBlockers({ ...ready, documents, verification }),
          `verification ${verification}, documents ${documents}`)
          .toEqual(['verification']);
      }
    }
  });

  it('F: verification complete and every actual requirement complete submits', () => {
    expect(submissionBlockers(ready)).toEqual([]);
    expect(submissionBlockers({ ...ready, documents: 'not_started' })).toEqual([]);
  });

  it('never treats an unknown documents state as optional', () => {
    // Only the two states the derivation can legitimately produce pass; any
    // future vocabulary fails closed.
    expect(stepHoldsSubmission('documents', 'in_progress')).toBe(true);
    expect(stepHoldsSubmission('documents', 'blocked')).toBe(true);
  });
});

describe('a verified party cannot buy another paid sequence', () => {
  it('prepare_verification_attempt refuses before any draft or upload grant exists', () => {
    const block = opBlock('prepare_verification_attempt', 'submit_verification_attempt');
    expect(block).toContain("code: 'already_verified'");
    expect(block).toContain("?.status === 'verified'");
    // The refusal reads the canonical projection, not a re-derived status.
    expect(block).toContain('verificationParties(admin, c.id)');
  });

  it('submit_verification_attempt re-checks before the draft can become queued', () => {
    const block = opBlock('submit_verification_attempt', 'request_verification_upload_url');
    expect(block).toContain("code: 'already_verified'");
    const guard = block.indexOf("code: 'already_verified'");
    const queue = block.indexOf("processing_status: 'queued'");
    expect(queue, 'queued transition exists').toBeGreaterThan(-1);
    expect(guard, 'guard sits before the queued transition').toBeLessThan(queue);
  });
});

describe('vendor_data identifies exactly one applicant attempt', () => {
  it('differs between cases, and between parties on one case', () => {
    const a = buildVendorData('case-a', null, 1);
    const b = buildVendorData('case-b', null, 1);
    const aParty = buildVendorData('case-a', 'party-2', 1);
    expect(a).not.toBe(b);
    expect(a).not.toBe(aParty);
    expect(new Set([a, b, aParty]).size).toBe(3);
  });

  it('is stable for retries of the same attempt and new for the next one', () => {
    // Deterministic from row state — never random, never regenerated per open.
    expect(buildVendorData('case-a', null, 2)).toBe(buildVendorData('case-a', null, 2));
    expect(buildVendorData('case-a', null, 2)).not.toBe(buildVendorData('case-a', null, 3));
  });

  it('carries no PII — internal identifiers only', () => {
    const parsed = parseVendorData(buildVendorData('case-a', 'party-2', 4));
    expect(parsed).toEqual({ caseId: 'case-a', partyId: 'party-2', attempt: 4 });
  });

  it("refuses to correlate another applicant's decision", () => {
    const minted = buildVendorData('case-a', 'party-2', 1);
    expect(vendorDataMatches(minted, 'case-a', 'party-2', 1)).toBe(true);
    expect(vendorDataMatches(minted, 'case-b', 'party-2', 1)).toBe(false);
    expect(vendorDataMatches(minted, 'case-a', null, 1)).toBe(false);
    expect(vendorDataMatches(minted, 'case-a', 'party-2', 2)).toBe(false);
    expect(vendorDataMatches('garbage', 'case-a', 'party-2', 1)).toBe(false);
    expect(vendorDataMatches(null, 'case-a', 'party-2', 1)).toBe(false);
  });
});
