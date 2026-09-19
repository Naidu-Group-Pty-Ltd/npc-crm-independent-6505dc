/**
 * Contract tests for the second notification defect — the one that kept the bell
 * empty even after every producer was repaired.
 *
 * The read path looked healthy from every angle except the only one that
 * mattered. Production evidence:
 *
 *   - The browser's request is in the API log and returns 200:
 *       GET /rest/v1/notifications?...&or=(target_user_id.is.null,target_user_id.eq.<uid>)
 *   - Replaying that exact query as `authenticated` with that user's claims
 *     returns 50 rows, all unread.
 *   - Replaying it as `anon` returns 0 rows AND NO ERROR.
 *
 * So the browser was querying as `anon`. `notifications` policies are all
 * `TO authenticated`, but `anon` still held a SELECT grant — and RLS is additive
 * over GRANTs, so Postgres matched no policy and PostgREST answered `200 []`
 * instead of refusing. The app has two credentials: the staff session cookie
 * (which every edge function uses, and which works) and a self-minted Supabase
 * JWT for direct PostgREST calls. `custom-auth-verify-v2` treats that JWT as
 * optional — on a signing failure it still answers `valid: true` with
 * `access_token: null` — and the client then builds a plain anon-key client.
 *
 * The table dates the regression precisely: of ~2,000 notifications written
 * since 3 July, not one has ever been marked read; on 1 July it was 65 of 65.
 * `markAsRead` under anon is a silent no-op.
 *
 * The fix is to stop depending on that JWT for the bell, and to make the
 * degraded state impossible to miss everywhere else.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const MIGRATION = 'supabase/migrations/20260803040000_close_silent_anon_and_record_webhook_rejections.sql';

describe('the bell no longer depends on the browser-held JWT', () => {
  const context = read('src/contexts/NotificationsContext.tsx');
  const feed = read('supabase/functions/notifications-feed/index.ts');

  it('reads through the session-authenticated function, not PostgREST', () => {
    expect(context).toMatch(/const NOTIFICATIONS_FN = 'notifications-feed(-v2)?'/);
    expect(context).toMatch(/invokeSecureFunction[\s\S]{0,200}NOTIFICATIONS_FN/);
    // The direct query is what silently returned 200 [].
    expect(context).not.toMatch(/\.from\('notifications'\)\s*\n?\s*\.select/);
  });

  it('routes every mutation through the same credential', () => {
    // A read that works and writes that silently affect zero rows is the worst
    // of both worlds: the UI moves, then snaps back on the next refresh.
    for (const action of ['mark_read', 'mark_all_read', 'clear', 'clear_all', 'create']) {
      expect(context, `${action} not routed through the feed`).toContain(`action: '${action}'`);
    }
    expect(context).not.toMatch(/supabase\s*\n?\s*\.from\('notifications'\)/);
  });

  it('scopes every server-side query to the caller', () => {
    // This function runs as service_role, so the RLS predicate it replaces has
    // to be reapplied by hand on EVERY query — including the id-addressed ones,
    // or a caller could mark another user's notification read by guessing its id.
    expect(feed).toMatch(/const visible = [\s\S]{0,160}target_user_id\.is\.null,target_user_id\.eq\.\$\{me\}/);
    for (const guarded of [
      /visible\(\s*\n?\s*sb\.from\('notifications'\)\.select/,
      /visible\(query\.eq\('id', id\)\)/,
      /visible\(\s*\n?\s*sb\.from\('notifications'\)\.update\(\{ read: true \}\)\.eq\('read', false\)/,
      /visible\(sb\.from\('notifications'\)\.delete\(\)\.gte/,
    ]) {
      expect(feed).toMatch(guarded);
    }
  });

  it('refuses a service-role caller impersonating a user', () => {
    // verifyAuth returns userId 'service_role' for internal callers; treating
    // that as a user id would scope the feed to the literal string.
    expect(feed).toMatch(/auth\.userId === 'service_role'/);
  });

  it('never broadcasts a client-raised notification by omission', () => {
    // target_user_id IS NULL means "every staff member sees this". That must be
    // asked for, not fallen into by leaving a field off.
    expect(feed).toMatch(/b\.broadcast === true \? null :/);
    expect(context).toMatch(/broadcast: false/);
  });

  it('bounds the list size a caller can request', () => {
    expect(feed).toMatch(/Math\.min\(Math\.max\(Math\.trunc\(requested\), 1\), MAX_LIMIT\)/);
  });
});

describe('the anon fallback can no longer fail silently', () => {
  const sql = read(MIGRATION);
  const auth = read('src/hooks/useAuth.tsx');
  /**
   * The handler, not an entrypoint.
   *
   * This read `custom-auth-verify-v2/index.ts` directly, and that file is now a
   * shim: both verify URLs are deployed and both delegate to one handler in
   * `_shared/customAuth/verify.ts`. The assertion followed the code rather than
   * being deleted, because the contract it pins — verify SAYS when it could not
   * mint an RLS token — is exactly what a month-long silent outage cost.
   *
   * Reading the shared module is also strictly stronger than what this checked
   * before. The reason that module exists, in its own words, is that "only one
   * of them used to have source here, and the one that did not stopped
   * receiving every hardening the other got" — so the entrypoints are asserted
   * to be shims below, which is the property the split was made for and which
   * nothing else tests.
   */
  const verify = read('supabase/functions/_shared/customAuth/verify.ts');
  const entrypoints = [
    'supabase/functions/custom-auth-verify/index.ts',
    'supabase/functions/custom-auth-verify-v2/index.ts',
  ];

  it('revokes the grant that turned a denial into an empty result', () => {
    expect(sql).toMatch(/revoke all on public\.notifications from anon/i);
    expect(sql).toMatch(/revoke all on public\.vapi_call_logs from anon/i);
  });

  it('makes verify declare when it could not mint an RLS token', () => {
    expect(verify).toMatch(/jwt_unavailable: accessToken === null/);
    // The old comment ("Continue without JWT - session is still valid") is the
    // decision that made a month-long outage look like normal operation.
    expect(verify).not.toMatch(/Continue without JWT/);
  });

  it('keeps both verify URLs on that one handler', () => {
    for (const rel of entrypoints) {
      const src = read(rel);
      expect(src, `${rel} must delegate to the shared handler`)
        .toMatch(/handleStaffVerify/);
      // A shim that grows its own logic is how the two URLs diverged the first
      // time. Anything beyond the import and the serve call belongs in the
      // handler, where both entrypoints get it.
      const statements = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('//'));
      expect(statements, `${rel} must stay a shim, not gain its own logic`)
        .toHaveLength(2);
    }
  });

  it('makes the client shout instead of degrading quietly', () => {
    expect(auth).toMatch(/data\.jwt_unavailable/);
    expect(auth).toMatch(/direct Supabase queries/);
  });
});

describe('refused inbound webhooks are recorded', () => {
  const sql = read(MIGRATION);
  const webhook = read('supabase/functions/vapi-call-webhook/index.ts');

  it('still fails closed', () => {
    // The point is visibility, NOT letting unauthenticated callers through.
    expect(webhook).toMatch(/if \(!secretAccepted\)/);
    expect(webhook).toMatch(/verifyWebhookSecret\(webhookSecret, providedSecret\)/);
    expect(webhook).toMatch(/status: 401/);
  });

  it('reads every header name this estate actually sends', () => {
    // `x-vapi-webhook-secret` is the name 13 assistants and a phone number were
    // configured with. Reading only the other two is what stopped call logging
    // dead on 2026-07-22 and cost 171 refusals that nothing acted on, every one
    // of them classified `secret_not_presented`.
    for (const header of ['x-vapi-secret', 'x-webhook-secret', 'x-vapi-webhook-secret']) {
      expect(webhook).toContain(`req.headers.get('${header}')`);
    }
  });

  it('accepts a previous secret so a rotation can be reconciled', () => {
    // Without it, the minutes between setting the new value and sweeping the
    // senders are indistinguishable from a rotation that failed outright.
    expect(webhook).toMatch(/VAPI_WEBHOOK_SECRET_PREVIOUS/);
    expect(webhook).toMatch(/verifyWebhookSecret\(previousWebhookSecret, providedSecret\)/);
  });

  it('never stamps a hardcoded squad identity onto a call', () => {
    // The squad id is a property of whichever VAPI org this deployment talks
    // to. Hardcoded, it goes stale the moment the estate moves and splits one
    // squad's call history in two, because CallLogs filters and
    // SquadAnalyticsDashboard groups on these columns.
    const code = webhook
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/a9656ea1-3575-4ac6-b985-fd138be06cc5/);
    expect(code).not.toMatch(/Inbound Reception Squad/);
    expect(code).toMatch(/resolveSquadIdentity/);
  });

  it('distinguishes an unset secret from a wrong one', () => {
    // Different fixes: configure the secret here, vs. correct what VAPI sends.
    for (const reason of ['secret_not_configured', 'secret_mismatch', 'secret_not_presented']) {
      expect(webhook).toContain(reason);
    }
  });

  it('records the refusal without letting the diagnostic break the response', () => {
    expect(webhook).toMatch(/record_webhook_rejection/);
    const idx = webhook.indexOf('record_webhook_rejection');
    expect(webhook.slice(idx - 400, idx + 400)).toMatch(/catch \(_e\)/);
  });

  it('bounds the table and sanitises the only caller-influenced input', () => {
    // Reachable from an unauthenticated request: it must not become a write
    // primitive or an unbounded row source.
    expect(sql).toMatch(/date_trunc\('hour', now\(\)\)/);
    expect(sql).toMatch(/regexp_replace\(coalesce\(p_reason/);
    expect(sql).toMatch(/primary key \(function_name, hour_bucket, reason\)/);
  });

  it('keeps the recorder off anon and the table read-only for staff', () => {
    expect(sql).toMatch(/revoke all on function public\.record_webhook_rejection\(text, text\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function public\.record_webhook_rejection\(text, text\) to service_role/i);
    expect(sql).toMatch(/grant select on public\.webhook_rejections to authenticated/i);
  });
});
