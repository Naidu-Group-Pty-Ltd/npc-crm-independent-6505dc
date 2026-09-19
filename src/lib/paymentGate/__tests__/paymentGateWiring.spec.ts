/**
 * Where the gate is mounted, and what it must never reach.
 *
 * The risk this feature carries is locking somebody it should not, and the two
 * ways that happens are a gate mounted too widely and a gate that fails closed.
 * Both are absences of the kind a rendering test cannot see, so they are pinned
 * at the source.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const layout = readFileSync('src/components/layout/DashboardLayout.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const outlet = readFileSync('src/components/billing/PaymentGateOutlet.tsx', 'utf8');
const pure = readFileSync('supabase/functions/_shared/paymentGate.pure.ts', 'utf8');
const edge = readFileSync('supabase/functions/mission-control-gate/index.ts', 'utf8');
const config = readFileSync('supabase/config.toml', 'utf8');
const screen = readFileSync('src/components/billing/PaymentGateScreen.tsx', 'utf8');

describe('mounting', () => {
  it('gates both breakpoints of the dashboard shell', () => {
    // Two shells are rendered by this file and a gate on only one of them is a
    // payment wall a phone can walk around.
    const opens = layout.match(/<PaymentGateOutlet>/g) ?? [];
    const closes = layout.match(/<\/PaymentGateOutlet>/g) ?? [];
    expect(opens).toHaveLength(2);
    expect(closes).toHaveLength(2);
  });

  it('warns inside the dashboard on both breakpoints too', () => {
    expect((layout.match(/<PaymentGateBanner \/>/g) ?? []).length).toBe(2);
  });

  it('the provider sits inside the auth provider — a signed-out visitor is never gated', () => {
    // The login page, password reset and every public link live outside the
    // dashboard layout. A workspace that cannot be signed into cannot reach
    // support, cannot pay, and cannot tell anyone what is wrong.
    expect(app.indexOf('<AuthProvider>')).toBeLessThan(app.indexOf('<PaymentGateProvider>'));
    expect(app).toMatch(/<PaymentGateProvider>/);
  });
});

describe('fail-open', () => {
  it('the outlet blocks on `blocked` alone and derives nothing itself', () => {
    expect(outlet).toMatch(/const \{ blocked \} = usePaymentGate\(\)/);
    // No local reasoning about reasons, deadlines or payment — one expression
    // decides, in the pure module, and every surface reads it.
    expect(outlet).not.toMatch(/locks_at|locksAt|grace_expired|paid/);
  });

  it('the pure module admits a lock from exactly one expression', () => {
    const locks = pure.match(/status === "locked"/g) ?? [];
    expect(locks).toHaveLength(1);
  });

  it('the edge function answers 200 with an open verdict rather than an error status', () => {
    expect(edge).toMatch(/unknownVerdict\(\)/);
    // A 4xx/5xx from this function would send the client down a path where it
    // has no verdict at all; the whole contract is that a failure is an OPEN
    // verdict the caller can read.
    expect(edge).not.toMatch(/json\(unknownVerdict\(\),\s*5\d\d\)/);
  });
});

describe('the way out is actually drawn', () => {
  it('decides the pay button by one shared rule, not by naming a reason', () => {
    // `reason !== "operator_locked"` answered yes to every word this build has
    // never heard of. The rule now lives in the pure module, where both the
    // button and the copy read it.
    expect(screen).toMatch(/payingCanUnlock\(verdict\)/);
    expect(screen).not.toMatch(/reason !== ["']operator_locked["']/);
  });

  it("renders the verdict's own pricing URL, which had no call site at all", () => {
    // Mission Control sends `checkout.pricing_url` on every gated read and
    // calls it "always a real URL when gated, never null, because a locked
    // screen with no way out is worse than no screen" — and nothing in the
    // product read it. The fallback appeared only when a refusal happened to
    // carry its own copy, which is a minority of the refusal shapes.
    expect(screen).toMatch(/verdict\.pricingUrl/);
  });

  it('stops offering the button while a payment is being confirmed', () => {
    // The only anti-double-charge guard is Mission Control's `paid_at`, which
    // the Stripe webhook writes — so between paying and that webhook landing,
    // a second click buys a second subscription.
    expect(screen).toMatch(/confirming/);
    expect(screen).toMatch(/already_paid/);
  });
});

describe('deployment', () => {
  it('the gate function declares verify_jwt', () => {
    // An omitted block is read as `true` by the CLI, which would put the
    // platform JWT gate in front of a cookie-authenticated call and 401 every
    // request — see docs/security/VERIFY_JWT.md.
    expect(config).toMatch(/\[functions\.mission-control-gate\]\s*\nverify_jwt = false/);
  });

  it('the shared modules parse under Deno — no aliases, explicit extensions', () => {
    const shared = readFileSync('supabase/functions/_shared/paymentGate.ts', 'utf8');
    for (const text of [pure, shared, edge]) {
      expect(text).not.toMatch(/from ["']@\//);
      for (const m of text.matchAll(/from ["'](\.[^"']+)["']/g)) {
        expect(m[1]).toMatch(/\.ts$/);
      }
    }
  });
});
