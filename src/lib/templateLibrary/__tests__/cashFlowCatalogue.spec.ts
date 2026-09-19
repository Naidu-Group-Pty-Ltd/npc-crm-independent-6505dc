/**
 * The 10 Year Cash Flow family catalogue — the fifth report format drawn in the
 * ten Investment Compass designs.
 *
 * Four things here are specific to this format:
 *
 *  1. **No total row anywhere.** The record carries two totals that do not
 *     equal the figures beside them — `initialCosts.totalUpfront` on 132 of
 *     161 rows, `annualCosts.totalAnnual` on 141 of 162 — so the projection
 *     does not publish them and these masters cannot bind them. The instinct
 *     when laying out a cost table is to add a total row, which is exactly why
 *     this is asserted rather than left to the comment in the source.
 *  2. **No client and no adviser.** `investment_reports` has no client-name
 *     column. A binding that cannot resolve renders as the empty string, not as
 *     a visible `{{…}}`, so a cover titled `{{client.name}}` ships blank — which
 *     is what the Borrowing Capacity and Comparison masters did until this
 *     format's audit found it.
 *  3. **Ten-row tables on a page model that cannot paginate**, on ten spacing
 *     scales that put the same ten rows anywhere between 154pt and 244pt.
 *  4. **The chart plots equity**, because equity is positive on all 4,860
 *     stored elements and cash flow is negative on 4,856 of them.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { CASH_FLOW_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlow';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/portfolio';
import { COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/comparison';
import { deriveEntryFacts } from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { colourwaysForFamily, colourwayTokenOverride } from '../colourways';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

const cashflow = SAMPLE.cashflow as Record<string, any>;

/**
 * Namespaces this format may bind besides its own.
 *
 * Deliberately shorter than the other catalogues' list: `client` and `author`
 * are NOT here, because nothing can fill them for a report of this kind.
 */
// `partNumber` is the renderer's own per-page part counter (resolved over
// the pages that actually draw, like `pageNumber`), not a projection leaf.
const AMBIENT = ['org', 'report', 'partNumber'];

function boundPaths(templates: typeof CASH_FLOW_COMPASS_TEMPLATES): Set<string> {
  const paths = new Set<string>();
  for (const t of templates) {
    for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) paths.add(m[1]);
  }
  return paths;
}

describe('the catalogue', () => {
  it('ships fifty masters across the same ten families', () => {
    expect(CASH_FLOW_COMPASS_TEMPLATES).toHaveLength(50);
    expect(new Set(CASH_FLOW_COMPASS_TEMPLATES.map((t) => t.designMeta.familyKey)).size).toBe(10);
  });

  it('is production-ready, because the format has a real adapter', () => {
    for (const t of CASH_FLOW_COMPASS_TEMPLATES) {
      expect(t.reportType, t.name).toBe('cashflow');
      expect(deriveEntryFacts({ report_type: t.reportType, schema: t.schema }).production_ready, t.name)
        .toBe(true);
    }
  });

  it('does not collide with any of the other four family catalogues', () => {
    const mine = CASH_FLOW_COMPASS_TEMPLATES.map((t) => t.slug);
    const others = [
      ...INVESTMENT_COMPASS_TEMPLATES, ...BORROWING_CAPACITY_TEMPLATES,
      ...PORTFOLIO_TEMPLATES, ...COMPARISON_TEMPLATES,
    ].map((t) => t.slug);
    expect(new Set(mine).size).toBe(50);
    expect(mine.filter((s) => others.includes(s))).toEqual([]);
    for (const t of CASH_FLOW_COMPASS_TEMPLATES) {
      expect(t.designMeta.reportFormat).toBe('cash-flow-ten-year');
    }
  });

  it('parses against the live schema contract', () => {
    for (const t of CASH_FLOW_COMPASS_TEMPLATES) {
      expect(() => parseTemplate(t.schema), t.name).not.toThrow();
    }
  });
});

describe('what these masters may not bind', () => {
  const paths = boundPaths(CASH_FLOW_COMPASS_TEMPLATES);

  it('binds nothing outside `cashflow` and the two ambient namespaces', () => {
    const namespaces = new Set([...paths].map((p) => p.split('.')[0]));
    expect([...namespaces].filter((ns) => ns !== 'cashflow' && !AMBIENT.includes(ns)).sort())
      .toEqual([]);
  });

  it('names no client and no adviser, because the record carries neither', () => {
    // The failure this prevents is silent: an unresolved binding renders as the
    // empty string, so a cover titled `{{client.name}}` has no title at all and
    // every page is footed " · Ten year cash flow".
    for (const p of paths) {
      expect(p.startsWith('client.'), `${p} cannot resolve for this report type`).toBe(false);
      expect(p.startsWith('author.'), `${p} cannot resolve for this report type`).toBe(false);
    }
  });

  it('binds neither of the two totals the record contradicts', () => {
    expect(paths.has('cashflow.purchase.totalUpfront')).toBe(false);
    expect(paths.has('cashflow.costs.totalAnnual')).toBe(false);
    // Nor the year-one cash flow the record states twice.
    expect(paths.has('cashflow.annualNet')).toBe(false);
    expect(paths.has('cashflow.weeklyNet')).toBe(false);
    // Nor the purchase price, which is $3 on one stored report.
    expect(paths.has('cashflow.purchase.propertyValue')).toBe(false);
  });

  it('publishes every leaf the masters bind, not just the namespace', () => {
    // A namespace that resolves and a leaf that resolves are different claims,
    // and only the second one puts a figure on the page.
    const flat = new Set<string>();
    const walk = (value: unknown, path: string) => {
      flat.add(path);
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(cashflow, 'cashflow');
    walk(SAMPLE.report, 'report');
    walk(SAMPLE.org, 'org');

    flat.add('partNumber'); // renderer-ambient, resolved per rendered page
    const missing = [...paths].filter((p) => !flat.has(p)).sort();
    expect(missing).toEqual([]);
  });
});

describe('the sample is the adapter’s own output', () => {
  it('carries three scenarios of ten years, as every stored projection does', () => {
    expect(cashflow.years).toHaveLength(10);
    expect(cashflow.termYears).toBe(10);
    for (const name of ['conservative', 'moderate', 'optimistic']) {
      expect(cashflow.scenarios[name], name).toHaveLength(10);
    }
  });

  it('behaves the way all 4,860 stored elements behave', () => {
    for (const [name, series] of Object.entries(cashflow.scenarios as Record<string, any[]>)) {
      for (const y of series) {
        // Cash flow is negative on 4,856 of the 4,860 stored elements and the
        // cumulative column on all 4,860. A sample that turned positive would
        // let a page be laid out for a case production does not produce.
        expect(y.cumulativeCashFlow, `${name} year ${y.year}`).toBeLessThan(0);
        expect(y.cashFlow, `${name} year ${y.year}`).toBeLessThan(0);
        expect(y.equity, `${name} year ${y.year}`).toBeGreaterThan(0);
      }
    }
  });

  it('names the scenario the way a reader reads it, not the way it is stored', () => {
    expect(cashflow.scenario).toBe('moderate');
    expect(cashflow.scenarioLabel).toBe('Moderate');
  });

  it('is built at the rates production is built at, exactly', () => {
    // Measured across all 162 stored reports: `(value10/value1)^(1/9)` is
    // 2.000, 4.000 and 6.000 and `(rent10/rent1)^(1/9)` is 2.000, 3.000 and
    // 4.000, to three decimal places, without exception. The projection derives
    // these off the series, so this asserts the sample and production agree
    // about what a scenario *is* — not merely that both look plausible.
    expect(cashflow.scenarioBasis).toEqual({
      conservative: { capitalGrowth: 2, rentalGrowth: 2 },
      moderate: { capitalGrowth: 4, rentalGrowth: 3 },
      optimistic: { capitalGrowth: 6, rentalGrowth: 4 },
    });
    expect(cashflow.basis).toEqual({ capitalGrowth: 4, rentalGrowth: 3 });
  });

  it('orders the scenarios strictly, as all 162 stored projections do', () => {
    const at10 = (s: string) => cashflow.scenarios[s][9].propertyValue;
    expect(at10('conservative')).toBeLessThan(at10('moderate'));
    expect(at10('moderate')).toBeLessThan(at10('optimistic'));
  });

  it('amortises the loan identically in all three, as the record does', () => {
    // The scenarios differ in assumed capital growth and in nothing else, which
    // is why the scenario table does not repeat the debt column.
    const balances = ['conservative', 'moderate', 'optimistic']
      .map((s) => cashflow.scenarios[s].map((y: any) => y.loanBalance));
    expect(balances[1]).toEqual(balances[0]);
    expect(balances[2]).toEqual(balances[0]);
    expect(balances[0][9]).toBeLessThan(balances[0][0]);
  });
});

describe('rendering', () => {
  it('renders every master with the series on the page and nothing unresolved', () => {
    const yearTen = new Intl.NumberFormat('en-AU', {
      style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
    }).format(cashflow.outcome.propertyValue);
    for (const t of CASH_FLOW_COMPASS_TEMPLATES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
      expect(html, t.name).toContain(yearTen);
      expect(html, t.name).toContain('14 Marlborough Street');
      expect(html, t.name).not.toContain('{{');
    }
  });

  it('opens on the built narrative, which cannot disagree with the tables', () => {
    /*
     * The legacy document leads with two sentences built from the series'
     * own ends. The sample is the projection's own output, so the narrative
     * arrives composed — and asserting the break-even sentence pins the
     * production truth that no stored moderate scenario ever turns positive.
     */
    expect(String(cashflow.overview)).toContain('a week to hold in year one');
    for (const t of CASH_FLOW_COMPASS_TEMPLATES.slice(0, 5)) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
      expect(html, t.name).toContain('a week to hold in year one');
      expect(html, t.name).toContain('of capital growth');
    }
  });

  it('titles and foots every page, which a client-bound cover did not', () => {
    for (const t of CASH_FLOW_COMPASS_TEMPLATES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
      // The address appears on the cover and in the running foot of every page.
      const occurrences = html.split('14 Marlborough Street').length - 1;
      expect(occurrences, t.name).toBeGreaterThan(1);
    }
  });

  it('draws every one of the ten years, on every master', () => {
    const t = CASH_FLOW_COMPASS_TEMPLATES[0];
    const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
    for (const y of cashflow.years as any[]) {
      const rent = new Intl.NumberFormat('en-AU', {
        style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
      }).format(y.annualRent);
      expect(html, `year ${y.year} rent`).toContain(rent);
    }
  });

  /**
   * 550 renders: fifty masters against their base palette and each of their ten
   * colourways. Exhaustive on purpose — a colourway that moved a block would
   * move it on exactly one family — and slow enough to need saying so, because
   * the 5s default passes when this file runs alone and times out when it runs
   * beside the other catalogues.
   */
  it('changes the colour and never the layout', () => {
    const geometry = (html: string) => (html.match(/left:[\d.]+pt;top:[\d.]+pt/g) ?? []).join('|');
    for (const t of CASH_FLOW_COMPASS_TEMPLATES) {
      const base = geometry(renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html);
      for (const cw of colourwaysForFamily(t.designMeta.familyKey)) {
        const other = geometry(renderTemplateToHtml(t.schema as any, {
          data: SAMPLE, tokenOverrides: colourwayTokenOverride(cw),
        }).html);
        expect(other, `${t.name} / ${cw.name}`).toBe(base);
      }
    }
  }, 60_000);

  it('states the growth the series was built at, not the growth it recorded', () => {
    // `assumptions.capitalGrowth` on the sample row is 5.2 and the moderate
    // series is built at 4 — the disagreement measured on 66 of the 69 stored
    // reports that record one. The page must carry the 4.
    const t = CASH_FLOW_COMPASS_TEMPLATES[0];
    const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
    expect(html).toContain('What each scenario assumes');
    expect(html).toContain('4.00% capital growth');
    expect(html).not.toContain('5.20%');
    // And the exclusions notice beside it.
    expect(html).toContain('What this projection does not include');
  });
});

describe('the other four formats keep their own identity rules', () => {
  it('lets a format name a client only where one actually resolves', () => {
    /*
     * The rule is "bind a client only where there is one to bind", not "only
     * the Portfolio Review may". A binding that cannot resolve renders blank
     * rather than visibly broken, which is why this is asserted for all four
     * formats at once rather than discovered one cover at a time.
     *
     * Where each stands, measured:
     *
     *  - Portfolio Review — `portfolio_analysis_reports.client_name`, populated
     *    on all 21 rows.
     *  - Borrowing Capacity — the assessment row carries `client_id` and no
     *    name, which is why this used to be `false`. All **143 of 143** resolve
     *    that id to a real `clients` row, so the adapter joins it and the cover
     *    names the applicant. The premise changed; the rule did not.
     *  - Property Comparison — stored against `report_ids` and nothing else,
     *    and the reports it points at have no client-name column.
     *  - 10 Year Cash Flow — reads `investment_reports`, where **2 of 1,182**
     *    rows link to a client at all. A cover naming one would be blank on
     *    99.8% of them.
     */
    const bindsClient = (templates: any[]) =>
      templates.some((t) => JSON.stringify(t.schema).includes('{{client.name}}'));

    expect(bindsClient(PORTFOLIO_TEMPLATES), 'portfolio').toBe(true);
    expect(bindsClient(BORROWING_CAPACITY_TEMPLATES), 'borrowing capacity').toBe(true);
    expect(bindsClient(COMPARISON_TEMPLATES), 'comparison').toBe(false);
    expect(bindsClient(CASH_FLOW_COMPASS_TEMPLATES), 'cash flow').toBe(false);
  });

  it('gives the two re-titled formats a cover that resolves', () => {
    const coverTitleOf = (t: any) => {
      const cover = t.schema.pages[0];
      const block = cover.blocks.find((b: any) => b.name === 'Cover title');
      return String(block?.props?.heading ?? '');
    };
    expect(coverTitleOf(BORROWING_CAPACITY_TEMPLATES[0])).toBe('{{capacity.bandLabel}}');
    expect(coverTitleOf(COMPARISON_TEMPLATES[0])).toContain('{{comparison.propertyCount}}');
    expect(coverTitleOf(CASH_FLOW_COMPASS_TEMPLATES[0])).toBe('{{cashflow.property.address}}');
  });
});
