/**
 * Split a text item that is really two fields sharing one baseline.
 *
 * THE ARTIFACT
 * ------------
 * The BC Snapshot footer sets two independent fields at opposite ends of one
 * 9pt strip:
 *
 *     x  72.0 → 199.7   'P R I V A T E  A N D  C O N F I D E N T I A L'
 *     x 460.3 → 521.6   'R E F  9 0 E 5 D F 3 4'
 *
 * Docling groups them into ONE text item spanning x 72 → 521.6, and the item
 * carries a single string. Reconstructed as one left-aligned overlay, the
 * reference number sets immediately after `CONFIDENTIAL` — near the middle of
 * the page, 260pt from where the source puts it, with the right margin empty.
 *
 * WHAT MAKES THEM SEPARABLE
 * -------------------------
 * `source_measure` (v2) ships each line's `x0Pt`, `x1Pt` and `baselineYPt`.
 * Lines that share a baseline are one visual row; a horizontal gap between two
 * of them that dwarfs any word space is a COLUMN boundary, not a word gap.
 *
 * The threshold is deliberately far above anything typography produces. A word
 * space is well under an em; a wide tab is a few. Requiring several ems AND an
 * absolute floor means a generous inter-word gap can never be mistaken for a
 * column, at the cost of leaving a narrowly-separated pair merged — which is
 * the safe direction, because the merged form is what ships today.
 *
 * WHY SPLITTING IS SAFE WHEN IT FIRES
 * -----------------------------------
 * Each run keeps its own measured x and width, so both land exactly where the
 * source drew them. The only thing lost is the fiction that they were ever one
 * field. A split that fires wrongly on a genuinely single field still renders
 * both halves at their source positions — it costs an extra layer in the
 * editor, not a wrong page.
 *
 * Pure and deterministic. Returns null when it cannot see enough to be sure,
 * and the caller keeps the merged item.
 */

/** Line geometry as `source_measure.lines[]` ships it from v2 onward. */
export interface MeasuredLineGeometry {
  x0Pt?: number;
  x1Pt?: number;
  baselineYPt?: number;
}

/** Baseline spread, in points, within which lines count as the same row. */
export const SAME_BASELINE_TOLERANCE_PT = 1.5;

/** A column gap must exceed this many times the font size… */
export const MIN_COLUMN_GAP_EM = 4;

/** …and this many points outright, so tiny type cannot lower the bar. */
export const MIN_COLUMN_GAP_PT = 24;

/**
 * How many distinct ROWS these lines occupy, or null without v2 geometry.
 *
 * `source_measure.lineCount` counts line RECORDS; two runs sharing a baseline
 * are two of them. This counts rows, which is the number "did the source wrap
 * here" is actually asking for.
 */
export function countDistinctBaselines(
  lines: readonly MeasuredLineGeometry[] | undefined,
): number | null {
  if (!lines?.length) return null;
  const baselines: number[] = [];
  for (const line of lines) {
    const y = finite(line?.baselineYPt);
    if (y == null) return null;
    baselines.push(y);
  }
  baselines.sort((a, b) => a - b);
  let rows = 1;
  for (let i = 1; i < baselines.length; i += 1) {
    if (baselines[i] - baselines[i - 1] > SAME_BASELINE_TOLERANCE_PT) rows += 1;
  }
  return rows;
}

export interface BaselineColumn {
  /** Indices into the source lines array, in reading order. */
  lineIndices: number[];
  /** Left edge in page points, from the source's own measurement. */
  xPt: number;
  /** Width in page points. */
  widthPt: number;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Points, at the same 3-decimal precision the sidecar measures in. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Group `lines` into columns when they all share one baseline and separate
 * cleanly. Returns null unless there are at least two columns.
 */
export function splitBaselineColumns(
  lines: readonly MeasuredLineGeometry[] | undefined,
  fontSizePt: number,
): BaselineColumn[] | null {
  if (!lines || lines.length < 2) return null;
  const size = finite(fontSizePt);
  if (size == null || size <= 0) return null;

  const placed: Array<{ index: number; x0: number; x1: number; y: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const x0 = finite(lines[i]?.x0Pt);
    const x1 = finite(lines[i]?.x1Pt);
    const y = finite(lines[i]?.baselineYPt);
    // A v1 artifact has none of these. Absent geometry is not geometry at the
    // origin, so one missing line disqualifies the whole item.
    if (x0 == null || x1 == null || y == null || x1 <= x0) return null;
    placed.push({ index: i, x0, x1, y });
  }

  // Every line must sit on the same baseline. A stacked block is a paragraph,
  // whatever its horizontal gaps look like.
  const baselines = placed.map((p) => p.y);
  if (Math.max(...baselines) - Math.min(...baselines) > SAME_BASELINE_TOLERANCE_PT) return null;

  const threshold = Math.max(size * MIN_COLUMN_GAP_EM, MIN_COLUMN_GAP_PT);
  const ordered = [...placed].sort((a, b) => a.x0 - b.x0);
  const columns: BaselineColumn[] = [];
  for (const line of ordered) {
    const current = columns[columns.length - 1];
    const previousRight = current ? current.xPt + current.widthPt : null;
    if (current && previousRight != null && line.x0 - previousRight <= threshold) {
      current.lineIndices.push(line.index);
      current.widthPt = round3(Math.max(previousRight, line.x1) - current.xPt);
      continue;
    }
    columns.push({ lineIndices: [line.index], xPt: line.x0, widthPt: round3(line.x1 - line.x0) });
  }
  if (columns.length < 2) return null;
  // Reading order within a column follows the source line order, not the sort.
  for (const column of columns) column.lineIndices.sort((a, b) => a - b);
  return columns;
}
