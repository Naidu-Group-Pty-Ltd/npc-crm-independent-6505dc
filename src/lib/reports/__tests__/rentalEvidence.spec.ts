/**
 * The rent a report may quote, and what it prints when there isn't one.
 *
 * The adoption-safety block is the important one. This rule replaces an
 * expression that ran on every investment report ever generated, so the bar is
 * not "the new behaviour is better" — it is "a report that has rental evidence
 * resolves to exactly the number it resolved to before". Those cases are
 * written against the old expression rather than against an idea of it.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OCCUPANCY_WEEKS,
  NOT_ESTABLISHED,
  absentRentDirective,
  resolveRentalEvidence,
  statedMoney,
  statedWeeklyRent,
  statedYield,
} from '../investment/rentalEvidence.pure';

// The expression this replaces, verbatim from the generator:
//   effectiveWeeklyRent = mergedOverrides.weeklyRent || propertyDetails?.weeklyRent || 0
//   annualRentIncome    = effectiveWeeklyRent * effectiveOccupancyRate
const legacyWeeklyRent = (ov: unknown, listing: unknown): number =>
  (ov as number) || (listing as number) || 0;

describe('adoption safety — a report with rental evidence is unchanged', () => {
  const cases: Array<{ ov?: unknown; listing?: unknown; weeks?: unknown }> = [
    { ov: 650 },
    { listing: 480 },
    { ov: 1200, listing: 900 },
    { ov: '725', listing: 400 },
    { listing: '395' },
    { ov: 650, weeks: 50 },
    { ov: 650, weeks: 48 },
    { listing: 812.5 },
  ];

  it.each(cases)('renders the same weekly rent as the old expression (%o)', (c) => {
    const evidence = resolveRentalEvidence({
      overrideWeeklyRent: c.ov, listingWeeklyRent: c.listing, occupancyWeeks: c.weeks,
    });
    // The contract is what reaches the page. The old expression passed a
    // STRING straight through where the override carried one, so comparing
    // types would pin an accident; comparing the interpolated text pins the
    // document.
    expect(`$${evidence.weeklyRent}`).toBe(`$${legacyWeeklyRent(c.ov, c.listing)}`);
    expect(evidence.established).toBe(true);
  });

  it('coerces a string rent to a number, which the old expression did not', () => {
    // `effectiveWeeklyRent || 0` passed '395' through, and the rental range
    // line did `(effectiveWeeklyRent || 0) + 50` — string concatenation, so
    // the upper bound printed as $39550. Measured: all 185 stored weeklyRent
    // overrides are JSON numbers and no stored report shows the artefact, so
    // this closes a latent bug rather than changing an observed document.
    const evidence = resolveRentalEvidence({ overrideWeeklyRent: '395' });
    expect(evidence.weeklyRent).toBe(395);
    expect(evidence.weeklyRent! + 50).toBe(445);
  });

  it.each(cases)('produces the same annual rent as the old expression (%o)', (c) => {
    const evidence = resolveRentalEvidence({
      overrideWeeklyRent: c.ov, listingWeeklyRent: c.listing, occupancyWeeks: c.weeks,
    });
    const weeks = (c.weeks as number) || DEFAULT_OCCUPANCY_WEEKS;
    expect(evidence.annualRent).toBeCloseTo(Number(legacyWeeklyRent(c.ov, c.listing)) * weeks, 2);
  });

  it('an override beats the listing, and the listing beats the lookup', () => {
    expect(resolveRentalEvidence({
      overrideWeeklyRent: 700, listingWeeklyRent: 600, calculatedWeeklyRent: 500,
    })).toMatchObject({ weeklyRent: 700, source: 'override' });
    expect(resolveRentalEvidence({
      listingWeeklyRent: 600, calculatedWeeklyRent: 500,
    })).toMatchObject({ weeklyRent: 600, source: 'listing' });
  });

  it('defaults to 52 weeks, the assumption the prompt states', () => {
    expect(resolveRentalEvidence({ overrideWeeklyRent: 650 }).occupancyWeeks).toBe(52);
    expect(DEFAULT_OCCUPANCY_WEEKS).toBe(52);
  });
});

describe('the defect: a rent the document could not see', () => {
  it('reaches the market lookup, which the old expression could not', () => {
    // `effectiveWeeklyRent` knew only what a person typed. The looked-up rent
    // landed in `financials.income.weeklyRent`, in a scope the prompt could
    // not read — so the document said 0.00% while the projections beside it
    // were built on a real rent. 83 stored reports carry that.
    const evidence = resolveRentalEvidence({ calculatedWeeklyRent: 545 });
    expect(evidence).toMatchObject({ weeklyRent: 545, source: 'market_lookup', established: true });
    expect(evidence.annualRent).toBe(545 * 52);
    expect(legacyWeeklyRent(undefined, undefined)).toBe(0); // what the old code saw
  });
});

describe('absent, not zero', () => {
  it('reports no rent as absent rather than as zero', () => {
    const evidence = resolveRentalEvidence({});
    expect(evidence).toMatchObject({ weeklyRent: null, annualRent: null, source: 'none', established: false });
  });

  it('treats every flavour of "not captured" as absent', () => {
    for (const empty of [0, '0', '', null, undefined, NaN, 'n/a', -50, {}, []]) {
      expect(resolveRentalEvidence({
        overrideWeeklyRent: empty, listingWeeklyRent: empty, calculatedWeeklyRent: empty,
      }).established).toBe(false);
    }
  });

  it('keeps the occupancy assumption even with no rent', () => {
    // The reader is still told what the model would have assumed; only the
    // figure derived from a rent goes away.
    expect(resolveRentalEvidence({ occupancyWeeks: 50 }).occupancyWeeks).toBe(50);
  });
});

describe('what a reader is shown', () => {
  it('puts the percent sign inside the formatter, so null cannot print "null%"', () => {
    expect(statedYield('4.83')).toBe('4.83%');
    expect(statedYield(4.83)).toBe('4.83%');
    expect(statedYield('-1.73')).toBe('-1.73%');
    expect(statedYield(null)).toBe(NOT_ESTABLISHED);
    expect(statedYield(undefined)).toBe(NOT_ESTABLISHED);
    expect(statedYield(null)).not.toContain('%');
    expect(statedYield(null)).not.toContain('0.00');
  });

  it('never renders an absent figure as a number', () => {
    expect(statedMoney(null)).toBe(NOT_ESTABLISHED);
    expect(statedMoney(33_800)).toBe('$33,800');
    expect(statedWeeklyRent(resolveRentalEvidence({}))).toBe(NOT_ESTABLISHED);
    expect(statedWeeklyRent(resolveRentalEvidence({ overrideWeeklyRent: 650 }))).toBe('$650');
  });

  it('a zero yield is still sayable when it is a real measurement', () => {
    // The rule is about ABSENCE, not about the digit. Nothing here should stop
    // a genuine 0.00% (or a negative net yield) being printed.
    expect(statedYield('0.00')).toBe('0.00%');
    expect(statedYield(0)).toBe('0%');
  });
});

describe('the directive that has to travel with an absent yield', () => {
  it('says nothing at all when a rent was established', () => {
    expect(absentRentDirective(resolveRentalEvidence({ overrideWeeklyRent: 650 }))).toBe('');
  });

  it('forbids the model estimating one, and says what to write instead', () => {
    const directive = absentRentDirective(resolveRentalEvidence({}));
    expect(directive).toContain('NO RENTAL EVIDENCE');
    expect(directive).toMatch(/do NOT estimate/i);
    expect(directive).toContain(NOT_ESTABLISHED);
    // A prohibition with no permitted action is one a model routes around, so
    // the qualitative discussion is explicitly still allowed.
    expect(directive).toMatch(/qualitatively/i);
  });

  it('contains no number that could be read as a rent or a yield', () => {
    const directive = absentRentDirective(resolveRentalEvidence({}));
    expect(directive).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(directive).not.toMatch(/\$\s*\d/);
  });
});
