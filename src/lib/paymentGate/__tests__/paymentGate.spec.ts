/**
 * The gate's clone-side rules.
 *
 * Every test here is about the same guarantee stated two ways: this workspace
 * locks ONLY when Mission Control says "locked", and locks under no other
 * circumstance whatsoever.
 */
import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatRemaining,
  lockedCopy,
  openVerdict,
  parseGateResponse,
  payingCanUnlock,
  remainingMs,
  shouldBlock,
  shouldWarn,
  unknownVerdict,
  warningCopy,
} from '@/lib/paymentGate/state';

const LOCKED_BODY = {
  ok: true,
  gated: true,
  status: 'locked',
  reason: 'grace_expired',
  locked: true,
  paid: false,
  locks_at: '2026-08-30T00:00:00.000Z',
  ms_remaining: 0,
  counting: false,
  plan: { slug: 'growth', name: 'Growth', amount_due_cents: 86000, currency: 'AUD' },
  clone: { id: 'c1', name: 'Acme Property', slug: 'acme' },
  checkout: { start_path: '/api/public/clones/gate/checkout', pricing_url: 'https://pay.example' },
};

describe('only an explicit lock locks', () => {
  it('reads a locked verdict', () => {
    const v = parseGateResponse(LOCKED_BODY);
    expect(v.gated).toBe(true);
    expect(v.locked).toBe(true);
    expect(shouldBlock(v)).toBe(true);
    expect(v.plan?.name).toBe('Growth');
    expect(v.pricingUrl).toBe('https://pay.example');
  });

  const neverLocks: Array<[string, unknown]> = [
    ['null', null],
    ['a string', 'locked'],
    ['an empty object', {}],
    ['ok:false', { ...LOCKED_BODY, ok: false }],
    ['gated:false', { ...LOCKED_BODY, gated: false }],
    ['no status', { ok: true, gated: true, reason: 'grace_expired' }],
    ['a status this build has never heard of', { ...LOCKED_BODY, status: 'quarantined' }],
    // The nastiest one: a body that CLAIMS locked on the convenience mirror
    // while the decided status says open. The decided field wins.
    ['locked:true but status open', { ...LOCKED_BODY, status: 'open', locked: true }],
  ];

  it.each(neverLocks)('%s does not lock', (_label, body) => {
    expect(shouldBlock(parseGateResponse(body))).toBe(false);
  });

  it('an unrecognised reason is `unknown` and still open', () => {
    const v = parseGateResponse({ ...LOCKED_BODY, status: 'open', reason: 'moon_phase' });
    expect(v.reason).toBe('unknown');
    expect(shouldBlock(v)).toBe(false);
  });
});

describe('the failure verdicts', () => {
  it('an unknown verdict is open, and says nobody answered', () => {
    const v = unknownVerdict();
    expect(shouldBlock(v)).toBe(false);
    expect(v.known).toBe(false);
    expect(v.gated).toBe(false);
  });

  it('the default verdict — what the app renders before the first answer — is open', () => {
    // A gate that blocked while it was still asking would flash a payment wall
    // in front of every user on every cold load, including the prime's.
    expect(shouldBlock(openVerdict())).toBe(false);
  });
});

describe('warnings', () => {
  const counting = parseGateResponse({
    ...LOCKED_BODY,
    status: 'open',
    locked: false,
    reason: 'within_grace',
    counting: true,
    locks_at: new Date(Date.now() + 36 * 3600_000).toISOString(),
    ms_remaining: 36 * 3600_000,
  });

  it('warns while the window is open and running out', () => {
    expect(shouldWarn(counting)).toBe(true);
    expect(warningCopy(counting)).toMatch(/Growth/);
  });

  it('never warns a paid workspace', () => {
    const paid = parseGateResponse({
      ...LOCKED_BODY,
      status: 'open',
      locked: false,
      reason: 'paid',
      paid: true,
      counting: false,
    });
    expect(shouldWarn(paid)).toBe(false);
    expect(shouldBlock(paid)).toBe(false);
  });

  it('never warns an ungated workspace', () => {
    expect(shouldWarn(openVerdict())).toBe(false);
  });

  it('the countdown is recomputed against the clock, not trusted from the payload', () => {
    // `ms_remaining` is right when it is read and wrong a minute later, and
    // this is a screen people sit and watch.
    const v = parseGateResponse({
      ...LOCKED_BODY,
      status: 'open',
      locked: false,
      counting: true,
      locks_at: '2026-09-02T00:00:00.000Z',
      ms_remaining: 999_999_999,
    });
    const at = new Date('2026-09-01T00:00:00.000Z');
    expect(remainingMs(v, at)).toBe(24 * 3600_000);
  });

  it('a deadline in the past reads as none rather than as a negative', () => {
    const v = parseGateResponse({ ...LOCKED_BODY, status: 'open', locked: false, counting: true });
    expect(remainingMs(v, new Date('2030-01-01T00:00:00.000Z'))).toBe(0);
  });
});

describe('what the customer is told', () => {
  it('never says a payment failed, and never blames the reader', () => {
    for (const reason of ['grace_expired', 'operator_locked'] as const) {
      const v = parseGateResponse({ ...LOCKED_BODY, reason });
      const { headline, body } = lockedCopy(v);
      const text = `${headline} ${body}`.toLowerCase();
      expect(text).not.toMatch(/failed|declined|overdue|suspended for non-?payment|your fault/);
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it('an operator hold is described as a hold, not as an unpaid bill', () => {
    const v = parseGateResponse({ ...LOCKED_BODY, reason: 'operator_locked' });
    expect(lockedCopy(v).headline).toMatch(/hold/i);
  });

  it('promises the data is kept', () => {
    const v = parseGateResponse(LOCKED_BODY);
    expect(lockedCopy(v).body.toLowerCase()).toMatch(/kept|untouched/);
  });
});

describe('formatting', () => {
  it('reads a duration coarsely', () => {
    expect(formatRemaining(72 * 3600_000)).toBe('3 days');
    expect(formatRemaining(50 * 3600_000)).toBe('2 days 2 hours');
    expect(formatRemaining(90 * 60_000)).toBe('1 hour');
    expect(formatRemaining(0)).toBe('none');
    expect(formatRemaining(null)).toBeNull();
  });

  it('formats money in the workspace currency', () => {
    expect(formatMoney(86000, 'AUD')).toContain('860');
    expect(formatMoney(null)).toBeNull();
  });
});

describe('whether paying is what lifts this', () => {
  const gated = (over: Record<string, unknown>) =>
    parseGateResponse({
      ok: true,
      gated: true,
      status: 'locked',
      reason: 'grace_expired',
      locked: true,
      paid: false,
      plan: { slug: 'scale', name: 'Scale', amount_due_cents: 221000, currency: 'AUD' },
      checkout: { pricing_url: 'https://pay.example/' },
      ...over,
    });

  it('offers the payment on the states a payment discharges', () => {
    expect(payingCanUnlock(gated({ reason: 'grace_expired' }))).toBe(true);
    expect(
      payingCanUnlock(gated({ reason: 'within_grace', status: 'open', locked: false })),
    ).toBe(true);
    expect(
      payingCanUnlock(gated({ reason: 'no_deadline', status: 'open', locked: false })),
    ).toBe(true);
  });

  it('never offers it on an operator hold, which a payment cannot lift', () => {
    // Mission Control's resolver reads the override before `paid_at` and
    // settling never clears it, so a payment here is taken and changes
    // nothing. Mission Control refuses to mint that checkout for the same
    // reason; this is the near side of the same rule.
    expect(payingCanUnlock(gated({ reason: 'operator_locked' }))).toBe(false);
  });

  it('never offers it to somebody who has already paid', () => {
    expect(payingCanUnlock(gated({ reason: 'grace_expired', paid: true }))).toBe(false);
  });

  it('fails CLOSED on a reason this build does not know', () => {
    // The rule this replaces was `reason !== "operator_locked"`, which answers
    // yes to every word it has never heard of — including the `unknown` a body
    // we could not read resolves to. That draws a full-width demand for money
    // over a verdict whose whole meaning is that we do not know why.
    expect(payingCanUnlock(gated({ reason: 'something_new_entirely' }))).toBe(false);
    expect(payingCanUnlock(unknownVerdict())).toBe(false);
    expect(payingCanUnlock(openVerdict())).toBe(false);
  });

  it('says so in the copy too — no "complete the payment" without a button', () => {
    expect(lockedCopy(gated({ reason: 'something_new_entirely' })).body).not.toMatch(
      /complete the payment/i,
    );
    expect(lockedCopy(gated({ reason: 'grace_expired' })).body).toMatch(/payment/i);
  });

  it('prompts an unpaid gate that is on no clock at all', () => {
    // `shouldWarn` once required `counting`, so a gate an operator gave no
    // deadline showed no way to pay anywhere in the product.
    const noDeadline = gated({
      reason: 'no_deadline',
      status: 'open',
      locked: false,
      counting: false,
    });
    expect(shouldWarn(noDeadline)).toBe(true);
  });

  it('stops prompting once it is paid or locked', () => {
    expect(shouldWarn(gated({ reason: 'paid', status: 'open', locked: false, paid: true }))).toBe(
      false,
    );
    expect(shouldWarn(gated({ reason: 'grace_expired' }))).toBe(false);
  });
});
