/**
 * The 10 Year Cash Flow projection.
 *
 * The fixture is shaped from the live `investment_reports.financial_calculations`
 * across all 162 reports that store a projection: three scenarios, ten years,
 * the same eight numeric fields on every element, whole-number percent rates,
 * `interest_only` as the only stored `loanType`. Only the values are invented.
 *
 * Most of what this file asserts is what the projection **refuses** to publish.
 * That is the whole design: four figures in this record contradict the series
 * they would be printed beside, and the failure they cause is a document that
 * disagrees with itself rather than one that looks broken.
 */
import { describe, it, expect } from 'vitest';
import {
  projectCashFlow,
  applyCashFlowProjection,
  DEFAULT_SCENARIO,
  SCENARIOS,
  PROJECTION_YEARS,
} from '../../../../supabase/functions/_shared/cashFlowProjection.pure';
import { getAdapter, supportsProduction } from '../adapters';

const VALUE = 1285000;
const LOAN = 1028000;

function series(growth: number, from = 0) {
  let cumulative = 0;
  return Array.from({ length: PROJECTION_YEARS }, (_, i) => {
    const year = i + 1;
    const propertyValue = Math.round(VALUE * growth ** year);
    const loanBalance = Math.round(LOAN * (1 - 0.0114 * year));
    const cashFlow = -37816 - from * 100 + i * 400;
    cumulative += cashFlow;
    return {
      year,
      propertyValue,
      loanBalance,
      equity: propertyValue - loanBalance,
      annualRent: Math.round(47840 * 1.031 ** i),
      cashFlow,
      cumulativeCashFlow: cumulative,
      roi: Number((9.2 + i * 1.6).toFixed(2)),
    };
  });
}

/** Shaped exactly like a stored row. */
const ROW = {
  id: 'report-1',
  property_address: '14 Marlborough Street, Leichhardt NSW 2040',
  updated_at: '2026-08-02T00:00:00.000Z',
  created_at: '2026-07-30T00:00:00.000Z',
  financial_calculations: {
    projections: {
      conservative: series(1.03, 2),
      moderate: series(1.052, 1),
      optimistic: series(1.07, 0),
    },
    initialCosts: {
      // Present in the row, and none of the three is published. See below.
      propertyValue: VALUE,
      totalUpfront: 315890,
      deposit: 257000, stampDuty: 56890, legalFees: 1500, inspectionFees: 500,
      lmi: 0, loanAmount: LOAN,
    },
    loanDetails: {
      interestRate: 6.14, monthlyPayment: 6280, weeklyPayment: 1449.23,
      totalInterest: 1230480, loanType: 'interest_only',
      rateSource: 'User specified', interestOnlyPeriod: 2, lvr: 80,
    },
    annualCosts: {
      councilRates: 2184, waterRates: 780, landlordInsurance: 1612,
      maintenance: 2496, propertyManagement: 3224, strataFees: 0, landTax: 0,
      lettingFees: 920, totalAnnual: 24668,
    },
    assumptions: { capitalGrowth: 5.2, cpiGrowth: 2.8, occupancyWeeks: 52 },
    keyMetrics: { lvr: 80, annualNet: -21476, weeklyNet: -413 },
  },
};

function resolves(data: Record<string, any>, path: string): boolean {
  let cur: any = data;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(key in cur)) return false;
    cur = cur[key];
  }
  return cur !== undefined && cur !== null && cur !== '';
}

describe('the cash flow adapter is real, not a stub', () => {
  it('reports production support', () => {
    expect(supportsProduction('cashflow')).toBe(true);
    expect(getAdapter('cashflow')?.label).toBe('Cash Flow Analysis');
  });

  it('still names a legacy fallback, because most reports cannot use it', () => {
    // 1,020 of the 1,182 investment reports store no projection at all.
    expect(getAdapter('cashflow')?.legacyFallback?.reason).toBeTruthy();
  });

  it('leaves the still-stubbed formats honestly marked', () => {
    // `qa` left this list when `markdown-block` gave the vocabulary a way to
    // set model-authored Markdown as structure; it has an adapter and 50
    // masters now. The three below have no render route and no contract, so
    // they are catalogue templates without a backing format rather than
    // formats awaiting an adapter.
    for (const t of ['suburb', 'postcode', 'statewide']) {
      expect(supportsProduction(t), t).toBe(false);
    }
  });
});

describe('the series', () => {
  const p = projectCashFlow(ROW);

  it('publishes ten years of the requested scenario, and all three beside it', () => {
    expect(p.hasProjections).toBe(true);
    expect(p.cashflow.years).toHaveLength(PROJECTION_YEARS);
    expect(p.cashflow.termYears).toBe(PROJECTION_YEARS);
    expect(p.cashflow.scenario).toBe(DEFAULT_SCENARIO);
    // The key is what a conditional tests; the label is what a KPI prints.
    expect(p.cashflow.scenarioLabel).toBe('Moderate');
    for (const name of SCENARIOS) {
      expect((p.cashflow.scenarios as any)[name], name).toHaveLength(PROJECTION_YEARS);
    }
  });

  it('restates each year without recomputing it', () => {
    const y1 = (p.cashflow.years as any[])[0];
    expect(y1.year).toBe(1);
    expect(y1.propertyValue).toBe(Math.round(VALUE * 1.052));
    expect(y1.cashFlow).toBe(-37916);
    expect(y1.cumulativeCashFlow).toBe(-37916);
    // Whole-number percent, like every other rate in this codebase.
    expect(y1.roi).toBe(9.2);
  });

  it('leads on whichever scenario it is asked for', () => {
    const optimistic = projectCashFlow(ROW, 'optimistic');
    expect(optimistic.cashflow.scenario).toBe('optimistic');
    expect((optimistic.cashflow.years as any[])[9].propertyValue)
      .toBeGreaterThan((p.cashflow.years as any[])[9].propertyValue);
    // The other two are still published, so a scenario page can draw all three
    // whichever one leads.
    expect(Object.keys(optimistic.cashflow.scenarios as any)).toHaveLength(3);
  });

  it('states the ends of the series so a KPI need not index the last element', () => {
    const o = p.cashflow.outcome as any;
    const years = p.cashflow.years as any[];
    expect(o.year).toBe(10);
    expect(o.propertyValue).toBe(years[9].propertyValue);
    expect(o.cumulativeCashFlow).toBe(years[9].cumulativeCashFlow);
    expect(o.valueGrowth).toBe(years[9].propertyValue - years[0].propertyValue);
    expect(o.equityGrowth).toBe(years[9].equity - years[0].equity);
    // The first year plus the one derived weekly figure the legacy year-one
    // block carries (÷52 — arithmetic, never `keyMetrics.weeklyNet`).
    expect(p.cashflow.firstYear).toEqual({
      ...years[0],
      cashFlowWeekly: (years[0] as any).cashFlow / 52,
    });
  });

  it('sets the equity gained against the cash it took, and nothing else', () => {
    const o = p.cashflow.outcome as any;
    const years = p.cashflow.years as any[];
    // Cumulative cash flow is negative on every stored element, so this adds.
    expect(o.equityGrowthLessShortfall)
      .toBe((years[9].equity - years[0].equity) + years[9].cumulativeCashFlow);
    // The deposit and the purchase costs are NOT in it — the page says so, and
    // this is the assertion that keeps that true.
    expect(o.equityGrowthLessShortfall).not.toBe(
      (years[9].equity - years[0].equity) + years[9].cumulativeCashFlow - 315890,
    );
  });
});

describe('what it refuses to publish', () => {
  const p = projectCashFlow(ROW);
  const data = applyCashFlowProjection({}, ROW);

  it('omits the year-one cash flow the record states a second time', () => {
    // `keyMetrics.annualNet` and `weeklyNet` are year-one cash flow, exactly
    // what `projections.moderate[0].cashFlow` is. Median disagreement across
    // the 162 stored reports: $24,793. They agree on none of them.
    expect(resolves(data, 'cashflow.annualNet')).toBe(false);
    expect(resolves(data, 'cashflow.weeklyNet')).toBe(false);
    expect(JSON.stringify(p.cashflow)).not.toContain('-21476');
  });

  it('omits both stored totals, which do not total the figures beside them', () => {
    // `totalUpfront` equals the sum of its own components on 29 of 161 rows
    // (residual −$80,740 to +$93,000); `annualCosts.totalAnnual` on 18 of 162
    // (−$25,020 to +$14,003). A total printed under figures it contradicts by
    // $93,000 tells a reader the document cannot add up.
    expect(resolves(data, 'cashflow.purchase.totalUpfront')).toBe(false);
    expect(resolves(data, 'cashflow.costs.totalAnnual')).toBe(false);
    // The components themselves are all published.
    for (const k of ['deposit', 'stampDuty', 'legalFees', 'inspectionFees', 'loanAmount']) {
      expect(resolves(data, `cashflow.purchase.${k}`), k).toBe(true);
    }
    for (const k of ['councilRates', 'waterRates', 'maintenance', 'propertyManagement']) {
      expect(resolves(data, `cashflow.costs.${k}`), k).toBe(true);
    }
  });

  it('omits the purchase price, because the series carries the value', () => {
    // Sound on 160 of 161 rows and $3 on one — whose own series says $780,000.
    expect(resolves(data, 'cashflow.purchase.propertyValue')).toBe(false);
    expect(resolves(data, 'cashflow.firstYear.propertyValue')).toBe(true);
  });

  it('omits the interest-only period, which the series does not model', () => {
    // Stored as 2 years on 93 reports, while the projected balance falls in
    // year one on all 161 — to 0.988 of the original, in every scenario.
    expect(resolves(data, 'cashflow.loan.interestOnlyPeriod')).toBe(false);
    const years = p.cashflow.years as any[];
    expect(years[1].loanBalance).toBeLessThan(years[0].loanBalance);
  });

  it('publishes no client, because the table has no column for one', () => {
    // `investment_reports` has no `client_name`, and `client_property_id` is
    // set on 2 of the 162. The masters name the property instead.
    expect('client' in (p as any)).toBe(false);
    expect(resolves(data, 'client.name')).toBe(false);
    expect(resolves(data, 'cashflow.property.address')).toBe(true);
  });

  it('does not publish the weekly rent beside a series it does not explain', () => {
    // `projections.annualRent` equals neither `weeklyRent * 52` nor
    // `weeklyRent * occupancyWeeks` on any of the 162.
    expect(resolves(data, 'cashflow.weeklyRent')).toBe(false);
  });
});

describe('the rest of the record', () => {
  const p = projectCashFlow(ROW);

  it('labels the loan type rather than printing the stored enum', () => {
    expect((p.cashflow.loan as any).loanType).toBe('Interest only');
    expect((p.cashflow.loan as any).rateSource).toBe('User specified');
  });

  it('passes whole-number percent rates through unscaled', () => {
    expect((p.cashflow.loan as any).interestRate).toBe(6.14);
    expect((p.cashflow.loan as any).lvr).toBe(80);
    expect((p.cashflow.basis as any).capitalGrowth).toBe(5.2);
  });

  it('falls back to keyMetrics for the LVR the loan does not carry', () => {
    const withoutLvr = { ...ROW.financial_calculations, loanDetails: { interestRate: 6.14 } };
    const q = projectCashFlow({ ...ROW, financial_calculations: withoutLvr });
    expect((q.cashflow.loan as any).lvr).toBe(80);
  });

  it('derives each scenario’s rates from the scenario, never from the record', () => {
    // The stored `assumptions.capitalGrowth` on this fixture is 5.2 while the
    // moderate series is built at 5.2 too — deliberately, so the assertion
    // below is about WHERE the figure came from rather than about its value.
    // In production they disagree on 66 of the 69 reports that record one.
    expect('assumptions' in p.cashflow).toBe(false);
    const basis = p.cashflow.scenarioBasis as Record<string, any>;
    expect(basis.conservative.capitalGrowth).toBe(3);
    expect(basis.moderate.capitalGrowth).toBe(5.2);
    expect(basis.optimistic.capitalGrowth).toBe(7);
    // Rental growth is 3.1% on every scenario of this fixture.
    expect(basis.moderate.rentalGrowth).toBe(3.1);

    // Change nothing but the recorded assumption, and the derived basis does
    // not move — which is the whole point.
    const lying = {
      ...ROW.financial_calculations,
      assumptions: { capitalGrowth: 26.6, cpiGrowth: 6.3, occupancyWeeks: 49 },
    };
    const q = projectCashFlow({ ...ROW, financial_calculations: lying });
    expect((q.cashflow.basis as any).capitalGrowth).toBe(5.2);
    expect(JSON.stringify(q.cashflow)).not.toContain('26.6');
  });

  it('omits a rate it cannot derive rather than dividing by zero', () => {
    // Year-one rent is $0 on 5 of the 162 stored reports.
    const noRent = {
      ...ROW.financial_calculations,
      projections: {
        moderate: series(1.052, 1).map((y) => ({ ...y, annualRent: 0 })),
      },
    };
    const q = projectCashFlow({ ...ROW, financial_calculations: noRent });
    expect((q.cashflow.basis as any).capitalGrowth).toBe(5.2);
    expect('rentalGrowth' in (q.cashflow.basis as any)).toBe(false);
  });

  it('never writes an undefined key, so absent means absent', () => {
    const walk = (o: any, at: string) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        expect(v, `${at}.${k}`).not.toBeUndefined();
        walk(v, `${at}.${k}`);
      }
    };
    walk(p, 'projection');
  });
});

describe('a report with no stored projection', () => {
  it('reports it rather than publishing an empty series', () => {
    // 1,020 of the 1,182 investment reports. The adapter turns this into a
    // null binding context, so the legacy generator keeps them.
    const bare = projectCashFlow({ id: 'x', property_address: 'Somewhere' });
    expect(bare.hasProjections).toBe(false);
    expect('years' in bare.cashflow).toBe(false);
    expect('outcome' in bare.cashflow).toBe(false);
  });

  it('survives an entirely empty row without throwing', () => {
    expect(() => projectCashFlow({})).not.toThrow();
    expect(projectCashFlow({}).hasProjections).toBe(false);
  });

  it('still publishes the inputs a partial record does carry', () => {
    // A report can store costs and a loan without a projection. Those are not
    // invented and are not withheld — only the series is absent.
    const partial = projectCashFlow({
      id: 'x',
      financial_calculations: { annualCosts: { councilRates: 2184 } },
    });
    expect((partial.cashflow.costs as any).councilRates).toBe(2184);
    expect(partial.hasProjections).toBe(false);
  });
});

describe('merging', () => {
  it('is additive and leaves the voice catalogue’s own cashflow keys alone', () => {
    // The voice templates' ten-year table lives at `cashflow.0` … `cashflow.9`
    // plus `breakEvenNote`. The two vocabularies share the namespace.
    const data = applyCashFlowProjection(
      { cashflow: { 0: { rent: 1 }, breakEvenNote: 'year seven' } },
      ROW,
    );
    expect(resolves(data, 'cashflow.breakEvenNote')).toBe(true);
    expect(resolves(data, 'cashflow.0.rent')).toBe(true);
    expect(resolves(data, 'cashflow.years')).toBe(true);
  });

  it('publishes the generation date under the ambient report namespace', () => {
    const data = applyCashFlowProjection({}, ROW);
    expect(data.report.generatedDate).toBe('2026-08-02T00:00:00.000Z');
  });
});

describe('the legacy document narrative, restated', () => {
  /*
   * `describeProjection` in `reports/cashFlow/normalise.pure.ts` cannot run on
   * a stored row — it takes the browser's twenty-field years and throws on
   * anything less, which is its contract. The projection restates its
   * sentences from the series' own ends, with one deliberate change: the
   * legacy says "a week after tax", and the stored series does not state its
   * tax treatment, so the restatement claims nothing the record does not.
   */
  it('composes the narrative from the series ends, in the legacy sentences', () => {
    const p = projectCashFlow(ROW);
    const narrative = String(p.cashflow.overview);
    expect(narrative).toContain('14 Marlborough Street, Leichhardt NSW 2040');
    // -37,916 in year one is $729 a week, and the wording claims no tax basis.
    expect(narrative).toContain('costs $729 a week to hold in year one');
    expect(narrative).not.toContain('after tax');
    expect(narrative).toContain('of capital growth');
    expect(narrative).toContain('of equity at the end of the term.');
    // Production's answer on every stored moderate scenario.
    expect(narrative).toContain('does not turn cash-flow positive within the projected term');
    expect((p.cashflow.outcome as any).breakEvenYear).toBeUndefined();
  });

  it('publishes the weekly year-one figure as arithmetic on the series', () => {
    // Never `keyMetrics.weeklyNet` (-413 on this fixture), which disagrees
    // with the series' own year one on every stored report.
    const p = projectCashFlow(ROW);
    expect((p.cashflow.firstYear as any).cashFlowWeekly).toBeCloseTo(-37916 / 52, 6);
  });

  it('names the break-even year when the series has one', () => {
    const years = series(1.052, 1).map((y, i) => ({
      ...y,
      // Positive from year six on.
      cashFlow: i >= 5 ? 1200 : y.cashFlow,
    }));
    const p = projectCashFlow({
      ...ROW,
      financial_calculations: {
        ...(ROW.financial_calculations as any),
        projections: { moderate: years },
      },
    });
    expect((p.cashflow.outcome as any).breakEvenYear).toBe(6);
    expect(String(p.cashflow.overview)).toContain('turns cash-flow positive in year 6.');
  });

  it('says a year-one-positive projection returns rather than costs', () => {
    const years = series(1.052, 1).map((y) => ({ ...y, cashFlow: 2600 }));
    const p = projectCashFlow({
      ...ROW,
      financial_calculations: {
        ...(ROW.financial_calculations as any),
        projections: { moderate: years },
      },
    });
    const narrative = String(p.cashflow.overview);
    expect(narrative).toContain('returns $50 a week in year one');
    expect(narrative).toContain('It is cash-flow positive from the first year.');
  });

  it('composes nothing for a report with no stored series', () => {
    const p = projectCashFlow({ id: 'x', financial_calculations: { projections: {} } });
    expect(p.cashflow.overview).toBeUndefined();
    expect(p.hasProjections).toBe(false);
  });
});
