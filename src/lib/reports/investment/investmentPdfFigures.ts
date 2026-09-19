/**
 * Charts and sparklines for the standard Investment presentation, drawn as
 * vectors with pdf-lib.
 *
 * ## They plot what the document already says
 *
 * Every series here is read from the stored record the document itself is
 * built from — `financial_calculations.projections` (10 years: property value,
 * equity, cash flow, cumulative cash flow, rent, loan balance) and
 * `investment_score.breakdown`. Nothing is fetched, nothing is recomputed and
 * nothing is estimated. A chart is a second reading of a figure the report
 * has already stated, which is why turning charts off is safe: the figures
 * stay where they were.
 *
 * ## Absent is absent
 *
 * A series the record does not carry draws nothing at all. 22 of the 216
 * stored reports with financials have no `projections` object, and a chart
 * invented for them would be the confident-figure-against-nothing failure this
 * programme has already had once.
 *
 * ## No external service
 *
 * These are lines, rectangles and text on the page. There is no chart library,
 * no image, and no request — which is also what makes them survive the render
 * boundary that a fetched chart image would not.
 */
import type { PDFFont, PDFPage } from 'pdf-lib';
import { rgb } from 'pdf-lib';
import { dimensionScoresMayBeShown, dimensionWasScored } from '@/lib/reports/investment/scoreSections.pure';

/** The report's palette, passed in so this draws in the document's own ink. */
export interface FigurePalette {
  ink: ReturnType<typeof rgb>;
  muted: ReturnType<typeof rgb>;
  accent: ReturnType<typeof rgb>;
  rule: ReturnType<typeof rgb>;
  positive: ReturnType<typeof rgb>;
  negative: ReturnType<typeof rgb>;
}

export interface ProjectionYear {
  year: number;
  propertyValue?: number;
  equity?: number;
  cashFlow?: number;
  cumulativeCashFlow?: number;
  annualRent?: number;
  loanBalance?: number;
}

const finite = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The ten-year series the record carries, or null.
 *
 * `moderate` is the scenario the document's own projection section is written
 * from; the other two exist and are deliberately not plotted, because a chart
 * showing a scenario the prose does not discuss invites a reader to compare
 * two different assumptions as though they were one.
 */
export function readProjectionSeries(financials: unknown): ProjectionYear[] | null {
  const projections = (financials as { projections?: unknown } | null | undefined)?.projections;
  const moderate = (projections as { moderate?: unknown } | null | undefined)?.moderate;
  if (!Array.isArray(moderate) || moderate.length < 2) return null;

  const rows: ProjectionYear[] = [];
  for (const entry of moderate) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const year = finite(row.year);
    if (year === null) continue;
    rows.push({
      year,
      propertyValue: finite(row.propertyValue) ?? undefined,
      equity: finite(row.equity) ?? undefined,
      cashFlow: finite(row.cashFlow) ?? undefined,
      cumulativeCashFlow: finite(row.cumulativeCashFlow) ?? undefined,
      annualRent: finite(row.annualRent) ?? undefined,
      loanBalance: finite(row.loanBalance) ?? undefined,
    });
  }
  return rows.length >= 2 ? rows : null;
}

export interface ScoreComponent { label: string; score: number; weight?: number }

/**
 * The scored dimensions the record carries, or an empty list.
 *
 * Two questions, both asked of the modules that own them rather than of a
 * local reading. Whether this score's own run authorised publishing dimension
 * scores at all (`dimensionScoresMayBeShown` — the templated scorecard's
 * gate, which this chart never asked). And whether a dimension was actually
 * scored (`dimensionWasScored`): the engine writes `available: false` with a
 * score of 0 and a weight of 0 for a dimension it had no data for, and the
 * local test here read `hasData` alone — so an unscored growth dimension
 * survived as a real bar labelled "Growth 0" beside "Yield 30" on every
 * document of 291 Stone Mason Drive (QA-19). A dimension that is out of
 * scope is not a substantive zero.
 */
export function readScoreComponents(investmentScore: unknown): ScoreComponent[] {
  const breakdown = (investmentScore as { breakdown?: unknown } | null | undefined)?.breakdown;
  if (typeof breakdown !== 'object' || breakdown === null) return [];
  if (!dimensionScoresMayBeShown(investmentScore as Record<string, unknown>)) return [];
  const out: ScoreComponent[] = [];
  for (const [key, raw] of Object.entries(breakdown as Record<string, unknown>)) {
    if (typeof raw === 'object' && raw !== null && !dimensionWasScored(raw)) continue;
    const value = typeof raw === 'object' && raw !== null
      ? finite((raw as Record<string, unknown>).score)
      : finite(raw);
    if (value === null) continue;
    const weight = typeof raw === 'object' && raw !== null
      ? finite((raw as Record<string, unknown>).weight) ?? undefined
      : undefined;
    out.push({
      // `growthScore` → `Growth`. The projection's own vocabulary, made into
      // words rather than printed as a field name.
      label: key.replace(/Score$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, (c) => c.toUpperCase()),
      score: value,
      weight,
    });
  }
  return out;
}

const money = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
};

export interface Box { x: number; y: number; width: number; height: number }

/**
 * A line chart of one money series against the projection years.
 *
 * Every gridline is labelled and both axis ends are named, because an
 * unlabelled axis is a decoration rather than a reading.
 */
export function drawProjectionLineChart(
  page: PDFPage,
  series: ProjectionYear[],
  field: keyof Omit<ProjectionYear, 'year'>,
  title: string,
  box: Box,
  fonts: { regular: PDFFont; bold: PDFFont },
  palette: FigurePalette,
): boolean {
  const points = series
    .map((row) => ({ year: row.year, value: row[field] }))
    .filter((p): p is { year: number; value: number } => typeof p.value === 'number');
  if (points.length < 2) return false;

  const titleSize = 9;
  const labelSize = 6.5;
  const plot = {
    x: box.x + 44,
    y: box.y + 16,
    width: box.width - 52,
    height: box.height - 16 - titleSize - 10,
  };
  if (plot.width <= 20 || plot.height <= 20) return false;

  page.drawText(title, {
    x: box.x, y: box.y + box.height - titleSize, size: titleSize,
    font: fonts.bold, color: palette.ink,
  });

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 0);
  const span = rawMax - rawMin || Math.abs(rawMax) || 1;
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;

  const toX = (i: number) => plot.x + (plot.width * i) / (points.length - 1);
  const toY = (v: number) => plot.y + (plot.height * (v - min)) / (max - min);

  // Gridlines, each labelled with the value it stands for.
  for (let g = 0; g <= 3; g += 1) {
    const value = min + ((max - min) * g) / 3;
    const y = toY(value);
    page.drawLine({
      start: { x: plot.x, y }, end: { x: plot.x + plot.width, y },
      thickness: 0.4, color: palette.rule,
    });
    page.drawText(money(value), {
      x: box.x, y: y - labelSize / 2 + 1, size: labelSize,
      font: fonts.regular, color: palette.muted,
    });
  }

  // A zero rule where the series crosses it — a negative cash flow reads as
  // negative only against a baseline.
  if (min < 0 && max > 0) {
    page.drawLine({
      start: { x: plot.x, y: toY(0) }, end: { x: plot.x + plot.width, y: toY(0) },
      thickness: 0.8, color: palette.muted,
    });
  }

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    page.drawLine({
      start: { x: toX(i - 1), y: toY(a.value) },
      end: { x: toX(i), y: toY(b.value) },
      thickness: 1.4,
      color: b.value >= a.value ? palette.accent : palette.negative,
    });
  }

  // Only the ends of the x-axis are named: ten crowded year labels under a
  // 150pt chart are unreadable and say nothing the table does not.
  page.drawText(`Year ${points[0].year}`, {
    x: plot.x, y: box.y + 4, size: labelSize, font: fonts.regular, color: palette.muted,
  });
  const lastLabel = `Year ${points[points.length - 1].year}`;
  page.drawText(lastLabel, {
    x: plot.x + plot.width - fonts.regular.widthOfTextAtSize(lastLabel, labelSize),
    y: box.y + 4, size: labelSize, font: fonts.regular, color: palette.muted,
  });
  return true;
}

/** Scored dimensions as bars on a common baseline, each labelled with its value. */
export function drawScoreBars(
  page: PDFPage,
  components: ScoreComponent[],
  title: string,
  box: Box,
  fonts: { regular: PDFFont; bold: PDFFont },
  palette: FigurePalette,
): boolean {
  if (!components.length) return false;
  const titleSize = 9;
  const rowSize = 7;
  const labelWidth = 86;
  const valueWidth = 26;
  const rows = components.slice(0, 8);
  const rowHeight = Math.min(14, (box.height - titleSize - 8) / rows.length);
  if (rowHeight < 7) return false;

  page.drawText(title, {
    x: box.x, y: box.y + box.height - titleSize, size: titleSize,
    font: fonts.bold, color: palette.ink,
  });

  // A common baseline means one scale: the largest of 100 and what is actually
  // scored, so a 0–10 breakdown is not drawn as ten empty bars.
  const max = Math.max(100, ...rows.map((r) => r.score));
  const barWidth = box.width - labelWidth - valueWidth;
  if (barWidth <= 10) return false;

  rows.forEach((row, i) => {
    const y = box.y + box.height - titleSize - 10 - (i + 1) * rowHeight + rowHeight * 0.25;
    page.drawText(row.label.slice(0, 22), {
      x: box.x, y, size: rowSize, font: fonts.regular, color: palette.ink,
    });
    page.drawRectangle({
      x: box.x + labelWidth, y: y - 1, width: barWidth, height: rowSize,
      color: palette.rule,
    });
    page.drawRectangle({
      x: box.x + labelWidth, y: y - 1,
      width: Math.max(0, (barWidth * Math.min(row.score, max)) / max), height: rowSize,
      color: palette.accent,
    });
    page.drawText(String(Math.round(row.score)), {
      x: box.x + labelWidth + barWidth + 4, y, size: rowSize,
      font: fonts.bold, color: palette.ink,
    });
  });
  return true;
}

/**
 * A sparkline — the shape of a series, beside the figure it belongs to.
 *
 * No axis, no labels, no scale: a sparkline is a word-sized graphic that says
 * "rising", "falling" or "flat" next to a number that is already printed. The
 * moment it needs a label it wants to be a chart instead.
 */
export function drawSparkline(
  page: PDFPage,
  values: readonly number[],
  box: Box,
  palette: FigurePalette,
): boolean {
  const points = values.filter((v) => Number.isFinite(v));
  if (points.length < 2 || box.width <= 4 || box.height <= 2) return false;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || Math.abs(max) || 1;
  const toX = (i: number) => box.x + (box.width * i) / (points.length - 1);
  const toY = (v: number) => box.y + (box.height * (v - min)) / range;

  if (min < 0 && max > 0) {
    page.drawLine({
      start: { x: box.x, y: toY(0) }, end: { x: box.x + box.width, y: toY(0) },
      thickness: 0.3, color: palette.rule,
    });
  }
  for (let i = 1; i < points.length; i += 1) {
    page.drawLine({
      start: { x: toX(i - 1), y: toY(points[i - 1]) },
      end: { x: toX(i), y: toY(points[i]) },
      thickness: 0.9,
      color: palette.accent,
    });
  }
  // The end point, because a sparkline is read from its last value.
  const lastY = toY(points[points.length - 1]);
  page.drawCircle({
    x: box.x + box.width, y: lastY, size: 1.4,
    color: points[points.length - 1] >= points[0] ? palette.positive : palette.negative,
  });
  return true;
}

/** The series a sparkline is drawn from, by the figure it sits beside. */
export function sparklineSeries(
  series: ProjectionYear[], field: keyof Omit<ProjectionYear, 'year'>,
): number[] {
  return series
    .map((row) => row[field])
    .filter((v): v is number => typeof v === 'number');
}
