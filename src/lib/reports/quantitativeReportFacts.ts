/**
 * What a quantitative market report holds, read once for the PDF the report
 * page composes.
 *
 * That PDF was written against a report shape the pipeline no longer stores.
 * `quantitative-report-pipeline` writes `kpis` (and a copy under `analytics`)
 * as `total_listings`, `average_price`, `median_price`, `valid_price_count` and
 * `unique_suburbs`; the PDF read `avg_price`, `recent_30d`,
 * `analytics.velocity`, `analytics.quality` and `analytics.coverage`, none of
 * which exist, and every read had a default. So each downloaded report said
 * its market showed "stable momentum with a 0.0% increase in listing volume",
 * that "the median listing price stands at $0", that data confidence averaged
 * "0.0%" and the market's health was "Low" — and it went further than
 * defaults: a field-coverage table of percentages chosen by thresholds on a
 * number that was always zero, a confidence distribution of fixed shares of
 * the listing count (30 / 35 / 20 / 15 %), and a "Suburb Deep-Dive" of ten
 * hard-coded Perth suburbs at invented shares and prices built on a $500,000
 * base, whatever market the report was about.
 *
 * Here every figure is read from where the pipeline puts it, under both
 * spellings a stored row can carry, and a figure the row does not hold is
 * `null` — never a zero, never a default. The page prints what is held and
 * leaves out what is not.
 */
import type { QuantitativeChartPoint, StoredQuantitativeChart } from './quantitativeCharts';
import { chartPointsFromConfig } from './quantitativeCharts';

/** The parts of a stored report row this reads. */
export interface StoredQuantitativeReport {
  listing_count?: number | null;
  kpis?: Record<string, unknown> | null;
  analytics?: Record<string, unknown> | null;
}

export interface QuantitativeReportFacts {
  totalListings: number | null;
  averagePrice: number | null;
  medianPrice: number | null;
  /** Listings that carried a usable price. */
  pricedListings: number | null;
  uniqueSuburbs: number | null;
  /** Listings received in the last 30 days. */
  recent30d: number | null;
  velocity: { label: string; delta: number | null } | null;
  /** Average data confidence, per cent — whichever scale the row stored it on. */
  confidence: number | null;
  /** Field completeness, per cent. */
  completeness: number | null;
  coverage: { suburbs: number | null; saturation: string | null } | null;
  quartiles: { q1: number | null; q3: number | null; iqr: number | null } | null;
  /** The suburbs with the most listings, most first — the pipeline's own count. */
  topSuburbs: Array<{ suburb: string; listings: number }>;
}

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** A count: a finite number of zero or more. */
const count = (...values: unknown[]): number | null => {
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  return null;
};

/** A price, a percentage or an index: a finite number above zero. A zero price is no price. */
const positive = (...values: unknown[]): number | null => {
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  return null;
};

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A per cent: above zero and no more than a hundred. */
const percent = (v: unknown): number | null => {
  const n = positive(v);
  return n !== null && n <= 100 ? n : null;
};

/**
 * An average confidence, as a per cent. The generator that wrote it averaged
 * the listings' own confidences, which are 0–1 shares (`airtableListing.pure.ts`),
 * and stored the share: 0.78, printed by this page as "0.8%". The listings'
 * own rule reads it — a value up to 1 is a share, one above 1 and up to 100 is
 * already a per cent — and anything else is not a confidence.
 */
const confidencePercent = (v: unknown): number | null => {
  const n = positive(v);
  return n !== null && n <= 1 ? n * 100 : percent(n);
};

/**
 * A stored chart's data, found by the pipeline's own key for it and, for a row
 * written before keys were stored, by its title.
 */
function chartData(
  charts: readonly StoredQuantitativeChart[],
  key: string,
  title: RegExp,
): QuantitativeChartPoint[] | null {
  const chart = charts.find((c) => c.chart_key === key)
    ?? charts.find((c) => !c.chart_key && title.test(c.title ?? ''));
  return chart ? chartPointsFromConfig(chart) : null;
}

/** The pipeline's bucket for a listing with no suburb: not a suburb. */
const NO_SUBURB = /^unknown(\s+suburb)?$/i;

export function readQuantitativeReportFacts(
  report: StoredQuantitativeReport,
  charts: readonly StoredQuantitativeChart[] = [],
): QuantitativeReportFacts {
  const kpis = record(report.kpis) ?? {};
  const analytics = record(report.analytics) ?? {};
  const price = record(analytics.price);
  const quality = record(analytics.quality);
  const coverageRow = record(analytics.coverage);
  const velocityRow = record(analytics.velocity);

  // The pipeline's daily activity chart is the last 30 days of dated listings,
  // one point a day; its own finding states their sum as the month's intake.
  const daily = chartData(charts, 'daily_listing_activity', /^daily listing activity$/i);
  const recentFromChart = daily ? daily.reduce((sum, p) => sum + p.value, 0) : null;

  const suburbs = chartData(charts, 'suburb_volume', /^suburb volume distribution$/i) ?? [];
  const topSuburbs = suburbs
    .filter((p) => p.value > 0 && p.label.trim() && !NO_SUBURB.test(p.label.trim()))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((p) => ({ suburb: p.label.trim(), listings: p.value }));

  // The pipeline counts the listings with no suburb as one suburb more
  // (`l.suburb || "Unknown"`). Where its own suburb chart shows that bucket,
  // the count is one more than the suburbs the listings name.
  //
  // That chart is the ten busiest suburbs. Where it is cut at ten and the
  // bucket falls below the cut, nothing stored says the bucket exists, so the
  // pipeline's own count is printed as it always was, and it can be one more
  // than the suburbs named. Counting only named suburbs is the pipeline's fix
  // (`unique_suburbs`, at a new `REPORT_VERSION`), recorded with its other
  // defects in `TEMPLATE_PARITY.md`.
  const storedSuburbs = count(kpis.unique_suburbs, analytics.unique_suburbs);
  const pipelineSuburbs = charts.find((c) => c.chart_key === 'suburb_volume' || c.chart_key === 'suburb_volume_distribution');
  const countsNoSuburb = Boolean(pipelineSuburbs
    && (chartPointsFromConfig(pipelineSuburbs) ?? []).some((p) => p.value > 0 && NO_SUBURB.test(p.label.trim())));

  const velocityLabel = text(velocityRow?.label);
  const q1 = positive(price?.q1);
  const q3 = positive(price?.q3);
  const iqr = positive(price?.iqr);

  return {
    totalListings: count(kpis.total_listings, analytics.total_listings, report.listing_count),
    averagePrice: positive(kpis.average_price, kpis.avg_price, analytics.average_price),
    medianPrice: positive(kpis.median_price, analytics.median_price, price?.median),
    pricedListings: count(kpis.valid_price_count, analytics.valid_price_count),
    uniqueSuburbs: storedSuburbs !== null && countsNoSuburb && storedSuburbs > 0 ? storedSuburbs - 1 : storedSuburbs,
    recent30d: count(kpis.recent_30d, recentFromChart),
    velocity: velocityLabel
      ? { label: velocityLabel, delta: typeof velocityRow?.delta === 'number' && Number.isFinite(velocityRow.delta) ? velocityRow.delta : null }
      : null,
    confidence: confidencePercent(quality?.avg_confidence),
    completeness: percent(quality?.completeness),
    coverage: coverageRow && (count(coverageRow.suburbs) !== null || text(coverageRow.saturation))
      ? { suburbs: count(coverageRow.suburbs), saturation: text(coverageRow.saturation) }
      : null,
    quartiles: q1 !== null || q3 !== null || iqr !== null ? { q1, q3, iqr } : null,
    topSuburbs,
  };
}

/** The generator's velocity labels, as the word a sentence needs ("volume is rising", not "is uptrend"). */
const VELOCITY_WORDS: Readonly<Record<string, string>> = { uptrend: 'rising', downtrend: 'falling', stable: 'steady' };

const whole = (n: number) => Math.round(n).toLocaleString('en-AU');
const money = (n: number) => `$${whole(n)}`;

/**
 * The market snapshot, as sentences about what the report holds — one for
 * each fact present, none for a fact that is not.
 */
export function marketSnapshotSentences(f: QuantitativeReportFacts): string[] {
  const out: string[] = [];
  if (f.totalListings !== null) {
    out.push(`This quantitative analysis covers ${whole(f.totalListings)} property listings`
      + `${f.uniqueSuburbs !== null ? ` across ${whole(f.uniqueSuburbs)} suburbs` : ''}.`);
  }
  if (f.velocity) {
    const delta = f.velocity.delta;
    const change = delta !== null ? `, ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)}% on the previous 30 days` : '';
    const direction = VELOCITY_WORDS[f.velocity.label.toLowerCase()];
    out.push(direction ? `Listing volume is ${direction}${change}.` : `Listing volume trend: ${f.velocity.label}${change}.`);
  }
  if (f.medianPrice !== null && f.averagePrice !== null) {
    out.push(`The median listing price is ${money(f.medianPrice)} and the average ${money(f.averagePrice)}.`);
  } else if (f.medianPrice !== null) {
    out.push(`The median listing price is ${money(f.medianPrice)}.`);
  } else if (f.averagePrice !== null) {
    out.push(`The average listing price is ${money(f.averagePrice)}.`);
  }
  if (f.pricedListings !== null && f.totalListings) {
    out.push(`${whole(f.pricedListings)} of the ${whole(f.totalListings)} listings carried a price.`);
  }
  if (f.confidence !== null) {
    out.push(`Data confidence averages ${f.confidence.toFixed(1)}%`
      + `${f.completeness !== null ? ` with ${whole(f.completeness)}% field completeness` : ''}.`);
  }
  if (f.recent30d !== null) {
    out.push(`${whole(f.recent30d)} listings were received in the last 30 days.`);
  }
  return out;
}
