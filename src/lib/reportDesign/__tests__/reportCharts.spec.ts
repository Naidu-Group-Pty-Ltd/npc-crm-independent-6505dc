/**
 * The chart layer.
 *
 * Charts are the part of a report a reader looks at first and a test can see
 * least, so the assertions here are about the three properties that were
 * actually wrong before the port:
 *
 *  1. **No colour of their own.** Eleven hardcoded hexes made the charts a
 *     twelfth palette — unreachable from a tenant, unaudited for contrast, and
 *     with their own idea of what "risk" looks like.
 *  2. **Type that is legible on paper.** Sizes were viewBox units, which say
 *     nothing about printed size. A 9.5-unit label in a 760-unit viewBox across
 *     the 174mm measure is 6.2pt.
 *  3. **Output that is safe and deterministic.** Chart data is model-generated,
 *     and on the shared-report path attacker-influenced.
 */
/* eslint-disable no-restricted-syntax --
 * Fixture colours: hostile tenant brands used to prove the palette flows
 * through, and expected values asserted against. Not palette choices.
 */
import { describe, expect, it } from 'vitest';
import {
  CHART_TEXT_PT,
  CHART_WIDTH,
  MAX_HEATMAP_CELLS,
  MAX_WATERFALL_ITEMS,
  MAX_WHEEL_SCORES,
  DONUT_STACK_BELOW_MM,
  chartContext,
  chartContextForSpan,
  chartFigure,
  chartPalette,
  formatAxisValue,
  minifySvg,
  ptToUnits,
  renderBars,
  renderBullet,
  renderCalendarHeatmap,
  renderDonut,
  renderGauge,
  renderHeatmap,
  renderInlineSpark,
  renderMarginSpark,
  renderMarimekko,
  renderMicroMap,
  renderPictograph,
  renderQuadrant,
  renderScoreBars,
  renderTiles,
  renderTimelineRibbon,
  renderWaterfall,
  fitLines,
  stableId,
  svgEscape,
  unitsToPt,
  withAlpha,
} from '../charts.pure';
import { resolveReportPalette } from '../brandResolve.pure';
import { CONTRAST_FLOOR, PRINT_SEMANTIC } from '../tokens.pure';
import { contrastRatio } from '../color.pure';

const palette = resolveReportPalette();
const ctx = chartContext(palette);

/** Every chart, with arguments that produce a non-empty drawing. */
const CHARTS: Array<[string, () => string]> = [
  ['gauge', () => renderGauge(ctx, 72, { label: 'Investment score', caption: 'weighted' })],
  ['waterfall', () => renderWaterfall(ctx, [
    { label: 'Rent', value: 42_400 },
    { label: 'Expenses', value: -11_900 },
    { label: 'Interest', value: -38_600 },
    { label: 'Net', value: -8_100, total: true },
  ])],
  ['heatmap', () => renderHeatmap(ctx, [[1, 2], [3, 4]], {
    rowLabels: ['A', 'B'], colLabels: ['X', 'Y'], title: 'Growth',
  })],
  ['scoreBars', () => renderScoreBars(ctx, [80, 65, 40, 90], { labels: ['A', 'B', 'C', 'D'] })],
  ['bullet', () => renderBullet(ctx, { value: 62, target: 75, label: 'Yield', sub: 'vs target' })],
  ['marimekko', () => renderMarimekko(ctx, [
    { label: 'Owner', weight: 3, segments: [2, 1] },
    { label: 'Rented', weight: 2, segments: [1, 3] },
  ], { segmentLabels: ['House', 'Unit'] })],
  ['microMap', () => renderMicroMap(ctx, {
    suburb: 'Blackwater', state: 'QLD', postcode: '4717', neighbours: ['Bluff', 'Comet'],
  })],
  ['calendarHeatmap', () => renderCalendarHeatmap(ctx, [1, 2, 3, 4, 5, 6], { title: 'Listings' })],
  ['bars', () => renderBars(ctx, [
    { label: 'Schools', value: 8 }, { label: 'Transport', value: 4 },
  ], { title: 'Amenity', unit: '/10' })],
  ['quadrant', () => renderQuadrant(ctx, [
    { x: 4, y: 8, label: 'Subject', highlight: true }, { x: 7, y: 3, label: 'Peer' },
  ], { title: 'Risk vs return', xLabel: 'Risk', yLabel: 'Return', q1: 'Growth' })],
  ['pictograph', () => renderPictograph(ctx, 7, 10, { label: 'Owner-occupied', sub: 'per ten dwellings' })],
  ['inlineSpark', () => renderInlineSpark(ctx, [1, 2, 3, 2, 5])],
  ['marginSpark', () => renderMarginSpark(ctx, [5, 3, 4, 1])],
  ['donut', () => renderDonut(ctx, [
    { label: 'Owned', value: 60 }, { label: 'Rented', value: 40 },
  ], { title: 'Tenure' })],
  ['tiles', () => renderTiles(ctx, [
    { label: 'Median', value: '$785k', sub: 'up 4.1%', intensity: 0.8 },
  ], { title: 'Locality' })],
  ['timelineRibbon', () => renderTimelineRibbon(ctx, [
    { phase: 'existing', label: 'Hospital' }, { phase: '3-5y', label: 'Rail spur' },
  ])],
];

describe('every chart draws', () => {
  it.each(CHARTS)('%s produces well-formed SVG', (_name, render) => {
    const svg = render();
    expect(svg.trimStart().startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('NaN');
    // A stray `${` means a template hole; `[object Object]` means a bad interpolation.
    expect(svg).not.toContain('${');
    expect(svg).not.toContain('[object Object]');
  });

  it.each(CHARTS)('%s balances its tags', (_name, render) => {
    const svg = render();
    const opens = (svg.match(/<[a-zA-Z]/g) ?? []).length;
    const closes = (svg.match(/<\/[a-zA-Z]/g) ?? []).length + (svg.match(/\/>/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it.each(CHARTS)('%s is deterministic', (_name, render) => {
    expect(render()).toBe(render());
  });
});

describe('charts have no colour of their own', () => {
  it.each(CHARTS)('%s paints only palette roles', (_name, render) => {
    const svg = render();
    const used = new Set([
      ...(svg.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((h) => h.toUpperCase()),
    ]);
    const allowed = new Set(Object.values(chartPalette(palette)).flat()
      .filter((v): v is string => typeof v === 'string').map((h) => h.toUpperCase()));
    for (const hex of used) expect(allowed, `${hex} is not a palette role`).toContain(hex);
  });

  it('follows a tenant brand', () => {
    const tenant = chartContext(resolveReportPalette({ brandHex: '#00A3FF' }));
    expect(renderGauge(tenant, 50)).toContain('#00A3FF');
    expect(renderGauge(ctx, 50)).not.toContain('#00A3FF');
  });

  it('keeps the semantic three fixed whatever the tenant does', () => {
    // A chart must not be the place "risk" becomes green.
    const tenant = chartContext(resolveReportPalette({ brandHex: '#00FF00', preset: 'high_contrast' }));
    const svg = renderWaterfall(tenant, [{ label: 'Loss', value: -100 }, { label: 'Gain', value: 40 }]);
    expect(svg).toContain(PRINT_SEMANTIC.negative);
    expect(svg).toContain(PRINT_SEMANTIC.positive);
  });

  it('draws its labels in ink that clears the micro floor on its own ground', () => {
    const p = chartPalette(palette);
    for (const ink of [p.ink, p.inkMuted, p.accentDeep]) {
      expect(contrastRatio(ink, p.ground)).toBeGreaterThanOrEqual(CONTRAST_FLOOR.micro);
      expect(contrastRatio(ink, p.groundAlt)).toBeGreaterThanOrEqual(CONTRAST_FLOOR.micro);
    }
  });
});

describe('chart type is legible in print', () => {
  it('converts points to viewBox units and back', () => {
    const units = ptToUnits(10, CHART_WIDTH.wide);
    expect(unitsToPt(units, CHART_WIDTH.wide)).toBeCloseTo(10, 1);
  });

  it('scales with the viewBox — the same point size is more units in a wider chart', () => {
    expect(ptToUnits(10, CHART_WIDTH.wide)).toBeGreaterThan(ptToUnits(10, CHART_WIDTH.compact));
  });

  it('reproduces the defect this replaces', () => {
    // The original hardcoded 9.5 units for axis labels in a 760-unit viewBox.
    expect(unitsToPt(9.5, CHART_WIDTH.wide)).toBeLessThan(CHART_TEXT_PT.micro);
    expect(unitsToPt(9.5, CHART_WIDTH.wide)).toBeCloseTo(6.2, 1);
  });

  it.each(Object.entries(CHART_TEXT_PT))('%s (%dpt) clears the print floor', (_role, pt) => {
    expect(pt).toBeGreaterThanOrEqual(7.5);
  });

  it.each(CHARTS)('%s sets no text below the micro floor once printed', (_name, render) => {
    const svg = render();
    const vb = Number(svg.match(/viewBox="0 0 ([\d.]+)/)?.[1]);
    expect(Number.isFinite(vb)).toBe(true);
    const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
    for (const size of sizes) {
      // The inline sparkline carries no text; anything else must be readable.
      expect(unitsToPt(size, vb), `${size} units in a ${vb} viewBox`).toBeGreaterThanOrEqual(7.4);
    }
  });
});

describe('a chart knows how wide it will print', () => {
  it('sizes to a grid column, not the full measure', () => {
    // A chart built for 174mm and dropped into a 38% column prints every label
    // at 38% of the size the code asked for. Seen in the first charted render.
    const col5 = chartContextForSpan(palette, 5);
    expect(col5.widthMm).toBeLessThan(chartContext(palette).widthMm);
    const svgFull = renderBars(ctx, [{ label: 'A', value: 1 }]);
    const svgCol = renderBars(col5, [{ label: 'A', value: 1 }]);
    const sizeOf = (svg: string) => Number(svg.match(/font-size="([\d.]+)"/)?.[1]);
    // A narrower printed width means MORE viewBox units per point — the drawing
    // is scaled down, so the type has to be drawn bigger to land the same size.
    expect(sizeOf(svgCol)).toBeGreaterThan(sizeOf(svgFull));
    const vb = CHART_WIDTH.wide;
    expect(unitsToPt(sizeOf(svgCol), vb, col5.widthMm))
      .toBeCloseTo(unitsToPt(sizeOf(svgFull), vb), 1);
  });

  it('narrower spans are narrower, in order', () => {
    const widths = ([4, 5, 7, 8] as const).map((s) => chartContextForSpan(palette, s).widthMm);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
  });

  it('stacks the donut legend under the ring in a narrow column', () => {
    // A legend row is a swatch, a label and a percentage — about 30mm of type.
    // Beside a ring in a 66mm column it printed straight through the figure.
    const narrow = chartContext(palette, DONUT_STACK_BELOW_MM - 1);
    const wide = chartContext(palette, DONUT_STACK_BELOW_MM + 1);
    const data = [{ label: 'Owner-occupied', value: 62 }, { label: 'Rented', value: 38 }];
    // The legend column starts at the left margin when stacked and beside the
    // ring when not.
    expect(renderDonut(narrow, data)).toContain('<rect x="16"');
    expect(renderDonut(wide, data)).toContain('<rect x="250"');
    // Explicit layout beats the width heuristic. Compared structurally, not
    // byte for byte: the two contexts print at different widths, so their type
    // is drawn at different unit sizes for the same point size.
    expect(renderDonut(narrow, data, { layout: 'side' })).toContain('<rect x="250"');
    expect(renderDonut(wide, data, { layout: 'stacked' })).toContain('<rect x="16"');
  });
});

describe('output safety', () => {
  const HOSTILE = '<script>alert("x")</script> & "q"';

  it('escapes tags and quotes in every label position', () => {
    const svgs = [
      renderGauge(ctx, 50, { label: HOSTILE, caption: HOSTILE }),
      renderBars(ctx, [{ label: HOSTILE, value: 1 }], { title: HOSTILE }),
      renderTiles(ctx, [{ label: HOSTILE, value: HOSTILE, sub: HOSTILE }], { title: HOSTILE }),
      renderMicroMap(ctx, { suburb: HOSTILE, state: HOSTILE, neighbours: [HOSTILE] }),
      renderDonut(ctx, [{ label: HOSTILE, value: 1 }], { title: HOSTILE, centerLabel: HOSTILE }),
      renderQuadrant(ctx, [{ x: 1, y: 1, label: HOSTILE }], { title: HOSTILE, q1: HOSTILE }),
      renderTimelineRibbon(ctx, [{ phase: 'existing', label: HOSTILE }], { title: HOSTILE }),
    ];
    for (const svg of svgs) {
      expect(svg).not.toContain('<script>');
      expect(svg).toContain('&lt;script&gt;');
    }
  });

  it('svgEscape neutralises the four characters that matter in XML', () => {
    expect(svgEscape('<&>"')).toBe('&lt;&amp;&gt;&quot;');
    expect(svgEscape(null)).toBe('');
  });

  it('refuses oversized inputs rather than rendering them', () => {
    expect(renderWaterfall(ctx, Array.from({ length: MAX_WATERFALL_ITEMS + 1 },
      (_, i) => ({ label: `x${i}`, value: 1 })))).toBe('');
    expect(renderScoreBars(ctx, Array.from({ length: MAX_WHEEL_SCORES + 1 }, () => 5))).toBe('');
    const big = Array.from({ length: 25 }, () => Array.from({ length: 25 }, () => 1));
    expect(25 * 25).toBeGreaterThan(MAX_HEATMAP_CELLS);
    expect(renderHeatmap(ctx, big)).toBe('');
  });

  it('refuses a ragged heatmap grid', () => {
    expect(renderHeatmap(ctx, [[1, 2], [3]])).toBe('');
  });

  it('returns empty rather than a broken drawing for empty data', () => {
    expect(renderBars(ctx, [])).toBe('');
    expect(renderTiles(ctx, [])).toBe('');
    expect(renderMarimekko(ctx, [])).toBe('');
    expect(renderCalendarHeatmap(ctx, [])).toBe('');
    expect(renderInlineSpark(ctx, [1])).toBe('');
    expect(renderMarginSpark(ctx, [])).toBe('');
    expect(renderDonut(ctx, [])).toBe('');
  });

  it('survives a zero-range series without dividing by zero', () => {
    expect(renderInlineSpark(ctx, [5, 5, 5])).not.toContain('NaN');
    expect(renderCalendarHeatmap(ctx, [3, 3, 3])).not.toContain('NaN');
    expect(renderHeatmap(ctx, [[2, 2], [2, 2]])).not.toContain('NaN');
    expect(renderGauge(ctx, 0, { max: 0 })).not.toContain('NaN');
  });
});

describe('defs ids are unique per drawing', () => {
  it('two gauges on one page do not share a gradient id', () => {
    // The original hardcoded `id="gauge-fill"`, so the second reference
    // resolved to the first definition.
    const a = renderGauge(ctx, 30);
    const b = renderGauge(ctx, 80);
    const idOf = (svg: string) => svg.match(/id="(gauge-[a-z0-9]+)"/)?.[1];
    expect(idOf(a)).toBeDefined();
    expect(idOf(a)).not.toBe(idOf(b));
  });

  it('never sets the large-arc flag on the value sweep', () => {
    // The sweep is `pct` of a half circle, so it is never more than 180 degrees.
    // The original set the flag whenever pct > 0.5, drawing the arc the long way
    // round — two disconnected segments at the ends of the track.
    for (const value of [10, 49, 51, 72, 99, 100]) {
      const svg = renderGauge(ctx, value);
      const sweeps = [...svg.matchAll(/A 130 130 0 (\d) 1 /g)].map((m) => m[1]);
      // The track is a full half-circle and legitimately uses the flag; the
      // value arc must not.
      expect(sweeps.slice(1)).not.toContain('1');
    }
  });

  it('the same gauge twice keeps the same id — the hash is of content', () => {
    expect(renderGauge(ctx, 30)).toBe(renderGauge(ctx, 30));
  });

  it('stableId is deterministic and shaped for an XML id', () => {
    expect(stableId('x', 1, 'a')).toBe(stableId('x', 1, 'a'));
    expect(stableId('x', 1, 'a')).not.toBe(stableId('x', 2, 'a'));
    expect(stableId('x', 1)).toMatch(/^x-[a-z0-9]+$/);
  });
});

describe('helpers', () => {
  it.each([
    [1_500_000, 'money', '$1.5m'],
    [12_400, 'money', '$12k'],
    [-320, 'money', '$-320'],
    // 4.55 is not representable in binary and rounds down; asserting the
    // arithmetic as it is rather than as it reads.
    [4.55, 'percent', '4.5%'],
    [42, 'percent', '42%'],
    [12_400, 'plain', '12k'],
  ] as const)('formatAxisValue(%d, %s) = %s', (value, mode, expected) => {
    expect(formatAxisValue(value, mode)).toBe(expected);
  });

  it('minifySvg removes the indentation that markdown reads as a code block', () => {
    expect(minifySvg('<svg>\n    <g>\n      <rect/>\n    </g>\n  </svg>')).toBe('<svg><g><rect/></g></svg>');
  });

  it('withAlpha clamps and keeps two decimals', () => {
    expect(withAlpha('#FFFFFF', 0.5)).toBe('rgba(255,255,255,0.50)');
    expect(withAlpha('#000000', 5)).toBe('rgba(0,0,0,1.00)');
    expect(withAlpha('#000000', -1)).toBe('rgba(0,0,0,0.00)');
  });

  it('chartFigure wraps and minifies, and drops an empty chart entirely', () => {
    const fig = chartFigure(renderInlineSpark(ctx, [1, 2]), 'Trend');
    expect(fig).toContain('class="chart-figure"');
    expect(fig).toContain('<figcaption>Trend</figcaption>');
    expect(fig).not.toMatch(/\n/);
    expect(chartFigure('', 'Trend')).toBe('');
  });
});

describe('a label never runs past the drawing it belongs to', () => {
  // The primitives have no text measurement, so a label is fitted by an
  // estimated advance and cut with an ellipsis rather than left to run —
  // measured on the reference renders (RS-3, 14 Sep 2026): every gauge
  // caption was clipped at the viewBox edge ("… TOWNSHIP WITH PRACTICAL GROW"),
  // a donut legend label printed into its own value, and a tile's label
  // printed through the next tile's.
  const textsOf = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

  it('fitLines wraps by word to the line count asked for and says when it cut', () => {
    expect(fitLines('A home in a stable regional township', 200, 10, 2)).toEqual(['A home in a stable', 'regional township']);
    expect(fitLines('short', 200, 10, 2)).toEqual(['short']);
    expect(fitLines('', 200, 10, 2)).toEqual([]);
    const cut = fitLines('one two three four five six seven eight nine ten eleven twelve', 100, 10, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1].endsWith('…')).toBe(true);
    for (const line of cut) expect(line.length).toBeLessThanOrEqual(10);
  });

  it('a gauge caption is set on at most two lines and the arc moves down for them', () => {
    const long = renderGauge(ctx, 72, { label: 'Location & Property Fit', caption: 'A home in a stable regional township with practical growth prospects and a settled, family-led rental market' });
    const short = renderGauge(ctx, 72, { label: 'Location & Property Fit', caption: 'Weighted' });
    const captionRuns = textsOf(long).filter((t) => t === t.toUpperCase() && !t.startsWith('/') && t.length > 8);
    expect(captionRuns.length).toBeGreaterThanOrEqual(2);
    expect(captionRuns.length).toBeLessThanOrEqual(3);
    // Every run fits the drawing: nothing longer than the width allows at micro size.
    // The estimate allows ~75 tracked capitals across the 428 units the caption may use.
    for (const run of captionRuns) expect(run.length).toBeLessThanOrEqual(76);
    const heightOf = (svg: string) => Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg)![1]);
    expect(heightOf(long)).toBeGreaterThan(heightOf(short));
  });

  it('a donut legend label wraps clear of its value, and the drawing grows to hold it', () => {
    const segments = [
      { label: 'Family renters', value: 45 },
      { label: 'Local owner-occupiers', value: 35 },
      { label: 'Professionals and small households with longer names', value: 20 },
    ];
    const svg = renderDonut(ctx, segments, { title: 'Likely occupier mix for this locality' });
    const texts = textsOf(svg);
    expect(texts.some((t) => t.startsWith('Professionals'))).toBe(true);
    expect(texts.every((t) => t.length <= 40)).toBe(true);
    expect(texts).toContain('20%');
    const heightOf = (s: string) => Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(s)![1]);
    const plain = renderDonut(ctx, [{ label: 'Owned', value: 60 }, { label: 'Rented', value: 40 }], { title: 'Tenure' });
    expect(heightOf(svg)).toBeGreaterThanOrEqual(heightOf(plain));
  });

  it('a tile fits its label, its value and its sub-line, and every tile grows to the tallest', () => {
    // Four columns, as the model's positioning tiles are drawn: 130 units a cell.
    const svg = renderTiles(ctx, [
      { label: 'Cowra LGA', value: 'Regional service hub', sub: 'Highway junction · Lachlan Valley' },
      { label: 'Bathurst', value: 'Regional city', sub: 'Larger centre 100+ km' },
      { label: 'Young', value: 'Nearby rural service centre', sub: 'Agriculture-anchored' },
      { label: 'Cowra surrounds', value: 'Rural hinterland', sub: 'Agriculture-anchored' },
    ]);
    const texts = textsOf(svg);
    expect(texts.every((t) => t.length <= 22)).toBe(true);
    // The phrase-value is set at the label size on two lines rather than run across the next tile.
    expect(texts).toContain('Regional');
    expect(texts).toContain('service hub');
    const rects = [...svg.matchAll(/<rect [^>]*height="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(new Set(rects).size).toBe(1);
    expect(rects[0]).toBeGreaterThanOrEqual(88);
  });

  it('a timeline marker\'s labels are wrapped to the room between markers, and the ribbon grows for them', () => {
    // The long report's pipeline, as the model wrote it: two items a phase,
    // each longer than the measure between two stops.
    const items = [
      { phase: 'existing', label: 'Rail within 900m of the property' },
      { phase: 'existing', label: 'Established bus corridor on the main road' },
      { phase: '0-2y', label: 'Incremental health and education upgrades' },
      { phase: '3-5y', label: 'Further road and transport corridor investment' },
      { phase: '5y+', label: 'Ongoing renewal of community facilities and services' },
    ];
    const svg = renderTimelineRibbon(ctx, items, { title: 'Infrastructure pipeline' });
    const texts = textsOf(svg).filter((t) => t !== 'Infrastructure pipeline' && !/^(EXISTING|0-2Y|3-5Y|5Y\+)$/.test(t));
    // The old renderer cut every label at 26 characters and set it on one line;
    // a 46-character label now wraps whole.
    expect(texts).toContain('Further road and transport');
    expect(texts).toContain('corridor investment');
    expect(texts).toContain('Ongoing renewal of');
    // And NOTHING is cut here. A stop carrying one item is given four lines
    // and a stop carrying two is given two each, so the 51-character label
    // alone at `5y+` sets whole where it used to lose its last three words.
    // A cut is a last resort, not the normal state of a long label.
    expect(texts.filter((t) => t.endsWith('…'))).toHaveLength(0);
    expect(texts.join(' ')).toContain('facilities and services');
    // Each stop's measure is 172 units; at micro size that is about 27 characters.
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(28);
    // The end labels are anchored to the edges and the interior ones centred
    // on their stops, which sit at equal measures from the edges and each other.
    const xs = [...svg.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs).toEqual([98, 286, 474, 662]);
    const heightOf = (s: string) => Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(s)![1]);
    const short = renderTimelineRibbon(ctx, [{ phase: 'existing', label: 'Rail' }], {});
    expect(heightOf(svg)).toBeGreaterThan(heightOf(short));
    // Every label row sits above the bottom of the ground.
    const ys = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThan(heightOf(svg) - 10);
  });

  it('a heatmap value is set in whichever page colour reads against its cell', () => {
    // A structure whose accent is its ink (Dictionary): a full cell is dark,
    // so the value on it is set in the ground; an empty cell is the ground,
    // so the value on it is set in the ink. Six "1"s on the medium reference
    // report read as ILLEGIBLE before this (RS-4, 14 Sep 2026).
    const dictionary = { ...ctx, palette: { ...ctx.palette, accent: '#312A21', ground: '#FFFDFA', ink: '#3D3429' } };
    const svg = renderHeatmap(dictionary, [[0, 1]], { rowLabels: ['Planning'], colLabels: ['High', 'Limited'] });
    const values = [...svg.matchAll(/<text[^>]*font-weight="600"[^>]*fill="([^"]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => [m[2], m[1]]);
    expect(values).toContainEqual(['0', '#3D3429']);
    expect(values).toContainEqual(['1', '#FFFDFA']);
    // The default (light accent on a light ground) keeps the ink on every cell.
    const plain = renderHeatmap(ctx, [[0, 1]], { rowLabels: ['Planning'], colLabels: ['High', 'Limited'] });
    const plainValues = [...plain.matchAll(/<text[^>]*font-weight="600"[^>]*fill="([^"]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(new Set(plainValues).size).toBe(1);
  });

  it('a pictograph title wraps clear of its count, and the array moves down for the second line', () => {
    // A pictograph is a compact figure: the router draws it for the compact
    // fraction of the measure, so its type is larger in viewBox units.
    const compact = chartContext(palette, ctx.widthMm * (CHART_WIDTH.compact / CHART_WIDTH.wide));
    const long = renderPictograph(compact, 7, 10, { label: 'Approximate share of core family houses in Cowra', sub: 'Illustrative — per ten dwellings in the locality, from the census tenure mix' });
    const short = renderPictograph(compact, 7, 10, { label: 'Owner-occupied', sub: 'per ten dwellings' });
    const texts = textsOf(long);
    expect(texts).toContain('7 / 10');
    const title = texts.filter((t) => /Approximate|houses|Cowra/.test(t));
    expect(title.length).toBe(2);
    expect(title.join(' ')).toBe('Approximate share of core family houses in Cowra');
    // The count is right-aligned at the width; the title's lines stop short of it.
    const countUnits = '7 / 10'.length * ptToUnits(CHART_TEXT_PT.caption, 404, compact.widthMm) * 0.55;
    const titleChar = ptToUnits(CHART_TEXT_PT.title, 404, compact.widthMm) * 0.55;
    for (const line of title) expect(line.length * titleChar).toBeLessThanOrEqual(404 - 24 - countUnits - 10);
    const heightOf = (s: string) => Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(s)![1]);
    expect(heightOf(long)).toBeGreaterThan(heightOf(short));
    // The first icon row starts below the second title line.
    const firstTile = Number(/<g transform="translate\(12 ([\d.]+)\)"/.exec(long)![1]);
    const titleYs = [...long.matchAll(/<text x="12\.0" y="([\d.]+)"[^>]*font-weight="700"/g)].map((m) => Number(m[1]));
    expect(firstTile).toBeGreaterThan(Math.max(...titleYs));
  });
});

/**
 * A waterfall's category label is wrapped into its slot, not guillotined.
 *
 * The renderer read `b.label.length > 16 ? b.label.slice(0, 14) + '…'` — a
 * hard cut that never wrapped and never asked how wide the bar's slot is.
 * Measured 19 Sep 2026: the slot is 133 units and holds 19 characters a line,
 * so four of the five labels on an acquisition build-up were cut to fourteen
 * while `fitLines` sets every one of them whole in two lines.
 *
 * The case that settles it is the directive's own documentation. The worked
 * example in `vizDirectives.pure.ts` is `{{waterfall: Gross rent +$50,000,
 * Non-mortgage outgoings -$13,101, Room =+$36,899}}`, and this renderer drew
 * that example's own label as `Non-mortgage o…`.
 */
describe('a waterfall label fits the bar it belongs to', () => {
  const drawnText = (svg: string): string[] =>
    [...svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1]).filter((t) => /[A-Za-z]{3}/.test(t));
  const heightOf = (svg: string): number => Number(/viewBox="0 0 [0-9.]+ ([0-9.]+)"/.exec(svg)?.[1]);

  /** The directive documentation's own worked example, verbatim. */
  const DOCUMENTED = [
    { label: 'Gross rent', value: 50000 },
    { label: 'Non-mortgage outgoings', value: -13101 },
    { label: 'Room', value: 36899, total: true },
  ];

  /** The five-step shape a Compass acquisition build-up draws. */
  const BUILD_UP = [
    { label: 'Purchase price', value: 700000 },
    { label: 'Stamp duty and transfer', value: 27000 },
    { label: 'Legal and conveyancing', value: 2200 },
    { label: 'Building and pest inspection', value: 900 },
    { label: 'Total acquisition cost', value: 730100, total: true },
  ];

  it("draws the directive documentation's own example label whole", () => {
    const drawn = drawnText(renderWaterfall(ctx, DOCUMENTED));
    expect(drawn).toContain('Non-mortgage outgoings');
    expect(drawn.some((t) => t.includes('…'))).toBe(false);
  });

  it('wraps rather than truncating, on every label of a build-up', () => {
    const svg = renderWaterfall(ctx, BUILD_UP);
    const drawn = drawnText(svg);
    expect(drawn.some((t) => t.includes('…'))).toBe(false);
    // Every word of every label survives, in order, across its own lines.
    for (const item of BUILD_UP) {
      const words = item.label.split(' ');
      const joined = drawn.join(' ');
      for (const word of words) expect(joined).toContain(word);
    }
  });

  /*
   * The regression guard, stated as the defect rather than as the fix: no
   * label may come out at exactly the length the old cut produced.
   */
  it('never cuts a label at fourteen characters', () => {
    for (const items of [DOCUMENTED, BUILD_UP]) {
      for (const t of drawnText(renderWaterfall(ctx, items))) {
        expect(t.endsWith('…') && t.length === 15).toBe(false);
      }
    }
  });

  it('grows the drawing for a second line and leaves a one-line chart alone', () => {
    const short = renderWaterfall(ctx, [
      { label: 'Rent', value: 50000 },
      { label: 'Costs', value: -13101 },
      { label: 'Room', value: 36899, total: true },
    ]);
    // A chart whose labels already fit is byte-identical in its geometry.
    expect(heightOf(short)).toBe(360);
    expect(heightOf(renderWaterfall(ctx, DOCUMENTED))).toBe(360);
    // One extra line of labels costs one line-step of ground, and no more.
    expect(heightOf(renderWaterfall(ctx, BUILD_UP))).toBe(373);
  });

  /*
   * The ellipsis is not removed, only demoted. A label no two lines of the
   * slot can hold still says it was cut — silently dropping the tail would be
   * worse than the truncation this replaces.
   */
  it('still ends with an ellipsis where two lines genuinely cannot hold the label', () => {
    const drawn = drawnText(renderWaterfall(ctx, [
      { label: 'Purchase price', value: 700000 },
      {
        label: 'Lenders mortgage insurance premium capitalised into the loan balance at settlement',
        value: 14500,
      },
      { label: 'Total', value: 714500, total: true },
    ]));
    expect(drawn.some((t) => t.endsWith('…'))).toBe(true);
  });
});
