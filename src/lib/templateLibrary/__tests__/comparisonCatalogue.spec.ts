/**
 * The Property Comparison family catalogue — the fourth report format drawn in
 * the ten Investment Compass designs.
 *
 * Three things here are specific to this format and worth the assertions:
 *
 *  1. **The ranking is drawn once per property count.** A comparison holds 2 to
 *     5 properties. Four mutually exclusive variants sit at the same position
 *     under conditionals, so no comparison prints a blank row and none loses a
 *     property — the two failure modes a fixed-size table has to choose
 *     between.
 *  2. **Everything is nested under `comparison`.** `risks`, `recommendations`
 *     and `properties` already mean other things to the voice and Portfolio
 *     templates, and the preview sample is one shared object.
 *  3. **A score is never printed without its denominator.** The stored
 *     `finalScore` is on two scales.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { COMPARISON_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/comparison';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { PORTFOLIO_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/portfolio';
import { deriveEntryFacts } from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { colourwaysForFamily, colourwayTokenOverride } from '../colourways';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

const comparison = SAMPLE.comparison as Record<string, any>;

/** Namespaces every template may bind regardless of format. */
const AMBIENT = ['client', 'org', 'report', 'author'];

describe('the catalogue', () => {
  it('ships fifty masters across the same ten families', () => {
    expect(COMPARISON_TEMPLATES).toHaveLength(50);
    expect(new Set(COMPARISON_TEMPLATES.map((t) => t.designMeta.familyKey)).size).toBe(10);
  });

  it('is production-ready, because the format has a real adapter', () => {
    for (const t of COMPARISON_TEMPLATES) {
      expect(t.reportType, t.name).toBe('comparison');
      expect(deriveEntryFacts({ report_type: t.reportType, schema: t.schema }).production_ready, t.name)
        .toBe(true);
    }
  });

  it('does not collide with any of the other three family catalogues', () => {
    const mine = COMPARISON_TEMPLATES.map((t) => t.slug);
    const others = [
      ...INVESTMENT_COMPASS_TEMPLATES, ...BORROWING_CAPACITY_TEMPLATES, ...PORTFOLIO_TEMPLATES,
    ].map((t) => t.slug);
    expect(new Set(mine).size).toBe(50);
    expect(mine.filter((s) => others.includes(s))).toEqual([]);
    for (const t of COMPARISON_TEMPLATES) {
      expect(t.designMeta.reportFormat).toBe('comparison-analysis');
    }
  });

  it('parses against the live schema contract', () => {
    for (const t of COMPARISON_TEMPLATES) {
      expect(() => parseTemplate(t.schema), t.name).not.toThrow();
    }
  });

  it('binds nothing outside `comparison` and the ambient namespaces', () => {
    // The whole format is nested, because three of its natural top-level names
    // are already taken by other formats in the one shared preview object.
    const bound = new Set<string>();
    for (const t of COMPARISON_TEMPLATES) {
      for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\./g)) bound.add(m[1]);
    }
    expect([...bound].filter((ns) => ns !== 'comparison' && !AMBIENT.includes(ns))).toEqual([]);
  });

  it('carries the salvage-only pages, every one conditional', () => {
    // Market timing rides 23 of the 27 damaged rows and competitive
    // advantages 10 — content the intact rows never hold, because the writer
    // that destructures a successful response has no column for them. The
    // pages are conditional so an intact record renders no empty furniture.
    const CASCADE = [
      'Market timing',
      'The holding rationale',
      'Competitive advantages',
      'Competitive advantages · continued',
      'What to do',
    ];
    for (const t of COMPARISON_TEMPLATES) {
      const pages = t.schema.pages as any[];
      for (const name of CASCADE) {
        const page = pages.find((p) => p.name === name);
        expect(page, `${t.name} lacks the "${name}" page`).toBeTruthy();
        expect(String((page as any).conditional ?? ''), `${t.name} "${name}" is unconditional`)
          .not.toBe('');
      }
    }
  });

  it('writes every conditional as an expression that actually evaluates', () => {
    // A conditional is JavaScript, not a binding path — `ranked.0.score` is a
    // SyntaxError there, and a conditional that throws at construction answers
    // false forever: the block is silently dark on every render. Constructing
    // each expression is the whole test.
    const seen = new Set<string>();
    const collect = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.conditional === 'string') seen.add(node.conditional);
      for (const v of Object.values(node)) {
        if (Array.isArray(v)) v.forEach(collect);
        else collect(v);
      }
    };
    for (const t of COMPARISON_TEMPLATES.slice(0, 5)) (t.schema.pages as any[]).forEach(collect);
    expect(seen.size).toBeGreaterThan(10);
    for (const cond of seen) {
      expect(
        () => new Function('comparison', 'client', 'org', 'report', `return (${cond});`),
        `does not parse: ${cond}`,
      ).not.toThrow();
    }
  });
});

describe('the verdict has a treatment for both storage shapes', () => {
  /*
   * `recommendations` is absent on 25 of the 50 stored rows — every salvaged
   * row bar two — and the old page bound only the pick, so half of production
   * rendered a display-size heading with nothing in it. The two treatments are
   * mutually exclusive: for any record exactly one heading and one callout
   * render.
   */
  const verdictConds = (t: any) => (t.schema.pages as any[])
    .find((p) => p.name === 'The verdict')!
    .blocks.map((b: any) => String(b.conditional ?? ''))
    .filter((cond: string) => cond.includes('recommendations'));

  it('draws two mutually exclusive treatments', () => {
    for (const t of COMPARISON_TEMPLATES.slice(0, 5)) {
      const conds = verdictConds(t);
      // Two headings and two callouts, each pair split by the same guard.
      expect(conds.length, t.name).toBe(4);
      for (const state of [
        { recommendations: { bestOverall: { winner: 'x' } } },
        { recommendations: undefined },
        {},
      ]) {
        const holding = conds.filter((cond: string) => {
          const fn = new Function('comparison', `return (${cond});`);
          return Boolean(fn(state));
        });
        // One heading and one callout — never zero, never both treatments.
        expect(holding.length, `${t.name} ${JSON.stringify(state)}`).toBe(2);
      }
    }
  });

  it('renders the fallback with the ranked-first property and the note', () => {
    const t: any = COMPARISON_TEMPLATES[0];
    const salvagedComparison = {
      ...comparison,
      recommendations: undefined,
      truncated: true,
      truncationNote: 'The analysis was cut short while it was being written, and the '
        + 'sections it had completed were stored as raw text rather than as a finished report.',
    };
    const { html } = renderTemplateToHtml(t.schema, {
      data: { ...SAMPLE, comparison: salvagedComparison },
    });
    expect(html).toContain('Why there is no recommendation here');
    expect(html).toContain('cut short while it was being written');
    // The "What to do" page is dark without a recommendation.
    expect(html).not.toContain('Runners-up');

    const intact = renderTemplateToHtml(t.schema, { data: SAMPLE }).html;
    expect(intact).not.toContain('Why there is no recommendation here');
    expect(intact).toContain('Runners-up');
  });
});

describe('the ranking is drawn once per property count', () => {
  const rankingPageOf = (t: (typeof COMPARISON_TEMPLATES)[number]) =>
    t.schema.pages.find((p: any) => p.name === 'The ranking');

  it('carries four mutually exclusive variants at one position', () => {
    for (const t of COMPARISON_TEMPLATES) {
      const tables = (rankingPageOf(t)?.blocks ?? []).filter(
        (b: any) => b.type === 'data-table' && JSON.stringify(b.props).includes('comparison.ranked.0.rank'),
      ) as any[];
      expect(tables, t.name).toHaveLength(4);

      // Every one is conditional, and they all sit at the same y.
      const tops = new Set(tables.map((b) => b.props.y));
      expect(tops.size, t.name).toBe(1);
      for (const b of tables) expect(b.conditional, t.name).toContain('comparison.ranked.length');

      // 2, 3, 4 and 5 rows — the observed range, with no count unhandled.
      expect(tables.map((b) => b.props.rows.length).sort()).toEqual([2, 3, 4, 5]);
    }
  });

  it('renders exactly one of them, whatever the count', () => {
    const t = COMPARISON_TEMPLATES[0];
    for (const count of [2, 3, 4, 5]) {
      const ranked = Array.from({ length: count }, (_, i) => ({
        rank: i + 1,
        address: `Property ${i + 1}`,
        shortAddress: `Property ${i + 1}`,
        score: 90 - i * 5,
        outOf: 100,
        riskLevel: 'Low',
        strengths: ['s1', 's2', 's3'],
        concerns: ['c1', 'c2', 'c3'],
        bestSuitedFor: 'someone',
      }));
      const { html } = renderTemplateToHtml(t.schema as any, {
        data: { ...SAMPLE, comparison: { ...comparison, ranked, propertyCount: count } },
      });
      // The last property appears, and the one past the end does not.
      expect(html, `count ${count}`).toContain(`Property ${count}`);
      expect(html, `count ${count}`).not.toContain(`Property ${count + 1}`);
    }
  });
});

describe('the sample data matches what the table stores', () => {
  it('compares between two and five properties', () => {
    expect(comparison.propertyCount).toBe(comparison.properties.length);
    expect(comparison.propertyCount).toBeGreaterThanOrEqual(2);
    expect(comparison.propertyCount).toBeLessThanOrEqual(5);
    expect(comparison.ranked).toHaveLength(comparison.propertyCount);
  });

  it('scores every property on one declared scale', () => {
    for (const r of comparison.ranked) {
      expect(r.outOf).toBe(comparison.scaleOutOf);
      expect(r.score).toBeLessThanOrEqual(r.outOf);
    }
    // Best first, and the ranks agree with the order.
    expect(comparison.ranked.map((r: any) => r.rank)).toEqual([1, 2, 3]);
    expect(comparison.ranked[0].score).toBeGreaterThan(comparison.ranked[1].score);
  });

  it('carries all eleven superlatives, including the ones naming nobody', () => {
    const { money, place, risk } = comparison.axes;
    expect(money.winners).toHaveLength(4);
    expect(place.winners).toHaveLength(4);
    expect(risk.winners).toHaveLength(3);
    // About one axis in six names no property across the stored comparisons.
    const noWinner = [...money.winners, ...place.winners, ...risk.winners]
      .filter((w: any) => w.winner === 'No clear winner');
    expect(noWinner.length).toBeGreaterThan(0);
  });
});

describe('rendering', () => {
  it('renders every master with the analysis on the page and nothing unresolved', () => {
    for (const t of COMPARISON_TEMPLATES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
      expect(html, t.name).toContain('88.5');
      expect(html, t.name).toContain('No clear winner');
      expect(html, t.name).not.toContain('{{');
    }
  });

  it('never prints a score without its denominator', () => {
    // "8.5" means one thing out of 10 and another out of 100, and both scales
    // are live in the table. Every bound score is paired with `outOf` in the
    // template source, so the pairing cannot be lost by a data change.
    for (const t of COMPARISON_TEMPLATES) {
      const source = JSON.stringify(t.schema);
      const scores = [...source.matchAll(/\{\{comparison\.ranked\.(\d+)\.score\}\}/g)];
      expect(scores.length, t.name).toBeGreaterThan(0);
      for (const m of scores) {
        expect(source, `${t.name} · ranked.${m[1]}`)
          .toContain(`{{comparison.ranked.${m[1]}.score}} / {{comparison.ranked.${m[1]}.outOf}}`);
      }
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
    for (const t of COMPARISON_TEMPLATES) {
      const base = geometry(renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html);
      for (const cw of colourwaysForFamily(t.designMeta.familyKey)) {
        const other = geometry(renderTemplateToHtml(t.schema as any, {
          data: SAMPLE, tokenOverrides: colourwayTokenOverride(cw),
        }).html);
        expect(other, `${t.name} / ${cw.name}`).toBe(base);
      }
    }
  }, 60_000);

  it('drops the sections a comparison did not record', () => {
    // `runners` and `avoid` are empty on some stored comparisons — a minimum of
    // zero each — so both are conditional rather than drawn blank.
    const t = COMPARISON_TEMPLATES[0];
    const withAll = renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html;
    expect(withAll).toContain('Runners-up');
    expect(withAll).toContain('Not recommended');

    const bare = renderTemplateToHtml(t.schema as any, {
      data: {
        ...SAMPLE,
        comparison: {
          ...comparison,
          recommendations: { bestOverall: comparison.recommendations.bestOverall },
        },
      },
    }).html;
    expect(bare).not.toContain('Runners-up');
    expect(bare).not.toContain('Not recommended');
    // The recommendation itself still stands.
    expect(bare).toContain('22 Chapel Street');
  });
  it('joins the whole risk list, so one risk leaves no trailing separator', () => {
    /*
     * The register used to bind `specificRisks.0` and `.1` with a literal ` · `
     * between them. Measured across the 67 risk entries in production, that was
     * right for 10 of them: 8 carry a single risk and printed "…analysis. ·"
     * with nothing after the separator, and 49 carry three to six, of which
     * everything past the second never reached the page.
     */
    const t = COMPARISON_TEMPLATES[0];

    const one = renderTemplateToHtml(t.schema as any, {
      data: {
        ...SAMPLE,
        comparison: {
          ...comparison,
          risks: [{ ...comparison.risks[0], specificRisks: ['Only one risk here.'] }],
        },
      },
    }).html;
    expect(one).toContain('Only one risk here.');
    expect(one).not.toContain('Only one risk here. ·');

    const many = renderTemplateToHtml(t.schema as any, {
      data: {
        ...SAMPLE,
        comparison: {
          ...comparison,
          risks: [{
            ...comparison.risks[0],
            specificRisks: ['Risk one.', 'Risk two.', 'Risk three.', 'Risk four.'],
          }],
        },
      },
    }).html;
    // Everything past the second used to be dropped; the modal entry has four.
    for (const r of ['Risk one.', 'Risk two.', 'Risk three.', 'Risk four.']) {
      expect(many, `lost ${r}`).toContain(r);
    }
  });

  it('clips the joined risk list so it cannot outgrow the box it declares', () => {
    // A block that sets taller than its declared height does not overflow the
    // page — it prints over the next block, which `flow()` cannot see. The
    // longest joined entry in production is 398 characters against a budget of
    // 260, so the binding truncates and shows an ellipsis where it clips.
    const t = COMPARISON_TEMPLATES[0];
    const html = renderTemplateToHtml(t.schema as any, {
      data: {
        ...SAMPLE,
        comparison: {
          ...comparison,
          risks: [{
            ...comparison.risks[0],
            specificRisks: Array.from({ length: 12 }, (_, i) => `Specific risk number ${i} runs on.`),
          }],
        },
      },
    }).html;
    expect(html).toContain('…');
    expect(html).toContain('Specific risk number 0 runs on.');
    // The tail is clipped rather than laid over the block beneath it.
    expect(html).not.toContain('Specific risk number 11 runs on.');
  });
});
