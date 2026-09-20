/**
 * The chart vocabulary, drawn — and the Markdown renderer that places it.
 *
 * The defect these pin is not subtle: for every investment report the design
 * system has ever produced, the model's `{{bars: …}}` lines set as body copy.
 * The corpus carries **3,753 of them across 35 reports**, so the property that
 * matters most here is the dullest one — that no `{{` survives into the HTML.
 */
import { describe, expect, it } from 'vitest';
import {
  MM_PER_LINE,
  figureLines,
  planningChartContext,
  renderVizDirective,
  vizDirectiveRenderer,
} from '../vizFigures.pure';
import { VIZ_DIRECTIVE_KINDS, parseVizDirectives } from '../vizDirectives.pure';
import { renderMarkdown } from '../markdown.pure';

/** Verbatim from `investment_reports.report_content`. */
const REAL: Record<string, string> = {
  bars: '{{bars: Local town centre access 82, Regional highway connectivity 88, Active transport (walk/cycle) options 60 | title=Connectivity pillars | max=100 | unit=%}}',
  donut: '{{donut: Detached houses 82, Semi/terrace 8, Units 10 | title=Cooloola Cove dwelling mix | center=82% | centerSub=Detached houses}}',
  gauge: '{{gauge: 72 | Income Stability Score | Service-based roles with regional diversification}}',
  glance: '{{glance: ✓ Strong regional rental demand | ◆ Established 3‑bed House | ⚠ Resources‑linked economy | ★ Suitability: Proceed with caution}}',
  heatmap: '{{heatmap: 7.8,8.2,7.5 / 6.9,7.4,7.0 / 6.2,6.8,6.5 | rows=2019-21,2022-24,2025-27 est. | cols=Central,Fringe,Outlying | title=Relative demand}}',
  margin: '{{margin: Western corridor growth | spark=100,108,115,123,130 | note=Indicative population index. | label=Macro demand}}',
  pictograph: '{{pictograph: 7/10 | label=Strategic investors | sub=Most suited to long-term investors | icon=person | cols=10}}',
  quadrant: '{{quadrant: 10.2,4 "This property"*, 4.5,4 "NSW median house", 4.2,4 "National median house" | xlabel=Gross yield % | ylabel=Capital growth % | xmax=12 | ymax=8 | title=Positioning}}',
  tiles: '{{tiles: Cooloola Cove Calm & space sub="Quiet cul‑de‑sacs, family yards" int=0.75, Tin Can Bay Coastal leisure sub="Foreshore, boating, cafes" int=0.80 | title=Lifestyle mix | cols=3}}',
  timeline: '{{timeline: Existing "Bruce Highway access via Gympie", 0-2y "Ongoing safety upgrades", 3-5y "Progressive road improvements" | title=Regional road pipeline}}',
  waterfall: '{{waterfall: Gross rent +$50,000, Non‑mortgage outgoings -$13,101, Cash available for loan +$36,899 | title=Year‑1 cash available}}',
  wheel: '{{wheel: 80,72,60,55,68 | labels=Tenant fit,Amenity access,Perception,Environmental risk,Future flexibility | max=100 | title=Locality strengths}}',
};

const ctx = planningChartContext();
const draw = (raw: string) => renderVizDirective(ctx, parseVizDirectives(raw)[0]!);

describe('every kind in the corpus draws', () => {
  it('leaves no kind without a renderer', () => {
    expect(Object.keys(REAL).sort()).toEqual([...VIZ_DIRECTIVE_KINDS].sort());
  });

  for (const [kind, raw] of Object.entries(REAL)) {
    it(`draws a real ${kind}`, () => {
      const figure = draw(raw);
      expect(figure, `${kind} produced nothing`).not.toBeNull();
      expect(figure!.html.length).toBeGreaterThan(100);
      expect(figure!.lines).toBeGreaterThan(1);
      // Whatever it drew, it is not the source text.
      expect(figure!.html).not.toContain('{{');
    });
  }
});

describe('what the figure carries for a tagged PDF', () => {
  it('describes a chart, because an undescribed figure fails PDF/UA', () => {
    const html = draw(REAL.bars)!.html;
    expect(html).toContain('<img class="chart-img"');
    expect(html).toMatch(/alt="[^"]*Local town centre access 82[^"]*"/);
  });

  it('bounds the description rather than inlining a whole payload', () => {
    const long = `{{bars: ${Array.from({ length: 40 }, (_, i) => `Dimension number ${i} ${i}`).join(', ')}}}`;
    const alt = /alt="([^"]*)"/.exec(draw(long)!.html)?.[1] ?? '';
    expect(alt.length).toBeLessThanOrEqual(180);
  });
});

describe('a compact chart prints at the width it was drawn for', () => {
  // A gauge is 460 units wide and 300 tall. Across the full 174mm measure that
  // is 113mm of page for one number, and the corpus averages fifteen a report.
  for (const kind of ['gauge', 'donut', 'wheel', 'pictograph']) {
    it(`${kind} is marked compact`, () => {
      expect(draw(REAL[kind])!.html).toContain('class="chart-figure chart-compact"');
    });
  }

  for (const kind of ['bars', 'heatmap', 'quadrant', 'tiles', 'timeline', 'waterfall']) {
    it(`${kind} keeps the full measure`, () => {
      expect(draw(REAL[kind])!.html).toContain('class="chart-figure"');
    });
  }

  it('costs the page less than the same chart stretched across the measure', () => {
    const compact = draw(REAL.gauge)!.lines;
    const stretched = figureLines(
      // The same drawing, charged at the full measure.
      '<svg viewBox="0 0 460 300"></svg>',
      ctx.widthMm,
    );
    expect(compact).toBeLessThan(stretched);
  });
});

describe('figureLines', () => {
  it('is the aspect ratio against the column, in body lines', () => {
    // A square figure across a 174mm measure is 174mm tall.
    const lines = figureLines('<svg viewBox="0 0 100 100"></svg>', 174);
    expect(lines).toBe(Math.ceil(174 / MM_PER_LINE));
  });

  it('charges a caption one more line', () => {
    const plain = figureLines('<svg viewBox="0 0 100 100"></svg>', 174, false);
    expect(figureLines('<svg viewBox="0 0 100 100"></svg>', 174, true)).toBe(plain + 1);
  });

  it('falls back to counting words when there is no drawing', () => {
    // A glance strip and a margin note are HTML, not SVG.
    expect(figureLines('<div><p>one two three four five six</p></div>', 174))
      .toBeGreaterThanOrEqual(2);
  });
});

describe('the Markdown renderer places them', () => {
  const doc = ['## Locality', '', REAL.glance, '', 'Some prose about the suburb.', '', REAL.bars, '']
    .join('\n');

  it('turns a directive line into a figure block and never into prose', () => {
    const res = renderMarkdown(doc, { idPrefix: 'x', renderDirective: vizDirectiveRenderer(ctx) });
    expect(res.blocks.map((b) => b.kind)).toEqual(['heading', 'figure', 'paragraph', 'figure']);
    expect(res.notices.figuresDrawn).toBe(2);
    expect(res.notices.figuresDropped).toBe(0);
    expect(res.html).not.toContain('{{');
  });

  it('removes a directive even when no renderer is supplied', () => {
    // This is the case that shipped: `{{bars: …}}` set in body copy on a
    // client's page. A shortcode is an instruction to the renderer; if nobody
    // can draw it, it is still not something to show a reader.
    const res = renderMarkdown(doc, { idPrefix: 'x' });
    expect(res.html).not.toContain('{{');
    expect(res.notices.figuresDrawn).toBe(0);
    expect(res.notices.figuresDropped).toBe(2);
  });

  it('counts a figure against the page budget', () => {
    const withFigures = renderMarkdown(doc, {
      idPrefix: 'x', renderDirective: vizDirectiveRenderer(ctx),
    }).lines;
    const without = renderMarkdown(doc, { idPrefix: 'x' }).lines;
    // Around 23 sheets of charts a report. A budget that charges nothing for
    // them plans a document that does not exist.
    expect(withFigures).toBeGreaterThan(without + 5);
  });

  it('leaves a directive named inside a sentence alone', () => {
    // Real: a "how to read this report" legend writes `- **{{gauge: …}}** — a
    // score out of 100`. Lifting it out leaves a bullet with a hole in it.
    const legend = '- **{{gauge: …}}** – a score out of 100 for risk or amenity.';
    const res = renderMarkdown(legend, { idPrefix: 'x', renderDirective: vizDirectiveRenderer(ctx) });
    expect(res.blocks[0].kind).toBe('list');
    expect(res.notices.figuresDrawn).toBe(0);
  });

  it('drops a directive whose payload has nothing to plot, and says so', () => {
    // Real: `{{waterfall: Offer accepted +Contract, Settlement =Risk-managed}}`.
    const res = renderMarkdown(
      '{{waterfall: Offer accepted +Contract, Settlement =Risk‑managed acquisition}}',
      { idPrefix: 'x', renderDirective: vizDirectiveRenderer(ctx) },
    );
    expect(res.html).not.toContain('{{');
    expect(res.notices.figuresDropped).toBe(1);
    expect(res.notices.figuresDrawn).toBe(0);
  });

  it('reads several directives on consecutive lines as several figures', () => {
    const res = renderMarkdown(`${REAL.gauge}\n${REAL.bars}\n${REAL.wheel}`, {
      idPrefix: 'x', renderDirective: vizDirectiveRenderer(ctx),
    });
    expect(res.blocks.filter((b) => b.kind === 'figure')).toHaveLength(3);
  });
});

/*
 * The timeline ribbon, after the Cowra render.
 *
 * Measured on the rendered page: the model's NEXT TWO YEARS printed under
 * "5Y+" because the phase matcher's range separator was a plain hyphen and
 * `0–2y` is written with an EN-DASH, and because an unrecognised phase fell
 * through to `return '5y+'` — inventing a horizon, which §3 forbids.
 */
describe('the timeline ribbon places a milestone or refuses to draw', () => {
  const drawTimeline = (src: string) => {
    const d = parseVizDirectives(src)[0];
    const fig = renderVizDirective(ctx, d, null);
    if (!fig) return { kind: 'null' as const, html: '' };
    return { kind: fig.html.includes('<table') ? 'table' as const : 'ribbon' as const, html: fig.html };
  };

  it('reads a range written with an en-dash, which is how the model writes it', () => {
    expect(drawTimeline(
      '{{timeline: Existing "Schools and hospital", 0–2y "Park upkeep", 3–5y "Civic upgrades" | title=T}}',
    ).kind).toBe('ribbon');
  });

  it('reads a range written with a hyphen, as it always did', () => {
    expect(drawTimeline(
      '{{timeline: Existing "Town centre", 0-2y "Health upgrades", 3-5y "Roads", 5y+ "Renewal" | title=T}}',
    ).kind).toBe('ribbon');
  });

  it('refuses rather than placing an unreadable phase at the far end of the axis', () => {
    // `return "5y+"` as a catch-all is a fabricated horizon: it says a
    // milestone is five years away because the renderer could not read when
    // it is.
    const out = drawTimeline('{{timeline: Existing "Now", "sometime" "Who knows" | title=T}}');
    expect(out.kind).toBe('table');
    expect(out.html).toContain('Who knows');
  });

  it('refuses rather than silently dropping a third milestone from one band', () => {
    const out = drawTimeline('{{timeline: 0-2y "A", 0-2y "B", 0-2y "C" | title=T}}');
    expect(out.kind).toBe('table');
    for (const label of ['A', 'B', 'C']) expect(out.html).toContain(`>${label}<`);
  });
});
