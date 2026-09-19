/**
 * The infographics, composed from the design system's primitives.
 *
 * Nothing here draws SVG. Every function turns one part of the payload into a
 * call on `reportDesign/charts.pure.ts` and returns `''` when the data behind it
 * is absent — which is the rule the whole module exists to enforce: **a chart is
 * drawn only when the numbers it needs are real.** The generator being replaced
 * charts any table it can coerce into two numeric columns, which is how a
 * "Distribution chart" ends up drawn over a row of years.
 *
 * The other half of the rule is that the chart has to be honest about what the
 * data *is*. Three of these were chosen against the obvious option for that
 * reason, and each says so where it is defined:
 *
 * - the sensitivity tornado, because the stored data is two one-way series and
 *   a heatmap would invent a cross-product,
 * - the peer strip, because a 0-100 gauge on a corpus that never leaves 38-68
 *   tells a reader nothing,
 * - the SWOT quadrant, which is a labelled 2×2 of counts rather than
 *   `renderQuadrant`, because SWOT items have no x and no y.
 */
import {
  type BarItem,
  chartContext,
  chartFigure,
  COMPACT_FIGURE_FRACTION,
  type ChartContext,
  renderBars,
  renderBullet,
  renderGauge,
  renderMicroMap,
  renderScoreBars,
  renderSeriesFan,
  renderTiles,
  renderWaterfall,
  svgEscape,
  type WaterfallItem,
  withAlpha,
} from '../../reportDesign/charts.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import {
  escapeHtml,
  renderDataTable,
  type TableRow,
} from '../../reportDesign/primitives.pure.ts';
import type {
  Demographics,
  EconomicContext,
  FinancialModel,
  InvestmentReport,
  InvestmentScore,
  LocationIntelligence,
  PropertySpecs,
} from './payload.pure.ts';
import { SCORE_CORPUS } from './payload.pure.ts';

export const investmentChartContext = (palette: ResolvedReportPalette): ChartContext =>
  chartContext(palette);

const money = (v: number): string => {
  const abs = Math.abs(v);
  const body = abs >= 1_000_000
    ? `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`
    : abs >= 1_000
      ? `${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`
      : abs.toFixed(0);
  return `${v < 0 ? '−' : ''}$${body}`;
};

const pct = (v: number, digits = 1): string => `${v.toFixed(digits)}%`;

/**
 * The context a chart drawn at `CHART_WIDTH.compact` should be measured
 * against, and the figure width that matches it.
 *
 * A gauge is 460 units wide and 300 tall. Rendered `width: 100%` across the
 * 174mm measure that is 113mm of paper — read off a render, the score gauge
 * had a whole page to itself with two thirds of it empty. The narrowed context
 * matters as much as the CSS: every point size inside the drawing is computed
 * against `ctx.widthMm`, so a chart printed at 60% of the width it was measured
 * for sets its labels at 60% of the size the code asked for.
 */
const compactCtx = (ctx: ChartContext): ChartContext =>
  ({ ...ctx, widthMm: ctx.widthMm * COMPACT_FIGURE_FRACTION });

// ── The score ───────────────────────────────────────────────────────────────

/** The headline gauge. Absolute, 0-100, with the grade under it. */
export function scoreGauge(ctx: ChartContext, score: InvestmentScore): string {
  if (score.total === null) return '';
  return chartFigure(
    renderGauge(compactCtx(ctx), score.total, {
      max: 100,
      label: score.grade ? `Grade ${score.grade}` : 'Investment score',
      caption: 'Out of 100',
    }),
    'The composite score across all five dimensions.',
    '',
    'compact',
  );
}

/**
 * Where this score sits against every report the firm has scored.
 *
 * The reason this exists is the single most important visual finding of the
 * migration. **All 979 scored reports fall between 38 and 68**, 648 of them
 * grade C, with no A at any point in the record. So the absolute gauge above
 * puts the needle in very nearly the same place on every document ever
 * produced, and a reader comparing two reports learns nothing from it.
 *
 * This strip shows the observed range with the property's own score marked on
 * it, and names the peer set on the page. It is deliberately **not** dressed up
 * as a market percentile: the peers are this firm's own scored reports, which is
 * a real and useful reference and is not the same claim.
 */
export function scorePeerStrip(ctx: ChartContext, score: InvestmentScore): string {
  if (score.total === null) return '';
  const w = 720, h = 118;
  const padL = 30, padR = 30;
  const trackY = 54, trackH = 14;
  const trackW = w - padL - padR;
  const lo = SCORE_CORPUS.min, hi = SCORE_CORPUS.max;
  const at = (v: number) => padL + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * trackW;

  // One axis, and it is the score.
  //
  // The first version drew the five grade bands sized by *share of the corpus*
  // and then put the score marker on at its *value*, which is two different
  // scales on one axis: grade C is 66% of the corpus but a seven-point span, so
  // a 52 — a C+ — landed visually inside the C band. A render made that obvious
  // and nothing else would have. Grades cannot be drawn as disjoint spans here
  // in any case, because the observed score ranges overlap (C runs 42-54, C+
  // runs 50-57); the grade is already stated on the gauge above, so this chart
  // states the one thing the gauge cannot — where the score falls in the range
  // the firm has actually produced.
  const track = `<rect x="${padL}" y="${trackY}" width="${trackW}" height="${trackH}" `
    + `fill="${ctx.palette.groundAlt}" rx="2"/>`
    + `<rect x="${padL}" y="${trackY}" width="${(at(score.total) - padL).toFixed(1)}" `
    + `height="${trackH}" fill="${withAlpha(ctx.palette.accent, 0.55)}" rx="2"/>`;

  const meanX = at(SCORE_CORPUS.mean);
  const mean = `<line x1="${meanX.toFixed(1)}" x2="${meanX.toFixed(1)}" y1="${trackY - 6}" `
    + `y2="${trackY + trackH + 6}" stroke="${ctx.palette.inkMuted}" stroke-width="1" stroke-dasharray="3 3"/>`
    + `<text x="${meanX.toFixed(1)}" y="${trackY + trackH + 20}" text-anchor="middle" font-size="13" `
    + `fill="${ctx.palette.inkMuted}">average ${SCORE_CORPUS.mean}</text>`;

  const x = at(score.total);
  const marker = `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${trackY - 14}" `
    + `y2="${trackY + trackH + 4}" stroke="${ctx.palette.ink}" stroke-width="2.6"/>`
    + `<text x="${x.toFixed(1)}" y="${trackY - 22}" text-anchor="middle" font-size="20" font-weight="700" `
    + `fill="${ctx.palette.ink}" style="font-variant-numeric:lining-nums tabular-nums;">`
    + `${svgEscape(String(Math.round(score.total)))}</text>`;

  const ends = `<text x="${padL}" y="${trackY - 8}" font-size="13" fill="${ctx.palette.inkMuted}">`
    + `${lo}</text>`
    + `<text x="${w - padR}" y="${trackY - 8}" text-anchor="end" font-size="13" `
    + `fill="${ctx.palette.inkMuted}">${hi}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" `
    + `preserveAspectRatio="xMidYMid meet">${track}${mean}${marker}${ends}</svg>`;

  const rank = score.percentile !== null
    ? ` It scores higher than ${score.percentile}% of them.`
    : '';
  return chartFigure(
    svg,
    `Every one of the ${SCORE_CORPUS.count} reports this firm has scored falls between `
    + `${lo} and ${hi}, averaging ${SCORE_CORPUS.mean}. The scale is this firm's own record, `
    + `not the market.${rank}`,
  );
}

/**
 * The scored dimensions as bars on a common baseline, and the table that
 * explains them.
 *
 * The chart alone says how the dimensions scored and nothing about which of
 * them the composite leaned on. The engine records a `weight` and a one-line
 * `details` for each — "Excellent walkability (90+). Limited CBD access
 * (>60 min)." — and until `toScore` learned to read the dimension objects,
 * none of it left the database. A shape without its weights is a picture; with
 * them it is an argument, so the two ship together.
 *
 * This drew a radar until 2026-09-08. `renderScoreBars` carries why it does
 * not any more; the short version is that the polygon's area depended on the
 * arbitrary order of the axes, which made the chart's most dominant property
 * carry no information.
 */
export function scoreWheel(ctx: ChartContext, score: InvestmentScore): string {
  const present = score.breakdown.filter((b) => b.value !== null);
  // Two bars are a comparison; one is a number, and a number belongs in the
  // table rather than in a chart of its own.
  if (present.length < 2) return '';
  const wheel = chartFigure(
    renderScoreBars(compactCtx(ctx), present.map((b) => b.value as number), {
      labels: present.map((b) => b.label),
      max: 100,
    }),
    present.length < score.breakdown.length
      ? `${score.breakdown.length - present.length} of the five dimensions were not scored and are not plotted.`
      : 'Each dimension out of 100.',
    '',
    'compact',
  );
  return wheel + scoreBreakdownTable(score);
}

/**
 * The dimension table: score, weight, and the engine's own reason.
 *
 * An excluded dimension keeps its row and says so rather than being dropped —
 * "no data" and "scored zero" are opposite facts, and a reader who counts four
 * rows where the wheel has five would assume the fifth was cut for space.
 */
export function scoreBreakdownTable(score: InvestmentScore): string {
  const rows: TableRow[] = score.breakdown
    .filter((b) => b.value !== null || b.excluded || b.details)
    .map((b) => ({
      dimension: b.label,
      score: b.excluded || b.value === null ? 'Not scored' : String(Math.round(b.value)),
      weight: b.weight === null ? '' : `${Math.round(b.weight)}`,
      why: b.excluded && !b.details ? 'No data was available for this dimension.' : b.details,
    }));
  if (rows.length < 2) return '';
  const anyWeight = score.breakdown.some((b) => b.weight !== null);
  const anyDetail = score.breakdown.some((b) => Boolean(b.details));
  return renderDataTable(
    [
      { key: 'dimension', label: 'Dimension', align: 'left' },
      { key: 'score', label: 'Score', align: 'right' },
      ...(anyWeight ? [{ key: 'weight', label: 'Weight', align: 'right' as const }] : []),
      ...(anyDetail ? [{ key: 'why', label: 'What the score reflects', align: 'left' as const }] : []),
    ],
    rows,
    { caption: 'How the composite was built' },
  );
}

/**
 * SWOT as a labelled 2×2.
 *
 * Not `renderQuadrant`: that plots points against an x and a y, and a strength
 * has neither. This is four counted lists in the conventional SWOT arrangement —
 * internal on the top row, external on the bottom, helpful on the left.
 */
export function swotQuadrant(score: InvestmentScore): string {
  const cells: Array<{ title: string; tone: string; items: readonly string[] }> = [
    { title: 'Strengths', tone: 'positive', items: score.strengths },
    { title: 'Weaknesses', tone: 'negative', items: score.weaknesses },
    { title: 'Opportunities', tone: 'informative', items: score.opportunities },
    { title: 'Risks', tone: 'caution', items: score.risks },
  ];
  if (cells.every((c) => !c.items.length)) return '';

  const html = cells.map((c) => `
        <div class="swot-cell tone-${c.tone}">
          <span class="swot-label">${escapeHtml(c.title)}</span>
          ${c.items.length
            ? `<ul>${c.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
            : '<p class="swot-empty">None identified</p>'}
        </div>`).join('');
  return `<div class="swot-grid">${html}</div>`;
}

// ── Location ────────────────────────────────────────────────────────────────

/** The locator, plus the walk score as a bullet when there is one. */
export function localityMap(ctx: ChartContext, loc: LocationIntelligence): string {
  if (!loc.suburb && loc.walkScore === null) return '';
  const map = loc.suburb
    ? chartFigure(
      renderMicroMap(compactCtx(ctx), { suburb: loc.suburb, state: loc.state, postcode: loc.postcode }),
      loc.lat !== null && loc.lng !== null
        ? 'An abstract locator, not a map to scale.'
        : 'An abstract locator. No coordinates were recorded for this property.',
      '',
      'compact',
    )
    : '';
  const walk = loc.walkScore !== null
    ? chartFigure(
      renderBullet(ctx, {
        value: loc.walkScore,
        max: 100,
        ranges: [50, 70, 90],
        label: 'Walk Score',
        sub: 'Car-dependent · Somewhat walkable · Very walkable · Walker’s paradise',
      }),
      '',
    )
    : '';
  return map + walk;
}

/** Amenity counts, as bars. */
export function amenityBars(ctx: ChartContext, loc: LocationIntelligence): string {
  const items: BarItem[] = loc.amenities
    .filter((a) => a.count !== null && a.count > 0)
    .slice(0, 8)
    .map((a) => ({ label: a.label, value: a.count as number, display: String(a.count) }));
  if (items.length < 2) return '';
  return chartFigure(
    renderBars(ctx, items, { title: 'Amenities within reach' }),
    'Counted from the location intelligence lookup at the time the report was generated.',
  );
}

// ── Demographics and the economy ────────────────────────────────────────────

/** The locality's people, as bars of comparable rates. */
export function demographicsBars(ctx: ChartContext, d: Demographics): string {
  const rates: BarItem[] = [];
  const add = (label: string, v: number | null, tone?: BarItem['tone']) => {
    if (v === null) return;
    rates.push({ label, value: v, display: pct(v), tone });
  };
  add('Owner-occupied', d.ownerOccupierRate, 'accent');
  add('Rented', d.renterRate, 'accent');
  add('Housing stress', d.housingStress, 'caution');
  add('Unemployment', d.unemploymentRate, 'caution');
  add('Population growth', d.populationGrowth, 'positive');
  if (rates.length < 2) return '';
  return chartFigure(
    renderBars(ctx, rates, { title: 'Household and labour profile', max: 100, unit: '%' }),
    'Rates as a share of the locality, from the most recent census and labour force data.',
  );
}

/** The macro backdrop, as tiles. */
export function economicTiles(ctx: ChartContext, e: EconomicContext): string {
  const tiles = [
    { label: 'Cash rate', v: e.cashRate, f: (n: number) => pct(n, 2) },
    { label: 'Inflation', v: e.inflation, f: (n: number) => pct(n) },
    { label: 'GDP growth', v: e.gdpGrowth, f: (n: number) => pct(n) },
    { label: 'Unemployment', v: e.unemploymentRate, f: (n: number) => pct(n) },
    { label: 'Participation', v: e.participationRate, f: (n: number) => pct(n) },
    { label: 'Credit growth', v: e.creditGrowth, f: (n: number) => pct(n) },
    { label: 'House price growth', v: e.housePriceGrowth, f: (n: number) => pct(n) },
  ].filter((t) => t.v !== null).map((t) => ({ label: t.label, value: t.f(t.v as number) }));
  if (tiles.length < 3) return '';
  return chartFigure(
    renderTiles(ctx, tiles, { title: 'The macro backdrop', cols: 4 }),
    'As at the date this report was generated, not as at today.',
  );
}

/** What the property is, as tiles. Drawn from the one column every row has. */
export function propertyTiles(ctx: ChartContext, s: PropertySpecs): string {
  const tiles = [
    { label: 'Bedrooms', v: s.bedrooms === null ? '' : String(s.bedrooms) },
    { label: 'Bathrooms', v: s.bathrooms === null ? '' : String(s.bathrooms) },
    { label: 'Parking', v: s.parking === null ? '' : String(s.parking) },
    { label: 'Land', v: s.landSqm === null ? '' : `${Math.round(s.landSqm)} m²` },
    { label: 'Building', v: s.buildingSqm === null ? '' : `${Math.round(s.buildingSqm)} m²` },
    { label: 'Built', v: s.yearBuilt === null ? '' : String(s.yearBuilt) },
    { label: 'Zoning', v: s.zoning },
    { label: 'Type', v: s.propertyType },
  ].filter((t) => t.v).map((t) => ({ label: t.label, value: t.v }));
  if (tiles.length < 3) return '';
  return chartFigure(renderTiles(ctx, tiles, { cols: 4 }), '');
}

// ── The financial model ─────────────────────────────────────────────────────

/** Gross and net yield, and cash-on-cash, each against a plausible band. */
export function yieldBullets(ctx: ChartContext, f: FinancialModel): string {
  const out: string[] = [];
  if (f.grossYield !== null) {
    out.push(renderBullet(ctx, {
      value: f.grossYield, max: 10, ranges: [3, 4.5, 6],
      label: 'Gross rental yield', sub: `${pct(f.grossYield, 2)} of purchase price`,
    }));
  }
  if (f.netYield !== null) {
    out.push(renderBullet(ctx, {
      value: f.netYield, max: 10, ranges: [2, 3.5, 5],
      label: 'Net rental yield', sub: `${pct(f.netYield, 2)} after holding costs`,
    }));
  }
  if (f.cashOnCash !== null) {
    out.push(renderBullet(ctx, {
      value: Math.max(0, f.cashOnCash), max: 15, ranges: [3, 6, 9],
      label: 'Cash-on-cash return',
      sub: f.cashOnCash < 0 ? `${pct(f.cashOnCash, 2)} — negative, shown at zero` : pct(f.cashOnCash, 2),
    }));
  }
  if (!out.length) return '';
  return chartFigure(out.join(''), 'Bands are conventional market ranges, not a recommendation.');
}

/** LVR against the lending thresholds a reader will care about. */
export function lvrBullet(ctx: ChartContext, f: FinancialModel): string {
  if (f.lvr === null) return '';
  return chartFigure(
    renderBullet(ctx, {
      value: f.lvr, max: 100, ranges: [60, 80, 90],
      label: 'Loan-to-value ratio',
      sub: f.lvr > 80 ? `${pct(f.lvr)} — above the 80% LMI threshold` : pct(f.lvr),
    }),
    'The 80% mark is where lenders mortgage insurance usually begins.',
  );
}

/**
 * Income less each cost line, ending on the net position.
 *
 * A waterfall rather than a pie of costs, because the quantity a reader is
 * after is what survives — and a pie cannot show a negative total, which is what
 * most of these reports have.
 */
export function costWaterfall(ctx: ChartContext, f: FinancialModel): string {
  if (!f.costs.length || f.annualIncome === null) return '';
  const items: WaterfallItem[] = [
    { label: 'Gross rent', value: f.annualIncome },
    ...f.costs.map((c) => ({ label: c.label, value: -c.value })),
  ];
  if (f.monthlyPayment !== null) items.push({ label: 'Loan repayments', value: -f.monthlyPayment * 12 });
  const net = items.reduce((n, i) => n + i.value, 0);
  items.push({ label: 'Net position', value: net, total: true });
  return chartFigure(
    renderWaterfall(ctx, items, { mode: 'money' }),
    net < 0
      ? `This property is negatively geared at ${money(net)} a year before tax.`
      : `This property is positively geared at ${money(net)} a year before tax.`,
  );
}

/**
 * One-way sensitivities as a tornado.
 *
 * **Not a heatmap.** `sensitivityAnalysis` holds `interestRateChanges` and
 * `rentChanges` as two independent objects of three scenarios each — six
 * one-way results, not a 3×3 grid. The generator being replaced draws a heatmap
 * from them, which asks the reader to read a cell as "rent +10% *and* rates
 * +1%", a combination nothing ever computed. A tornado states exactly what the
 * data is: the effect of moving one variable at a time, ordered by impact.
 */
export function sensitivityTornado(ctx: ChartContext, f: FinancialModel): string {
  const points = [...f.interestSensitivity, ...f.rentSensitivity];
  if (points.length < 2) return '';
  const items: BarItem[] = points
    .map((p) => ({
      label: p.label,
      value: p.delta,
      display: `${p.delta >= 0 ? '+' : ''}${money(p.delta)}`,
      tone: (p.delta >= 0 ? 'positive' : 'negative') as BarItem['tone'],
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return chartFigure(
    renderBars(ctx, items, { title: 'One variable at a time' }),
    'Change in the annual position against the base case. Each scenario moves a '
    + 'single variable — the report does not model them in combination.',
  );
}

/** The ten-year fan, all three scenarios. */
export function projectionFan(
  ctx: ChartContext,
  series: Array<{ label: string; values: number[] }>,
  opts: { title: string; caption: string; mode?: 'money' | 'percent' | 'plain'; zeroLine?: boolean },
): string {
  if (!series.length) return '';
  const years = Math.max(...series.map((s) => s.values.length));
  return chartFigure(
    renderSeriesFan(ctx, series, {
      title: opts.title,
      xLabels: Array.from({ length: years }, (_, i) => `Yr ${i + 1}`),
      mode: opts.mode ?? 'money',
      // Only where zero is a reference a reader is actually looking for.
      //
      // Forcing it on every fan put a break-even line under a property-value
      // series that runs from $466k to $931k, which threw away more than half
      // the plot and squeezed ten years of divergence into the top third. Zero
      // is the whole point of a cumulative cash-flow chart and pure decoration
      // on a valuation one.
      zeroLine: opts.zeroLine === true,
    }),
    opts.caption,
  );
}

// ── The dispatcher ──────────────────────────────────────────────────────────

/**
 * Whether a named chart has the data it needs.
 *
 * The single fact both the page planner and the renderer read, for the reason
 * the Market Intelligence migration learned the hard way with its audience
 * panels: two modules deciding the same thing separately drift, and the drift
 * shows up as a page budget that over-claims by exactly one page per chart that
 * turned out not to be drawable.
 *
 * Measured before this existed: a report with no financial model earned six
 * financial charts, drew none of them, and claimed four pages more than it
 * printed.
 *
 * Deliberately conservative — it answers "could this be drawn", and the drawing
 * functions remain free to return `''` for a reason this cannot see. The
 * renderer counts those into `chartsSkipped`, so a disagreement is visible in
 * the ledger rather than silent.
 */
export function chartHasData(name: string, report: InvestmentReport): boolean {
  const s = report.score;
  const f = report.financial;
  const loc = report.location;
  switch (name) {
    case 'score-gauge': return s !== null && s.total !== null;
    case 'score-peers': return s !== null && s.total !== null;
    case 'score-wheel': return s !== null && s.breakdown.filter((b) => b.value !== null).length >= 3;
    case 'swot-quadrant':
      return s !== null
        && [s.strengths, s.weaknesses, s.opportunities, s.risks].some((l) => l.length > 0);
    case 'locality-map': return loc !== null && (Boolean(loc.suburb) || loc.walkScore !== null);
    case 'amenity-bullets':
      return loc !== null && loc.amenities.filter((a) => a.count !== null && a.count > 0).length >= 2;
    case 'demographics-bars': {
      const d = report.demographics;
      if (!d) return false;
      const rates = [d.ownerOccupierRate, d.renterRate, d.housingStress, d.unemploymentRate, d.populationGrowth];
      return rates.filter((v) => v !== null).length >= 2;
    }
    case 'economic-bullets': {
      const e = report.economic;
      if (!e) return false;
      return Object.values(e).filter((v) => v !== null).length >= 3;
    }
    case 'property-tiles': {
      const p = report.specs;
      const filled = [p.bedrooms, p.bathrooms, p.parking, p.landSqm, p.buildingSqm, p.yearBuilt]
        .filter((v) => v !== null).length + [p.zoning, p.propertyType].filter(Boolean).length;
      return filled >= 3;
    }
    case 'yield-bullets':
      return f !== null && (f.grossYield !== null || f.netYield !== null || f.cashOnCash !== null);
    case 'lvr-bullet': return f !== null && f.lvr !== null;
    case 'cost-waterfall': return f !== null && f.costs.length > 0 && f.annualIncome !== null;
    case 'sensitivity-tornado':
      return f !== null && f.interestSensitivity.length + f.rentSensitivity.length >= 2;
    case 'projection-value':
    case 'projection-rent':
    case 'projection-cashflow':
      return f !== null && f.projections.length >= 2;
    default: return false;
  }
}

/**
 * Draw one named chart, or nothing.
 *
 * Returning `''` rather than throwing is the point: a chart is a garnish on a
 * section of prose, and a missing measurement should cost the reader the chart,
 * never the section. The caller counts the empties into `notices.chartsSkipped`.
 */
export function renderNamedChart(
  name: string,
  report: InvestmentReport,
  ctx: ChartContext,
  scenarios: (field: 'propertyValue' | 'cumulativeCashFlow' | 'annualRent') => Array<{ label: string; values: number[] }>,
): string {
  const f = report.financial;
  switch (name) {
    case 'score-gauge': return report.score ? scoreGauge(ctx, report.score) : '';
    case 'score-peers': return report.score ? scorePeerStrip(ctx, report.score) : '';
    case 'score-wheel': return report.score ? scoreWheel(ctx, report.score) : '';
    case 'swot-quadrant': return report.score ? swotQuadrant(report.score) : '';
    case 'locality-map': return report.location ? localityMap(ctx, report.location) : '';
    case 'amenity-bullets': return report.location ? amenityBars(ctx, report.location) : '';
    case 'demographics-bars': return report.demographics ? demographicsBars(ctx, report.demographics) : '';
    case 'economic-bullets': return report.economic ? economicTiles(ctx, report.economic) : '';
    case 'property-tiles': return propertyTiles(ctx, report.specs);
    case 'yield-bullets': return f ? yieldBullets(ctx, f) : '';
    case 'lvr-bullet': return f ? lvrBullet(ctx, f) : '';
    case 'cost-waterfall': return f ? costWaterfall(ctx, f) : '';
    case 'sensitivity-tornado': return f ? sensitivityTornado(ctx, f) : '';
    case 'projection-value':
      return f
        ? projectionFan(ctx, scenarios('propertyValue'), {
          title: 'Projected property value',
          caption: 'Three growth scenarios over ten years. The band is the spread between them.',
        })
        : '';
    case 'projection-rent':
      return f
        ? projectionFan(ctx, scenarios('annualRent'), {
          title: 'Projected annual rent',
          caption: 'Three scenarios over ten years, before vacancy and costs.',
        })
        : '';
    case 'projection-cashflow':
      return f
        ? projectionFan(ctx, scenarios('cumulativeCashFlow'), {
          title: 'Cumulative cash flow',
          caption: 'Before tax. The dashed line at zero is break-even.',
          zeroLine: true,
        })
        : '';
    default: return '';
  }
}
