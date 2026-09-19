import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildVendorData, parseVendorData, vendorDataMatches,
} from '../../../supabase/functions/_shared/aml/providers/didit.pure.ts';
import {
  submissionBlockers,
} from '../../../supabase/functions/_shared/aml/portalJourney.pure.ts';

/**
 * The provider-hosted verification session, and the four properties it has to
 * hold at once.
 *
 * ## Why this file replaced `hostedIdvRetired.test.ts`
 *
 * That suite asserted the ABSENCE of this flow — 68 guards written when the
 * product decision was that no customer is sent to a verification vendor's
 * page. The component exists again, so those guards could not stay.
 *
 * **The product decision itself stands**: no tenant resolves the hosted
 * provider, and customers still use NPC's own camera. The provider-side record
 * the business wanted turned out to be a flag on the Standalone calls —
 * `save_api_request=true`, which persists each request under Manual Checks —
 * not a different customer journey. What follows therefore describes a flow
 * that is complete and correct but deliberately not active.
 *
 * What was worth keeping from it is kept, and is asserted here or in
 * `identityDocumentSession.test.ts`: no iframe, no credential in the browser,
 * no path from a browser event to a verification outcome, and a return page
 * that claims receipt rather than a verdict.
 *
 * ## The four properties
 *
 *  1. **One applicant is one Didit user.** `vendor_data` is person-scoped, so
 *     every session an applicant runs aggregates under one Directory user.
 *  2. **A repeat request never buys a second session.** Three independent
 *     guards, listed under "duplicate-charge protection" below.
 *  3. **A decision reaches exactly one applicant.** Correlation is checked
 *     before anything is written, and a mismatch is an integration fault rather
 *     than a customer outcome.
 *  4. **Session created ≠ identity verified.** Nothing in the browser, and
 *     nothing about creating a session, can move a verification.
 */

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Source with comments removed — prose describing a rule must not satisfy it. */
const code = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

const PORTAL_FN = read('supabase/functions/aml-client-portal/index.ts');
const WEBHOOK = read('supabase/functions/didit-webhook/index.ts');
const STEP = read('src/components/portal/IdentityVerificationStep.tsx');
const OUTCOME = read('supabase/functions/_shared/aml/diditOutcome.ts');

/** The `start_hosted_verification` operation, comments intact. */
const START_BLOCK = PORTAL_FN.slice(
  PORTAL_FN.indexOf("case 'start_hosted_verification'"),
  PORTAL_FN.indexOf("case 'submit_verification'"));

const CASE_A = '11111111-1111-4111-8111-111111111111';
const CASE_B = '22222222-2222-4222-8222-222222222222';
const PARTY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_A = '33333333-3333-4333-8333-333333333333';
const WORKFLOW = '75ad112b-27a4-48b1-b040-664305064d11';

/* ── 1 & 2. distinct, stable, person-scoped identifiers ──────────────────── */

describe('User A and User B get distinct, stable identifiers', () => {
  it('A and B never share a vendor_data', () => {
    expect(buildVendorData(CASE_A, null)).not.toBe(buildVendorData(CASE_B, null));
    expect(buildVendorData(CASE_A, PARTY_A)).not.toBe(buildVendorData(CASE_A, null));
  });

  it('one applicant is ONE Didit user — the key carries no attempt', () => {
    // Didit groups sessions into a Directory user by this exact string. A
    // fourth segment split one production applicant into two users.
    const key = buildVendorData(CASE_A, PARTY_A);
    expect(key.split(':')).toHaveLength(3);
    expect(parseVendorData(key)?.attempt).toBeNull();
  });

  it('is the same key on every retry, so sessions aggregate rather than fork', () => {
    expect(buildVendorData(CASE_A, PARTY_A)).toBe(buildVendorData(CASE_A, PARTY_A));
  });

  it('is derived from server state and can never be chosen by the browser', () => {
    expect(code(START_BLOCK)).toContain('buildVendorData(c.id, partyId)');
    const vendorLine = START_BLOCK.slice(
      START_BLOCK.indexOf('vendorData:'), START_BLOCK.indexOf('metadata:'));
    expect(vendorLine).not.toContain('body.');
  });
});

/* ── 3 & 4. a refresh or a double-click buys nothing ─────────────────────── */

describe('duplicate-charge protection', () => {
  it('resumes an in-flight session instead of minting a second one', () => {
    // `activeHostedCheck` finds the party's open session; the customer is
    // returned to it and the URL is re-read from the provider.
    expect(code(START_BLOCK)).toContain('activeHostedCheck(admin, c.id, partyId)');
    expect(START_BLOCK).toContain('resumed: true');
  });

  it('answers a lost insert race with the session that already exists', () => {
    // The partial unique index `uq_aml_verification_active_hosted_session`
    // decides the race in Postgres rather than by check-then-insert, because
    // every lost race is a real session NPC pays for.
    expect(code(START_BLOCK)).toContain("insErr.code === '23505'");
    expect(START_BLOCK).toContain("code: 'already_processing'");
    // A second session is never created on that branch.
    const raced = START_BLOCK.slice(
      START_BLOCK.indexOf("insErr.code === '23505'"),
      START_BLOCK.indexOf("insErr.code === '23514'"));
    expect(raced).not.toContain('createSession');
  });

  it('relies on the provider upsert as the outermost guard', () => {
    // Measured 2026-08-14: two creates with one `workflow_id + vendor_data`
    // returned byte-identical session_id, token, url and session_number. A
    // person-scoped key therefore cannot buy a second unstarted session even
    // if both NPC guards were bypassed.
    expect(buildVendorData(CASE_A, PARTY_A)).toBe(buildVendorData(CASE_A, PARTY_A));
  });

  it('opens the window before the request, so a double-click cannot stack two', () => {
    // One NAMED window: a second open with the same name reuses it.
    expect(code(STEP)).toContain("const HOSTED_WINDOW_NAME = 'npc-identity-verification'");
    expect(code(STEP)).toContain('window.open(');
  });
});

/* ── 5. an already-verified applicant cannot create another ──────────────── */

describe('a verified applicant cannot create another session', () => {
  it('refuses before the row is inserted and before any provider call', () => {
    const guard = START_BLOCK.indexOf("code: 'already_verified'");
    expect(guard, 'the guard exists').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(START_BLOCK.indexOf('createSession'));
    expect(guard).toBeLessThan(START_BLOCK.indexOf("from('verification_checks').insert"));
  });

  it('reads the canonical projection rather than re-deriving "verified"', () => {
    expect(code(START_BLOCK)).toContain('verificationParties(admin, c.id)');
    expect(code(START_BLOCK)).toContain("?.status === 'verified'");
  });

  it('is enforced on the capture path too, so neither flow can be the way in', () => {
    for (const op of ['prepare_verification_attempt', 'submit_verification_attempt']) {
      const block = PORTAL_FN.slice(
        PORTAL_FN.indexOf(`case '${op}'`),
        PORTAL_FN.indexOf(`case '${op}'`) + 6000);
      expect(block, op).toContain("code: 'already_verified'");
    }
  });
});

/* ── 6 & 8. a decision reaches exactly one applicant ─────────────────────── */

describe('a webhook for A cannot update B', () => {
  const correlation = {
    expectedWorkflowId: WORKFLOW,
    expectedCaseId: CASE_A,
    expectedPartyId: PARTY_A,
    expectedSessionId: SESSION_A,
    expectedAttempt: null,
  };

  it('accepts the applicant it was minted for', () => {
    expect(vendorDataMatches(
      buildVendorData(CASE_A, PARTY_A), CASE_A, PARTY_A, null)).toBe(true);
  });

  it("refuses another applicant's key on this row", () => {
    for (const foreign of [
      buildVendorData(CASE_B, PARTY_A),
      buildVendorData(CASE_A, null),
      buildVendorData(CASE_B, null),
    ]) {
      expect(vendorDataMatches(foreign, CASE_A, PARTY_A, null), foreign).toBe(false);
    }
  });

  it('refuses a malformed or absent key rather than defaulting to a match', () => {
    for (const bad of [null, undefined, '', 'npc', 'npc:only-a-case', 'garbage', 42]) {
      expect(vendorDataMatches(bad, CASE_A, PARTY_A, null), String(bad)).toBe(false);
    }
  });

  it('correlates on workflow, case, party AND session before writing anything', () => {
    // `assertDecisionCorrelates` runs first in `applyDiditDecision`, and it
    // throws — the caller records an integration fault and no customer outcome.
    const apply = OUTCOME.slice(
      OUTCOME.indexOf('export async function applyDiditDecision'),
      OUTCOME.indexOf('const mapped = mapDiditDecision'));
    expect(apply).toContain('assertDecisionCorrelates(');
    expect(apply).toContain('expectedCaseId: check.case_id');
    expect(apply).toContain('expectedPartyId: check.party_id');
    expect(apply).toContain('expectedSessionId: String(check.provider_reference');
    expect(correlation.expectedSessionId).toBe(SESSION_A);
  });

  it('finds the row by the session NPC itself stored, never from the body', () => {
    const lookup = WEBHOOK.slice(
      WEBHOOK.indexOf('const { data: checkRows }'),
      WEBHOOK.indexOf('if (!check)'));
    expect(lookup).toContain("eq('provider_reference', sessionId)");
    // Nothing in the payload names a case or a party.
    expect(code(WEBHOOK)).not.toMatch(/payload\[['"]case_id['"]\]/);
    expect(code(WEBHOOK)).not.toMatch(/payload\[['"]party_id['"]\]/);
  });

  it('chooses the LIVE row deterministically when a session id repeats', () => {
    /*
     * Person-scoped `vendor_data` makes this reachable: a released row and the
     * live row that replaced it can both carry one session id. `maybeSingle()`
     * fails outright on a second row, which would turn a real outcome into a
     * 500 and then, once Didit stopped retrying, into no outcome at all.
     */
    const lookup = WEBHOOK.slice(
      WEBHOOK.indexOf('const { data: checkRows }'),
      WEBHOOK.indexOf('if (!check)'));
    expect(lookup).not.toContain('maybeSingle()');
    expect(lookup).toContain("order('superseded_at'");
    expect(lookup).toContain('nullsFirst: true');
    expect(lookup).toContain('limit(1)');
  });
});

/* ── 7. duplicate delivery is idempotent ─────────────────────────────────── */

describe('a duplicate webhook is idempotent', () => {
  it('de-duplicates on the provider event id', () => {
    expect(code(WEBHOOK)).toContain("eq('dedup_key', eventId)");
    expect(code(WEBHOOK)).toContain('replay: true');
  });

  it('records the event BEFORE processing, so a crash re-processes', () => {
    const insert = WEBHOOK.indexOf("from('provider_events').insert");
    const processed = WEBHOOK.indexOf('processed_at: new Date().toISOString()');
    expect(insert).toBeGreaterThan(-1);
    expect(insert).toBeLessThan(processed);
  });

  it('settles on a CONDITIONAL update, which is the real guarantee', () => {
    // De-dup can be raced and a crash can land between the insert and the
    // update. Settling is filtered on the row still being unsettled, so an
    // attempt cannot be consumed twice however many times the handler runs.
    expect(OUTCOME).toContain("eq('attempt_consumed', false)");
    expect(OUTCOME).toContain('already_applied');
  });
});

/* ── 4 (property). created is not verified ───────────────────────────────── */

describe('creating a session is not a verification', () => {
  it('writes no identity status when the session is created', () => {
    const created = START_BLOCK.slice(
      START_BLOCK.indexOf('const session = await provider.createSession'),
      START_BLOCK.indexOf('return jsonResponse({\n            started: true'));
    expect(created).toContain("processing_status: 'processing'");
    // `status` and `attempt_consumed` are untouched by session creation.
    expect(created).not.toMatch(/\bstatus:\s*'(passed|verified|failed)'/);
    expect(created).not.toMatch(/attempt_consumed:\s*true/);
  });

  it('never persists the session URL — it embeds a live credential', () => {
    expect(PORTAL_FN).toMatch(/verification_url: session\.url/);
    expect(PORTAL_FN).not.toMatch(/session_url:\s*session\.url/);
    // Comment-stripped: this block explains at length what it does NOT store,
    // and prose naming a credential must not be able to fail the assertion
    // that no credential is stored.
    const persisted = code(START_BLOCK.slice(
      START_BLOCK.indexOf('didit_session: {'),
      START_BLOCK.indexOf('updated_at: new Date().toISOString(),\n          }).eq(')));
    expect(persisted).toContain('session_id:');
    expect(persisted).toContain('vendor_data:');
    expect(persisted).toContain('workflow_id:');
    expect(persisted).toContain('status:');
    expect(persisted).not.toContain('url:');
    expect(persisted).not.toContain('token');
  });

  it('keeps the credential out of the browser bundle entirely', () => {
    for (const file of [
      'src/components/portal/IdentityVerificationStep.tsx',
      'src/lib/aml/amlPortalApi.ts',
    ]) {
      const source = read(file);
      expect(source, file).not.toContain('DIDIT_API_KEY');
      expect(source, file).not.toContain('x-api-key');
      expect(source, file).not.toMatch(/verification\.didit\.me/);
    }
  });

  it('holds the session URL in memory only, never in storage or a log', () => {
    expect(STEP).not.toMatch(/(localStorage|sessionStorage)\.setItem[^\n]*url/i);
    expect(STEP).not.toMatch(/console\.(log|info|warn|error)\([^)]*url/i);
    expect(STEP).not.toMatch(/toast\.[a-z]+\([^)]*verification_url/);
  });
});

/* ── 9. the readiness fixes are untouched ────────────────────────────────── */

describe('the submission-readiness fixes still hold', () => {
  it('identity verification still gates submission', () => {
    const ready = {
      consent: 'complete', questionnaire: 'complete',
      documents: 'complete', verification: 'complete',
    } as const;
    expect(submissionBlockers({ ...ready, verification: 'in_progress' }))
      .toEqual(['verification']);
    expect(submissionBlockers(ready)).toEqual([]);
  });

  it('optional untouched documents still do not block', () => {
    expect(submissionBlockers({
      consent: 'complete', questionnaire: 'complete',
      documents: 'not_started', verification: 'complete',
    })).toEqual([]);
  });

  it('the backend still enforces the same rule it renders', () => {
    const submit = PORTAL_FN.slice(PORTAL_FN.indexOf("case 'submit_for_review'"));
    expect(submit).toContain('submissionBlockers({');
    expect(submit).toContain('submission_requirements_incomplete');
  });
});
