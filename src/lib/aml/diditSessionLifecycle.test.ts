import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildVendorData,
  parseVendorData,
  vendorDataMatches,
  isStaleHostedSession,
  assertDecisionCorrelates,
  DiditCorrelationError,
} from '../../../supabase/functions/_shared/aml/providers/didit.pure.ts';

/**
 * Getting a customer a session created under the CURRENT configuration.
 *
 * ## What went wrong
 *
 * `POST /v3/session/` is not a create. Measured against the live API: two
 * calls with the same `workflow_id + vendor_data` returned byte-identical
 * `session_id` and token, left `session_number` unchanged, and merely
 * overwrote `metadata`. Changing one character of `vendor_data` returned a
 * genuinely new session.
 *
 * NPC's `vendor_data` was `npc:<case>:<party|primary>` — stable for the life
 * of the case. So when the verification workflow was reconfigured to allow
 * desktop capture, a customer who had pressed Start eight minutes earlier
 * could not get a session under the new configuration by any route: the portal
 * resumed their in-flight row, and even superseding it would have re-minted
 * the same session from the provider. Their session was valid for seven days.
 * They saw the cross-device QR screen the whole time.
 *
 * Two locks, both of which had to come off:
 *   1. NPC resumed the in-flight check without asking whether it was current.
 *   2. The provider deduplicated any replacement back onto the same session.
 *
 * ## What must stay true
 *
 * Superseding a stale session is a TECHNICAL event. It is not a verification
 * failure, it consumes no attempt, and it writes no identity outcome.
 *
 * ## The attempt scope was REVERSED, deliberately
 *
 * Attempt scoping broke the provider's dedup on purpose, and that had a cost
 * nobody had measured at the time: Didit groups sessions into a Directory user
 * by the exact `vendor_data` string, so a key carrying the attempt made one
 * applicant several users in the Business Console. Case `8c58cc07…` is in
 * production with two of them.
 *
 * The hosted key is therefore person-scoped again — `npc:<case>:<party>` — and
 * the dedup it restores is now load-bearing rather than merely tolerated: it is
 * the outermost guard against a refresh or a double-click buying a second paid
 * session. What that costs is stated where it is decided (`buildVendorData`):
 * the staleness guard below can release NPC's row but cannot re-mint under a
 * new configuration while the provider's session is alive.
 */

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const PARTY_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const WORKFLOW_ID = 'bb4349a9-8793-4e35-b0b8-ee559a19993a';

const REVISED_AT = Date.parse('2026-08-08T11:55:41.999Z');
/** The real live session: minted 8m48s before the workflow was corrected. */
const MINTED_BEFORE = '2026-08-08T11:46:53.797856Z';
const MINTED_AFTER = '2026-08-08T12:10:00.000Z';

describe('a session minted under superseded configuration is not reused', () => {
  it('recognises the exact production case', () => {
    expect(isStaleHostedSession(MINTED_BEFORE, REVISED_AT)).toBe(true);
  });

  it('leaves a session minted after the change alone', () => {
    expect(isStaleHostedSession(MINTED_AFTER, REVISED_AT)).toBe(false);
  });

  it('treats a session minted at the same instant as current', () => {
    // Strictly-before. A session created by the same operation that recorded
    // the revision is not stale, and re-minting it would be a free session
    // thrown away.
    expect(isStaleHostedSession(new Date(REVISED_AT).toISOString(), REVISED_AT)).toBe(false);
  });

  it('does nothing at all when no revision has been recorded', () => {
    // The guard must be inert until an operator records a change, or every
    // deployment would supersede every in-flight session.
    for (const at of [null, undefined as any, NaN]) {
      expect(isStaleHostedSession(MINTED_BEFORE, at)).toBe(false);
    }
  });

  it('fails safe on unusable inputs rather than superseding', () => {
    // Not knowing when a session was minted is not evidence that it is stale,
    // and throwing a customer out of a working verification is the worse
    // error.
    for (const minted of [null, undefined, '', 'not-a-date', 'yesterday']) {
      expect(isStaleHostedSession(minted as any, REVISED_AT), String(minted)).toBe(false);
    }
  });
});

describe('the hosted key identifies the PERSON, not the attempt', () => {
  it('is the three-part person-scoped form, carrying no attempt', () => {
    // What makes one applicant one Didit Directory user. A fourth segment
    // would split them into one user per attempt, which is the production
    // state this reversed.
    const key = buildVendorData(CASE_ID, PARTY_ID);
    expect(key).toBe(`npc:${CASE_ID}:${PARTY_ID}`);
    expect(parseVendorData(key)?.attempt).toBeNull();
  });

  it('is stable across attempts, so every session aggregates under one user', () => {
    expect(buildVendorData(CASE_ID, PARTY_ID)).toBe(buildVendorData(CASE_ID, PARTY_ID));
  });

  it('differs between parties and between cases', () => {
    const mine = buildVendorData(CASE_ID, PARTY_ID);
    expect(mine).not.toBe(buildVendorData(CASE_ID, 'someone-else'));
    expect(mine).not.toBe(buildVendorData('other-case', PARTY_ID));
    // The case subject is a distinct person from a declared related party.
    expect(mine).not.toBe(buildVendorData(CASE_ID, null));
  });

  it('is derived from server state, never from the browser', () => {
    const portal = readFileSync('supabase/functions/aml-client-portal/index.ts', 'utf8');
    const block = portal.slice(
      portal.indexOf("case 'start_hosted_verification'"),
      portal.indexOf("case 'submit_verification'"));
    expect(block).toContain('buildVendorData(c.id, partyId)');
    // `c.id` is the case resolved against this portal session, `partyId` is
    // matched against the case's own parties. Nothing from the request body
    // reaches the provider key.
    const vendorLine = block.slice(block.indexOf('vendorData:'), block.indexOf('metadata:'));
    expect(vendorLine).not.toContain('body.');
    // And the attempt must not creep back in: it is what fragments the user.
    expect(vendorLine).not.toContain('captureSequence');
  });
});

describe('webhook correlation still resolves case, party and attempt', () => {
  const correlation = {
    expectedWorkflowId: WORKFLOW_ID,
    expectedCaseId: CASE_ID,
    expectedPartyId: PARTY_ID,
    expectedSessionId: SESSION_ID,
    expectedAttempt: 2,
  };
  const decision = (over: Record<string, unknown> = {}) => ({
    session_id: SESSION_ID,
    workflow_id: WORKFLOW_ID,
    vendor_data: buildVendorData(CASE_ID, PARTY_ID, 2),
    status: 'Approved',
    ...over,
  });

  it('accepts the attempt it was minted for', () => {
    expect(() => assertDecisionCorrelates(decision(), correlation)).not.toThrow();
  });

  it('refuses a decision belonging to a different attempt of the same party', () => {
    // Without this, a decision from a superseded session could settle the
    // replacement attempt — the customer's outcome decided by a session they
    // abandoned.
    expect(() => assertDecisionCorrelates(
      decision({ vendor_data: buildVendorData(CASE_ID, PARTY_ID, 1) }), correlation))
      .toThrow(DiditCorrelationError);
  });

  it('still refuses another case or party', () => {
    for (const vendor of [buildVendorData('other-case', PARTY_ID, 2),
      buildVendorData(CASE_ID, 'someone-else', 2)]) {
      expect(() => assertDecisionCorrelates(decision({ vendor_data: vendor }), correlation))
        .toThrow(DiditCorrelationError);
    }
  });

  it('accepts a legacy session that predates attempt scoping', () => {
    // The live in-flight session carries the three-part form and can still
    // complete. Refusing it would strand a real customer's decision.
    expect(() => assertDecisionCorrelates(
      decision({ vendor_data: `npc:${CASE_ID}:${PARTY_ID}` }), correlation)).not.toThrow();
  });

  it('a row with no recorded attempt still correlates', () => {
    expect(vendorDataMatches(buildVendorData(CASE_ID, PARTY_ID, 5), CASE_ID, PARTY_ID, null))
      .toBe(true);
  });
});

describe('superseding a stale session costs the customer nothing', () => {
  const portal = readFileSync('supabase/functions/aml-client-portal/index.ts', 'utf8');
  const block = portal.slice(
    portal.indexOf("case 'start_hosted_verification'"),
    portal.indexOf("case 'submit_verification'"));
  const guard = block.slice(
    block.indexOf('isStaleHostedSession'), block.indexOf('try {', block.indexOf('isStaleHostedSession')));

  it('releases rather than settles — no identity outcome is written', () => {
    expect(guard).toContain("releaseHostedCheck(admin, String(existing.id), 'workflow_revised')");
    // A release must not reach the settling path, which is the only thing
    // that writes a status.
    expect(guard).not.toContain('applyDiditDecision');
    for (const outcome of ['verified', 'failed', 'passed', 'declined', 'referred']) {
      expect(guard).not.toContain(`'${outcome}'`);
    }
  });

  it('consumes no attempt', () => {
    expect(guard).toContain('attempt_consumed: false');
    // `releaseHostedCheck` itself only ever touches an unconsumed row.
    const release = portal.slice(
      portal.indexOf('async function releaseHostedCheck'),
      portal.indexOf('type IdvAvailability'));
    expect(release).toContain(".eq('attempt_consumed', false)");
    expect(release).not.toContain('attempt_consumed: true');
    // And it leaves `status` alone, so the party's state is unchanged.
    expect(release).not.toMatch(/\bstatus:/);
  });

  it('is recorded as a technical event, not a customer failure', () => {
    expect(guard).toContain("category: 'technical'");
    expect(guard).toContain("reason: 'workflow_revised'");
    expect(guard).toContain("scope: 'identity_verification_only'");
  });

  it('runs before the resume path, so a stale session is never returned', () => {
    // Ordering is the guarantee. If the resume block ran first it would
    // return the stale URL and the guard would never be reached.
    const guardAt = block.indexOf('isStaleHostedSession');
    const resumeAt = block.indexOf('resumed: true');
    expect(guardAt).toBeGreaterThan(-1);
    expect(resumeAt).toBeGreaterThan(guardAt);
  });
});

describe('no session credential is stored or logged', () => {
  const portal = readFileSync('supabase/functions/aml-client-portal/index.ts', 'utf8');
  const block = portal.slice(
    portal.indexOf("case 'start_hosted_verification'"),
    portal.indexOf("case 'submit_verification'"));

  it('persists identifiers only — never the URL or the token', () => {
    const from = block.indexOf('didit_session: {');
    const persisted = block.slice(from, block.indexOf('},', from));
    for (const key of ['session_id', 'workflow_id', 'workflow_version', 'attempt']) {
      expect(persisted).toContain(key);
    }
    // The URL embeds the session token, so storing it would put a live
    // credential in the case record. Code only — the comment saying so
    // necessarily names both.
    const code = persisted.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const credential of ['url', 'token', 'session_url', 'verification_url']) {
      expect(code).not.toContain(credential);
    }
  });

  it('the URL is returned to the browser and written nowhere', () => {
    // It appears exactly twice: the resumed response and the fresh one.
    const returned = [...block.matchAll(/verification_url:/g)];
    expect(returned).toHaveLength(2);
    // No update/insert anywhere in the block carries it.
    for (const m of block.matchAll(/\.(update|insert)\(\{([\s\S]*?)\}\)/g)) {
      expect(m[2]).not.toContain('verification_url');
      expect(m[2]).not.toContain('session.url');
    }
  });

  it('nothing logs a session URL or token', () => {
    for (const m of block.matchAll(/console\.(log|error|warn|info)\(([^\n]*)/g)) {
      expect(m[2]).not.toContain('url');
      expect(m[2]).not.toContain('token');
      expect(m[2]).not.toContain('session.');
    }
  });
});
