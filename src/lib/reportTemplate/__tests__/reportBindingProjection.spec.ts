/**
 * The binding projection, measured the only way that means anything: how many
 * of the catalogue's bindings resolve against a row shaped like production.
 *
 * The fixture below is not invented. Its key names, nesting and units are taken
 * from the live `investment_reports` table (1,182 rows) — `property_specs` in
 * snake_case, `financial_calculations` nested under `initialCosts` / `income` /
 * `keyMetrics` / `loanDetails` / `annualCosts` / `assumptions`, and
 * `investment_score.risks` as an array of plain strings. Only the values are
 * synthetic. A fixture written in the catalogue's own vocabulary would pass
 * while production stayed broken, which is exactly how this defect survived.
 */
import { describe, it, expect } from 'vitest';
import {
  projectInvestmentReport,
  applyInvestmentProjection,
} from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import { applyOrganisationProjection } from '../../../../supabase/functions/_shared/organisationProjection.pure';
import { OVERALL_GRADE_UNAVAILABLE } from '../../../../supabase/functions/_shared/reports/market/scoringInputPolicy.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { visibleTableRows } from '../blocks/_data';

/** Shaped exactly like a stored row. See the header. */
const ROW = {
  property_address: '14 Marlborough Street, Leichhardt NSW 2040',
  updated_at: '2026-08-02T00:00:00.000Z',
  created_at: '2026-08-01T00:00:00.000Z',
  /*
   * The document the model writes, which `projectReportNarrative` publishes as
   * `narrative.source` and the Compass masters bind on their narrative pages.
   *
   * Present here because it is present in production: 1,187 of 1,187
   * `investment_reports` rows carry it, averaging ~38,000 characters. A
   * fixture without it made `narrative.source` look like a binding with no
   * source, which is the one thing the expected-absent list below must never
   * be allowed to claim about a column every real row has.
   */
  report_content: '## Executive Verdict\n\n'
    + 'Leichhardt is a **consolidated inner-west market** with limited detached '
    + 'stock and a long-run preference for period housing on level land.\n\n'
    + '### Location Overview\n\n'
    + 'The address sits within the Inner West council area, zoned R2 Low '
    + 'Density Residential.\n',
  property_specs: {
    bedrooms: 3, bathrooms: 2, parking: 1,
    land_size_sqm: 412, building_size_sqm: 168,
    property_type: 'House', year_built: 1998,
    zoning: 'R2 Low Density Residential', council_area: 'Inner West',
  },
  financial_calculations: {
    initialCosts: {
      propertyValue: 1290000, stampDuty: 56890, legalFees: 1800,
      inspectionFees: 950, totalUpfront: 1_349_640, deposit: 258000, loanAmount: 1032000,
    },
    income: { weeklyRent: 920 },
    keyMetrics: {
      grossRentalYield: 3.71, netRentalYield: 2.95, cashOnCashReturn: -2.9,
      weeklyNet: -753.5, annualNet: -39182, lvr: 80, totalInvestment: 1349640,
    },
    loanDetails: { loanAmount: 1032000, interestRate: 6.14, monthlyPayment: 6280, weeklyPayment: 1449, lvr: 80 },
    /*
     * All EIGHT components the engine subtracts, because that is what a stored
     * row carries. This fixture held four and a `totalAnnual` that did not
     * foot with them, and that is exactly the defect it was meant to guard:
     * the projection published the same four, the masters bound the four, and
     * the missing $2,328 sat inside "Net position" with no row naming it. On
     * 262 Pallas Street, Maryborough the same gap was $2,100 of water rates
     * and letting fees.
     */
    annualCosts: {
      councilRates: 1980, waterRates: 1100, landlordInsurance: 720,
      propertyManagement: 2392, lettingFees: 920, maintenance: 1290,
      landTax: 1420, strataFees: 0, totalAnnual: 9822,
    },
    assumptions: { capitalGrowth: 4.2, cpiGrowth: 2.5, occupancyWeeks: 50 },
    cashFlow: { taxRate: null },
  },
  investment_score: {
    totalScore: 72, grade: 'B+',
    recommendation: 'Proceed to offer at or below $1.29m',
    // ONE risk. `investment_score.risks` runs 0-1 across all 1,182 rows and
    // never holds two — the fixture used to carry three, which is how a
    // three-row register survived review.
    risks: ['Interest rate exposure at 80% LVR'],
    strengths: ['Land-led inner-west holding', 'Below suburb median'],
    weaknesses: ['Negative cash flow in years 1-3', 'Dated internals'],
    opportunities: ['Subdivision potential subject to council'],
    // Five weighted dimensions. `growthScore` and `demandScore` carry a flat 50
    // and no details on 919 of the 985 scored reports, which is why they are
    // shaped that way here.
    breakdown: {
      growthScore: { score: 50, weight: 40, details: '' },
      locationScore: { score: 85, weight: 25, details: 'Excellent walkability (90+). Excellent CBD access (<15 min).' },
      yieldScore: { score: 62, weight: 15, details: 'Moderate yield (3-4%) - Negative cash flow likely' },
      demandScore: { score: 50, weight: 15, details: '' },
      riskScore: { score: 53, weight: 5, details: 'High LVR (80%) increases leverage risk. Moderate negative cash flow requires contribution.' },
    },
  },
};

/** Resolve `a.b.c` the way the renderer does: every hop must exist. */
function resolves(data: Record<string, any>, path: string): boolean {
  let cur: any = data;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return false;
    if (typeof cur !== 'object') return false;
    if (!(key in cur)) return false;
    cur = cur[key];
  }
  return cur !== undefined && cur !== null && cur !== '';
}

/** Every distinct binding the 50 masters use. */
function catalogueBindings(): string[] {
  const found = new Set<string>();
  for (const t of INVESTMENT_COMPASS_TEMPLATES) {
    for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) found.add(m[1]);
  }
  return [...found].sort();
}

/** The raw context the adapter built before the projection existed. */
function rawContext() {
  const shallow = (o: any) => (o && typeof o === 'object' ? { ...o } : {});
  return {
    report: { id: 'r1', type: 'investment', address: ROW.property_address, generated_at: ROW.updated_at },
    property: shallow(ROW.property_specs),
    financials: shallow(ROW.financial_calculations),
    scores: shallow(ROW.investment_score),
  } as Record<string, any>;
}

describe('the defect this projection fixes', () => {
  it('resolved almost nothing before — one binding in eighty', () => {
    const before = catalogueBindings().filter((b) => resolves(rawContext(), b));
    // `property.zoning` is the single survivor: the one key whose spelling
    // happened to match between the catalogue and the database.
    expect(before).toEqual(['property.zoning']);
  });

  it('names the three causes precisely', () => {
    const raw = rawContext();
    // Case: the database is snake_case.
    expect(resolves(raw, 'property.yearBuilt')).toBe(false);
    expect(resolves(raw, 'property.year_built')).toBe(true);
    // Depth: a shallow spread never flattened a path.
    expect(resolves(raw, 'financials.grossYield')).toBe(false);
    expect(resolves(raw, 'financials.keyMetrics')).toBe(true);
    // Location: the address is published under `report`, not `property`.
    expect(resolves(raw, 'property.address')).toBe(false);
    expect(resolves(raw, 'report.address')).toBe(true);
  });
});

/** The live `whitelabel_settings` row: four fields set, address empty, no ABN. */
const ORGANISATION = {
  company_name: 'Naidu Property Consulting Services ',
  email_signature_phone: '02 8609 3299',
  email_signature_email: 'admin@npcservices.com.au',
  email_signature_website: 'www.npcservices.com.au',
  email_signature_address: '',
};

describe('after projection', () => {
  /*
   * The marks an adapter now supplies alongside the letterhead.
   *
   * `applyOrganisationAndBrand` reads `whitelabel_settings.logo_config`,
   * resolves a slot through `assets.pure.ts` and inlines the bytes, so a live
   * render has both. A 1x1 PNG stands in here: what this spec measures is
   * whether the path resolves, not which picture arrives.
   */
  const MARK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1'
    + 'HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  /*
   * The settings row, supplied the way `applyOrganisationAndBrand` supplies it.
   *
   * `global_report_settings` is where the ABN and the postal address actually
   * live — this spec used to record both as having no source, which was true of
   * `whitelabel_settings` and false of the deployment. Values are the live ones.
   */
  const SETTINGS = {
    contact: {
      abn: '50 684 555 771',
      address: 'Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153',
    },
    disclaimer: { text: 'As a Professional Property Consultant & Buyers Agent…', font_size: 'medium', is_enabled: true },
  };

  /*
   * Projected for the FINANCIAL tier, and that is the whole point of the
   * parameter.
   *
   * `catalogueBindings()` reads every master in the catalogue, and those
   * masters serve five tiers. The question this file asks is whether a bound
   * path has a SOURCE IN THE RECORD — which is a fact about the row, not about
   * which document draws it — so it has to be asked at the tier that publishes
   * the most. The compass tier withholds the financial modelling by design
   * (`TIER_CONTENT`), and asking here at the compass tier would report
   * `financials.annualRepayment` as a binding with nowhere to come from, which
   * is exactly the false claim the expected-absent list below must never make.
   *
   * What the compass withholds, and that no page is left with a hole by it, is
   * pinned by its own describe block at the foot of this file.
   */
  const data = applyOrganisationProjection(
    applyInvestmentProjection(rawContext(), ROW, { tier: 'financial' }),
    ORGANISATION,
    { mark: MARK, markMono: MARK },
    SETTINGS,
  );

  it('resolves every binding the catalogue has, bar the photographs', () => {
    // It began at 1 of 80. The projection took it to 40, and re-pointing the
    // masters off the paths that have no source — a narrative page bound
    // entirely to `market.*`, a three-row register bound to `risks.0..2` when
    // the record never holds two — took it the rest of the way.
    const bindings = catalogueBindings();
    const unresolved = bindings.filter((b) => !resolves(data, b));
    expect(bindings.length).toBeGreaterThanOrEqual(70);
    // Photographs (6). Nothing else — the ABN and the postal address used to be
    // here and now resolve, from `global_report_settings.contact_details`.
    expect(unresolved).toHaveLength(6);
  });

  it('leaves exactly the bindings that have no source, and no others', () => {
    // The contract, not a ratio. Every entry below was checked against
    // production and has nowhere in the row to come from. If a future change
    // makes one resolve, either it found a real source — delete the line and
    // say where it came from — or it invented a figure, and this test is the
    // thing standing between that invention and a client's report.
    const expectedAbsent = [
      // Photographs: no adapter emits them. The plates are page-conditional, so
      // an unfilled one costs no page rather than an empty one.
      'property.images.0', 'property.images.1', 'property.images.2',
      'property.images.3', 'property.images.4', 'property.images.5',
      // `org.abn` and `org.address` were here, on the finding that
      // `whitelabel_settings` has no ABN column and an empty
      // `email_signature_address`. Both were true, and both were the wrong
      // table: `global_report_settings.contact_details` carries
      //
      //     abn      50 684 555 771
      //     address  Level 5 Nexus Norwest, 4 Columbia Ct, Norwest NSW 2153
      //
      // and every render route already selects that row — it reached the legacy
      // composer and stopped there. `projectReportSettings` publishes both, so
      // the disclaimer block prints six contact lines where it printed four.
      // Deleted per this test's own instruction: found a real source, said
      // where it came from.
    ].sort();

    const actualAbsent = catalogueBindings().filter((b) => !resolves(data, b)).sort();
    expect(actualAbsent).toEqual(expectedAbsent);
  });

  it('reads the figures a client actually sees', () => {
    expect(data.property.address).toBe('14 Marlborough Street, Leichhardt NSW 2040');
    expect(data.property.type).toBe('House');
    expect(data.property.yearBuilt).toBe(1998);
    expect(data.property.landArea).toBe(412);
    expect(data.property.configuration).toBe('3 bed · 2 bath · 1 car');
    expect(data.financials.purchasePrice).toBe(1290000);
    expect(data.financials.stampDuty).toBe(56890);
    expect(data.financials.weeklyRent).toBe(920);
    expect(data.financials.grossYield).toBe(3.71);
    expect(data.financials.loanAmount).toBe(1032000);
    expect(data.recommendation.headline).toBe('Proceed to offer at or below $1.29m');
    expect(data.risks[0].risk).toBe('Interest rate exposure at 80% LVR');
    expect(data.summary.strength[0]).toBe('Land-led inner-west holding');
    expect(data.summary.watch[0]).toBe('Negative cash flow in years 1-3');
  });

  it('publishes no verdict at all on an ungraded record — never "Not available"', () => {
    // The scorer writes the policy's explanation where a recommendation would
    // go. RS-3 set the policy's short form ("Not available — insufficient
    // verified evidence") as the headline over the KPI band; the owner's rule
    // (14 Sep 2026) is that neither "N/A" nor "unavailable" reaches a client
    // document, so the headline, the action and the sentence are all absent
    // and the verdict block draws nothing.
    const ungraded = projectInvestmentReport({
      ...ROW,
      investment_score: {
        grade: 'N/A',
        recommendation: OVERALL_GRADE_UNAVAILABLE.explanation,
        policy: { gradeIssued: false },
      },
    });
    expect(ungraded.recommendation.headline).toBeUndefined();
    expect(ungraded.recommendation.action).toBeUndefined();
    expect(ungraded.recommendation.gradedLine).toBeUndefined();
    expect(ungraded.recommendation.grade).toBeUndefined();
    expect(ungraded.recommendation.score).toBeUndefined();
    expect(JSON.stringify(ungraded.recommendation)).not.toMatch(/not available|unavailable|N\/A/i);
    // A graded record's own recommendation is untouched.
    expect(data.recommendation.headline).toBe('Proceed to offer at or below $1.29m');
  });

  it('converts units without inventing a model', () => {
    // Weekly is annual/52 — arithmetic, not a forecast.
    expect(data.financials.weeklyRates).toBeCloseTo((1980 + 1100) / 52, 6);
    expect(data.financials.annualRepayment).toBe(6280 * 12);
    // `annualRent` is the CONTRACTUAL rent — 52 weeks — because that is the
    // basis the stored yields rest on (149 of 153 production reports) and what
    // a template prints as a bare "p.a." beside the weekly rent. It used to be
    // `weeklyRent × occupancyWeeks`, which agreed with neither the record's own
    // `income.annualRent` nor the yield published two keys away: on 62 of 153
    // reports the tile's annual rent could not produce its own gross yield.
    expect(data.financials.annualRent).toBe(920 * 52);
    // The occupancy assumption keeps its figure under its own name.
    expect(data.financials.annualRentAtOccupancy).toBe(920 * 50);
    expect(data.financials.annualRentAtOccupancyLabel).toBe('Annual rent at 50 occupied weeks');
    expect(data.assumptions.vacancy).toBeCloseTo((2 / 52) * 100, 6);
  });

  it('passes percentages through unscaled, because the filter does not scale', () => {
    // Stored whole-number percent (yield 0-7.51, rate 3.0-6.5 in production) and
    // `percent` formats without multiplying. Scaling here would print 371%.
    expect(data.financials.grossYield).toBe(3.71);
    expect(data.assumptions.interestRate).toBe(6.14);
    expect(data.assumptions.capitalGrowth).toBe(4.2);
  });

  it('leaves the unsourced absent rather than fabricating it', () => {
    // Each of these has no source in the row. A number here would be invented,
    // and an invented figure on a client's financial report is the worst
    // outcome available — worse than a blank line.
    // None of these is bound by a master any more either — but the projection
    // must keep refusing them, because the next format to arrive will reach for
    // exactly these names.
    for (const path of [
      'financials.breakEvenRent', 'financials.loanFees', 'financials.narrative',
      'assumptions.rentalGrowth', 'assumptions.sellingCosts', 'assumptions.taxRate',
      'market.postcode', 'market.narrative',
      'property.suburb', 'property.condition', 'property.tenancy',
      'recommendation.rationale', 'risks.0.why', 'risks.0.action',
      'summary.narrative', 'author.name', 'client.name',
    ]) {
      expect(resolves(data, path), `${path} must stay absent`).toBe(false);
    }
  });

  it('never writes an undefined key, so absent means absent', () => {
    const walk = (o: any, at: string) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        expect(v, `${at}.${k}`).not.toBeUndefined();
        walk(v, `${at}.${k}`);
      }
    };
    walk(projectInvestmentReport(ROW), 'projection');
  });

  it('is additive — the raw vocabulary still resolves', () => {
    expect(resolves(data, 'property.year_built')).toBe(true);
    expect(resolves(data, 'property.property_type')).toBe(true);
    expect(resolves(data, 'financials.keyMetrics')).toBe(true);
    expect(resolves(data, 'report.address')).toBe(true);
  });

  it('survives an empty or partial row without throwing', () => {
    expect(() => projectInvestmentReport({})).not.toThrow();
    const sparse = projectInvestmentReport({ property_address: '1 Test St' });
    expect(sparse.property.address).toBe('1 Test St');
    expect(Object.keys(sparse.financials)).toHaveLength(0);
    expect(sparse.risks).toEqual([]);
  });
});

/**
 * The cash flow table adds up.
 *
 * Measured on 262 Pallas Street, Maryborough (report
 * `aa41bcec-5a5c-434d-9162-96deb50e9bdb`, 16 Sep 2026): the printed rows came
 * to $10,780 a year against a "Net position" the engine built on $12,880, so
 * a client reading page 5 was $2,100 short with no line to attribute it to.
 * The engine subtracts eight annual components; the projection published four
 * and the masters bound those four — and the row that was missing water rates
 * was LABELLED "Council and water rates".
 *
 * These tests resolve the real masters' real rows against the projection and
 * add them up, so a ninth component added upstream, a renamed key or a row
 * dropped from a master fails here rather than shipping a table a reader
 * cannot foot.
 */
describe('the cash flow table foots to the net position', () => {
  /*
   * At the FINANCIAL tier throughout this block, because that is the only tier
   * on which the table is drawn: the masters' cash-flow pages are conditional
   * on `report.drawsFinancialModelling`, and the compass tier withholds the
   * eight components by design. Measuring the arithmetic at a tier that does
   * not print the table would prove nothing about the document that does.
   */
  const TIER = { tier: 'financial' } as const;
  const data = applyOrganisationProjection(applyInvestmentProjection({}, ROW, TIER), {});
  const ctx = { data, tokens: {} as any };

  /** Every master's "Cash flow" table, wherever in its schema it sits. */
  function cashFlowTables(schema: unknown): any[] {
    const found: any[] = [];
    const walk = (node: any) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.headers) && node.headers[0] === 'Cash flow' && Array.isArray(node.rows)) found.push(node);
      Object.values(node).forEach(walk);
    };
    walk(schema);
    return found;
  }

  /** The number a bound annual cell resolves to, by the key it names. */
  function annualOf(row: any): { label: string; key: string; value: number | undefined } {
    const label = String(row.cells?.[0] ?? '');
    const key = String(row.cells?.[2] ?? '').match(/financials\.([A-Za-z0-9_]+)/)?.[1] ?? '';
    const value = (data.financials as Record<string, unknown>)[key];
    return { label, key, value: typeof value === 'number' ? value : undefined };
  }

  it('publishes every component the engine subtracted', () => {
    const c = ROW.financial_calculations.annualCosts;
    const f = data.financials as Record<string, number>;
    // Two join the row whose label already claimed them; two more are their
    // own line. Nothing is dropped and nothing is counted twice.
    expect(f.annualRates).toBe(c.councilRates + c.waterRates);
    expect(f.annualManagement).toBe(c.propertyManagement + c.lettingFees);
    expect(f.annualInsurance).toBe(c.landlordInsurance);
    expect(f.annualMaintenance).toBe(c.maintenance);
    expect(f.annualOtherCosts).toBe(c.landTax + c.strataFees);
    expect(f.annualRates + f.annualInsurance + f.annualManagement + f.annualMaintenance + f.annualOtherCosts)
      .toBe(c.totalAnnual);
  });

  it('draws the land tax row only where there is a figure to draw', () => {
    // Both are nil on an ordinary house — 262 Pallas carries 0 and 0 — and a
    // row reading "$0" is a line the reader has to discount rather than read.
    const house = applyInvestmentProjection({}, {
      ...ROW,
      financial_calculations: {
        ...ROW.financial_calculations,
        annualCosts: { ...ROW.financial_calculations.annualCosts, landTax: 0, strataFees: 0, totalAnnual: 8402 },
      },
    }, TIER);
    expect('annualOtherCosts' in (house.financials as object)).toBe(false);
    expect('weeklyOtherCosts' in (house.financials as object)).toBe(false);
  });

  it('names the vacancy assumption instead of hiding it in the rent', () => {
    // `annualRent` stays contractual, because that is the basis the stored
    // yields rest on. The difference the occupancy assumption makes is its own
    // deduction, so the table can open on the contractual rent and still reach
    // a net position the engine built on the occupied one.
    const f = data.financials as Record<string, number>;
    expect(f.annualRent).toBe(920 * 52);
    expect(f.annualVacancyAllowance).toBe(920 * 52 - 920 * 50);
    // At 52 weeks there is no gap, so no row and no key.
    const full = applyInvestmentProjection({}, {
      ...ROW,
      financial_calculations: { ...ROW.financial_calculations, assumptions: { ...ROW.financial_calculations.assumptions, occupancyWeeks: 52 } },
    }, TIER);
    expect('annualVacancyAllowance' in (full.financials as object)).toBe(false);
  });

  it('resolves every line the master draws', () => {
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      for (const table of cashFlowTables(t.schema)) {
        for (const { row } of visibleTableRows(table.rows, ctx)) {
          const { label, key, value } = annualOf(row);
          expect(key, `${t.name}: "${label}" binds no financials key`).not.toBe('');
          expect(value, `${t.name}: "${label}" (financials.${key}) resolved to nothing`).toBeTypeOf('number');
        }
      }
    }
  });

  it('adds up, on every master that draws it', () => {
    const net = ROW.financial_calculations.keyMetrics.annualNet;
    let tablesChecked = 0;
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      for (const table of cashFlowTables(t.schema)) {
        tablesChecked += 1;
        let running = 0;
        let stated: number | undefined;
        for (const { row } of visibleTableRows(table.rows, ctx)) {
          const { label, value } = annualOf(row);
          if (value === undefined) continue;
          if (label === 'Net position') { stated = value; continue; }
          // Income adds; every other line is a deduction printed positive.
          running += label === 'Rental income' ? value : -value;
        }
        expect(stated, `${t.name}: no net position row`).toBe(net);
        expect(running, `${t.name}: the rows do not foot to the net position`).toBeCloseTo(net, 6);
      }
    }
    expect(tablesChecked).toBeGreaterThan(0);
  });
});

/**
 * The compass tier withholds the financial modelling, and no page is left with
 * a hole by it.
 *
 * `TIER_CONTENT` moved the modelling out of the Investment Compass and into the
 * Financial Analysis, on the owner's instruction that each document have one
 * purpose. The projection withholds the keys and three master pages are
 * conditional on `report.drawsFinancialModelling`, so those pages are simply
 * not drawn.
 *
 * The residual risk is the other kind of page: one that is drawn on every tier
 * and binds a withheld figure somewhere inside it. An unresolved binding
 * renders as the empty string, so what a reader would get is a label over
 * nothing — "Loan repayments" beside a blank — which is the placeholder defect
 * under a different name.
 *
 * Measured on this branch, that is three pages: the cover's fact band, the
 * executive dashboard's KPI variants and table, and the methodology page's
 * definition list. All three close up, each by a rule its own renderer already
 * carried and each written for this class of defect:
 *
 *   - `kpi-grid`      drops a tile whose value is bound and resolved to nothing
 *                     and recomputes its column count from the survivors, so
 *                     the cover band closes from four cells to three.
 *   - `data-table`    drops a row whose bound cells all resolved to nothing.
 *   - `definition-list` drops an item whose definition is bound and empty.
 *
 * So the rule pinned here is not "no page binds a withheld figure" — that would
 * forbid one design serving five tiers, which is the whole point of the
 * catalogue. It is that a withheld figure may only ever sit somewhere that
 * closes up around it.
 */
describe('a tier that withholds the modelling leaves no empty slot', () => {
  /** Block types whose renderers drop an item that resolved to nothing. */
  const CLOSES_UP = new Set(['kpi-grid', 'data-table', 'definition-list']);

  const bindingsIn = (o: unknown): string[] =>
    [...new Set([...JSON.stringify(o).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)].map((m) => m[1]))];

  const compass = applyInvestmentProjection({}, ROW, { tier: 'compass' });
  const financial = applyInvestmentProjection({}, ROW, { tier: 'financial' });

  it('withholds the modelling on the compass and publishes it on the financial', () => {
    const f = financial.financials as Record<string, unknown>;
    const c = compass.financials as Record<string, unknown>;
    // The figures the Financial Analysis exists for.
    for (const key of ['grossYield', 'netYield', 'lvr', 'loanAmount', 'annualRepayment', 'weeklyNet']) {
      expect(f[key], `financial tier: ${key}`).not.toBeUndefined();
      expect(key in c, `compass tier: ${key} must be withheld`).toBe(false);
    }
    // And the two figures the Compass keeps, because they describe the
    // property rather than a model of it: what it costs and what it rents for.
    expect(c.purchasePrice).toBe(1290000);
    expect(c.weeklyRent).toBe(920);
    expect(compass.report.drawsFinancialModelling).toBe(false);
    expect(financial.report.drawsFinancialModelling).toBe(true);
  });

  it('withholds the Yield rationale but keeps the dimension itself', () => {
    /*
     * A dimension's own explanation can BE the modelling. The Yield scorer's
     * reads `4.52% gross yield on a $575,000 purchase price.` — a yield,
     * computed against the price, in one sentence — and it printed on page 4
     * of a Compass whose `financials` withholds both. Withholding the figure
     * and leaving its rationale on the scorecard is the same number through a
     * second door.
     *
     * The dimension stays: it was measured, it carries weight in the grade,
     * and saying so is not modelling.
     */
    const withScores = {
      ...ROW,
      investment_score: {
        ...(ROW.investment_score as Record<string, unknown>),
        breakdown: {
          yieldScore: { score: 62, weight: 20, details: '4.52% gross yield on a $575,000 purchase price.' },
          locationScore: { score: 71, weight: 25, details: 'Walkable to a shopping centre and two schools.' },
        },
      },
    };
    const row = (t: 'compass' | 'financial') => (applyInvestmentProjection({}, withScores, { tier: t })
      .assessment as Array<Record<string, unknown>>);

    const compassYield = row('compass').find((a) => a.label === 'Yield');
    expect(compassYield?.score, 'the dimension is still scored').toBe(62);
    expect(compassYield?.weightLabel).toBe('20%');
    expect('details' in (compassYield ?? {}), 'the arithmetic goes').toBe(false);

    // Location explains itself in locality terms and is published everywhere.
    expect(row('compass').find((a) => a.label === 'Location')?.details)
      .toContain('Walkable');

    // And the Financial Analysis, which exists for the figures, keeps it.
    expect(row('financial').find((a) => a.label === 'Yield')?.details)
      .toContain('gross yield');
  });

  it('puts every withheld binding on a conditional page or in a block that closes up', () => {
    const offences: string[] = [];
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      for (const page of ((t.schema as Record<string, any>)?.pages ?? []) as any[]) {
        // A page the compass never draws may bind anything.
        if (String(page?.conditional ?? '').includes('drawsFinancialModelling')) continue;
        for (const block of (page?.blocks ?? []) as any[]) {
          if (CLOSES_UP.has(String(block?.type))) continue;
          for (const path of bindingsIn(block)) {
            if (resolves(financial, path) && !resolves(compass, path)) {
              offences.push(`${t.name} · ${page?.name} · ${block?.type} · ${path}`);
            }
          }
        }
      }
    }
    expect([...new Set(offences)].sort()).toEqual([]);
  });
});
