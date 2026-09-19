import { describe, expect, it } from 'vitest';

import {
  AUSTRALIAN_STATES,
  DUTY_SCHEDULES,
  assessAllStaleness,
  assessStaleness,
  calculateStampDuty,
  compareSchedules,
  evaluateScale,
  financialYearOf,
  validateAllSchedules,
  validateSchedule,
  type AustralianState,
  type DutySchedule,
} from '@/utils/stampDutyCalculator';

/**
 * Duty on `value` for an ordinary investor purchase — the shortest path to the
 * general scale, which is what most of the published worked examples quote.
 */
const investorDuty = (state: AustralianState, value: number) =>
  calculateStampDuty({ propertyValue: value, state, intent: 'investor' }).totalDuty;

const occupierDuty = (state: AustralianState, value: number) =>
  calculateStampDuty({ propertyValue: value, state, intent: 'owner_occupier' }).totalDuty;

describe('schedule integrity', () => {
  it('every built-in schedule satisfies its invariants', () => {
    // Reported as a list rather than one assertion per state so a bad edit shows
    // every problem it caused at once instead of only the first.
    expect(validateAllSchedules()).toEqual([]);
  });

  it('covers all eight jurisdictions', () => {
    expect(Object.keys(DUTY_SCHEDULES).sort()).toEqual([...AUSTRALIAN_STATES].sort());
  });

  // The monotonicity check runs with a small tolerance because two published
  // tables really do dip. Both are pinned here so the tolerance is a documented
  // allowance for a known artefact rather than a way of not looking.
  it('tolerates the 48c dip Revenue NSW rounding creates at $103,000', () => {
    const below = evaluateScale(DUTY_SCHEDULES.NSW.general, 102_999);
    const at = evaluateScale(DUTY_SCHEDULES.NSW.general, 103_000);
    expect(below - at).toBeCloseTo(0.48, 2);
    expect(validateSchedule(DUTY_SCHEDULES.NSW)).toEqual([]);
  });

  it("tolerates the ~$13 dip in the ACT's flat band at $1,455,000", () => {
    const below = evaluateScale(DUTY_SCHEDULES.ACT.general, 1_454_999);
    const at = evaluateScale(DUTY_SCHEDULES.ACT.general, 1_455_000);
    expect(below - at).toBeGreaterThan(0);
    expect(below - at).toBeLessThan(20);
    expect(validateSchedule(DUTY_SCHEDULES.ACT)).toEqual([]);
  });

  it('still catches a dip an order of magnitude larger than those artefacts', () => {
    const broken: DutySchedule = {
      ...DUTY_SCHEDULES.NSW,
      premium: undefined,
      general: [
        { from: 0, base: 0, rate: 1.25 },
        { from: 100_000, base: 1_250, rate: 4 },
        // A transposed base: $2,450 where the band beneath reaches $5,250.
        { from: 200_000, base: 2_450, rate: 5 },
      ],
    };
    expect(validateSchedule(broken).some((issue) => issue.message.includes('duty falls'))).toBe(true);
  });

  it('catches a discontinuity introduced into a scale', () => {
    const broken: DutySchedule = {
      ...DUTY_SCHEDULES.SA,
      general: [
        { from: 0, base: 0, rate: 1 },
        // Should be $120 to join up with 1% of $12,000.
        { from: 12_000, base: 999, rate: 2 },
      ],
    };
    const issues = validateSchedule(broken);
    expect(issues.some((issue) => issue.message.includes('discontinuity'))).toBe(true);
  });

  it('catches a scale where duty falls as value rises', () => {
    const broken: DutySchedule = {
      ...DUTY_SCHEDULES.SA,
      general: [
        { from: 0, base: 0, rate: 5 },
        { from: 100_000, mode: 'flat', rate: 1 },
      ],
    };
    expect(validateSchedule(broken).some((issue) => issue.message.includes('duty falls'))).toBe(true);
  });
});

describe('NSW', () => {
  // Revenue NSW 2026-27: $11,602 plus $4.50 per $100 over $387,000.
  it('matches the published general scale', () => {
    expect(investorDuty('NSW', 387_000)).toBe(11_602);
    expect(investorDuty('NSW', 650_000)).toBe(11_602 + Math.round(263_000 * 0.045));
    expect(investorDuty('NSW', 1_290_000)).toBe(52_237);
  });

  it('applies premium property duty above $3,870,000', () => {
    expect(investorDuty('NSW', 3_870_000)).toBe(194_137);
    expect(investorDuty('NSW', 4_000_000)).toBe(194_137 + Math.round(130_000 * 0.07));
  });

  it('is a financial year ahead of the schedule the retired iframe served', () => {
    // The calculatorsonline.com.au embed was still serving 2025-26: $11,152 over
    // a $372,000 threshold and a $3,721,000 premium cut-in. This test exists so
    // that a regression to those figures fails loudly rather than quietly
    // overstating every client's acquisition costs.
    expect(investorDuty('NSW', 650_000)).not.toBe(23_662);
    expect(investorDuty('NSW', 650_000)).toBe(23_437);
  });

  it('exempts a first home buyer to $800k and tapers to $1m', () => {
    expect(calculateStampDuty({
      propertyValue: 800_000, state: 'NSW', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).totalDuty).toBe(0);

    const taper = calculateStampDuty({
      propertyValue: 900_000, state: 'NSW', intent: 'owner_occupier', isFirstHomeBuyer: true,
    });
    expect(taper.fhbConcession).toBeGreaterThan(0);
    expect(taper.totalDuty).toBeGreaterThan(0);
    expect(taper.totalDuty).toBeLessThan(investorDuty('NSW', 900_000));

    expect(calculateStampDuty({
      propertyValue: 1_000_000, state: 'NSW', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).fhbConcession).toBe(0);
  });

  it('uses the vacant land thresholds for land', () => {
    expect(calculateStampDuty({
      propertyValue: 350_000, state: 'NSW', intent: 'owner_occupier',
      category: 'vacant_land', isFirstHomeBuyer: true,
    }).totalDuty).toBe(0);
    expect(calculateStampDuty({
      propertyValue: 450_000, state: 'NSW', intent: 'owner_occupier',
      category: 'vacant_land', isFirstHomeBuyer: true,
    }).fhbConcession).toBe(0);
  });

  it('adds a 9% foreign purchaser surcharge', () => {
    const base = investorDuty('NSW', 1_000_000);
    const foreign = calculateStampDuty({
      propertyValue: 1_000_000, state: 'NSW', intent: 'investor', isForeignBuyer: true,
    });
    expect(foreign.totalDuty).toBe(base + 90_000);
  });
});

describe('VIC', () => {
  it('charges a flat 5.5% between $960k and $2m', () => {
    expect(investorDuty('VIC', 1_000_000)).toBe(55_000);
    expect(investorDuty('VIC', 1_500_000)).toBe(82_500);
  });

  it('steps up rather than down when crossing $960,000', () => {
    // The marginal band reaches $52,670 at $960,000; the flat band charges
    // $52,800. Small, real, and the opposite of what a "premium rate" intuition
    // suggests — worth pinning so nobody "fixes" it.
    expect(investorDuty('VIC', 959_999)).toBe(52_670);
    expect(investorDuty('VIC', 960_000)).toBe(52_800);
  });

  it('applies PPR rates below $550k and general rates above', () => {
    // SRO worked figure: a PPR buyer at $500,000 pays $21,970 against $25,070
    // on the general scale.
    expect(occupierDuty('VIC', 500_000)).toBe(21_970);
    expect(investorDuty('VIC', 500_000)).toBe(25_070);
    // Above the ceiling the concession disappears entirely rather than tapering.
    expect(occupierDuty('VIC', 600_000)).toBe(investorDuty('VIC', 600_000));
  });

  it('exempts a first home buyer to $600k, tapering to $750k', () => {
    expect(calculateStampDuty({
      propertyValue: 600_000, state: 'VIC', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).totalDuty).toBe(0);
    expect(calculateStampDuty({
      propertyValue: 750_000, state: 'VIC', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).fhbConcession).toBe(0);
  });

  it('reduces the dutiable value for an off-the-plan owner-occupier purchase', () => {
    const full = calculateStampDuty({
      propertyValue: 540_000, state: 'VIC', intent: 'owner_occupier', category: 'new',
    });
    const offThePlan = calculateStampDuty({
      propertyValue: 540_000, state: 'VIC', intent: 'owner_occupier', category: 'new',
      offThePlanConstructionFraction: 0.6,
    });
    expect(offThePlan.totalDuty).toBeLessThan(full.totalDuty);
    expect(offThePlan.notes.join(' ')).toContain('off-the-plan');
  });

  it('gives an investor no off-the-plan reduction', () => {
    const investor = calculateStampDuty({
      propertyValue: 540_000, state: 'VIC', intent: 'investor', category: 'new',
      offThePlanConstructionFraction: 0.6,
    });
    expect(investor.totalDuty).toBe(investorDuty('VIC', 540_000));
  });
});

describe('QLD', () => {
  it('matches the published general scale', () => {
    expect(investorDuty('QLD', 5_000)).toBe(0);
    expect(investorDuty('QLD', 540_000)).toBe(17_325);
    expect(investorDuty('QLD', 1_000_000)).toBe(38_025);
  });

  // QRO's own worked examples for the home and first home concessions.
  it('reproduces the QRO worked examples exactly', () => {
    // $850,000 with the home concession only.
    expect(occupierDuty('QLD', 850_000)).toBe(24_100);
    // $700,000 first home: the $17,350 rebate cancels the duty exactly.
    expect(calculateStampDuty({
      propertyValue: 700_000, state: 'QLD', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).totalDuty).toBe(0);
    // $730,000 first home: $18,700 home-concession duty less a $12,145 rebate.
    expect(calculateStampDuty({
      propertyValue: 730_000, state: 'QLD', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).totalDuty).toBe(6_555);
  });

  it('gives no first home rebate at or above $800,000', () => {
    expect(calculateStampDuty({
      propertyValue: 800_000, state: 'QLD', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).fhbConcession).toBe(0);
  });

  it('charges a first home buyer nothing on a new home at any price', () => {
    // Full concession with no value cap, contracts from 1 May 2025.
    for (const price of [750_000, 1_200_000, 3_000_000]) {
      expect(calculateStampDuty({
        propertyValue: price, state: 'QLD', intent: 'owner_occupier',
        category: 'new', isFirstHomeBuyer: true,
      }).totalDuty).toBe(0);
    }
  });
});

describe('WA', () => {
  it('matches the published general scale', () => {
    expect(investorDuty('WA', 120_000)).toBe(2_280);
    expect(investorDuty('WA', 360_000)).toBe(11_115);
    // $28,452.50 at the boundary, published as $28,453.
    expect(investorDuty('WA', 725_000)).toBe(28_453);
  });

  it('meets the general scale exactly at the vacant land FHOR ceiling', () => {
    // Both routes reach $20,140 at $550,000 — the calibration that proves the
    // 20.14 per $100 figure was transcribed correctly.
    expect(investorDuty('WA', 550_000)).toBe(20_140);
    expect(calculateStampDuty({
      propertyValue: 550_000, state: 'WA', intent: 'owner_occupier',
      category: 'vacant_land', isFirstHomeBuyer: true,
    }).totalDuty).toBe(20_140);
  });

  it('exempts a first home buyer to $600k and phases out by $800k', () => {
    expect(calculateStampDuty({
      propertyValue: 600_000, state: 'WA', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).totalDuty).toBe(0);
    expect(calculateStampDuty({
      propertyValue: 850_000, state: 'WA', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).fhbConcession).toBe(0);
  });
});

describe('SA', () => {
  it('includes the $200k–$250k band the old calculator dropped', () => {
    expect(investorDuty('SA', 250_000)).toBe(8_955);
    expect(investorDuty('SA', 300_000)).toBe(11_330);
    expect(investorDuty('SA', 500_000)).toBe(21_330);
  });

  it('gives no relief on an established first home but exempts a new one', () => {
    expect(calculateStampDuty({
      propertyValue: 650_000, state: 'SA', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).fhbConcession).toBe(0);
    expect(calculateStampDuty({
      propertyValue: 1_500_000, state: 'SA', intent: 'owner_occupier',
      category: 'new', isFirstHomeBuyer: true,
    }).totalDuty).toBe(0);
  });
});

describe('TAS', () => {
  it('matches the published scale', () => {
    expect(investorDuty('TAS', 2_000)).toBe(50);
    expect(investorDuty('TAS', 25_000)).toBe(435);
    expect(investorDuty('TAS', 200_000)).toBe(5_935);
    expect(investorDuty('TAS', 725_000)).toBe(27_810);
  });

  it('offers no first home concession now the exemption has expired', () => {
    const result = calculateStampDuty({
      propertyValue: 700_000, state: 'TAS', intent: 'owner_occupier', isFirstHomeBuyer: true,
    });
    expect(result.fhbConcession).toBe(0);
    expect(result.notes.join(' ')).toContain('expired 30 June 2026');
  });
});

describe('NT', () => {
  it('uses the quadratic formula below $525,000', () => {
    // D = (0.06571441 x V^2) + 15V, V in thousands.
    expect(investorDuty('NT', 400_000)).toBe(Math.round(0.06571441 * 400 * 400 + 15 * 400));
    expect(investorDuty('NT', 300_000)).toBe(Math.round(0.06571441 * 300 * 300 + 15 * 300));
  });

  it('joins the flat rate almost exactly at the threshold', () => {
    // $25,987.16 from the formula against 4.95% of $525,000 = $25,987.50.
    expect(Math.abs(investorDuty('NT', 524_999) - investorDuty('NT', 525_000))).toBeLessThanOrEqual(1);
  });

  it('applies the flat rate to the whole value above the threshold', () => {
    expect(investorDuty('NT', 1_000_000)).toBe(49_500);
    expect(investorDuty('NT', 4_000_000)).toBe(230_000);
  });

  it('levies no foreign surcharge', () => {
    expect(calculateStampDuty({
      propertyValue: 1_000_000, state: 'NT', intent: 'investor', isForeignBuyer: true,
    }).foreignSurcharge).toBe(0);
  });
});

describe('ACT', () => {
  it('runs separate owner-occupier and investor schedules', () => {
    expect(occupierDuty('ACT', 260_000)).toBe(728);
    expect(investorDuty('ACT', 200_000)).toBe(2_400);
    expect(occupierDuty('ACT', 750_000)).toBe(19_208);
    expect(investorDuty('ACT', 750_000)).toBe(22_200);
    expect(occupierDuty('ACT', 500_000)).toBeLessThan(investorDuty('ACT', 500_000));
  });

  it('charges a flat 4.54% of the whole value above $1,455,000', () => {
    expect(investorDuty('ACT', 2_000_000)).toBe(90_800);
    expect(occupierDuty('ACT', 2_000_000)).toBe(90_800);
  });

  it('exempts an eligible first home buyer at any price', () => {
    // HBCS from 1 July 2026: no income test, no value cap.
    expect(calculateStampDuty({
      propertyValue: 1_800_000, state: 'ACT', intent: 'owner_occupier', isFirstHomeBuyer: true,
    }).totalDuty).toBe(0);
  });
});

describe('engine behaviour', () => {
  it('returns a zero breakdown for a zero or negative value', () => {
    for (const value of [0, -1, Number.NaN]) {
      const result = calculateStampDuty({ propertyValue: value, state: 'NSW', intent: 'investor' });
      expect(result.totalDuty).toBe(0);
      expect(result.baseDuty).toBe(0);
    }
  });

  it('never returns negative duty however generous the concession', () => {
    for (const state of AUSTRALIAN_STATES) {
      for (const value of [1_000, 300_000, 700_000, 2_500_000]) {
        const result = calculateStampDuty({
          propertyValue: value, state, intent: 'owner_occupier',
          category: 'new', isFirstHomeBuyer: true,
        });
        expect(result.totalDuty).toBeGreaterThanOrEqual(0);
        expect(result.fhbConcession).toBeLessThanOrEqual(result.baseDuty);
      }
    }
  });

  it('ignores a first home flag on an investment purchase', () => {
    const investor = calculateStampDuty({
      propertyValue: 700_000, state: 'NSW', intent: 'investor', isFirstHomeBuyer: true,
    });
    expect(investor.fhbConcession).toBe(0);
  });

  it('reports the schedule year and source so a report can cite them', () => {
    const result = calculateStampDuty({ propertyValue: 800_000, state: 'NSW', intent: 'investor' });
    expect(result.scheduleYear).toBe('2026-27');
    expect(result.sourceUrl).toContain('revenue.nsw.gov.au');
  });

  it('honours a caller-supplied schedule over the built-in one', () => {
    const flat: DutySchedule = {
      ...DUTY_SCHEDULES.NSW,
      year: '2099-00',
      general: [{ from: 0, base: 0, rate: 10 }],
      premium: undefined,
    };
    const result = calculateStampDuty({
      propertyValue: 500_000, state: 'NSW', intent: 'investor', schedule: flat,
    });
    expect(result.totalDuty).toBe(50_000);
    expect(result.scheduleYear).toBe('2099-00');
  });

  it('rises monotonically with price in every jurisdiction', () => {
    for (const state of AUSTRALIAN_STATES) {
      let previous = -1;
      for (let value = 50_000; value <= 5_000_000; value += 50_000) {
        const duty = investorDuty(state, value);
        expect(duty, `${state} at $${value}`).toBeGreaterThanOrEqual(previous);
        previous = duty;
      }
    }
  });
});

describe('staleness', () => {
  it('derives the Australian financial year from a date', () => {
    expect(financialYearOf(new Date('2026-06-30T00:00:00Z'))).toBe('2025-26');
    expect(financialYearOf(new Date('2026-07-01T00:00:00Z'))).toBe('2026-27');
    expect(financialYearOf(new Date('2026-12-31T00:00:00Z'))).toBe('2026-27');
  });

  it('reports no stale schedules for the year they were verified in', () => {
    const stale = assessAllStaleness(new Date('2026-08-10T00:00:00Z')).filter((r) => r.stale);
    expect(stale).toEqual([]);
  });

  it('flags an indexed jurisdiction once the financial year rolls over', () => {
    const report = assessStaleness(DUTY_SCHEDULES.NSW, new Date('2027-07-02T00:00:00Z'));
    expect(report.stale).toBe(true);
    expect(report.message).toContain('re-check');
  });

  it('does not flag a jurisdiction that does not index', () => {
    // Victoria's general rates have stood since 2021; age alone is not staleness.
    expect(assessStaleness(DUTY_SCHEDULES.VIC, new Date('2027-07-02T00:00:00Z')).stale).toBe(false);
  });
});

describe('drift detection', () => {
  it('reports no drift against itself', () => {
    const drift = compareSchedules(DUTY_SCHEDULES.NSW, DUTY_SCHEDULES.NSW);
    expect(drift.maxPercentDelta).toBe(0);
    expect(drift.maxDollarDelta).toBe(0);
  });

  it('measures a plausible indexation as a small movement', () => {
    // The 2025-26 NSW table the retired iframe served, against the current one.
    const previousYear: DutySchedule = {
      ...DUTY_SCHEDULES.NSW,
      year: '2025-26',
      general: [
        { from: 0, base: 0, rate: 1.25, min: 20 },
        { from: 17_000, base: 212, rate: 1.5 },
        { from: 37_000, base: 512, rate: 1.75 },
        { from: 99_000, base: 1_597, rate: 3.5 },
        { from: 372_000, base: 11_152, rate: 4.5 },
        { from: 1_240_000, base: 50_212, rate: 5.5 },
      ],
    };
    const drift = compareSchedules(DUTY_SCHEDULES.NSW, previousYear);
    expect(drift.maxPercentDelta).toBeGreaterThan(0);
    expect(drift.maxPercentDelta).toBeLessThan(5);
  });

  it('measures a misparsed table as a large movement', () => {
    const garbled: DutySchedule = {
      ...DUTY_SCHEDULES.NSW,
      general: [{ from: 0, base: 0, rate: 12 }],
    };
    expect(compareSchedules(DUTY_SCHEDULES.NSW, garbled).maxPercentDelta).toBeGreaterThan(5);
  });
});

describe('scale evaluation', () => {
  it('returns zero below the first band rather than a band minimum', () => {
    expect(evaluateScale(DUTY_SCHEDULES.NSW.general, 0)).toBe(0);
    expect(evaluateScale(DUTY_SCHEDULES.NSW.general, -100)).toBe(0);
  });

  it('applies the NSW $20 minimum to a trivial value', () => {
    expect(evaluateScale(DUTY_SCHEDULES.NSW.general, 100)).toBe(20);
  });
});
