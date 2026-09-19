/**
 * The Commercial & Industrial Capacity family catalogue.
 *
 * The assertions that matter here are the ones the projection cannot make
 * alone: that every conditional constructs (a SyntaxError in one is a page
 * that is silently dark forever), that depth variants are mutually exclusive,
 * that every bound path has a producer in the projection-built sample — which
 * did not exist at all until August 2026, so every preview rendered a cover
 * with no title — and that the `capacity` namespace this format shares with
 * the voice templates' residential vocabulary stays collision-free.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { evalConditional } from '@/lib/reportTemplate/bindingResolver';
import { COMMERCIAL_CAPACITY_TEMPLATES }
  from '../../../../scripts/template-library/investmentCompass/commercialCapacity';
import { projectCommercialCapacity }
  from '../../../../supabase/functions/_shared/commercialCapacityProjection.pure';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

const capacity = SAMPLE.capacity as Record<string, any>;

describe('the conditionals', () => {
  it('constructs every expression, because one that throws is a silently dark page', () => {
    const seen = new Set<string>();
    for (const t of COMMERCIAL_CAPACITY_TEMPLATES.slice(0, 5)) {
      const collect = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (typeof node.conditional === 'string') seen.add(node.conditional);
        for (const v of Object.values(node)) {
          if (Array.isArray(v)) v.forEach(collect);
          else collect(v);
        }
      };
      (t.schema.pages as any[]).forEach(collect);
    }
    expect(seen.size).toBeGreaterThan(20);
    for (const cond of seen) {
      expect(
        () => new Function('capacity', 'org', 'report', `return (${cond});`),
        `does not parse: ${cond}`,
      ).not.toThrow();
    }
  });

  it('draws every depth-varied table under mutually exclusive depths', () => {
    /*
     * The variant sets key on four different count shapes — a scalar count
     * (`tenancyCount`, `periodCount`, `warningCount`) and an array length
     * (`ratioRows`, `serviceability.rows`, `portfolio.rows`) — so each group
     * is exercised with the environment it actually reads.
     */
    const evalWith = (cond: string, env: Record<string, unknown>) => {
      try { return Boolean(new Function('capacity', `return (${cond});`)(env)); }
      catch { return false; }
    };
    const GROUPS: Array<[string, (n: number) => Record<string, unknown>]> = [
      ['tenancyCount', (n) => ({ propertyIncome: { tenancyCount: n, tenancies: [{}] } })],
      ['periodCount', (n) => ({ businessIncome: { periodCount: n, periods: [{}] } })],
      ['warningCount', (n) => ({ warnings: [{}], warningCount: n })],
      ['ratioRows.length', (n) => ({ ratioRows: Array.from({ length: n }, () => ({})) })],
      ['serviceability.rows.length', (n) => ({ serviceability: { rows: Array.from({ length: n }, () => ({})) } })],
      ['portfolio.rows.length', (n) => ({ portfolio: { rows: Array.from({ length: n }, () => ({})) } })],
    ];
    let groupsSeen = 0;
    for (const t of COMMERCIAL_CAPACITY_TEMPLATES.slice(0, 5)) {
      for (const page of t.schema.pages as any[]) {
        for (const [key, env] of GROUPS) {
          const conds = ((page.blocks ?? []) as any[])
            .filter((b) => b.type === 'data-table'
              && typeof b.conditional === 'string' && b.conditional.includes(key))
            .map((b) => String(b.conditional));
          if (conds.length < 2) continue;
          groupsSeen += 1;
          for (let n = 1; n <= 12; n += 1) {
            const holding = conds.filter((cond) => evalWith(cond, env(n)));
            expect(holding.length, `${t.name} "${page.name}" ${key} n=${n}`).toBe(1);
          }
        }
      }
    }
    expect(groupsSeen).toBe(5 * 6);
  });
});

describe('every bound path has a producer', () => {
  /**
   * Whole-sentence omission notes deliberately absent from a sample that shows
   * an uncapped document — each proven by the projection spec instead.
   */
  const ALLOWED_ABSENT = new Set([
    'capacity.constraintsOmitted', 'capacity.warningsOmitted',
    'capacity.compliance.flagsOmitted', 'capacity.transaction.fundingGapNote',
    'capacity.businessIncome.decliningNote', 'capacity.methodOmitted',
  ]);

  it('resolves every master binding against the projection-built sample', () => {
    const paths = new Set<string>();
    for (const t of COMMERCIAL_CAPACITY_TEMPLATES) {
      for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) paths.add(m[1]);
    }
    const flat = new Set<string>();
    const walk = (value: unknown, path: string) => {
      flat.add(path);
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(capacity, 'capacity');
    walk(SAMPLE.org, 'org');
    walk(SAMPLE.report, 'report');

    const missing = [...paths]
      .filter((p) => p === 'capacity' || p.startsWith('capacity.') || p.startsWith('org.') || p.startsWith('report.'))
      .filter((p) => !flat.has(p) && !flat.has(p.replace(/\.\d+\./g, '.0.')) && !ALLOWED_ABSENT.has(p))
      .sort();
    expect(missing).toEqual([]);
  });

  it('shares the namespace with the voice vocabulary without a collision', () => {
    // `capacity.borrowing`, `capacity.band` and their siblings serve the voice
    // templates' residential Snapshot bindings; this format's keys arrive by
    // spread. A key both sides write would mean one format previews the
    // other's data.
    const projected = new Set(Object.keys(
      projectCommercialCapacity({
        meta: { subject: 'x' }, headline: {}, ratios: {}, constraints: [],
        transaction: {}, serviceability: {}, warnings: [], outstanding: [],
        nextActions: [], method: [], analysis: null,
      } as any).capacity,
    ));
    for (const voiceKey of ['borrowing', 'stressTested', 'monthlySurplus', 'annualSurplus', 'band', 'bandLabel', 'dti', 'dtiLabel', 'depositAmount', 'propertyValueEstimate']) {
      expect(projected.has(voiceKey), `projection also writes capacity.${voiceKey}`).toBe(false);
      expect(voiceKey in capacity, `sample lost capacity.${voiceKey}`).toBe(true);
    }
  });
});

describe('rendering the sample', () => {
  const t = COMMERCIAL_CAPACITY_TEMPLATES[0];
  const html = () => renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html;

  it('draws the tests table with its real columns, three states included', () => {
    const page = html();
    // The columns that rendered empty on every row while the projection read
    // fields the payload never had.
    expect(page).toContain('$986,400');
    expect(page).toContain('Binds');
    expect(page).toContain('Does not bind');
    expect(page).toContain('Not applicable');
    expect(page).toContain('is what sets this capacity');
  });

  it('draws the ledger, the schedule, the periods and the portfolio', () => {
    const page = html();
    expect(page).toContain('Surplus after debt service');
    expect(page).toContain('Coastal Fabrication Services Pty Ltd');
    expect(page).toContain('FY2024');
    expect(page).toContain('weakens the borrower');
    // The change column, signed by the formatDelta whose rate bug this
    // format's first render found.
    expect(page).toContain('+4.6%');
    expect(page).toContain('Business purpose (indicative)');
  });

  it('renders without an unresolved binding anywhere', () => {
    for (const master of COMMERCIAL_CAPACITY_TEMPLATES.filter((x) => /-0(1|3)-/.test(x.slug))) {
      const { html: h } = renderTemplateToHtml(master.schema as any, { data: SAMPLE });
      expect(h, master.slug).not.toContain('{{');
    }
  });

  it('labels the model prose, with the attribution beside the note', () => {
    const page = html();
    expect(page).toContain('written by a language model');
    expect(page).toContain('Written by google/gemini-2.5-flash on 01 August 2026.');
  });

  it('drops every conditional page for a namespace that is not there', () => {
    const bare = { ...SAMPLE, capacity: undefined } as Record<string, unknown>;
    const visible = (t.schema.pages as any[])
      .filter((p) => !p.conditional || evalConditional(String(p.conditional), { data: bare, tokens: {} } as any))
      .map((p) => p.name);
    // Cover and the closing page are unconditional; every content page gates
    // on its own section of the projection.
    expect(visible.filter((n) => !['Cover', 'Important information'].includes(n))).toEqual([]);
  });
});
