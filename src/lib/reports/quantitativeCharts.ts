/**
 * What the quantitative market report's PDF may draw for a chart.
 *
 * The report stores each chart twice: as a picture (`image_data`) and as the
 * data it was drawn from (`chart_config`), which is what the report page draws
 * on screen (`normaliseChartConfig`, `LiveChart`). The pipeline stores the
 * picture empty, so the PDF almost always fell through to a stand-in — and the
 * stand-in INVENTED its figures: "Top Suburb 1…5" at fixed shares of the
 * listing count, a property-type split nobody measured, "Agency 1…5" at 15,
 * 12, 10, 8 and 6, "Category A…D", and a week of daily activity drawn from
 * `Math.random()`, so the same report printed different numbers each time it
 * was downloaded. Every one of them was set on the page as a chart of the
 * market.
 *
 * The rule now is the one every other document here answers to: a figure a
 * document prints is a figure the record holds. A chart is drawn from its
 * picture, or from the data the screen draws it from, or it is left out — and
 * a chart that is left out is not counted as drawn.
 *
 * Two more follow from it. The data is the chart, not the caption: the
 * pipeline stores the same series under more than one title (the listings in
 * each suburb three times over, the daily count twice), and a series is drawn
 * once. And a title is a claim about the data under it: four of the
 * pipeline's charts are built from something other than what they are called
 * (`TITLE_NOT_CARRIED_BY_DATA`), and are left out rather than drawn under a
 * name that tells the reader something the report does not hold.
 */
import { normaliseChartConfig } from '@/components/charts/kernel/normaliseChartConfig';

/** One category of a chart and the value the record holds for it. */
export interface QuantitativeChartPoint {
  label: string;
  value: number;
}

/** The parts of a stored chart this reads. */
export interface StoredQuantitativeChart {
  id: string;
  chart_type: string;
  title: string;
  image_data: string;
  chart_config?: unknown;
  /** The pipeline's own name for the chart (`daily_listing_activity`, `suburb_volume`, …). */
  chart_key?: string | null;
  /**
   * The pipeline's own place for the chart. Its rows are written in one insert
   * and share a creation time, so this is the only order they have.
   */
  sort_order?: number | null;
}

/**
 * The pipeline's charts whose data cannot carry their titles, by its own key,
 * and what each is actually built from — read from the pipeline's `build()`.
 */
export const TITLE_NOT_CARRIED_BY_DATA: Readonly<Record<string, string>> = {
  pricing_trends:
    'Its line is the number of listings received each day, the Daily Listing Activity series again, and holds no price.',
  suburb_performance_matrix:
    "It is the number of listings in each suburb; the price it pairs with every suburb is the whole market's average.",
  price_vs_volume:
    "It is the number of listings in each suburb beside the whole market's average price, the same for every suburb.",
  data_confidence:
    "It repeats one figure for every day: the snapshot's average confidence, a 0–1 share rounded to a whole number, so 0 or 1.",
};

/**
 * The version of `quantitative-report-pipeline` (`REPORT_VERSION`, stored on
 * the report as `version`) that builds those four charts that way. A pipeline
 * that builds them from what they are called is a new version, and its charts
 * are drawn; `quantitativeCharts.spec.ts` reads the pipeline and fails if it
 * changes them without saying so.
 */
export const PIPELINE_VERSION_WITH_UNSUPPORTED_TITLES = 1;

/** Whether the chart is one of those four, as the given pipeline version builds it. */
export function titleNotCarriedByData(chart: StoredQuantitativeChart, pipelineVersion?: number | null): boolean {
  const key = chart.chart_key;
  if (!key || !Object.prototype.hasOwnProperty.call(TITLE_NOT_CARRIED_BY_DATA, key)) return false;
  // Only the pipeline stores keys, and it has stamped every report it wrote.
  return pipelineVersion == null || pipelineVersion <= PIPELINE_VERSION_WITH_UNSUPPORTED_TITLES;
}

/** The charts in the pipeline's own order where every one carries it; otherwise as given. */
function inPipelineOrder<C extends StoredQuantitativeChart>(charts: readonly C[]): C[] {
  const ordered = charts.every((c) => typeof c.sort_order === 'number' && Number.isFinite(c.sort_order));
  return ordered
    ? charts.map((chart, at) => ({ chart, at }))
      .sort((a, b) => (a.chart.sort_order as number) - (b.chart.sort_order as number) || a.at - b.at)
      .map(({ chart }) => chart)
    : [...charts];
}

const seriesKey = (points: readonly QuantitativeChartPoint[]) =>
  JSON.stringify(points.map((p) => [p.label, p.value]));

/** A chart the PDF can draw, with what it is drawn from. */
export interface DrawableQuantitativeChart<C extends StoredQuantitativeChart = StoredQuantitativeChart> {
  chart: C;
  /** The picture, ready for the PDF (an SVG already rasterised); null where there is none. */
  image: string | null;
  /** The data the screen draws the chart from; null where none is held. */
  points: QuantitativeChartPoint[] | null;
}

/**
 * The chart's own data, exactly as the report page reads it to draw the same
 * chart (`normaliseChartConfig`): the first series, a point per category. The
 * page and the PDF therefore print the same numbers — including the kernel's
 * reading of a missing value, which is the kernel's to change, for both at
 * once. A chart whose data cannot be read at all has none.
 */
export function chartPointsFromConfig(chart: StoredQuantitativeChart): QuantitativeChartPoint[] | null {
  const model = normaliseChartConfig({
    id: chart.id,
    chart_type: chart.chart_type,
    title: chart.title,
    chart_config: chart.chart_config,
  });
  const key = model?.series[0]?.key;
  if (!model || !key) return null;
  const points = model.data.flatMap((row) => {
    const value = row[key];
    return typeof value === 'number' && Number.isFinite(value) ? [{ label: String(row.name), value }] : [];
  });
  return points.length > 0 ? points : null;
}

/**
 * Whether the PDF can draw a chart of this type from its data alone.
 *
 * A line needs two points to be a line, and a pie is a share of a positive
 * whole: one point draws an empty frame, and a pie of zeros or with a
 * negative slice draws nothing true. Such a chart is left out and not counted,
 * like a chart with no data at all. A bar of zeros is still a true chart.
 */
export function pointsCanBeDrawn(chartType: string, points: readonly QuantitativeChartPoint[]): boolean {
  if (points.length === 0) return false;
  if (chartType === 'line') return points.length >= 2;
  if (chartType === 'pie') return points.every((p) => p.value >= 0) && points.some((p) => p.value > 0);
  return true;
}

const SVG = /^data:image\/svg\+xml;base64,/;
const PICTURE = /^data:image\//;

/**
 * The charts the PDF draws, in the pipeline's order, each with what it is
 * drawn from. Left out: a chart with neither a picture nor data it can be
 * drawn from (`pointsCanBeDrawn`), a chart whose series an earlier chart
 * already draws, and a chart whose data cannot carry its title. So every count
 * the report prints — on its cover, its contents and its method — counts only
 * what is drawn.
 */
export async function drawableCharts<C extends StoredQuantitativeChart>(
  charts: readonly C[],
  rasterise: (svgDataUrl: string) => Promise<string>,
  pipelineVersion?: number | null,
): Promise<Array<DrawableQuantitativeChart<C>>> {
  const out: Array<DrawableQuantitativeChart<C>> = [];
  const drawnSeries = new Set<string>();
  for (const chart of inPipelineOrder(charts)) {
    if (titleNotCarriedByData(chart, pipelineVersion)) continue;
    const points = chartPointsFromConfig(chart);
    const series = points ? seriesKey(points) : null;
    if (series !== null && drawnSeries.has(series)) continue;
    let image: string | null = null;
    const stored = typeof chart.image_data === 'string' ? chart.image_data : '';
    if (SVG.test(stored)) {
      try {
        image = await rasterise(stored);
      } catch (error) {
        console.warn(`[quantitative report] could not rasterise "${chart.title}"`, error);
      }
    } else if (PICTURE.test(stored)) {
      image = stored;
    }
    // Without a picture the chart is drawn from its data, so the data has to
    // be drawable as the chart it is.
    const drawnFrom = points && (image || pointsCanBeDrawn(chart.chart_type, points)) ? points : null;
    if (!image && !drawnFrom) continue;
    if (series !== null) drawnSeries.add(series);
    out.push({ chart, image, points: drawnFrom });
  }
  return out;
}
