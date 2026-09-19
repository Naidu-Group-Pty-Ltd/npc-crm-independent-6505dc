/**
 * Pins the one writer-side override mapping: overrides that change modelled
 * inputs go INTO the financial engine (everything downstream recomputes);
 * only non-modelled fields are merged onto the result afterwards. Three
 * writers used to splat override values over stored leaves instead, which is
 * how a production row came to carry overridden line items summing $13,578
 * beside a stored totalAnnual of $21,418 and a projection series computed
 * from neither.
 */
import { describe, expect, it } from 'vitest';

import {
  applyDisplayOverrides,
  buildAnnualCostOverrides,
  buildCalculatorInput,
  DISPLAY_OVERRIDE_PATHS,
  MODELLED_OVERRIDE_KEYS,
  overlayOverridesForHistoricRow,
  overridesAffectModel,
  stateFromAddress,
} from '../../../../supabase/functions/_shared/reports/investment/overrides.pure';
import {
  calculateAnnualCosts,
  operatingExpensesFrom,
} from '../../../../supabase/functions/_shared/reports/investment/financialEngine.pure';

/** The captured production row's overrides, as its modal saved them. */
const ACER_OVERRIDES = {
  councilRates: 3150,
  waterRates: 1600,
  buildingLandlordInsurance: 2500,
  propertyManagementFees: 8,
  repairsMaintenance: 2900,
  lettingFees: 739,
  landTax: 0,
  weeklyRent: 739,
  interestRate: 6.5,
  taxRate: 37,
};

const ACER_ROW = {
  property_address: '6 Acer Court, Bowral NSW 2576',
  property_specs: { property_type: 'house' },
  financial_calculations: {
    initialCosts: { propertyValue: 1_190_000, deposit: 238_000 },
    loanDetails: { interestRate: 6.5, monthlyPayment: 6017.29 },
    income: { weeklyRent: 739 },
  },
};

describe('a modelled override never reaches the output by splatting', () => {
  it('the two vocabularies do not overlap', () => {
    // capitalGrowth and cpiGrowthRate are the deliberate exception: they go
    // into the engine AND are recorded under assumptions.* for display —
    // assumptions is an input record, not a computed leaf.
    const RECORDED_ASSUMPTIONS = new Set(['capitalGrowth', 'cpiGrowthRate']);
    for (const key of MODELLED_OVERRIDE_KEYS) {
      if (RECORDED_ASSUMPTIONS.has(key)) {
        expect(DISPLAY_OVERRIDE_PATHS[key]).toMatch(/^assumptions\./);
        continue;
      }
      expect(DISPLAY_OVERRIDE_PATHS[key], `${key} must not also be a display splat`).toBeUndefined();
    }
  });

  it('display paths never touch a computed leaf', () => {
    for (const path of Object.values(DISPLAY_OVERRIDE_PATHS)) {
      expect(path).not.toMatch(/^annualCosts\./);
      expect(path).not.toMatch(/^projections/);
      expect(path).not.toMatch(/totalUpfront|totalAnnual|cashOnCash|annualNet|weeklyNet/);
    }
  });
});

describe('calculateAnnualCosts with reviewed figures as input', () => {
  const costs = calculateAnnualCosts(1_190_000, 739, 'NSW', 'house', buildAnnualCostOverrides(ACER_OVERRIDES));

  it('every line is the reviewed figure, and the totals foot against them', () => {
    expect(costs.councilRates).toBe(3150);
    expect(costs.waterRates).toBe(1600);
    expect(costs.landlordInsurance).toBe(2500);
    expect(costs.maintenance).toBe(2900);
    expect(costs.landTax).toBe(0); // explicit reviewed $0, not the $6,525 formula
    expect((costs as any).lettingFees).toBe(739);
    // Management recomputes from the overridden percentage.
    expect(costs.propertyManagementPercent).toBe(8);
    expect(costs.propertyManagement).toBe(Math.floor(739 * 52 * 0.08));
    const items = costs.councilRates + costs.waterRates + costs.landlordInsurance
      + costs.propertyManagement + costs.maintenance + costs.strataFees + costs.landTax + 739;
    expect(costs.totalAnnual).toBe(items);
    expect(costs.totalAnnualExcludingLandTax).toBe(items - costs.landTax);
    expect(operatingExpensesFrom(costs)).toBe(costs.totalAnnual);
  });

  it('an absent override falls back to the formula; letting fees have no formula', () => {
    const plain = calculateAnnualCosts(1_190_000, 739, 'NSW', 'house');
    expect(plain.councilRates).toBe(Math.floor(1_190_000 * 0.008));
    expect(plain.landTax).toBe(6_525);
    expect('lettingFees' in plain).toBe(false);
    expect(plain.totalAnnual).toBe(plain.totalAnnualExcludingLandTax + plain.landTax);
  });
});

describe('buildCalculatorInput', () => {
  it('builds a complete input from the stored row plus overrides', () => {
    const build = buildCalculatorInput(ACER_OVERRIDES, ACER_ROW);
    expect(build.ok).toBe(true);
    expect(build.input).toMatchObject({
      propertyValue: 1_190_000,
      deposit: 238_000,
      weeklyRent: 739,
      state: 'NSW',
      propertyType: 'house',
      loanTerm: 30,
      interestRate: 6.5,
    });
    expect(build.input?.annualCostOverrides).toMatchObject({
      councilRates: 3150,
      landTax: 0,
      lettingFees: 739,
      propertyManagementPercent: 8,
    });
  });

  it('override beats stored value; lvr derives the deposit when no explicit one exists', () => {
    const build = buildCalculatorInput(
      { purchasePrice: 1_000_000, loanToValueRatio: 90, weeklyRent: 500 },
      { property_address: '1 Test St, Carlton VIC 3053' },
    );
    expect(build.ok).toBe(true);
    expect(build.input?.propertyValue).toBe(1_000_000);
    expect(build.input?.deposit).toBe(100_000);
    expect(build.input?.state).toBe('VIC');
  });

  it('refuses rather than guesses when a load-bearing input is missing', () => {
    const noRent = buildCalculatorInput({}, {
      property_address: '1 Test St, Carlton VIC 3053',
      financial_calculations: { initialCosts: { propertyValue: 800_000, deposit: 160_000 } },
    });
    expect(noRent.ok).toBe(false);
    expect(noRent.missing).toContain('weeklyRent');

    const noState = buildCalculatorInput({ weeklyRent: 500, purchasePrice: 800_000 }, {});
    expect(noState.ok).toBe(false);
    expect(noState.missing).toContain('state');
  });

  it('reads the state from the address, last occurrence winning', () => {
    expect(stateFromAddress('6 Acer Court, Bowral NSW 2576')).toBe('NSW');
    expect(stateFromAddress('12 Wagga St, Wagga Wagga NSW 2650')).toBe('NSW');
    expect(stateFromAddress('1 Vic Ave, Broadbeach QLD 4218')).toBe('QLD');
    expect(stateFromAddress(undefined)).toBeUndefined();
  });
});

describe('applyDisplayOverrides', () => {
  it('merges only non-modelled leaves and never mutates the input', () => {
    const fin = { annualCosts: { councilRates: 9_520, totalAnnual: 21_418 }, keyMetrics: { lvr: 80 } };
    const snapshot = JSON.parse(JSON.stringify(fin));
    const out = applyDisplayOverrides(fin, { ...ACER_OVERRIDES, taxRate: 37, occupancyRate: 50 });
    expect(fin).toEqual(snapshot);
    // The reviewed council rate does NOT splat here — it went into the engine.
    expect(out.annualCosts.councilRates).toBe(9_520);
    expect(out.taxBenefits.marginalTaxRate).toBe(37);
    expect(out.assumptions.occupancyWeeks).toBe(50);
  });

  it('skips empty values', () => {
    const out = applyDisplayOverrides({}, { taxRate: '', loanType: null, depreciation: undefined });
    expect(out).toEqual({});
  });
});

describe('overlayOverridesForHistoricRow', () => {
  it('splats the modelled leaves a pre-recompute row needs, then the display leaves', () => {
    const fin = {
      initialCosts: { propertyValue: 700_000, stampDuty: 27_000 },
      income: { weeklyRent: 650 },
      annualCosts: { councilRates: 2_000, totalAnnual: 18_000 },
    };
    const snapshot = JSON.parse(JSON.stringify(fin));
    const out = overlayOverridesForHistoricRow(fin, {
      purchasePrice: 750_000,
      weeklyRent: 700,
      councilRates: 3_150,
      taxRate: 37,
      cpiGrowthRate: 2.5,
    });
    expect(fin).toEqual(snapshot);
    expect(out.initialCosts.propertyValue).toBe(750_000);
    expect(out.income.weeklyRent).toBe(700);
    expect(out.annualCosts.councilRates).toBe(3_150);
    // Display vocabulary applies on top — both spellings of the CPI override
    // land, because the browser generator and the assumptions block read
    // different paths and a historic row must satisfy them both.
    expect(out.taxBenefits.marginalTaxRate).toBe(37);
    expect(out.cashFlow.cpiGrowthRate).toBe(2.5);
    expect(out.assumptions.cpiGrowth).toBe(2.5);
    // Derived figures deliberately stay as stored: the overlay is a display
    // compromise for historic rows, never a recompute.
    expect(out.annualCosts.totalAnnual).toBe(18_000);
    expect(out.initialCosts.stampDuty).toBe(27_000);
  });

  it('is the identity on a row with no overrides — which is every current row', () => {
    const fin = { keyMetrics: { lvr: 80 } };
    expect(overlayOverridesForHistoricRow(fin, undefined)).toBe(fin);
    expect(overlayOverridesForHistoricRow(fin, {})).toBe(fin);
  });

  it('skips empty values like the display splat does', () => {
    const out = overlayOverridesForHistoricRow({}, { purchasePrice: '', weeklyRent: null });
    expect(out).toEqual({});
  });
});

describe('overridesAffectModel', () => {
  it('gates the recompute on modelled keys only', () => {
    expect(overridesAffectModel({ taxRate: 37, loanType: 'io' })).toBe(false);
    expect(overridesAffectModel({ councilRates: 3150 })).toBe(true);
    expect(overridesAffectModel({ weeklyRent: 739 })).toBe(true);
    expect(overridesAffectModel({})).toBe(false);
    expect(overridesAffectModel(null)).toBe(false);
    expect(overridesAffectModel({ councilRates: '' })).toBe(false);
  });
});
