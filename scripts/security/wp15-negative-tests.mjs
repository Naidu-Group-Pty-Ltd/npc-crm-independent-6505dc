#!/usr/bin/env node
/**
 * WP-15 — Live negative-test harness.
 *
 * Executes the subset of docs/security/WP15_NEGATIVE_TEST_MATRIX.md that can
 * be run without a real user session and without provider fixtures. This
 * covers the WP-12 Phase B strict-signed rollout: any attempt to reach an
 * `internal_service` receiver without a valid HMAC envelope MUST return 401.
 *
 * Env required:
 *   SUPABASE_URL       (e.g. https://dduzbchuswwbefdunfct.supabase.co)
 *   SUPABASE_ANON_KEY  (public anon key)
 *   NON_SUPERADMIN_JWT (access token for an active, non-superadmin user)
 *
 * Optional:
 *   OUTPUT_DIR   (default docs/security/wp15-evidence/<YYYY-MM-DD>)
 *   CRON_TARGET  (default market-updates-digest)
 *   INTERNAL_TARGET (default agent-task-runner)
 *
 * Optional, and each unlocks one row that cannot run without it:
 *   OUTLOOK_WEBHOOK_CLIENT_STATE  NT-26 (webhook idempotency)
 *   RUN_QUOTA_TEST=true           NT-29 (rate limiting — COSTS MONEY, see below)
 *
 * Every row emits one JSON line:
 *   {"id":"NT-05","target":"…","input":"…","expected":"401","observed":"401","result":"expected_denial"}
 *
 * `result` is one of `expected_denial`, `FAIL`, or `skipped`. Exit code is 0
 * iff no row is `FAIL`. A `skipped` row carries a `reason` and does not fail the
 * run — it is a claim about why something is unproven, which is worth more in
 * the evidence than the row silently not existing.
 *
 * ## This fires real requests at production
 *
 * Every row is a denial probe: nothing here writes a row or mutates state, with
 * two exceptions that are both opt-in.
 *
 *   * NT-26 needs the live Outlook webhook secret, because idempotency is
 *     checked after the signature.
 *   * NT-29 must exhaust a rate limit to observe it, and the quota is consumed
 *     before the vendor call — so reaching 429 means ~30 billable Google Places
 *     requests first. Per docs/integrations/API_USAGE_METERING.md this
 *     deployment may be spending the prime's credential rather than its own,
 *     so that is a per-run decision rather than a default.
 */
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const NON_SUPERADMIN_JWT = process.env.NON_SUPERADMIN_JWT;
if (!SUPABASE_URL || !ANON || !NON_SUPERADMIN_JWT) {
  console.error('SUPABASE_URL, SUPABASE_ANON_KEY, and NON_SUPERADMIN_JWT are required.');
  process.exit(2);
}

const CRON_TARGET     = process.env.CRON_TARGET     || 'market-updates-digest';
const INTERNAL_TARGET = process.env.INTERNAL_TARGET || 'agent-task-runner';
const DATE = new Date().toISOString().slice(0, 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR || join('docs', 'security', 'wp15-evidence', DATE);
mkdirSync(OUTPUT_DIR, { recursive: true });
const OUT = join(OUTPUT_DIR, 'negative-tests.jsonl');
const lines = [];

/**
 * Every 5xx body this run happened to see, for NT-40. Collected rather than
 * provoked: deliberately breaking a production endpoint to watch it break is not
 * a test worth running against a live system.
 */
const observed5xx = [];

async function call(fn, headers, body) {
  const url = `${SUPABASE_URL}/functions/v1/${fn}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, ...headers },
    body: JSON.stringify(body ?? {}),
  });
  // Consume body so Deno / node fetch doesn't leak
  const text = await res.text().catch(() => '');
  if (res.status >= 500) observed5xx.push({ fn, body: text.slice(0, 400) });
  return { status: res.status, bodyPreview: text.slice(0, 200) };
}

/**
 * A row that could not be run, with the reason.
 *
 * `skipped` does not fail the run, and that is a deliberate choice rather than
 * leniency: the alternative is leaving the row out of the harness entirely,
 * which is what "unimplemented" meant before and is indistinguishable in the
 * evidence from a row that passed. A skip is a claim about *why* something is
 * unproven, and it lands in the artifact next to the rows that did run.
 */
function skip(id, target, input, reason) {
  const row = { id, target, input, expected: 'expected_denial', observed: 'not run', reason, result: 'skipped' };
  lines.push(JSON.stringify(row));
  console.log(JSON.stringify(row));
}

/** A row whose assertion is a boolean rather than a status code. */
function assert(id, target, input, expected, observed, passed, extra) {
  const row = { id, target, input, expected, observed, ...(extra ?? {}), result: passed ? 'expected_denial' : 'FAIL' };
  lines.push(JSON.stringify(row));
  console.log(JSON.stringify(row));
  return passed;
}

function record(id, target, input, expectedStatus, observedStatus, expectedError, observedBody) {
  const expectedList = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  let observedError;
  if (expectedError) {
    try {
      observedError = JSON.parse(observedBody).error;
    } catch {
      observedError = undefined;
    }
  }
  const result = expectedList.includes(observedStatus) && (!expectedError || observedError === expectedError)
    ? 'expected_denial'
    : 'FAIL';
  const row = {
    id, target, input,
    expected: expectedList.join('|'),
    observed: String(observedStatus),
    ...(expectedError && { expectedError, observedError: observedError ?? 'unparseable response' }),
    result,
  };
  lines.push(JSON.stringify(row));
  console.log(JSON.stringify(row));
  return result === 'expected_denial';
}

let ok = true;

// NT-05 — Arbitrary Bearer against Market AI orchestrator (verify_jwt=true fn)
{
  const r = await call('market-updates-qa',
    { authorization: 'Bearer not-a-real-jwt' },
    { question: 'ping' });
  ok = record('NT-05', 'market-updates-qa', 'Bearer <random>', 401, r.status) && ok;
}

// NT-06 — Missing X-Cron-Secret against a cron worker
{
  const r = await call(CRON_TARGET, {}, {});
  ok = record('NT-06', CRON_TARGET, 'missing X-Cron-Secret', [401, 403], r.status) && ok;
}

// NT-07 — Wrong X-Cron-Secret against a cron worker
{
  const r = await call(CRON_TARGET,
    { 'x-cron-secret': 'wrong-value-for-negative-test' },
    {});
  ok = record('NT-07', CRON_TARGET, 'wrong X-Cron-Secret', [401, 403], r.status) && ok;
}

// NT-09 — Missing X-Internal-Signature against internal-service receiver
{
  const r = await call(INTERNAL_TARGET, {}, { ping: true });
  ok = record('NT-09', INTERNAL_TARGET, 'missing X-Internal-Signature', [401, 403], r.status) && ok;
}

// NT-09b — Present but obviously-forged signature
{
  const r = await call(INTERNAL_TARGET, {
    'x-internal-signature':  'deadbeef'.repeat(8),
    'x-internal-timestamp':  String(Date.now()),
    'x-internal-nonce':      'nonce-negative-test',
    'x-internal-key-id':     'v1',
  }, { ping: true });
  ok = record('NT-09b', INTERNAL_TARGET, 'forged signature', 401, r.status) && ok;
}

// NT-11 — Authenticated non-superadmin against the admin management function
{
  const r = await call('admin-user-management',
    { authorization: `Bearer ${NON_SUPERADMIN_JWT}` },
    { action: 'list_users' });
  ok = record(
    'NT-11',
    'admin-user-management',
    'authenticated non-superadmin JWT',
    403,
    r.status,
    'Unauthorized: Superadmin access required',
    r.bodyPreview,
  ) && ok;
}

// ───────────────────────────────────────────────────────────────────────────
// Rows added for the 20-item programme (WP-16 … WP-21). Same rule as above:
// every one must come back a denial, and a pass here is the only evidence that
// a source fix is also a deployed fix.
// ───────────────────────────────────────────────────────────────────────────

// NT-37 — WP-19. A credentialed request from an origin that is not on the
// allowlist must not be told it may read the response. The function may answer
// 200; what must not happen is `Access-Control-Allow-Origin` coming back as `*`
// or echoing the attacker's origin, either of which lets a hostile page read a
// response carrying the session cookie.
{
  const evil = 'https://negative-test.invalid';
  const res = await fetch(`${SUPABASE_URL}/functions/v1/template-share`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, origin: evil },
    body: JSON.stringify({ operation: 'noop' }),
  });
  await res.text().catch(() => '');
  const acao = res.headers.get('access-control-allow-origin');
  const leaked = acao === '*' || acao === evil;
  lines.push(JSON.stringify({
    id: 'NT-37', target: 'template-share',
    input: `credentialed request with Origin: ${evil}`,
    expected: 'ACAO is neither * nor the request origin',
    observed: `ACAO: ${acao ?? '<absent>'}`,
    result: leaked ? 'FAIL' : 'expected_denial',
  }));
  console.log(lines.at(-1));
  ok = !leaked && ok;
}

// NT-38 — WP-16 / WP-20. A UUID belonging to nobody must not distinguish
// "exists but forbidden" from "does not exist", and must never return the row.
{
  const foreign = '00000000-0000-4000-8000-0000000000ff';
  const r = await call('get-client-data',
    { authorization: `Bearer ${NON_SUPERADMIN_JWT}` },
    { clientId: foreign });
  ok = record('NT-38', 'get-client-data', 'UUID from another tenant', [401, 403, 404], r.status) && ok;
}

// NT-39 — WP-20. A privileged write naming a column no request may set must be
// refused. Under an ordinary staff token the authorization gate refuses first,
// which is the correct denial and the one this asserts; proving the field
// allowlist itself needs an AML-write session, so that stays a unit concern
// (scripts/security/check-mass-assignment.mjs).
{
  const r = await call('aml-monitoring',
    { authorization: `Bearer ${NON_SUPERADMIN_JWT}` },
    { operation: 'upsert_alert', alert: { title: 'negative test', resolved_by: '00000000-0000-4000-8000-00000000000a' } });
  ok = record('NT-39', 'aml-monitoring', 'write naming a protected column', [401, 403], r.status) && ok;
}

// NT-41 — WP-19. The Lovable *preview* origins must not be trusted for
// credentialed responses. `lovablePreviewSuffixAllowed` has always been gated
// behind CORS_ALLOW_LOVABLE_PREVIEW and says production leaves it unset — but
// the two EXACT preview URLs sat in the allowlist unconditionally, and a probe
// against the deployed project on 11 Aug 2026 confirmed both were echoed back.
// A hostile page on either host could read a response carrying the staff session
// cookie. This is the row that says whether the fix is deployed.
//
// It also prints the allowlist head. `allowedOrigins[0]` is what a disallowed
// origin gets, so this is the one externally-visible clue to whether
// ALLOWED_ORIGINS is configured at all — compare it against what you set. It is
// reported, not asserted, because the fallback and a correctly-set variable
// produce the same string.
{
  const previews = [
    'https://id-preview--7976d60b-c277-4851-889b-c170285f4be2.lovable.app',
    'https://7976d60b-c277-4851-889b-c170285f4be2.lovableproject.com',
  ];
  const trusted = [];
  let allowlistHead = '<unknown>';
  for (const origin of previews) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-user-management`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST' },
    });
    await res.text().catch(() => '');
    const acao = res.headers.get('access-control-allow-origin');
    if (acao === origin) trusted.push(origin);
    else if (acao) allowlistHead = acao;
  }
  lines.push(JSON.stringify({
    id: 'NT-41', target: 'admin-user-management',
    input: 'credentialed preflight from the Lovable preview origins',
    expected: 'neither preview origin is echoed back',
    observed: trusted.length ? `TRUSTED: ${trusted.join(', ')}` : `not trusted (allowlist head: ${allowlistHead})`,
    note: `allowlist head is ${allowlistHead} — compare against your ALLOWED_ORIGINS; if it does not match, the variable is probably unset and the legacy fallback is supplying it`,
    result: trusted.length ? 'FAIL' : 'expected_denial',
  }));
  console.log(lines.at(-1));
  ok = trusted.length === 0 && ok;
}

// ───────────────────────────────────────────────────────────────────────────
// WP-26. The six rows the matrix declared and the harness never implemented —
// NT-20/21 (item 20, uploads and storage), NT-26/27 (item 16, webhooks),
// NT-29 (item 5, rate limiting) and NT-30 (item 10, sessions).
//
// Four of the twenty items had a gate and no live row at all, so nothing here
// could ever say whether the deployed system behaved like the source. These
// close that.
//
// All of them run against production, so each is a pure denial probe: nothing
// below writes a row, and the one that costs money is opt-in.
// ───────────────────────────────────────────────────────────────────────────

// NT-20 — Item 20. A private bucket must not serve its objects on the public
// object route, and must not let the publishable key list it.
//
// Asserted over a named set rather than one bucket. 25 of the project's 30
// buckets are private and they are private for different reasons; the ones
// below are the sensitive ones, and a single-bucket probe would have said
// nothing about the other seven. `aml-biometrics` is first deliberately — it
// holds identity-verification imagery.
{
  const SENSITIVE = [
    'aml-biometrics', 'aml-documents', 'client-documents', 'client-files',
    'legal-matter-documents', 'investment-reports', 'partner-agreements',
    'agency-agreements', 'finance-portal-documents', 'email-attachments',
  ];
  const served = [];
  const listable = [];
  for (const bucket of SENSITIVE) {
    // The public object route. On a private bucket Storage answers 400/404
    // whether or not the object exists, which is the point: it must not
    // distinguish, and it must never return the bytes.
    const pub = await fetch(
      `${SUPABASE_URL}/storage/v1/object/public/${bucket}/negative-test-probe.bin`,
      { headers: { apikey: ANON } },
    );
    await pub.arrayBuffer().catch(() => {});
    if (pub.status === 200) served.push(`${bucket} (public route)`);

    // And the anon `list()` that migration 20260725095000 closed. A bucket that
    // will enumerate itself to the publishable key has leaked its filenames
    // even if every object is unreadable — and filenames here are client names.
    const ls = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ prefix: '', limit: 1 }),
    });
    const lsBody = await ls.text().catch(() => '');
    // A 200 carrying a non-empty array is the failure. An empty array is a
    // genuinely empty prefix, not a control.
    if (ls.status === 200 && /\[\s*\{/.test(lsBody)) listable.push(`${bucket} (list)`);
  }
  const bad = [...served, ...listable];
  ok = assert(
    'NT-20', 'storage',
    `public-object GET and anon list() against ${SENSITIVE.length} private buckets`,
    'no bucket serves an object or enumerates to the publishable key',
    bad.length ? `EXPOSED: ${bad.join(', ')}` : `all ${SENSITIVE.length} denied`,
    bad.length === 0,
  ) && ok;
}

// NT-21 — Item 20. A signed URL this project did not issue must not deliver an
// object.
//
// The matrix wrote this as "Client A's signed URL rebound to Client B's path",
// which needs two live portal sessions and a real object in each. What is
// testable without either — and is the property that actually matters — is that
// the signature is *verified* rather than merely present: a token of the right
// shape that this project never signed must be refused, and asking for a signed
// URL with nothing but the publishable key must be refused too.
{
  const bucket = 'client-documents';
  // Built at runtime rather than written as a literal. The first version had the
  // encoded header and payload inline, and gitleaks flagged it — correctly. A
  // JWT-shaped string in a source file is worth failing CI over whether or not
  // this particular one is inert, and a fixture that has to be exempted from the
  // secret scanner to survive is a bad fixture. Assembling it from its parts is
  // also more honest about what it is: a well-formed token nobody signed.
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const forged = [
    `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ url: 'negative-test', iat: 1 })}`
      + '.negative-test-not-a-real-signature',
    'deadbeef'.repeat(8),
  ];
  const delivered = [];
  for (const token of forged) {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${bucket}/negative-test-probe.bin?token=${token}`,
      { headers: { apikey: ANON } },
    );
    await res.arrayBuffer().catch(() => {});
    if (res.status === 200) delivered.push(`token ${token.slice(0, 12)}… returned 200`);
  }
  // And the issuing route: the publishable key must not be able to mint one.
  const mint = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/negative-test-probe.bin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  const mintBody = await mint.text().catch(() => '');
  const minted = mint.status === 200 && /signedURL|signedUrl/.test(mintBody);
  if (minted) delivered.push('anon key minted a signed URL');
  ok = assert(
    'NT-21', 'storage',
    `forged signed-URL tokens and an anon mint attempt against ${bucket}`,
    'no forged token delivers an object; the publishable key cannot mint one',
    delivered.length ? `EXPOSED: ${delivered.join(', ')}` : 'all refused',
    delivered.length === 0,
  ) && ok;
}

// NT-27 — Item 16. `outlook-email-webhook` must reject a notification whose
// `clientState` does not match the configured secret.
//
// Note what a pass here proves and what it does not. WP-13 made this fail
// closed: if OUTLOOK_WEBHOOK_CLIENT_STATE is unset or shorter than 16
// characters the function 401s everything. So a 401 means "configured and
// rejecting" OR "not configured and refusing to guess" — both are denials, and
// neither is the thing you would want to be wrong about. The rejection happens
// before any notification is claimed or processed, which is why this is safe to
// fire at production.
{
  const r = await call('outlook-email-webhook', {}, {
    value: [{
      subscriptionId: 'negative-test-subscription',
      clientState: 'wrong-client-state-for-negative-test',
      changeType: 'created',
      resource: 'me/messages/negative-test',
      resourceData: { id: 'negative-test' },
    }],
  });
  ok = record('NT-27', 'outlook-email-webhook', 'clientState mismatch', 401, r.status) && ok;
}

// NT-26 — Item 16. The same webhook must be idempotent: a notification whose
// (subscriptionId, resource id, changeType) tuple has already been seen must be
// skipped rather than processed twice.
//
// This one needs the real `clientState`, because idempotency is checked AFTER
// the signature — correctly, since claiming a nonce for an unauthenticated
// caller would let anyone poison the dedupe table. Supplying that secret to CI
// would put a live webhook credential in a second place, so it stays opt-in and
// records itself as skipped when absent.
if (process.env.OUTLOOK_WEBHOOK_CLIENT_STATE) {
  const notification = {
    value: [{
      subscriptionId: 'wp15-negative-test-subscription',
      clientState: process.env.OUTLOOK_WEBHOOK_CLIENT_STATE,
      changeType: 'created',
      resource: 'me/messages/wp15-negative-test',
      resourceData: { id: 'wp15-negative-test' },
    }],
  };
  const first = await call('outlook-email-webhook', {}, notification);
  const second = await call('outlook-email-webhook', {}, notification);
  // The subscription id is synthetic, so neither delivery matches a real
  // subscription and nothing is fetched from Graph. What is being read is
  // whether the second call reports the tuple as already claimed.
  const skippedSecond = /"skipped"\s*:\s*(true|[1-9])|already|duplicate/i.test(second.bodyPreview);
  ok = assert(
    'NT-26', 'outlook-email-webhook',
    'identical Graph notification delivered twice',
    'second delivery reports the notification as already claimed',
    `first ${first.status}: ${first.bodyPreview.slice(0, 80)} | second ${second.status}: ${second.bodyPreview.slice(0, 80)}`,
    second.status < 500 && skippedSecond,
  ) && ok;
} else {
  skip('NT-26', 'outlook-email-webhook', 'identical Graph notification delivered twice',
    'OUTLOOK_WEBHOOK_CLIENT_STATE not supplied. Idempotency is checked after the '
    + 'clientState match — deliberately, since an unauthenticated caller who could '
    + 'claim nonces could poison the dedupe table — so this row cannot run without '
    + 'the live webhook secret.');
}

// NT-29 — Item 5. The public quota on `google-places-autocomplete` must return
// 429 once the sliding window is exhausted.
//
// OPT-IN, because proving it costs money. The IP quota is 30 requests / 60s and
// every request up to that limit reaches Google Places, which is billed — and
// per docs/integrations/API_USAGE_METERING.md this deployment may be spending
// the prime's credential rather than its own. ~31 autocomplete calls is a few
// cents, which is a fine price for knowing a rate limit works and a bad one to
// pay on every unattended run.
//
// The order matters and is the thing being checked: the quota is consumed
// BEFORE the vendor call, so request 31 must cost nothing.
if (process.env.RUN_QUOTA_TEST === 'true') {
  const BURST = 34; // limit is 30/60s; a few past it, not a flood
  let sawLimit = false;
  let sent = 0;
  for (let i = 0; i < BURST && !sawLimit; i++) {
    // >= 3 characters, or the handler returns early without consuming quota.
    const r = await call('google-places-autocomplete', {}, { input: `neg test ${i}` });
    sent++;
    if (r.status === 429) sawLimit = true;
  }
  ok = assert(
    'NT-29', 'google-places-autocomplete',
    `burst of up to ${BURST} requests against a 30/60s IP quota`,
    '429 before the burst is exhausted',
    sawLimit ? `429 after ${sent} requests` : `no 429 in ${sent} requests`,
    sawLimit,
    { cost_note: `${sent} Places autocomplete call(s) billed to the configured credential` },
  ) && ok;
} else {
  skip('NT-29', 'google-places-autocomplete', 'exceed the sliding-window IP quota',
    'RUN_QUOTA_TEST is not "true". The quota is consumed before the vendor call, so '
    + 'reaching 429 means ~30 billable Google Places requests first; this deployment '
    + 'may be spending the prime\'s credential (docs/integrations/API_USAGE_METERING.md), '
    + 'so it is a per-run decision rather than a default.');
}

// NT-30 — Item 10. A portal session token that this project did not issue must
// not resolve to a session.
//
// The matrix wrote this as "reuse a portal cookie from another IP after idle
// timeout". The idle-timeout half needs a real session aged past
// `idle_expires_at`, which cannot be manufactured from outside. What is
// testable — and is the property the item is actually about — is that the token
// is looked up and validated rather than trusted for being present.
//
// Sent through all four of the paths `extractPortalToken` accepts, because a
// control that holds on the header and not the body is not a control. That
// function reads `x-portal-session-token`, `body.portal_session_token`,
// `x-session-token` and `body.session_token`, in that order.
{
  const forged = 'wp15-negative-test-forged-portal-session-token-0000000000';
  const attempts = [
    ['x-portal-session-token header', { 'x-portal-session-token': forged }, {}],
    ['x-session-token header',        { 'x-session-token': forged },        {}],
    ['body.portal_session_token',     {},                                   { portal_session_token: forged }],
    ['body.session_token',            {},                                   { session_token: forged }],
  ];
  const accepted = [];
  for (const [label, headers, extra] of attempts) {
    const r = await call('manage-portal-client-data', headers, {
      operation: 'select', table: 'clients', ...extra,
    });
    if (r.status !== 401 && r.status !== 403) accepted.push(`${label} → ${r.status}`);
  }
  ok = assert(
    'NT-30', 'manage-portal-client-data',
    'forged portal session token through all four accepted carriers',
    'every carrier answers 401/403',
    accepted.length ? `ACCEPTED: ${accepted.join(', ')}` : 'all four denied',
    accepted.length === 0,
  ) && ok;
}

// NT-40 — WP-18. Nothing in this run may have answered a 5xx that carries the
// exception. Asserted over every response the harness saw rather than by
// provoking a failure: deliberately breaking a production endpoint to watch it
// break is not a test worth running against a live system, and this catches the
// same regression whenever any row happens to trip one.
{
  const schemaish = /relation "|column "|constraint "|violates |permission denied for table|at [A-Za-z]+\.[a-z]+ \(/i;
  const offenders = observed5xx.filter((o) => schemaish.test(o.body));
  lines.push(JSON.stringify({
    id: 'NT-40', target: 'any',
    input: `${observed5xx.length} 5xx response(s) seen during this run`,
    expected: 'no schema detail in any 5xx body',
    observed: offenders.length ? offenders.map((o) => `${o.fn}: ${o.body.slice(0, 80)}`).join(' | ') : 'none',
    result: offenders.length ? 'FAIL' : 'expected_denial',
  }));
  console.log(lines.at(-1));
  ok = offenders.length === 0 && ok;
}

writeFileSync(OUT, lines.join('\n') + '\n');
const skipped = lines.filter((l) => l.includes('"result":"skipped"')).length;
console.log(`\nWrote ${lines.length} rows -> ${OUT}${skipped ? ` (${skipped} skipped)` : ''}`);
if (!ok) {
  console.error('WP-15 negative-test harness: FAIL');
  process.exit(1);
}
console.log('WP-15 negative-test harness: OK');
