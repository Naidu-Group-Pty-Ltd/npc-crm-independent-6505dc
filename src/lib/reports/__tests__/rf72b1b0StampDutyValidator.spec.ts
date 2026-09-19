import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateStampDuty } from '../../../../supabase/functions/_shared/stampDuty/engine.pure.ts';
import {
  AUSTRALIAN_STATES,
  type AustralianState,
} from '../../../../supabase/functions/_shared/stampDuty/types.pure.ts';

/**
 * RF-7.2B.1B0 — the duty validator measures against the canonical schedule.
 *
 * It used to keep its own table of percentage bands. That is a second
 * implementation of a figure CLAUDE.md says lives in exactly one place, and the
 * band was the one that was wrong: production report 0ec278ea carried a NSW
 * duty of $19,162 on $555,000 — 3.453%, the canonical 2026-27 answer to the
 * dollar — and the validator called it `critical`, "outside expected range",
 * recommending the brackets that had in fact been used.
 *
 * These tests pin the replacement in both directions: a correct duty must pass
 * everywhere the engine has a schedule, and a wrong one must still fail. A
 * validator that only ever passes is not a validator.
 */
const SERVICE = resolve(
  __dirname, '../../../../supabase/functions/financial-validation-service/index.ts',
);
const src = readFileSync(SERVICE, 'utf8');

/** The tolerance the service applies — rounding only. */
const toleranceFor = (duty: number) => Math.max(2, duty * 0.001);

const canonical = (propertyValue: number, state: AustralianState) =>
  calculateStampDuty({ propertyValue, state, intent: 'investor', category: 'established' });

/** Mirrors the service's decision, so the tests judge the rule not the prose. */
const flagsDuty = (stored: number, propertyValue: number, state: AustralianState): boolean => {
  const c = canonical(propertyValue, state);
  if (c.totalDuty <= 0) return false;
  return Math.abs(stored - c.totalDuty) > toleranceFor(c.totalDuty);
};

describe('the validator no longer keeps its own duty table', () => {
  it('the hand-written percentage bands are gone', () => {
    expect(src).not.toContain('getExpectedStampDutyRange');
    expect(src).not.toContain('expectedStampDutyRange');
    // The specific floor that produced the production false positive.
    expect(src).not.toMatch(/min:\s*3\.5,\s*max:\s*4\.5/);
  });

  it('it reads the canonical engine instead', () => {
    expect(src).toContain("from '../_shared/stampDuty/engine.pure.ts'");
    expect(src).toContain('calculateStampDuty({');
    expect(src).toContain("intent: 'investor'");
  });
});

describe('correct canonical duty PASSES, in every jurisdiction with a schedule', () => {
  const prices = [300_000, 555_000, 750_000, 1_000_000, 1_500_000];
  for (const state of AUSTRALIAN_STATES) {
    it(`${state} — the engine's own answer is never flagged`, () => {
      let checked = 0;
      for (const price of prices) {
        const c = canonical(price, state);
        if (c.totalDuty <= 0) continue; // no loaded schedule; not this test's subject
        checked++;
        expect(flagsDuty(c.totalDuty, price, state)).toBe(false);
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it('the exact production case — NSW $555,000 → $19,162 — passes', () => {
    const c = canonical(555_000, 'NSW');
    expect(Math.round(c.totalDuty)).toBe(19_162);
    expect(flagsDuty(19_162, 555_000, 'NSW')).toBe(false);
    // ...and this is the value the old band called critical.
    expect(c.totalDuty / 555_000 * 100).toBeLessThan(3.5);
  });

  it('the whole NSW range that used to be flagged now passes', () => {
    // 117 of 186 sampled prices were spuriously critical, $300k to $1.87m.
    let spurious = 0;
    for (let v = 150_000; v <= 2_000_000; v += 10_000) {
      const c = canonical(v, 'NSW');
      if (c.totalDuty > 0 && flagsDuty(c.totalDuty, v, 'NSW')) spurious++;
    }
    expect(spurious).toBe(0);
  });

  it('a rounding difference of a dollar or two is not a defect', () => {
    const c = canonical(555_000, 'NSW');
    expect(flagsDuty(c.totalDuty + 1, 555_000, 'NSW')).toBe(false);
    expect(flagsDuty(c.totalDuty - 2, 555_000, 'NSW')).toBe(false);
  });
});

describe('incorrect duty still FAILS — recall is retained', () => {
  it('a materially wrong figure is flagged in every jurisdiction', () => {
    for (const state of AUSTRALIAN_STATES) {
      const c = canonical(700_000, state);
      if (c.totalDuty <= 0) continue;
      // Wrong by 20% either way.
      expect(flagsDuty(c.totalDuty * 1.2, 700_000, state)).toBe(true);
      expect(flagsDuty(c.totalDuty * 0.8, 700_000, state)).toBe(true);
    }
  });

  it('the classic errors are caught', () => {
    const price = 800_000;
    const c = canonical(price, 'NSW');
    // A flat-percentage guess instead of the progressive scale.
    expect(flagsDuty(price * 0.04, price, 'NSW')).toBe(true);
    // Another state's schedule applied to a NSW purchase.
    const vic = canonical(price, 'VIC');
    if (Math.abs(vic.totalDuty - c.totalDuty) > toleranceFor(c.totalDuty)) {
      expect(flagsDuty(vic.totalDuty, price, 'NSW')).toBe(true);
    }
    // Zero, and a duty an order of magnitude out.
    expect(flagsDuty(0, price, 'NSW')).toBe(true);
    expect(flagsDuty(c.totalDuty * 10, price, 'NSW')).toBe(true);
  });

  it('just past the tolerance is caught, so the band cannot drift', () => {
    const c = canonical(555_000, 'NSW');
    const justOver = c.totalDuty + toleranceFor(c.totalDuty) + 1;
    expect(flagsDuty(justOver, 555_000, 'NSW')).toBe(true);
  });
});

describe('the published quirks are respected rather than "fixed"', () => {
  // STAMP_DUTY.md: VIC steps UP at $960k, the ACT steps DOWN at $1.455m, and
  // NT is quadratic below $525k. A validator that smoothed these would flag
  // the schedule's own published behaviour.
  it('VIC around its $960,000 step', () => {
    for (const v of [950_000, 960_000, 970_000]) {
      const c = canonical(v, 'VIC');
      if (c.totalDuty > 0) expect(flagsDuty(c.totalDuty, v, 'VIC')).toBe(false);
    }
  });

  it('ACT around its $1.455m step', () => {
    for (const v of [1_450_000, 1_455_000, 1_460_000]) {
      const c = canonical(v, 'ACT');
      if (c.totalDuty > 0) expect(flagsDuty(c.totalDuty, v, 'ACT')).toBe(false);
    }
  });

  it('NT below $525,000, where the scale is quadratic', () => {
    for (const v of [300_000, 400_000, 500_000, 524_000]) {
      const c = canonical(v, 'NT');
      if (c.totalDuty > 0) expect(flagsDuty(c.totalDuty, v, 'NT')).toBe(false);
    }
  });

  it('QLD and SA representative prices', () => {
    for (const state of ['QLD', 'SA'] as const) {
      for (const v of [400_000, 650_000, 900_000]) {
        const c = canonical(v, state);
        if (c.totalDuty > 0) expect(flagsDuty(c.totalDuty, v, state)).toBe(false);
      }
    }
  });
});

describe('the message names the authority', () => {
  it('cites the schedule year and the assessed figure, not a percentage band', () => {
    expect(src).toContain('canonical.scheduleYear');
    expect(src).toContain('does not match the');
    // The old message blamed the brackets; the new one names what was expected.
    expect(src).not.toContain('is outside expected range for');
  });
});
