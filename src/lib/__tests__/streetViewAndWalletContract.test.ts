/**
 * Contract tests for two production defects found on the Listings map and the
 * Billing & Usage page. Both had the same shape: correct-looking code sitting
 * on infrastructure that was not there, reporting a confident but wrong story
 * to the user.
 *
 *   1. Street View answered 429 to every request because the shared rate-limit
 *      primitive it calls (`security_consume_rate_limit`) had never been
 *      migrated. The helper treated an RPC error as "over quota", and the panel
 *      rendered that as "Google has no panorama coverage for this location" —
 *      a claim about Google, for what was a missing migration here.
 *
 *   2. The wallet showed a "Primary" badge derived from a local integer column,
 *      never checked against the card Stripe will actually charge. A wallet
 *      that only reports its own table can look healthy while Stripe charges
 *      something else.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

describe('shared abuse controls separate "over limit" from "unavailable"', () => {
  const src = read('supabase/functions/_shared/publicAbuseControls.ts');

  it('falls back to a local counter when the shared primitive errors', () => {
    // The bug: `if (error || !data?.[0]) return { ok: false }` denied every
    // caller whenever the RPC was missing.
    expect(src).toContain('consumeLocalQuota');
    expect(src).not.toMatch(/if \(error \|\| !data\?\.\[0\]\) return \{ ok: false, retryAfterMs: 1000 \};/);
  });

  it('still enforces a real ceiling in the fallback path', () => {
    // Falling back must not mean "no limit" — these endpoints spend money.
    const fn = src.slice(src.indexOf('function consumeLocalQuota'), src.indexOf('* Consume one unit'));
    expect(fn).toContain('bucket.count <= opts.limit');
    expect(fn).toContain('resetAt');
  });

  it('marks degraded answers so the fallback is not silent', () => {
    expect(src).toContain('degraded: true');
    expect(src).toMatch(/console\.warn\('\[abuse-controls\]/);
  });

  it('a genuine over-limit answer still denies', () => {
    expect(src).toContain("ok: data[0].allowed === true");
  });
});

describe('street-view does not turn a local gap into a provider outage', () => {
  const src = read('supabase/functions/street-view/index.ts');

  it('an unreadable circuit no longer 503s the request', () => {
    // provider_circuit_is_open reports whether GOOGLE is failing. Not being
    // able to read our own circuit table says nothing about Google.
    expect(src).not.toMatch(/if \(circuitReadError \|\| circuitOpen === true\) return/);
    expect(src).toContain('if (circuitReadError) {');
    expect(src).toContain("console.warn('[street-view] circuit state unreadable");
  });

  it('a genuinely open circuit still short-circuits', () => {
    expect(src).toContain('} else if (circuitOpen === true) {');
    expect(src).toMatch(/error: 'temporarily_unavailable'/);
  });
});

describe('the Street View panel reports the real reason', () => {
  const src = read('src/components/listings/StreetViewPanel.tsx');

  it('only blames Google when Google actually said ZERO_RESULTS', () => {
    expect(src).toContain("data.status === 'ZERO_RESULTS' ? 'no_coverage' : 'error'");
    const messages = src.slice(src.indexOf('const MESSAGES'), src.indexOf('export function StreetViewPanel'));
    // The coverage claim must appear under no_coverage and nowhere else.
    const coverageClaims = messages.match(/no panorama coverage/g) ?? [];
    expect(coverageClaims).toHaveLength(1);
    expect(messages.slice(messages.indexOf('no_coverage'), messages.indexOf('not_configured')))
      .toContain('no panorama coverage');
  });

  it('distinguishes a missing key, back-pressure and a fault', () => {
    for (const state of ['not_configured', 'busy', 'error']) {
      expect(src, `${state} state missing`).toContain(`${state}:`);
    }
    expect(src).toContain("code === 'street_view_not_configured'");
    expect(src).toContain("code === 'rate_limited'");
  });

  it('offers a retry only where retrying could help', () => {
    // Retrying a coverage gap or an unconfigured key just repeats the answer.
    expect(src).toContain("state.status === 'busy' || state.status === 'error'");
  });

  it('says explicitly that a fault is not a coverage problem', () => {
    expect(src).toContain('This is not a coverage problem.');
  });
});

describe('the wallet reports Stripe, not just its own table', () => {
  const client = read('src/lib/missionControl.ts');
  const shared = read('supabase/functions/_shared/missionControl.ts');
  const panel = read('src/components/billing/PaymentMethodsPanel.tsx');

  it('carries Stripe truth through the client types', () => {
    for (const field of ['isStripeDefault', 'attachedAtStripe', 'stripeVerified']) {
      expect(client, `${field} missing from the prime client`).toContain(field);
    }
    expect(shared).toContain('stripe_default_payment_method_id');
    expect(shared).toContain('is_stripe_default');
  });

  it('treats "could not ask Stripe" as null, not false', () => {
    // Asserting a mismatch from ignorance is worse than saying nothing.
    expect(shared).toContain('typeof m.is_stripe_default === "boolean" ? m.is_stripe_default : null');
    expect(client).toMatch(/`null` means Stripe could not be reached, which is not the same as false/);
  });

  it('only claims drift when Stripe actually answered', () => {
    expect(panel).toContain('stripeVerified && sorted.length > 0 && localPrimary?.isStripeDefault !== true');
  });

  it('names the card Stripe will really charge', () => {
    expect(panel).toContain('Stripe charges this');
    expect(panel).toContain('will charge ${stripeCharges.brand');
  });

  it('flags cards Stripe no longer holds', () => {
    expect(panel).toContain('Not at Stripe');
    expect(panel).toContain('m.attachedAtStripe === false');
  });

  it('offers a repair rather than only a diagnosis', () => {
    expect(panel).toContain('Sync with Stripe');
    expect(panel).toContain("{ action: \"sync_default\" }");
  });

  it('the edge function accepts the repair action', () => {
    const edge = read('supabase/functions/mission-control-payment-methods/index.ts');
    expect(edge).toContain('if (action === "sync_default")');
  });
});

describe('the repair migration restores both missing primitives', () => {
  const sql = read('supabase/migrations/20260803020000_repair_shared_rate_limit_and_circuit_primitives.sql');

  it('recreates the rate limiter and the circuit breaker', () => {
    expect(sql).toContain('FUNCTION public.security_consume_rate_limit');
    expect(sql).toContain('FUNCTION public.provider_circuit_is_open');
    expect(sql).toContain('TABLE IF NOT EXISTS public.provider_circuit_state');
  });

  it('is idempotent, so applying it where they exist is a no-op', () => {
    expect(sql).not.toMatch(/CREATE FUNCTION (?!IF)/);
    expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
  });

  it('keeps the primitives off anon and authenticated', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.security_consume_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON public.provider_circuit_state FROM anon, authenticated;');
  });

  it('explains why it re-declares older migrations', () => {
    // The originals carry earlier timestamps than migrations already applied,
    // which is how they kept being skipped.
    expect(sql).toContain('20260723140000');
    expect(sql).toContain('20260724000000');
  });
});
