/**
 * Source and behaviour pins for the five defects measured on real client PDFs
 * (1/27D Mitchell Street, Muswellbrook — five downloads, three reports,
 * 2026-09-04) and recorded in §17 of the reporting-engine audit:
 *
 *  1. every `{{…}}` chart directive in a templated body was DROPPED — 43 on
 *     one Compass render, the Disclaimer's whole content among them;
 *  2. the final narrative bucket could overflow its physical box and print
 *     the document's tail over the running foot, silently;
 *  3. a condensed report wrote "N/A" nineteen times about figures its own row
 *     held (score 62, grade B, full financials);
 *  4. every tier of the Investment format rendered titled "Investment
 *     Compass" — cover, running head and running foot — whatever the document
 *     actually was;
 *  5. ten of the fifty Investment masters (two whole families, the house
 *     default among them) carried no Contents page at all;
 *  6. the chart primitives clipped their own labels — the score wheel cut
 *     "FUTURE RESILIENCE" to "RE RESILIENCE", the bars clipped their label
 *     column, and the heatmap drew an orphan row label the parser had split
 *     off a parenthesised phrase.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_IDENTITY,
  projectInvestmentReport,
} from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import {
  CALIBRATED_CONT_LINES,
  CALIBRATED_FIRST_LINES,
  packNarrativePages,
  resolveNarrativeProfile,
} from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import {
  planningChartContext,
  vizDirectiveRenderer,
} from '../../../../supabase/functions/_shared/reports/vizFigures.pure';
import { parseVizDirectives } from '../../../../supabase/functions/_shared/reports/vizDirectives.pure';
import {
  renderHeatmap,
  renderScoreBars,
} from '../../../../supabase/functions/_shared/reportDesign/charts.pure';
import { buildRecordedFactsBlock } from '../../../../supabase/functions/_shared/reports/investment/condenseFacts.pure';
import { hasContents } from '../../../../scripts/template-library/investmentCompass/resolvers';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROW = {
  property_address: '12 Sample Street, Exampleton NSW 2000',
  report_tier: 'snapshot',
  investment_score: {
    totalScore: 62,
    grade: 'B',
    recommendation: 'HOLD/BUY - Moderate investment potential',
    // The projection's own vocabulary: `breakdown.growthScore`, not `growth`.
    breakdown: {
      growthScore: { score: 58, weight: 40, details: 'Steady regional growth.' },
      locationScore: { score: 70, weight: 25, details: 'Serviceable location.' },
    },
  },
  financial_calculations: {
    initialCosts: { propertyValue: 550_000 },
    income: { weeklyRent: 600 },
    keyMetrics: { grossRentalYield: 5.67 },
    loanDetails: { loanAmount: 440_000, interestRate: 6.5 },
  },
};

describe('a templated body draws the figures the model asked for', () => {
  // The block's directive rendering moved into `markdownBlockContent.ts` when
  // the browser PDF renderer began drawing the same bucket: both surfaces now
  // read one resolution rather than two that agree. The rule is unchanged and
  // is asserted against whichever module owns it, not against a line of it.
  const block = code('src/lib/reportTemplate/blocks/markdownBlockContent.ts');
  const projection = code('supabase/functions/_shared/reportBindingProjection.pure.ts');

  it('the markdown block passes a directive renderer in the template palette', () => {
    expect(block).toContain('vizDirectiveRenderer');
    expect(block).toContain('CHART_TARGET_WIDTH_MM');
  });

  it('and neither renderer resolves that content for itself', () => {
    for (const path of [
      'src/lib/reportTemplate/blocks/markdownBlock.html.ts',
      'src/lib/reportTemplate/blocks/markdownBlock.ts',
    ]) {
      expect(code(path)).toContain('resolveMarkdownBlockContent');
      expect(code(path)).not.toContain('vizDirectiveRenderer(');
    }
  });

  it('the projection charges the same directives, so the page count agrees', () => {
    expect(projection).toContain('renderDirective: vizDirectiveRenderer(planningChartContext())');
  });

  it('a directive-carrying body gains figure blocks and pages on both arithmetics', () => {
    const doc = [
      '## Assessment',
      'A paragraph of ordinary prose that says something about the property.',
      '',
      '{{bars: Growth 58, Location 70, Yield 61 | title=Score components | max=100}}',
      '',
      '{{glance: ★ Strong tenant fit | ✓ Quiet complex | ⚠ Regional employment risk}}',
      '',
      '### Disclaimer',
      '{{glance: ⚠ General information only | ✓ Independent checks recommended}}',
    ].join('\n');
    const profile = resolveNarrativeProfile('investment')!;
    const withFigures = renderMarkdown(doc, {
      charging: profile.charging,
      renderDirective: vizDirectiveRenderer(planningChartContext()),
    });
    expect(withFigures.notices.figuresDrawn).toBeGreaterThanOrEqual(3);
    expect(withFigures.blocks.some((b) => b.kind === 'figure')).toBe(true);
    // Without the renderer the same source loses the blocks — the defect.
    const without = renderMarkdown(doc, { charging: profile.charging });
    expect(without.blocks.some((b) => b.kind === 'figure')).toBe(false);
    // The heading must not be left promising content that was dropped.
    const packed = packNarrativePages(withFigures.blocks, profile);
    const flat = packed.flat();
    const disclaimerAt = flat.findIndex((b) => b.kind === 'heading' && /Disclaimer/.test(b.html));
    expect(disclaimerAt).toBeGreaterThanOrEqual(0);
    expect(flat[disclaimerAt + 1]?.kind).toBe('figure');
  });
});

describe('the narrative budget holds the tail on the page', () => {
  it('sits ~16% under the measured capacity, cut against the field failure', () => {
    // The failing bucket packed 47 charged units under the old budget of 50
    // and still overflowed the physical box. The budget must sit below that
    // observed failure, not merely below the bench-measured capacity.
    expect(CALIBRATED_CONT_LINES).toBeLessThanOrEqual(46);
    expect(CALIBRATED_FIRST_LINES).toBeLessThanOrEqual(36);
  });

  it('charges a top-level bullet for its own hanging indent', () => {
    const source = code('supabase/functions/_shared/reports/markdown.pure.ts');
    expect(source).toContain("cpl - (measured ? 6 : 0) - it.depth * 4");
  });

  it('a long source-note list no longer fits a bucket its render overflows', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      `- **Source ${i + 1} — An Authority With A Long Name** ${'because the sentence explains what the source underpins at length, '.repeat(3)}and remains one item.`);
    const doc = `## Sources\n${items.join('\n')}`;
    const profile = resolveNarrativeProfile('investment')!;
    const { blocks } = renderMarkdown(doc, { charging: profile.charging });
    const list = blocks.find((b) => b.kind === 'list')!;
    // Six items at ~200 characters each cannot be a page-quarter.
    expect(list.lines).toBeGreaterThan(14);
  });
});

describe('a condensed report is written against the recorded figures', () => {
  it('renders the row facts, formatted, with no placeholder vocabulary', () => {
    const block = buildRecordedFactsBlock(projectInvestmentReport(ROW))!;
    expect(block).toContain('Investment grade: B');
    expect(block).toContain('Investment score: 62/100');
    expect(block).toContain('Purchase price: $550,000');
    expect(block).toContain('Weekly rent: $600');
    expect(block).toContain('Growth score: 58/100');
    // No FACT line carries a placeholder (the instruction footer may name
    // the forbidden word — that is the rule, not a value).
    expect(block).not.toMatch(/: (N\/A|TBD|—)\b/);
    // A metric the row does not hold produces no line at all.
    expect(block).not.toContain('Net yield');
  });

  it('answers null for a row with nothing recordable', () => {
    expect(buildRecordedFactsBlock(projectInvestmentReport({}))).toBeNull();
  });

  it('the condense prompt carries the block and forbids placeholders', () => {
    const fn = code('supabase/functions/condense-investment-report/index.ts');
    // Whitespace-insensitive, because the call wraps: what is pinned is that
    // the block is built from the PARENT report's projection, and that the
    // projection is taken for the TARGET tier. `condense` reads a Compass row
    // to write a Briefing or a Snapshot, so keying the tier on the row it read
    // would withhold the modelling from the one document that exists for it.
    const dense = fn.replace(/\s+/g, '');
    expect(dense).toContain('buildRecordedFactsBlock(projectInvestmentReport(parentReport');
    expect(dense, 'the facts block is projected for the tier being written')
      .toContain('{tier:targetTier}');
    expect(fn).toContain('NEVER write "N/A"');
    expect(fn).toContain('omit the row');
  });
});

describe('the document is titled as what it is, per tier', () => {
  it('translates every tier once, in the projection', () => {
    expect(DOCUMENT_IDENTITY.financial.title).toBe('Financial Analysis');
    expect(DOCUMENT_IDENTITY.snapshot.title).toBe('Snapshot Report');
    expect(DOCUMENT_IDENTITY.briefing.title).toBe('Executive Briefing');
    // Locked decision B (`TIER_FRAMEWORK.md`): the strategic tier is the Due
    // Diligence Report wherever a person sees it. QA-32 (15 Sep 2026) found it
    // titled "Snapshot Report" by one presentation and "Strategic Overview" by
    // the other.
    expect(DOCUMENT_IDENTITY.strategic.title).toBe('Due Diligence Report');
    expect(DOCUMENT_IDENTITY.compass.title).toBe('Investment Compass');

    const p = projectInvestmentReport({ ...ROW, report_tier: 'financial' });
    expect(p.report.documentTitle).toBe('Financial Analysis');
    expect(typeof p.report.standfirst).toBe('string');
    // An unrecognised tier reads as the ranking's default document.
    expect(projectInvestmentReport({ ...ROW, report_tier: 'mystery' }).report.documentTitle)
      .toBe('Investment Compass');
  });

  it('the Investment composer binds the identity rather than spelling it', () => {
    const composer = code('scripts/template-library/investmentCompass/templates.ts');
    expect(composer).toContain("'{{property.address}} · {{report.documentTitle}}'");
    expect(composer).toContain("'{{report.documentTitle}} · {{property.address}}'");
    expect(composer).toContain("eyebrow: '{{report.documentTitle}}'");
    expect(composer).toContain("standfirst: '{{report.standfirst}}'");
    expect(composer).not.toContain("eyebrow: 'Investment Compass'");
    expect(composer).not.toContain("marker: 'Investment Compass'");
  });

  it('the sample data previews the identity, so the picker covers stay worded', () => {
    const sample = read('src/lib/templateLibrary/sampleReportData.ts');
    expect(sample).toContain("documentTitle: 'Investment Compass'");
    expect(sample).toContain('standfirst:');
  });
});

describe('a chart label prints whole', () => {
  // Chromium palette-free context at the width the directive renderer uses
  // for a compact figure (the wheel), and at full measure for the rest.
  const scorecard = (labels: string[]) => {
    const base = planningChartContext();
    const ctx = { ...base, widthMm: base.widthMm * (460 / 760) };
    return renderScoreBars(ctx, labels.map((_, i) => 60 + i), { labels });
  };

  it('a long dimension label prints whole on the scorecard', () => {
    // This guard was written for a radar. `FUTURE RESILIENCE` printed as
    // `RE RESILIENCE` at w=460, and a padding-only widening to 532 still
    // clipped it because the type is sized through `w / widthMm` and grows
    // with the box — so the wheel had to wrap its side labels and solve its
    // own width.
    //
    // The radar is gone (see `renderScoreBars`), and with it the radial side
    // labels that caused this. The DEFECT CLASS is not gone: a scorecard whose
    // longest dimension name is clipped is the same failure whatever geometry
    // draws it, so the guard moved onto the chart that replaced it. Bars set
    // their labels horizontally in a column that sizes to the longest one, and
    // the label is emitted whole rather than truncated — both are asserted,
    // because a column that sizes correctly and a label that is cut are
    // independent ways to get this wrong.
    const labels = ['Yield Strength', 'Cash Flow', 'Growth Alignment', 'Future Resilience', 'Affordability'];
    const svg = scorecard(labels);

    // Whole, in one text node, exactly as given — no wrap, no ellipsis, no
    // uppercase transform that a reader would have to decode back.
    for (const label of labels) {
      expect(svg, label).toContain(`>${label}<`);
    }

    // And the ink fits: every label is end-anchored at the column's right
    // edge and runs LEFT from there, so its start must stay at or above 0.
    // 0.58em per character is the advance `renderBars` sizes the column with.
    const microSize = Number(/font-size="([\d.]+)"/.exec(svg)![1]);
    for (const m of svg.matchAll(/<text x="([\d.]+)"[^>]*text-anchor="end"[^>]*>([^<]+)<\/text>/g)) {
      const ink = m[2].length * microSize * 0.58;
      expect(Number(m[1]) - ink, m[2]).toBeGreaterThanOrEqual(0);
    }
  });

  it('the scorecard is never a radar', () => {
    // Rejected by the product owner on 2026-09-08 and removed rather than
    // discouraged: a dormant radar renderer is one import away from coming
    // back. The polygon, the spokes and the rings are the signature.
    const svg = scorecard(['Location strength', 'Risk profile', 'Tenant appeal']);
    expect(svg).not.toContain('<polygon');
    expect(svg).not.toContain('<circle');
    // Bars share one baseline: every bar starts at the same x.
    const xs = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="[\d.]+" height="12"/g)]
      .map((m) => m[1]);
    expect(xs.length).toBeGreaterThan(0);
    expect(new Set(xs).size).toBe(1);
  });

  it('a parenthesised label is one label, not a row per comma', () => {
    const [d] = parseVizDirectives(
      '{{heatmap: 3,3,2,3,2,3 | rows=Risk level (1=Low, 5=High) | cols=Crime,Environmental,Planning,Supply,Transport,Infra timing | title=Risk intensity snapshot}}',
    );
    expect(d).toMatchObject({ kind: 'heatmap' });
    expect((d as { rowLabels: string[] }).rowLabels).toEqual(['Risk level (1=Low, 5=High)']);
  });

  it('the heatmap never draws a label for a row the grid does not hold', () => {
    const ctx = planningChartContext();
    const svg = renderHeatmap(ctx, [[3, 3, 2, 3, 2, 3]], {
      rowLabels: ['Risk level (1=Low', '5=High)'],
      colLabels: ['Crime', 'Environmental', 'Planning', 'Supply', 'Transport', 'Infra timing'],
      title: 'Risk intensity snapshot',
    });
    expect(svg).not.toContain('5=High)');
    expect(svg).toContain('Risk level (1=Low');
  });

  it('the bars label column is sized from the type, not a guess', () => {
    const source = code('supabase/functions/_shared/reportDesign/charts.pure.ts');
    expect(source).not.toContain('const charPx = 5.4');
    expect(source).toContain("ptToUnits(CHART_TEXT_PT.micro, w, ctx.widthMm) * 0.58");
  });
});

describe('every master carries a contents page', () => {
  it('hasContents no longer silences a family', () => {
    expect(hasContents('none')).toBe(true);
    expect(hasContents('rail_index')).toBe(true);
  });

  it('the v10 seed and the active-row refresh ship together', () => {
    expect(read('supabase/migrations/20260917100000_seed_template_library_v10_tier_identity_contents_figures.sql').length)
      .toBeGreaterThan(1_000_000);
    const refresh = read('supabase/migrations/20260917110000_refresh_active_masters_from_library_v10.sql');
    expect(refresh).toContain("t.config -> 'libraryLineage' ->> 'entryId'");
    expect(refresh).toMatch(/jsonb_set\(\s*e\.schema/);
    // The refresh must never invent a palette: the row's own baked colours
    // are carried forward, which is exactly the colourway re-bake.
    expect(refresh).toContain("coalesce(t.schema -> 'tokens' -> 'colors'");
    expect(refresh).not.toMatch(/\bdelete\b/i);
  });
});
