import { describe, expect, it } from 'vitest';
import {
  ASSUMED_INTEREST_ONLY_YEARS,
  describeAssumedInputs,
  evidenceBasisNotes,
  landBuildSplit,
  missingInputsOf,
  readBaseFinancials,
} from '../readBaseFinancials';

/**
 * The 10-year cash flow reads the case the calculator wrote, where it wrote it.
 *
 * The fixture is the shape `financial-calculator-service` persists — nested
 * under `income`, `annualCosts`, `initialCosts`, `loanDetails`, `assumptions`
 * and `taxBenefits` — carrying the figures of 291 Stone Mason Drive as the
 * audit recorded them (QA-291SM-20260915). Before this, every one of those
 * paths was read FLAT and fell through to 0 or a default: no rent, no costs,
 * no duty, 5.5% instead of 6.5%, 52 weeks instead of 50 (QA-01, QA-02, QA-03).
 */
const STONE_MASON = {
  financial_calculations: {
    initialCosts: {
      propertyValue: 1_299_000,
      deposit: 259_800,
      loanAmount: 1_039_200,
      stampDuty: 52_732,
      lmi: 0,
      legalFees: 1_800,
      inspectionFees: 500,
      totalUpfront: 314_832,
    },
    loanDetails: { monthlyPayment: 6_568.45, lvr: 80, interestRate: 6.5, loanTerm: 30 },
    income: { weeklyRent: 900, annualRent: 46_800 },
    annualCosts: {
      councilRates: 1_800, waterRates: 1_100, landlordInsurance: 2_200, propertyManagement: 3_510,
      maintenance: 4_500, strataFees: 2_400, landTax: 0, lettingFees: 900,
      totalAnnual: 16_410, totalAnnualExcludingLandTax: 16_410,
    },
    assumptions: { capitalGrowth: 5, cpiGrowth: 2.5, occupancyWeeks: 50 },
    taxBenefits: { depreciation: 10_000 },
  },
  manual_overrides: {},
};

describe('readBaseFinancials — the record is read where the calculator writes it', () => {
  const base = readBaseFinancials(STONE_MASON, 2026);

  it('resolves rent, every holding cost and the acquisition costs from the nested record (QA-01, QA-03)', () => {
    expect(base.weeklyRent).toBe(900);
    expect(base.councilRates).toBe(1_800);
    expect(base.waterRates).toBe(1_100);
    expect(base.buildingLandlordInsurance).toBe(2_200);
    expect(base.repairsMaintenance).toBe(4_500);
    expect(base.bodyCorporateFees).toBe(2_400);
    expect(base.lettingFees).toBe(900);
    expect(base.landTax).toBe(0);
    expect(base.stampDuty).toBe(52_732);
    expect(base.solicitorFees).toBe(1_800);
    expect(base.inspectionFees).toBe(500);
    expect(base.depositValue).toBe(259_800);
    expect(base.loanAmount).toBe(1_039_200);
    expect(base.depositValue + base.stampDuty + base.solicitorFees + base.inspectionFees + base.lmiAmount).toBe(314_832);
  });

  it('runs the same scenario the sibling report ran (QA-02): rate, fee, occupancy, depreciation, product', () => {
    expect(base.interestRate).toBe(6.5);
    expect(base.propertyManagementFees).toBe(7.5);
    expect(base.occupancyRate).toBe(50);
    expect(base.depreciation).toBe(10_000);
    expect(base.loanTermYears).toBe(30);
    expect(base.loanType).toBe('principal_interest');
    expect(base.interestOnlyPeriodYears).toBe(0);
    for (const field of ['weeklyRent', 'interestRate', 'propertyManagementFees', 'occupancyRate', 'depreciation', 'stampDuty']) {
      expect(base.provenance[field], field).toBe('record');
    }
    expect(base.missingInputs).toEqual([]);
  });

  it('says which inputs were defaulted, and only those', () => {
    expect(base.provenance.taxRate).toBe('default');
    expect(base.assumedInputs).toContain('taxRate');
    expect(base.assumedInputs).not.toContain('interestRate');
    expect(describeAssumedInputs(base)).toContain('marginal tax rate 30%');
  });

  it('never defaults the build price to the purchase price (QA-13)', () => {
    expect(base.buildPrice).toBe(0);
    expect(base.provenance.buildPrice).toBe('absent');
    expect(landBuildSplit(base)).toEqual({ landPrice: null, buildPrice: null, derived: false });
    expect(landBuildSplit({ purchasePrice: 900_000, landPrice: 400_000, buildPrice: 0 }))
      .toEqual({ landPrice: 400_000, buildPrice: 500_000, derived: true });
    expect(landBuildSplit({ purchasePrice: 900_000, landPrice: 400_000, buildPrice: 450_000 }))
      .toEqual({ landPrice: 400_000, buildPrice: 450_000, derived: false });
  });

  it('stamps a fingerprint that moves with the inputs and not otherwise', () => {
    const again = readBaseFinancials(STONE_MASON, 2026);
    expect(again.caseFingerprint).toBe(base.caseFingerprint);
    expect(base.caseFingerprint).toMatch(/^[0-9a-f]{8}$/);
    const moved = readBaseFinancials({ ...STONE_MASON, manual_overrides: { interestRate: 5.5 } }, 2026);
    expect(moved.caseFingerprint).not.toBe(base.caseFingerprint);
    expect(moved.provenance.interestRate).toBe('override');
  });

  it('reports a projection with no rent or no cost base as incomplete rather than running it at zero (QA-01)', () => {
    const noRent = readBaseFinancials({
      financial_calculations: { initialCosts: { propertyValue: 1_299_000 }, annualCosts: { councilRates: 1_800 } },
    }, 2026);
    expect(noRent.weeklyRent).toBe(0);
    expect(noRent.provenance.weeklyRent).toBe('absent');
    expect(noRent.missingInputs).toContain('weeklyRent');
    expect(noRent.missingInputs).not.toContain('holdingCosts');

    const noCosts = readBaseFinancials({
      financial_calculations: { initialCosts: { propertyValue: 1_299_000 }, income: { weeklyRent: 900 } },
    }, 2026);
    expect(noCosts.missingInputs).toEqual(['holdingCosts']);
    expect(missingInputsOf({ purchasePrice: 0, weeklyRent: 900 }, { purchasePrice: 'absent' })).toContain('purchasePrice');
  });

  it('an interest-only loan stated without a period gets a disclosed one, never P&I under an IO label (QA-04)', () => {
    const io = readBaseFinancials({ ...STONE_MASON, manual_overrides: { loanType: 'interest_only' } }, 2026);
    expect(io.loanType).toBe('interest_only');
    expect(io.interestOnlyPeriodYears).toBe(ASSUMED_INTEREST_ONLY_YEARS);
    expect(io.provenance.interestOnlyPeriodYears).toBe('default');
    expect(describeAssumedInputs(io)).toContain(`interest-only period ${ASSUMED_INTEREST_ONLY_YEARS} years`);
    const stated = readBaseFinancials({ ...STONE_MASON, manual_overrides: { loanType: 'interest_only', interestOnlyPeriodYears: 3 } }, 2026);
    expect(stated.interestOnlyPeriodYears).toBe(3);
    expect(stated.provenance.interestOnlyPeriodYears).toBe('override');
  });

  it('keeps the legacy flat keys a hand-saved row may carry, after the record', () => {
    const legacy = readBaseFinancials({
      financial_calculations: { purchasePrice: 500_000, weeklyRent: 450, stampDuty: 17_000, councilRates: 1_500, interestRate: 6.1 },
    }, 2026);
    expect(legacy.purchasePrice).toBe(500_000);
    expect(legacy.weeklyRent).toBe(450);
    expect(legacy.stampDuty).toBe(17_000);
    expect(legacy.interestRate).toBe(6.1);
    expect(legacy.provenance.weeklyRent).toBe('legacy');
  });

  it('an override outranks the record', () => {
    const o = readBaseFinancials({ ...STONE_MASON, manual_overrides: { weeklyRent: 950, occupancyRate: 52 } }, 2026);
    expect(o.weeklyRent).toBe(950);
    expect(o.occupancyRate).toBe(52);
    expect(o.provenance.weeklyRent).toBe('override');
  });
});

describe('evidenceBasisNotes (QA-12, QA-14, QA-15)', () => {
  it('says what the tax, land-tax and cost lines rest on', () => {
    const base = readBaseFinancials(STONE_MASON as never, 2026);
    const notes = evidenceBasisNotes(base);
    expect(notes.some((n) => /Tax effects assume deductions are utilised at a \d+% marginal rate/.test(n))).toBe(true);
    expect(notes.some((n) => /land tax/i.test(n) && /aggregate taxable landholdings/.test(n))).toBe(true);
    expect(notes.some((n) => /Operating costs are .*not quotes or bills/.test(n))).toBe(true);
  });
  it('never calls a missing land-tax figure a finding of none payable', () => {
    const base = readBaseFinancials(STONE_MASON as never, 2026);
    const notes = evidenceBasisNotes({ ...base, landTax: 0, provenance: { ...base.provenance, landTax: 'absent' } });
    expect(notes.find((n) => /land tax/i.test(n))).toContain('not a finding that none is payable');
  });
});

