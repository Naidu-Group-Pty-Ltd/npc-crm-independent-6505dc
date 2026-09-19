/**
 * The Cash Flow Comparison family catalogue — the seventh report format drawn
 * in the ten Investment Compass designs, and the first that is preview-only.
 *
 * Two things here are unlike the other six.
 *
 * **It is preview-only on purpose, and the spec says why.** A comparison is
 * persisted nowhere a template can reach — see
 * `cashFlowComparisonProjection.pure.ts`. Marking these masters production-ready
 * would tell an operator on the card that a copy could be activated, and it
 * could not.
 *
 * **The rules it must not break are editorial rather than numeric.** Model prose
 * names no property; `avoid` is not on the ranking page; `highestRisk` is not a
 * scoreboard row; a score is never printed with a denominator. Each comes from
 * `docs/reports/CASH_FLOW_COMPARISON.md`, each is a decision somebody made about
 * what a document may say, and each would be silently undone by an ordinary
 * refactor of the page sequence.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { evalConditional } from '@/lib/reportTemplate/bindingResolver';
import { CASH_FLOW_COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlowComparison';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/portfolio';
import { COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/comparison';
import { CASH_FLOW_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/cashFlow';
import { CLIENT_DETAILS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/clientDetails';
import { deriveEntryFacts } from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { colourwaysForFamily, colourwayTokenOverride } from '../colourways';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

const cfc = SAMPLE.cashFlowComparison as Record<string, any>;

/** Namespaces this format may bind besides its own. */
// `partNumber` is the renderer's own per-page part counter (resolved over
// the pages that actually draw, like `pageNumber`), not a projection leaf.
const AMBIENT = ['org', 'report', 'client', 'partNumber'];

/** A comparison the adviser never asked an analysis for. */
const NO_ANALYSIS = (() => {
  const { analysis, ...rest } = cfc;
  return { ...SAMPLE, cashFlowComparison: { ...rest, hasAnalysis: false } };
})();

function boundPaths(): Set<string> {
  const paths = new Set<string>();
  for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
    for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) paths.add(m[1]);
  }
  return paths;
}

function visiblePages(schema: any, data: Record<string, unknown>): any[] {
  const ctx = { data, tokens: schema.tokens ?? { colors: {}, fonts: {}, spacing: {} } } as any;
  return schema.pages.filter((p: any) => !p.conditional || evalConditional(p.conditional, ctx));
}

function pageNamed(t: any, name: string): any {
  return t.schema.pages.find((p: any) => p.name === name);
}

describe('the catalogue', () => {
  it('ships fifty masters across the same ten families', () => {
    expect(CASH_FLOW_COMPARISON_TEMPLATES).toHaveLength(50);
    expect(new Set(CASH_FLOW_COMPARISON_TEMPLATES.map((t) => t.designMeta.familyKey)).size).toBe(10);
  });

  it('is preview-only, and that is the honest answer rather than an oversight', () => {
    // A comparison is persisted nowhere a template can reach: the projections
    // are the browser's, `cash_flow_analyses` refuses every write, and the
    // render ledger holds 0 rows and stores neither. Saying "production-ready"
    // on the card would be a claim an operator would act on.
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      expect(t.reportType, t.name).toBe('cash_flow_comparison');
      expect(deriveEntryFacts({ report_type: t.reportType, schema: t.schema }).production_ready, t.name)
        .toBe(false);
    }
  });

  it('does not collide with any of the other six family catalogues', () => {
    const mine = CASH_FLOW_COMPARISON_TEMPLATES.map((t) => t.slug);
    const others = [
      ...INVESTMENT_COMPASS_TEMPLATES, ...BORROWING_CAPACITY_TEMPLATES,
      ...PORTFOLIO_TEMPLATES, ...COMPARISON_TEMPLATES,
      ...CASH_FLOW_COMPASS_TEMPLATES, ...CLIENT_DETAILS_TEMPLATES,
    ].map((t) => t.slug);
    expect(new Set(mine).size).toBe(50);
    expect(mine.filter((s) => others.includes(s))).toEqual([]);
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      expect(t.designMeta.reportFormat).toBe('cash-flow-comparison');
    }
  });

  it('parses against the live schema contract', () => {
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      expect(() => parseTemplate(t.schema), t.name).not.toThrow();
    }
  });

  it('binds nothing outside `cashFlowComparison` and the ambient namespaces', () => {
    const namespaces = new Set([...boundPaths()].map((p) => p.split('.')[0]));
    expect([...namespaces].filter((ns) => ns !== 'cashFlowComparison' && !AMBIENT.includes(ns)).sort())
      .toEqual([]);
  });

  it('publishes every leaf the masters bind', () => {
    const flat = new Set<string>();
    const walk = (value: unknown, path: string) => {
      flat.add(path);
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(cfc, 'cashFlowComparison');
    walk(SAMPLE.report, 'report');
    walk(SAMPLE.org, 'org');

    // A leaf may legitimately be absent on a given record — `matched` is
    // published only when a ranking matched nothing, and a second weakness only
    // when the model wrote one. What must never be absent is the object it
    // hangs off: a binding whose PARENT does not exist is a namespace the
    // projection cannot publish, and that is the defect this catches.
    const parentOf = (path: string) => path.slice(0, path.lastIndexOf('.'));
    const known = (path: string) => flat.has(path) || flat.has(path.replace(/\.\d+\./g, '.0.'));
    flat.add('partNumber'); // renderer-ambient, resolved per rendered page
    const missing = [...boundPaths()]
      .filter((p) => !known(p) && !known(parentOf(p)))
      .sort();
    expect(missing).toEqual([]);
  });
});

describe('the tables change shape with the property count', () => {
  it('draws every property-wide table once per count, at one position', () => {
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      const ranking = pageNamed(t, 'Which comes out ahead');
      const tables = (ranking?.blocks ?? []).filter(
        (b: any) => b.type === 'data-table' && JSON.stringify(b.props).includes('ranked.0.rank'),
      ) as any[];
      expect(tables, t.name).toHaveLength(4);
      expect(new Set(tables.map((b) => b.props.y)).size, t.name).toBe(1);
      for (const b of tables) expect(b.conditional, t.name).toContain('propertyCount');
      expect(tables.map((b) => b.props.rows.length).sort()).toEqual([2, 3, 4, 5]);
    }
  });

  it('renders exactly one of them, whatever the count', () => {
    const t = CASH_FLOW_COMPARISON_TEMPLATES[0];
    for (const count of [2, 3, 4, 5]) {
      const properties = Array.from({ length: count }, (_, i) => ({
        ...cfc.properties[0], number: i + 1, shortAddress: `Property ${i + 1}`,
      }));
      const ranked = properties.map((p, i) => ({ ...p, rank: i + 1 }));
      const { html } = renderTemplateToHtml(t.schema as any, {
        data: { ...SAMPLE, cashFlowComparison: { ...cfc, propertyCount: count, properties, ranked } },
      });
      expect(html, `count ${count}`).toContain(`Property ${count}`);
      expect(html, `count ${count}`).not.toContain(`Property ${count + 1}`);
    }
  });
});

describe('what the contract forbids', () => {
  const source = CASH_FLOW_COMPARISON_TEMPLATES.map((t) => JSON.stringify(t.schema)).join('');

  it('never names a property beside a model sentence', () => {
    // `propertyNumber` indexes an ordering that existed inside one function
    // call and was never recorded. The only attributed model block is
    // `rankings`, matched on an address the model was told to echo.
    for (const path of [
      'analysis.trajectory', 'analysis.capitalGrowth', 'analysis.yields',
      'analysis.risk', 'analysis.investorMatches', 'analysis.recommendation',
    ]) {
      const bound = [...boundPaths()].filter((p) => p.startsWith(`cashFlowComparison.${path}`));
      expect(bound.length, path).toBeGreaterThan(0);
      for (const p of bound) {
        expect(p, `${p} attributes a model sentence to a property`)
          .not.toMatch(/\.(shortAddress|address|number)$/);
      }
    }
  });

  it('keeps `avoid` off the ranking page', () => {
    // Naming a property to avoid beside the ranking, in a document an adviser
    // may hand to a client considering that property, is a different act from
    // ranking it last.
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      const ranking = JSON.stringify(pageNamed(t, 'Which comes out ahead'));
      expect(ranking, t.name).not.toContain('avoid');
    }
    // And it does appear, on the risk page.
    expect(source).toContain('recommendation.avoid');
  });

  it('keeps the highest risk in prose and out of the scoreboard', () => {
    // An award for being the worst is not a category anyone wins.
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      const risk = JSON.stringify(pageNamed(t, 'Risk, and what to avoid'));
      expect(risk, t.name).toContain('risk.highestRisk.reason');
    }
    expect(source).not.toContain('scoreboard.winners.0.key');
  });

  it('never prints a score with a denominator the record does not name', () => {
    // The legacy generator printed `/100` regardless of the schema naming no
    // scale. Fixing the key while keeping the denominator would have turned
    // "undefined" into a confidently wrong number.
    expect(source).not.toMatch(/rankings\.\d+\.score[^}]*}}\s*\/\s*100/);
    expect(source).not.toContain('/ 100');
  });

  it('leads the verdict with the gap rather than the winner’s figure', () => {
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      const kpi = (pageNamed(t, 'Which comes out ahead')?.blocks ?? [])
        .find((b: any) => b.type === 'kpi-grid');
      expect(kpi, t.name).toBeTruthy();
      expect(kpi.props.items[0].value, t.name).toContain('scoreboard.leadMargin');
    }
  });

  it('prints both break-evens, named apart', () => {
    // The modal's is the year cumulative cash flow turns non-negative; the
    // sibling format's is the year annual does. Rarely the same year.
    expect(source).toContain('firstPositiveYear');
    expect(source).toContain('paybackYear');
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
      expect(html, t.name).toContain('First positive year');
      expect(html, t.name).toContain('Payback year');
    }
  });
});

describe('a comparison with no analysis', () => {
  it('drops every analysis page and stays a complete document', () => {
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      const full = visiblePages(t.schema, SAMPLE);
      const bare = visiblePages(t.schema, NO_ANALYSIS);
      expect(bare.length, t.name).toBeLessThan(full.length);

      const names = bare.map((p: any) => p.name);
      expect(names, t.name).toContain('Which comes out ahead');
      expect(names, t.name).toContain('The measures side by side');
      expect(names, t.name).toContain('On what basis');
      for (const gone of [
        'What the analysis found', 'Growth and yield', 'Each property in turn',
        'Who each property suits', 'Risk, and what to avoid',
      ]) {
        expect(names, `${t.name} still draws ${gone}`).not.toContain(gone);
      }
    }
  });

  it('says the figures are the whole of it, rather than leaving it noticed', () => {
    const t = CASH_FLOW_COMPARISON_TEMPLATES[0];
    const bare = renderTemplateToHtml(t.schema as any, { data: NO_ANALYSIS }).html;
    expect(bare).toContain('carries no written analysis');

    const full = renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html;
    expect(full).not.toContain('carries no written analysis');
  });

  it('keeps each analysis page on its own block, because partial is normal', () => {
    // The producer asks for eight sections with maxTokens 4000 and a response
    // that closed its braces early still parses. Gating them together would
    // drop three present sections because a fourth ran out of budget.
    const t = CASH_FLOW_COMPARISON_TEMPLATES[0];
    const partial = {
      ...SAMPLE,
      cashFlowComparison: {
        ...cfc,
        analysis: { summary: cfc.analysis.summary, rankings: cfc.analysis.rankings },
      },
    };
    const names = visiblePages(t.schema, partial).map((p: any) => p.name);
    expect(names).toContain('What the analysis found');
    expect(names).toContain('Each property in turn');
    expect(names).not.toContain('Growth and yield');
    expect(names).not.toContain('Risk, and what to avoid');
  });
});

describe('rendering', () => {
  it('renders every master with the comparison on the page and nothing unresolved', () => {
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      for (const [label, data] of [['full', SAMPLE], ['no analysis', NO_ANALYSIS]] as const) {
        const { html } = renderTemplateToHtml(t.schema as any, { data });
        expect(html, `${t.name} / ${label}`).not.toContain('{{');
        expect(html, `${t.name} / ${label}`).toContain('Marlborough Street');
      }
    }
  });

  it('carries the reference the cover and the running foot share', () => {
    // A date alone does not separate two comparisons run on the same day, which
    // is the normal case when the point of the screen is to try peer sets.
    const { html } = renderTemplateToHtml(CASH_FLOW_COMPARISON_TEMPLATES[0].schema as any, { data: SAMPLE });
    expect(html).toContain(cfc.reference);
  });

  it('draws the wins table with leaders resolved to street lines', () => {
    /*
     * The legacy scoreboard's wins table, which the projection published from
     * the start and no master drew until the binding audit. The leader cell is
     * the resolved street line, never the raw property number — a "1" as a
     * winner's name is a database index on a client's page — and the figure
     * column arrives composed because eight categories mix dollars, percent
     * and years.
     */
    const winners = (cfc.scoreboard as any).winners as Array<Record<string, unknown>>;
    expect(winners.length).toBeGreaterThan(0);
    const { html } = renderTemplateToHtml(CASH_FLOW_COMPARISON_TEMPLATES[0].schema as any, { data: SAMPLE });
    expect(html).toContain('Who leads on what');
    expect(html).toContain(String(winners[0].label));
    expect(html).toContain(String(winners[0].winner));
    expect(html).toContain(String(winners[0].valueLabel));
  });

  it('writes every conditional as an expression that actually evaluates', () => {
    // A conditional is JavaScript, not a binding path — `winners.0.label` is a
    // SyntaxError there, and a conditional that throws at construction answers
    // false forever: the block is silently dark on every render. This
    // catalogue was written with bracket indexes from the start; the test is
    // what keeps that true.
    const seen = new Set<string>();
    const collect = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.conditional === 'string') seen.add(node.conditional);
      for (const v of Object.values(node)) {
        if (Array.isArray(v)) v.forEach(collect);
        else collect(v);
      }
    };
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES.slice(0, 5)) (t.schema.pages as any[]).forEach(collect);
    expect(seen.size).toBeGreaterThan(10);
    for (const cond of seen) {
      expect(
        () => new Function('cashFlowComparison', 'client', 'org', 'report', `return (${cond});`),
        `does not parse: ${cond}`,
      ).not.toThrow();
    }
  });

  /**
   * 550 renders: fifty masters against their base palette and each of their ten
   * colourways. Exhaustive on purpose, and slow enough to need saying so.
   */
  it('changes the colour and never the layout', () => {
    const geometry = (html: string) => (html.match(/left:[\d.]+pt;top:[\d.]+pt/g) ?? []).join('|');
    for (const t of CASH_FLOW_COMPARISON_TEMPLATES) {
      const base = geometry(renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html);
      for (const cw of colourwaysForFamily(t.designMeta.familyKey)) {
        const other = geometry(renderTemplateToHtml(t.schema as any, {
          data: SAMPLE, tokenOverrides: colourwayTokenOverride(cw),
        }).html);
        expect(other, `${t.name} / ${cw.name}`).toBe(base);
      }
    }
  }, 60_000);
});
