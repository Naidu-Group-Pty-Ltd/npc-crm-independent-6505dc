import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  verifyDiditWebhook, computeDiditSignature, timingSafeEqualHex,
  DIDIT_WEBHOOK_MAX_SKEW_SECONDS,
} from '../../../supabase/functions/_shared/aml/providers/diditWebhook.pure.ts';

/**
 * `didit-webhook` runs without a JWT, so the HMAC is the entire authentication
 * boundary. These tests are the reason that is acceptable.
 */

const SECRET = 'test-webhook-secret-not-a-real-one';
const NOW = 1_800_000_000;
const BODY = JSON.stringify({
  event_id: 'e1', webhook_type: 'status.updated',
  session_id: 's1', status: 'Approved',
});

async function signed(over: Partial<Parameters<typeof verifyDiditWebhook>[0]> = {}) {
  return verifyDiditWebhook({
    rawBody: BODY,
    signatureHeader: await computeDiditSignature(BODY, SECRET),
    timestampHeader: String(NOW),
    secret: SECRET,
    nowSeconds: NOW,
    ...over,
  });
}

describe('webhook signature verification', () => {
  it('accepts a correctly signed, fresh delivery', async () => {
    expect(await signed()).toEqual({ ok: true, rejection: null });
  });

  it('rejects an invalid signature', async () => {
    const r = await signed({ signatureHeader: 'a'.repeat(64) });
    expect(r.ok).toBe(false);
    expect(r.rejection).toBe('invalid_signature');
  });

  it('rejects an absent signature — unsigned is never accepted in the clear', async () => {
    expect((await signed({ signatureHeader: null })).rejection).toBe('missing_signature');
  });

  it('rejects a body tampered with after signing', async () => {
    const tampered = JSON.stringify({
      event_id: 'e1', webhook_type: 'status.updated',
      session_id: 's1', status: 'Approved', injected: true,
    });
    const r = await verifyDiditWebhook({
      rawBody: tampered,
      signatureHeader: await computeDiditSignature(BODY, SECRET),
      timestampHeader: String(NOW), secret: SECRET, nowSeconds: NOW,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a signature made with a different secret', async () => {
    const r = await verifyDiditWebhook({
      rawBody: BODY,
      signatureHeader: await computeDiditSignature(BODY, 'someone-elses-secret'),
      timestampHeader: String(NOW), secret: SECRET, nowSeconds: NOW,
    });
    expect(r.ok).toBe(false);
  });

  it('fails CLOSED when no secret is configured', async () => {
    // The dangerous alternative is accepting unsigned bodies whenever the
    // secret is missing, which turns a deployment mistake into an open door.
    const r = await signed({ secret: null });
    expect(r.ok).toBe(false);
    expect(r.rejection).toBe('not_configured');
  });
});

describe('replay protection', () => {
  it('rejects a stale timestamp beyond the 300s window', async () => {
    const r = await signed({ timestampHeader: String(NOW - DIDIT_WEBHOOK_MAX_SKEW_SECONDS - 1) });
    expect(r.rejection).toBe('stale_timestamp');
  });

  it('rejects a timestamp far in the FUTURE too', async () => {
    // Accepting these would let a captured delivery be replayed indefinitely.
    const r = await signed({ timestampHeader: String(NOW + DIDIT_WEBHOOK_MAX_SKEW_SECONDS + 1) });
    expect(r.rejection).toBe('stale_timestamp');
  });

  it('accepts the edges of the window', async () => {
    expect((await signed({ timestampHeader: String(NOW - DIDIT_WEBHOOK_MAX_SKEW_SECONDS) })).ok)
      .toBe(true);
    expect((await signed({ timestampHeader: String(NOW + DIDIT_WEBHOOK_MAX_SKEW_SECONDS) })).ok)
      .toBe(true);
  });

  it('rejects a missing or unparseable timestamp', async () => {
    expect((await signed({ timestampHeader: null })).rejection).toBe('missing_timestamp');
    expect((await signed({ timestampHeader: 'not-a-number' })).rejection).toBe('missing_timestamp');
  });

  it('checks freshness BEFORE spending an HMAC on replayed traffic', async () => {
    const r = await signed({
      timestampHeader: String(NOW - 10_000), signatureHeader: 'garbage',
    });
    expect(r.rejection).toBe('stale_timestamp');
  });
});

describe('constant-time comparison', () => {
  it('compares equal and unequal values correctly', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
  });

  it('has no early exit on the first differing character', () => {
    // A `===` implementation would short-circuit here; the loop must not.
    const src = readFileSync(join(process.cwd(),
      'supabase/functions/_shared/aml/providers/diditWebhook.pure.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function timingSafeEqualHex'));
    const loop = body.slice(body.indexOf('for ('), body.indexOf('return diff === 0'));
    expect(loop).toContain('diff |=');
    expect(loop).not.toContain('return');
    expect(loop).not.toContain('break');
  });
});

/* ───────────────────── receiver + integration contracts ──────────────────── */

const repo = process.cwd();
const read = (p: string) => readFileSync(join(repo, p), 'utf8');

/**
 * Source with comments removed.
 *
 * These files explain themselves at length, and several of the prohibitions
 * below name the very thing they forbid ("the session token is NOT stored").
 * Asserting against prose would fail on the explanation rather than on the
 * behaviour, so the checks that must see only executable code use this.
 */
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const receiver = read('supabase/functions/didit-webhook/index.ts');
const outcome = read('supabase/functions/_shared/aml/diditOutcome.ts');
const portal = read('supabase/functions/aml-client-portal/index.ts');
const consumer = read('supabase/functions/cross-portal-outbox-worker/verificationConsumer.ts');
const registry = read('supabase/functions/_shared/aml/providers/index.ts');
const migration = read('supabase/migrations/20260908000000_aml_didit_hosted_idv.sql');

/** The handler body only — the import block names the same symbols. */
const handler = receiver.slice(receiver.indexOf('Deno.serve('));

describe('webhook receiver contract', () => {
  it('verifies the signature BEFORE creating a service-role client', () => {
    const verifyAt = handler.indexOf('await verifyDiditWebhook(');
    const clientAt = handler.indexOf('createClient(');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(clientAt).toBeGreaterThan(verifyAt);
  });

  it('reads the raw body as text and does not parse before verifying', () => {
    const rawAt = handler.indexOf('req.text()');
    const verifyAt = handler.indexOf('await verifyDiditWebhook(');
    const parseAt = handler.indexOf('JSON.parse(rawBody)');
    expect(rawAt).toBeGreaterThan(-1);
    expect(rawAt).toBeLessThan(verifyAt);
    expect(verifyAt).toBeLessThan(parseAt);
  });

  it('rejects a failed verification before any database access', () => {
    const rejectAt = handler.indexOf('reason: verification.rejection');
    const clientAt = handler.indexOf('createClient(');
    expect(rejectAt).toBeGreaterThan(-1);
    expect(rejectAt).toBeLessThan(clientAt);
  });

  it('de-duplicates on Didit\'s own event_id', () => {
    expect(receiver).toContain("payload['event_id']");
    expect(receiver).toMatch(/dedup_key/);
    expect(receiver).toMatch(/\.eq\('provider', 'didit'\)/);
  });

  it('re-processes an event recorded but never applied (crash safety)', () => {
    // Short-circuiting on the mere EXISTENCE of the event row would lose the
    // outcome permanently when a delivery crashes between insert and apply.
    expect(receiver).toContain('existing?.processed_at');
  });

  it('never trusts the webhook body as the decision', () => {
    expect(receiver).toContain('fetchDiditDecision');
    // The body's own `decision` object is not read anywhere.
    expect(receiver).not.toMatch(/payload\[['"]decision['"]\]/);
  });

  it('correlates by the session id NPC stored, never a body-supplied case id', () => {
    expect(receiver).toMatch(/\.eq\('provider_reference', sessionId\)/);
    expect(receiver).not.toMatch(/payload\[['"]case_id['"]\]/);
  });

  it('refuses a sandbox event in production', () => {
    expect(receiver).toContain('sandbox_event_in_production');
  });

  it('does not persist the decision payload or the session URL', () => {
    expect(receiver).not.toMatch(/payload:\s*payload\b/);
    expect(receiver).not.toContain('session_url');
  });

  it('treats a decision-retrieval failure as technical, never a customer failure', () => {
    const fetchAt = handler.indexOf('await fetchDiditDecision(');
    const block = handler.slice(fetchAt, handler.indexOf('await applyDiditDecision(', fetchAt));
    expect(block).toContain('provider_error_category');
    // No identity status is written and no attempt is consumed there.
    expect(block).not.toMatch(/\bstatus:\s*['"](failed|passed|exhausted)['"]/);
    expect(block).not.toMatch(/attempt_consumed:\s*true/);
    expect(block).toContain(".eq('attempt_consumed', false)");
  });

  it('is registered as a JWT-less webhook in config and the security registry', () => {
    const config = read('supabase/config.toml');
    expect(config).toMatch(/\[functions\.didit-webhook\]\s*\nverify_jwt = false/);
    const reg = JSON.parse(read('supabase/functions-registry/SECURITY_REGISTRY.json'));
    expect(reg.functions['didit-webhook']).toMatchObject({
      verify_jwt: false, exposure_class: 'webhook-secret', reviewed: true,
    });
  });
});

describe('exactly-once attempt consumption', () => {
  it('settles with an UPDATE conditional on the row being unsettled', () => {
    // This, not de-duplication, is what makes a duplicate/concurrent delivery
    // safe. De-dup can be raced; a conditional update cannot.
    const settle = outcome.slice(outcome.indexOf('THE idempotency guard'));
    expect(settle).toContain(".eq('attempt_consumed', false)");
    expect(settle).toContain(".in('processing_status', UNSETTLED_PROCESSING)");
  });

  it('reports already_applied rather than writing twice', () => {
    expect(outcome).toContain('already_applied');
    expect(outcome).toMatch(/settled\s*\?\?\s*\[\]\)\.length === 0/);
  });

  it('appends the timeline entry only for the writer that won', () => {
    const settleAt = outcome.indexOf('THE idempotency guard');
    const guardAt = outcome.indexOf('(settled ?? []).length === 0', settleAt);
    const eventAt = outcome.indexOf('appendDiditCaseEvent', guardAt);
    expect(guardAt).toBeGreaterThan(settleAt);
    expect(eventAt).toBeGreaterThan(guardAt);
  });

  it('releases an abandoned session without touching identity state', () => {
    const release = outcome.slice(
      outcome.indexOf('Closed without a decision'), outcome.indexOf('Authoritative identity outcome'));
    expect(release).toContain("processing_status: 'cancelled'");
    expect(release).not.toMatch(/\bstatus:\s*['"]failed['"]/);
    expect(release).not.toMatch(/attempt_consumed:\s*true/);
  });

  it('reuses the shared canonicalOutcome rather than its own attempt rules', () => {
    expect(outcome).toContain('canonicalOutcome');
    expect(outcome).toContain('verificationOutcome.pure.ts');
  });
});

describe('self-hosted path is not broken', () => {
  it('the outbox worker still downloads captures and calls runIdv for selfhosted', () => {
    expect(consumer).toContain("db.storage.from('aml-documents').download");
    expect(consumer).toContain('provider.runIdv');
    expect(consumer).toContain('canonicalOutcome');
  });

  it('the worker refuses hosted checks before claiming them', () => {
    const guardAt = consumer.indexOf("idvFlowFor(check.provider) === 'hosted_session'");
    const claimAt = consumer.indexOf("processing_status: 'processing'");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(claimAt);
  });

  it('the worker also refuses a check with no NPC-held document', () => {
    expect(consumer).toContain('if (!check.document_reference) return;');
  });

  it('the trigger stops emitting for checks with no NPC-held document', () => {
    expect(migration).toContain('NEW.document_reference IS NOT NULL');
  });

  it('the selfhosted adapter and its configuration are untouched', () => {
    expect(registry).toContain('makeSelfHostedIdvProvider');
    expect(registry).toContain('AML_VERIFICATION_SERVICE_URL');
    expect(registry).toContain('"selfhosted": () => makeSelfHostedIdvProvider()');
  });

  it('getIdvProvider refuses to hand a hosted provider to a capture caller', () => {
    expect(registry).toContain('has no capture-mode');
  });
});

describe('provider selection stays server-side', () => {
  it('the portal never reads a provider from the request body', () => {
    expect(portal).not.toMatch(/body\.provider/);
    expect(portal).not.toMatch(/body\[['"]provider['"]\]/);
  });

  it('the portal resolves the flow from tenant configuration', () => {
    expect(portal).toContain('resolveTenantProvider');
    expect(portal).toContain('idvFlowFor');
  });

  it('the browser is told only capture|hosted, never the provider key', () => {
    // Two experience words and nothing else. Which one is server-resolved from
    // the tenant's active provider; the browser cannot ask for the other.
    expect(portal).toContain("provider_flow: flow === 'hosted_session' ? 'hosted' : 'capture'");
    const statusBlock = portal.slice(
      portal.indexOf("case 'verification_status'"), portal.indexOf("case 'start_hosted_verification'"));
    expect(statusBlock).not.toContain('didit');
    expect(statusBlock).not.toContain('workflow_id');
    expect(statusBlock).not.toMatch(/DIDIT_/);
  });

  it('readiness treats a missing webhook secret as not configured', () => {
    // Creating sessions NPC could never receive results for would charge for
    // verifications that strand every customer mid-flow.
    expect(registry).toContain('DIDIT_WEBHOOK_SECRET');
    const fn = registry.slice(registry.indexOf('function diditIdvConfigured'));
    expect(fn.slice(0, 400)).toContain('DIDIT_WEBHOOK_SECRET');
  });
});

describe('session creation gates', () => {
  const block = portal.slice(
    portal.indexOf("case 'start_hosted_verification'"), portal.indexOf("case 'submit_verification'"));

  it('requires the consent catalogue and the separate biometric consent', () => {
    expect(block).toContain('consentRequiredResponse');
    expect(block).toContain('biometric_consent_required');
  });

  it('enforces the existing attempt ceiling before creating a session', () => {
    expect(block).toContain('verificationAttemptsUsed');
    expect(block).toContain('MAX_VERIFICATION_ATTEMPTS');
    expect(block).toContain('attempts_exhausted');
  });

  it('reuses an in-flight session instead of creating a second chargeable one', () => {
    expect(block).toContain('activeHostedCheck');
    expect(block).toContain('resumed: true');
  });

  it('uses an opaque vendor_data and internal-only metadata', () => {
    // Person-scoped: internal identifiers only, and no attempt suffix — the
    // key is what Didit groups an applicant's sessions by.
    expect(block).toContain('buildVendorData(c.id, partyId)');
    expect(block).toContain('verification_check_id: created.id');
    // No customer identifiers travel to the provider as correlation data.
    const meta = block.slice(block.indexOf('metadata: {'), block.indexOf('});', block.indexOf('metadata: {')));
    for (const pii of ['email', 'full_name', 'party_label', 'date_of_birth', 'subject_display_name']) {
      expect(meta).not.toContain(pii);
    }
  });

  it('never stores the hosted URL or a session token', () => {
    const code = codeOnly(block);
    expect(code).toContain('session_id: session.sessionId');
    // What is persisted about the session, as code rather than as prose.
    const from = code.indexOf('didit_session: {');
    const persisted = code.slice(from, code.indexOf('updated_at', from));
    expect(persisted).not.toContain('session.url');
    expect(persisted).not.toContain('token');
    // The URL appears exactly once in the whole op: in the response to the
    // customer's own browser.
    expect([...code.matchAll(/session\.url/g)]).toHaveLength(1);
    expect(code).toContain('verification_url: session.url');
  });

  it('consumes no attempt when session creation fails', () => {
    const fail = block.slice(block.indexOf('Session creation failed'));
    expect(fail).toContain("processing_status: 'cancelled'");
    expect(fail).toContain(".eq('attempt_consumed', false)");
    expect(fail).not.toMatch(/status:\s*['"]failed['"]/);
    expect(fail).toContain('nothing has been used up');
  });

  it('refuses NPC-side capture while a hosted provider is active', () => {
    expect(portal).toContain('hosted_verification_required');
    const upload = portal.slice(portal.indexOf("case 'request_verification_upload_url'"));
    expect(upload.slice(0, 2000)).toContain('hosted_verification_required');
  });
});

describe('customer-facing errors stay simple', () => {
  const block = portal.slice(
    portal.indexOf("case 'start_hosted_verification'"), portal.indexOf("case 'submit_verification'"));

  it('never leaks provider internals to the client', () => {
    const responses = [...block.matchAll(/error:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(responses.length).toBeGreaterThan(0);
    for (const msg of responses) {
      expect(msg).not.toMatch(/didit|workflow|api[_ ]key|http|\d{3}\s|secret/i);
    }
  });
});

/* ────────── a persisted STANDALONE session must never settle anything ────── */

/**
 * `save_api_request=true` persists each Standalone call as an API-type session,
 * and Didit emits `status.updated` for those too — so this endpoint now
 * receives events for checks it must not touch.
 *
 * The Standalone architecture has exactly ONE authoritative result: the
 * synchronous response the call itself returned, composed by
 * `standaloneVerification.ts`. A webhook settling those rows would be a second
 * authoritative path racing the first, able to overwrite an attempt that has
 * already been decided. There is deliberately no branch that could.
 */
describe('a persisted standalone session is acknowledged and ignored', () => {
  const block = receiver.slice(
    receiver.indexOf('if (!check) {'),
    receiver.indexOf('await markEvent({ verification_check_id: check.id })'));

  it('is recognised rather than reported as an alarming unknown session', () => {
    expect(block).toContain("reason: 'standalone_session_ignored'");
    expect(block).toContain('classifyStandaloneEvent(admin, {');
  });

  it('correlates on the metadata NPC supplied, not on provider_reference', () => {
    /*
     * `provider_reference` holds ONLY the ID request id, and only from
     * settlement onwards — so it cannot see a Face Match event at all, and an
     * ID event can beat the write. `metadata.npc_verification_check_id` is set
     * on the first call and echoed back inside an already-verified body.
     */
    const fn = receiver.slice(
      receiver.indexOf('async function classifyStandaloneEvent('),
      receiver.indexOf('Deno.serve('));
    expect(fn).toContain("eq('id', npcCheckId)");
    // The key itself is read off the verified payload in the handler.
    expect(receiver).toContain("eventMetadata['npc_verification_check_id']");
    // The provider on the row is what makes the classification safe: a hosted
    // row can never be reached through this path.
    expect(fn).toContain('isStandaloneIdvProvider(candidate.provider');
    // Corroboration is recorded, never required — requiring it would fail the
    // early-arrival case this exists to handle.
    expect(fn).toContain('provider_request_ids');
    expect(fn).toContain('vendorDataMatches(');
    expect(fn).toContain('standalone_metadata_uncorrelated_session');
  });

  it('reads nothing but identifiers — it can never settle', () => {
    const fn = codeOnly(receiver.slice(
      receiver.indexOf('async function classifyStandaloneEvent('),
      receiver.indexOf('Deno.serve(')));
    for (const forbidden of ['update(', 'insert(', 'applyDiditDecision', 'fetchDiditDecision']) {
      expect(fn, forbidden).not.toContain(forbidden);
    }
  });

  it('acknowledges with a 2xx, so Didit stops retrying it', () => {
    const branch = block.slice(block.indexOf('if (standalone) {'));
    expect(branch).toMatch(/return json\(\{[^}]*\}, 202\)/);
    // Never a 5xx: that is what would have it retried for ever.
    expect(branch).not.toContain('500');
    expect(branch).not.toContain('503');
  });

  it('applies nothing — no decision fetch, no settle, no outcome', () => {
    const branch = codeOnly(block.slice(block.indexOf('if (standalone) {')));
    for (const forbidden of [
      'applyDiditDecision', 'fetchDiditDecision', 'canonicalOutcome',
      'attempt_consumed', 'status:', 'outcome_detail',
    ]) {
      expect(branch, forbidden).not.toContain(forbidden);
    }
    // `processed: false` — acknowledged, not acted on.
    expect(branch).toContain('processed: false');
  });

  it('reaches that branch BEFORE any hosted settlement can run', () => {
    // The standalone check sits inside `if (!check)`, i.e. only when no hosted
    // row matched, and returns — so it can never fall through into the
    // settlement path below.
    const ignored = receiver.indexOf("reason: 'standalone_session_ignored'");
    const settle = receiver.indexOf('applyDiditDecision({');
    expect(ignored).toBeGreaterThan(-1);
    expect(settle).toBeGreaterThan(-1);
    expect(ignored).toBeLessThan(settle);
  });

  it('still finds hosted rows the way it always did', () => {
    // The hosted lookup is unchanged: provider = 'didit', by stored session id.
    expect(receiver).toContain("eq('provider', 'didit')");
    expect(receiver).toContain("eq('provider_reference', sessionId)");
  });

  it('a session belonging to nobody is still refused, and still says so', () => {
    /*
     * The reading is chosen rather than written as a literal now, because a
     * shared Didit application delivers every SIBLING deployment's events here
     * too and those are routine — see `readForeignSession`. What this test
     * still guards is the part that matters: an event that correlates to
     * nothing on this deployment is refused, whichever of the two names it
     * gets, and neither name is ever `processed`.
     */
    expect(block).toContain("readForeignSession(vendorData, caseHeldLocally)");
    expect(block).toContain("'foreign_tenant_session'");
    expect(block).toContain("'unknown_session'");
    expect(block).toContain('await markEvent({ error: reason, processed_at:');
    expect(block).toContain('json({ ok: true, processed: false, reason }, 202)');
    // No branch here may apply an outcome.
    expect(block).not.toContain('applyDiditDecision');
  });
});
