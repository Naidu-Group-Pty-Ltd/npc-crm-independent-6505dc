/**
 * The fork's composition, exercised rather than read.
 *
 * ## What this replaces
 *
 * Producing the Financial and Due Diligence reports is entirely
 * deterministic — the composite's own H2 sections routed through the split
 * registry, with the financial chapters typed from the recorded calculation
 * merged over them. No model call, no network. All 257 lines of it lived
 * inside `fork-investment-report/index.ts`, so it could only run inside a
 * deployed Deno runtime, and `subReportEngines.spec.ts` reaches it by reading
 * its SOURCE as text because there was no other way in.
 *
 * Two of the five client reports come out of that code and neither had ever
 * been produced outside production. `forkSplit.pure.ts` is the same code,
 * moved, with the document's "Generated" date taken as an input so a document
 * can be produced twice with the same bytes.
 *
 * The registry here is the code default, which IS production's:
 * `report_engine_config` holds no overlay for `split_routes`,
 * `split_metadata`, `split_section_order_fin` or `split_section_order_pldd`
 * (measured 17 Sep 2026).
 */
import { describe, expect, it } from 'vitest';

import {
  composeForkDocuments, countCompositeSections,
} from '../../../../supabase/functions/_shared/reports/investment/forkSplit.pure';
import { loadSplitRegistry } from '../../../../supabase/functions/_shared/reportSplitRegistry';

/** A client that answers nothing, so the registry resolves to its code defaults. */
const NO_OVERLAY = { from: () => ({ select: () => ({ in: async () => ({ data: null }) }) }) } as never;

const COMPOSITE = [
  '# Investment Compass',
  '',
  '## Executive Verdict',
  'The verdict paragraph.',
  '',
  '## Purchase & Ongoing Costs',
  '| Item | Amount |',
  '| --- | --- |',
  '| Stamp duty | $66,000 |',
  '',
  '## Planning, Zoning & What Is Mapped Over the Land',
  'R2 — Low Density Residential under The Hills LEP 2019.',
  '',
  '## Transport & Connectivity',
  'Metro at 1.2 km.',
  '',
].join('\n');

/**
 * A record shaped as `calculateKeyMetrics` writes it. Arbitrary figures: every
 * assertion below is about which sections exist and which document they land
 * in, never about what any of them says. It has to be present rather than
 * empty, because the chapters are typed FROM the record — an empty one
 * correctly composes nothing, which would make the test below pass for the
 * wrong reason.
 */
const FINANCIALS = {
  income: { weeklyRent: 800, annualRent: 41_600, occupancyWeeks: 50, effectiveAnnualRent: 40_000 },
  initialCosts: { propertyValue: 1_000_000, deposit: 200_000, stampDuty: 40_000, totalUpfront: 250_000 },
  loanDetails: { loanAmount: 800_000, interestRate: 6.2, loanTerm: 30, lvr: 80, loanType: 'principal_and_interest', structure: 'Principal and interest over 30 years', monthlyPayment: 4_900, annualPayment: 58_800 },
  annualCosts: { councilRates: 2_000, waterRates: 1_100, landlordInsurance: 1_400, maintenance: 2_000, propertyManagement: 2_800, lettingFees: 800, strataFees: 0, landTax: 0, totalAnnual: 10_100 },
  keyMetrics: { grossRentalYield: 4.16, netRentalYield: 3.15, lvr: 80, annualNet: -28_900, weeklyNet: -556, totalInvestment: 250_000 },
  assumptions: { capitalGrowth: 4.5, occupancyWeeks: 50, loanStructure: 'principal_and_interest' },
};

const compose = (over: Record<string, unknown> = {}) => composeForkDocuments({
  registry: undefined as never,
  parentContent: COMPOSITE,
  propertyAddress: '18 Example Street, Sampletown NSW 2155',
  financialCalculations: FINANCIALS,
  financialScore: {},
  composeFinancial: true,
  generatedOn: '2026-09-17',
  ...over,
});

describe('the fork composes both documents outside a deployed runtime', () => {
  it('counts the composite\'s sections without composing anything', () => {
    expect(countCompositeSections(COMPOSITE)).toBe(4);
    expect(countCompositeSections('')).toBe(0);
    // The handler refuses a composite with none before it loads a registry or
    // writes a row, so the count has to be askable on its own.
    expect(countCompositeSections('# Title only, no H2')).toBe(0);
  });

  it('sends each section to the variant the registry routes it to', async () => {
    const registry = await loadSplitRegistry(NO_OVERLAY);
    const docs = compose({ registry });
    const fin = [...docs.financial.markdown.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
    const pldd = [...docs.dueDiligence.markdown.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);

    // Money goes to the Financial report, land goes to Due Diligence, and
    // neither document is the other's.
    expect(fin.join(' ')).toMatch(/Purchase Costs|Financial/);
    expect(pldd.join(' ')).toMatch(/Planning|Transport|Property/);
    expect(pldd.join(' ')).not.toMatch(/Purchase Costs & Annual Holding/);
  });

  it('produces the same bytes twice, because the date is an input', async () => {
    const registry = await loadSplitRegistry(NO_OVERLAY);
    const a = compose({ registry });
    const b = compose({ registry });
    expect(a.financial.markdown).toBe(b.financial.markdown);
    expect(a.dueDiligence.markdown).toBe(b.dueDiligence.markdown);
    // …and the date it prints is the one it was given, in `en-AU`.
    expect(a.financial.markdown).toContain('17 September 2026');
  });

  it('composes the financial chapters only when the Financial report is asked for', async () => {
    const registry = await loadSplitRegistry(NO_OVERLAY);
    expect(compose({ registry }).composedChapters.length).toBeGreaterThan(0);
    expect(compose({ registry, composeFinancial: false }).composedChapters).toEqual([]);
    // The Due Diligence document is the same either way — the chapters are
    // the Financial report's and reach nothing else.
    expect(compose({ registry, composeFinancial: false }).dueDiligence.markdown)
      .toBe(compose({ registry }).dueDiligence.markdown);
  });

  it('gives every document a cover, a disclaimer and the property it is about', async () => {
    const registry = await loadSplitRegistry(NO_OVERLAY);
    const docs = compose({ registry });
    for (const doc of [docs.financial.markdown, docs.dueDiligence.markdown]) {
      expect(doc).toContain('18 Example Street, Sampletown NSW 2155');
      expect(doc).toContain('## Disclaimer');
      expect(doc.trimStart().startsWith('# ')).toBe(true);
    }
    // Two different reports, not one document twice.
    expect(docs.financial.markdown).not.toBe(docs.dueDiligence.markdown);
  });
});
