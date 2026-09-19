/**
 * The Market Intelligence family catalogue.
 *
 * The assertion that earns its place here is the first one: every conditional
 * must construct. This catalogue shipped with `marketIntel.layers.0` — the
 * numeric-segment SyntaxError — in all thirty-two layer-page conditionals, so
 * the format's eight layers, the document itself, were silently dark on every
 * one of the fifty masters while the cover, the summary and the calendar
 * rendered around the hole.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { evalConditional } from '@/lib/reportTemplate/bindingResolver';
import { MARKET_INTELLIGENCE_TEMPLATES }
  from '../../../../scripts/template-library/investmentCompass/marketIntelligence';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

const marketIntel = SAMPLE.marketIntel as Record<string, any>;

describe('the conditionals', () => {
  it('constructs every expression, because one that throws is a silently dark page', () => {
    const seen = new Set<string>();
    for (const t of MARKET_INTELLIGENCE_TEMPLATES.slice(0, 5)) {
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
    expect(seen.size).toBeGreaterThan(40);
    for (const cond of seen) {
      expect(
        () => new Function('marketIntel', 'org', 'report', `return (${cond});`),
        `does not parse: ${cond}`,
      ).not.toThrow();
    }
  });

  it('lights every layer page for a report that has the layer', () => {
    // The regression this catalogue shipped with, asserted end to end: eight
    // sample layers minus the deliberately empty one leaves seven, and each
    // must open its page.
    const t = MARKET_INTELLIGENCE_TEMPLATES[0];
    const visible = (t.schema.pages as any[])
      .filter((p) => !p.conditional || evalConditional(String(p.conditional), { data: SAMPLE, tokens: {} } as any))
      .map((p) => p.name);
    for (let i = 1; i <= (marketIntel.layers as any[]).length; i += 1) {
      expect(visible, `Layer ${i} is dark`).toContain(`Layer ${i}`);
    }
    expect(visible).not.toContain(`Layer ${(marketIntel.layers as any[]).length + 1}`);
  });

  it('draws the event notes under mutually exclusive depths', () => {
    const evalWith = (cond: string, env: Record<string, unknown>) => {
      try { return Boolean(new Function('marketIntel', `return (${cond});`)(env)); }
      catch { return false; }
    };
    for (const t of MARKET_INTELLIGENCE_TEMPLATES.slice(0, 5)) {
      let groups = 0;
      for (const page of t.schema.pages as any[]) {
        const conds = ((page.blocks ?? []) as any[])
          .filter((b) => b.type === 'definition-list'
            && typeof b.conditional === 'string' && b.conditional.includes('eventNotes.length'))
          .map((b) => String(b.conditional));
        if (conds.length < 2) continue;
        groups += 1;
        for (let n = 1; n <= 10; n += 1) {
          const env = { eventNotes: Array.from({ length: n }, () => ({})) };
          const holding = conds.filter((cond) => evalWith(cond, env));
          expect(holding.length, `${t.name} "${page.name}" n=${n}`).toBe(1);
        }
      }
      expect(groups, t.name).toBe(2);
    }
  });
});

describe('every bound path has a producer', () => {
  /**
   * Whole-sentence notes deliberately absent from a sample that shows an
   * uncapped document, plus the correlation block no stored row carries yet —
   * each proven by the projection spec instead.
   */
  const ALLOWED_ABSENT = new Set([
    'marketIntel.truncationNote', 'marketIntel.citationsOmitted',
    'marketIntel.eventNotesOmitted', 'marketIntel.layers.0.omissionNote',
    'marketIntel.correlation.analysis', 'marketIntel.correlation.analysisPages',
    'marketIntel.correlation.research', 'marketIntel.correlation.researchPages',
  ]);

  it('resolves every master binding against the projection-built sample', () => {
    const paths = new Set<string>();
    for (const t of MARKET_INTELLIGENCE_TEMPLATES) {
      for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) paths.add(m[1]);
    }
    const flat = new Set<string>();
    const walk = (value: unknown, path: string) => {
      flat.add(path);
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(marketIntel, 'marketIntel');
    walk(SAMPLE.org, 'org');
    walk(SAMPLE.report, 'report');

    const missing = [...paths]
      .filter((p) => p === 'marketIntel' || p.startsWith('marketIntel.') || p.startsWith('org.') || p.startsWith('report.'))
      .filter((p) => !flat.has(p)
        && !flat.has(p.replace(/\.\d+\./g, '.0.'))
        && !ALLOWED_ABSENT.has(p)
        && !ALLOWED_ABSENT.has(p.replace(/\.\d+\./g, '.0.')))
      .sort();
    expect(missing).toEqual([]);
  });
});

describe('rendering the sample', () => {
  const t = MARKET_INTELLIGENCE_TEMPLATES[0];
  const html = () => renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html;

  it('draws the layers, which it could not before the brackets', () => {
    const page = html();
    expect(page).toContain('RBA &amp; Interest Rate Analysis');
    expect(page).toContain('Competitive Strategic Edge');
    expect(page).toContain('90-Day Strategic Outlook');
    // The deliberately empty layer is named, never silently missing.
    expect(page).toContain('Regulatory &amp; Policy Watch');
    expect(page).toContain('returned no content');
  });

  it('draws the timeline in the legacy\'s cells and the notes under it', () => {
    const page = html();
    expect(page).toContain('16 Sep 2026');
    expect(page).toContain('interest rate');
    expect(page).toContain('Neutral');
    expect(page).toContain('What each event meant');
    expect(page).toContain('The hold was expected; the dropped easing bias was not.');
  });

  it('closes with the edition\'s panel and the brand\'s own close', () => {
    const page = html();
    expect(page).toContain('Investor Edition');
    expect(page).toContain('What this means for your portfolio');
    expect(page).toContain('Why Meridian Property Advisory?');
    expect(page).toContain('Contact Meridian Property Advisory');
    // The model's email call-to-action stays out of the document.
    expect(page).not.toContain('Book a strategy call');
  });

  it('renders without an unresolved binding anywhere', () => {
    for (const master of MARKET_INTELLIGENCE_TEMPLATES.filter((x) => /-0(1|3)-/.test(x.slug))) {
      const { html: h } = renderTemplateToHtml(master.schema as any, { data: SAMPLE });
      expect(h, master.slug).not.toContain('{{');
    }
  });

  it('drops every conditional page for a namespace that is not there', () => {
    const bare = { ...SAMPLE, marketIntel: undefined } as Record<string, unknown>;
    const visible = (t.schema.pages as any[])
      .filter((p) => !p.conditional || evalConditional(String(p.conditional), { data: bare, tokens: {} } as any))
      .map((p) => p.name);
    expect(visible.filter((n) => !['Cover', 'Important information'].includes(n))).toEqual([]);
  });
});
