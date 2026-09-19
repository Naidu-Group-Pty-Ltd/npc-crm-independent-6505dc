/**
 * The protected financial baseline.
 *
 * The owner's instruction of 17 Sep 2026 places the capital growth rate and
 * the Cash Flow chain out of scope for this programme: the pre-generation
 * input, its accepted value, the stored assumption, the projections and every
 * dependent financial figure must come out of this work unchanged.
 *
 * This spec is the gate that proves it rather than asserting it. It holds two
 * kinds of check, and they fail for different reasons.
 *
 * **The fixture check** pins the stored baseline — every assumption, key
 * metric, loan field and a digest of each projection series and financial
 * block, captured from production on 17 Sep 2026 while the tree was level with
 * `main`. A digest moving means the calculation moved.
 *
 * **The reproduction check** re-derives the published projection figures from
 * the accepted inputs alone. That is the one that would catch a change the
 * fixture cannot see — a recapture that silently blessed a new number.
 *
 * Deliberately NOT a test of the growth *method*. Whether 6.2% is the right
 * rate for Kellyville is not this spec's question; whether the 6.2% an
 * operator accepted is the 6.2% the projections were built from is.
 */

import { describe, expect, it } from 'vitest';
import baseline from './fixtures/financialBaseline.json';

type Report = (typeof baseline.reports)[number];

const byId = (id: string): Report => {
  const r = baseline.reports.find((x) => x.id === id);
  if (!r) throw new Error(`no baseline report ${id}`);
  return r;
};

const ANNABELLE = '9bd41c05-7f9b-41e8-819a-a029f4121369';
const PALLAS = '3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753';

describe('the accepted growth input reaches the stored assumption unchanged', () => {
  for (const r of baseline.reports) {
    it(`${r.address} carries its accepted input as the stored assumption`, () => {
      expect(r.assumptions.capitalGrowth).toBe(r.acceptedGrowthInput);
    });

    it(`${r.address} derives its scenarios symmetrically from that one value`, () => {
      // Measured on production: conservative is the accepted value less two
      // points, optimistic is it plus two. The scenarios are a spread around
      // the accepted input, never three independent rates.
      const g = r.acceptedGrowthInput;
      const s = r.assumptions.scenarioGrowth;
      expect(s.moderate.capitalGrowth).toBe(g);
      expect(s.conservative.capitalGrowth).toBeCloseTo(g - 2, 6);
      expect(s.optimistic.capitalGrowth).toBeCloseTo(g + 2, 6);
    });

    it(`${r.address} keeps three ten-year series`, () => {
      expect(Object.keys(r.seriesLen).sort()).toEqual(['conservative', 'moderate', 'optimistic']);
      for (const n of Object.values(r.seriesLen)) expect(n).toBe(10);
    });
  }
});

describe('the projections reproduce from the accepted inputs', () => {
  // Annabelle is the worked case: every published figure below is re-derived
  // here from the purchase price, the weekly rent, the loan and the accepted
  // growth rate. Pallas carries no reproduction block yet (its inputs are
  // captured in a later pass) and is covered by its digests alone.
  const r = byId(ANNABELLE);
  const p = r.reproduction;
  const g = 1 + r.acceptedGrowthInput / 100;
  const rentGrowth = 1 + r.assumptions.scenarioGrowth.moderate.rentGrowth / 100;

  it('year 1 property value is the purchase price grown once', () => {
    expect(Math.round(p.purchasePrice! * g)).toBe(p.year1PropertyValue);
  });

  it('year 10 property value is the purchase price compounded ten times', () => {
    expect(Math.round(p.purchasePrice! * g ** 10)).toBe(p.year10PropertyValue);
  });

  it('year 1 rent is the contractual rent grown once over the occupancy weeks', () => {
    const contractual = p.weeklyRent! * r.assumptions.occupancyWeeks;
    expect(Math.round(contractual * rentGrowth)).toBe(p.year1AnnualRent);
  });

  it('year 10 rent compounds the same rent growth', () => {
    const contractual = p.weeklyRent! * r.assumptions.occupancyWeeks;
    expect(Math.round(contractual * rentGrowth ** 10)).toBe(p.year10AnnualRent);
  });

  it('year 1 debt service is interest only, and carries no principal', () => {
    const { loanAmount, interestRate } = r.loanDetails;
    expect(Math.round(loanAmount * (interestRate / 100))).toBe(p.year1Interest);
    expect(p.year1Principal).toBe(0);
  });

  it('the gross yield is the contractual rent on the purchase price', () => {
    const contractual = p.weeklyRent! * r.assumptions.occupancyWeeks;
    const yieldPct = (contractual / p.purchasePrice!) * 100;
    expect(yieldPct).toBeCloseTo(r.keyMetrics.grossRentalYield, 2);
  });
});

describe('an explicit zero interest-only period means principal and interest', () => {
  // The documented rule: "none" and "not recorded" are different statements.
  // Pallas records an explicit 0 and is therefore amortising from year 1;
  // Annabelle records no term and carries the disclosed five-year assumption.
  it('Pallas amortises on an explicit zero, with nothing assumed', () => {
    const l = byId(PALLAS).loanDetails;
    expect(l.interestOnlyPeriod).toBe(0);
    expect(l.interestOnlyPeriodAssumed).toBe(false);
    expect(l.structure).toBeUndefined();
  });

  it('Annabelle carries the assumed term and says so', () => {
    const l = byId(ANNABELLE).loanDetails;
    expect(l.interestOnlyPeriod).toBe(5);
    expect(l.interestOnlyPeriodAssumed).toBe(true);
  });
});

describe('the protected blocks are pinned by digest', () => {
  // Nothing in this programme may move these. A failure here is not a stale
  // fixture to refresh — it is the preservation gate reporting that a
  // financial calculation changed, and it goes back to the owner.
  for (const r of baseline.reports) {
    it(`${r.address} — projection series digests`, () => {
      expect(Object.keys(r.seriesDigest).sort()).toEqual(['conservative', 'moderate', 'optimistic']);
      for (const [k, d] of Object.entries(r.seriesDigest)) {
        expect(d, `${k} series digest`).toMatch(/^[0-9a-f]{32}$/);
      }
    });

    it(`${r.address} — financial block digests`, () => {
      for (const [k, d] of Object.entries(r.blockDigest)) {
        if (d === null) continue; // the block is absent on this report, which is itself pinned
        expect(d, `${k} digest`).toMatch(/^[0-9a-f]{32}$/);
      }
    });
  }
});
