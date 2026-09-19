/**
 * Pure text-layout analysis for PDF reconstruction (R1).
 *
 * Converts raw pdf.js / MuPDF text spans into correctly-positioned, line-merged,
 * non-overlapping editable text overlays — the fix for the old importer's three
 * geometry defects:
 *   - one overlay per *span* with no line merge → fragments collide
 *   - `fontSize = hypot(t[2],t[3])` + `top = h − baseline − fontSize` (full em)
 *   - box inflation (`width = max(w+4, fontSize*2)`)
 *
 * Pure + unit-tested. Per-span colour/font/weight (when the extractor supplies
 * them) are preserved as rich-text `runs` (R0 primitive).
 */

export interface RawSpan {
  text: string;
  /** pdf.js text-item transform [a,b,c,d,e,f] (text-space → page-space). */
  transform: number[];
  /** Advance width in page units (pdf.js item.width). */
  width?: number;
  fontName?: string;
  fontFamily?: string;
  color?: string;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
}

export interface DecomposedSpan {
  text: string;
  x: number;            // left edge, page coords
  baselineY: number;    // baseline y in PDF coords (bottom-left origin)
  width: number;
  fontSize: number;
  rotation: number;     // degrees
  fontFamily?: string;
  color?: string;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
}

export interface TextRunSpec {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color?: string;
}

export interface TextOverlaySpec {
  x: number; y: number; width: number; height: number;
  content: string;
  fontSize: number;
  rotation: number;
  align: 'left';
  lineHeight: number;
  fontFamily?: string;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color?: string;
  runs?: TextRunSpec[];
}

const round = (n: number): number => Math.round(n);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Decompose a text matrix into position, scale, rotation. `fontSize ≈ scaleY`. */
export function decomposeTextMatrix(transform: number[]): {
  x: number; y: number; scaleX: number; scaleY: number; rotation: number; fontSize: number;
} {
  const [a, b, c, d, e, f] = transform;
  const scaleX = Math.hypot(a, b) || 1;
  const scaleY = Math.hypot(c, d) || scaleX;
  const rotation = Math.atan2(b, a) * 180 / Math.PI;
  return { x: e, y: f, scaleX, scaleY, rotation, fontSize: scaleY };
}

/**
 * PDF baseline y (bottom-left origin) → top-left box top.
 * The ascent above the baseline is ~0.8em, NOT a full em — using the full em
 * (the old bug) pushed every box too high and de-stacked the lines.
 */
export function baselineToTop(pageHeight: number, baselineY: number, fontSize: number, ascentRatio = 0.8): number {
  return pageHeight - baselineY - fontSize * ascentRatio;
}

export function normalizeSpan(span: RawSpan): DecomposedSpan {
  const dm = decomposeTextMatrix(span.transform);
  const width = span.width != null && span.width > 0 ? span.width : dm.fontSize * span.text.length * 0.5;
  return {
    text: span.text,
    x: dm.x,
    baselineY: dm.y,
    width,
    fontSize: dm.fontSize,
    rotation: dm.rotation,
    fontFamily: span.fontFamily ?? span.fontName,
    color: span.color,
    fontWeight: span.fontWeight,
    fontStyle: span.fontStyle,
  };
}

export interface LineGroupOptions {
  /** Max baseline delta (fraction of fontSize) to treat spans as one line. */
  baselineTolerance?: number; // default 0.5
}

/** Group decomposed spans into visual lines (top→bottom, then left→right). */
export function groupSpansIntoLines(spans: DecomposedSpan[], opts: LineGroupOptions = {}): DecomposedSpan[][] {
  const tol = opts.baselineTolerance ?? 0.5;
  const items = spans.filter((s) => s.text && s.text.trim().length > 0);
  // PDF y grows upward, so a larger baselineY is higher on the page.
  const sorted = [...items].sort((p, q) => (q.baselineY - p.baselineY) || (p.x - q.x));
  const lines: DecomposedSpan[][] = [];
  for (const s of sorted) {
    const line = lines.find((ln) => {
      const ref = ln[0];
      return Math.abs(ref.baselineY - s.baselineY) <= Math.max(ref.fontSize, s.fontSize) * tol
        && Math.abs(ref.rotation - s.rotation) < 1;
    });
    if (line) line.push(s);
    else lines.push([s]);
  }
  for (const ln of lines) ln.sort((p, q) => p.x - q.x);
  return lines;
}

function spanStyleKey(s: DecomposedSpan): string {
  return `${s.fontFamily}|${Math.round(s.fontSize)}|${s.fontWeight}|${s.fontStyle}|${s.color}`;
}

/** Insert a space between spans only when there's a real horizontal gap (>0.25em). */
function gapText(prev: DecomposedSpan | undefined, s: DecomposedSpan): string {
  if (!prev) return s.text;
  const gap = s.x - (prev.x + prev.width);
  return (gap > prev.fontSize * 0.25 ? ' ' : '') + s.text;
}

/** Merge one visual line of spans into a single, correctly-sized text overlay. */
export function mergeLineToOverlay(line: DecomposedSpan[], pageHeight: number, ascentRatio = 0.8): TextOverlaySpec {
  const first = line[0];
  const left = Math.min(...line.map((s) => s.x));
  const right = Math.max(...line.map((s) => s.x + s.width));
  const fontSize = Math.max(...line.map((s) => s.fontSize));
  const baseline = Math.max(...line.map((s) => s.baselineY));
  const top = baselineToTop(pageHeight, baseline, fontSize, ascentRatio);
  const lineHeight = 1.15;
  const content = line.map((s, i) => gapText(line[i - 1], s)).join('');

  const spec: TextOverlaySpec = {
    x: round(left),
    y: round(top),
    width: round(right - left),          // real span — NO inflation
    height: round(fontSize * lineHeight),
    content,
    fontSize: round2(fontSize),
    rotation: round2(first.rotation),
    align: 'left',
    lineHeight,
    fontFamily: first.fontFamily,
    fontWeight: first.fontWeight,
    fontStyle: first.fontStyle,
    color: first.color,
  };

  // Mixed styles within the line → preserve them as rich-text runs.
  if (new Set(line.map(spanStyleKey)).size > 1) {
    spec.runs = line.map((s, i) => ({
      text: gapText(line[i - 1], s),
      fontFamily: s.fontFamily,
      fontSize: round2(s.fontSize),
      fontWeight: s.fontWeight,
      fontStyle: s.fontStyle,
      color: s.color,
    }));
  }
  return spec;
}

/** Full pipeline: raw spans → non-overlapping, line-merged text overlays. */
export function spansToTextOverlays(
  spans: RawSpan[],
  pageHeight: number,
  opts: { ascentRatio?: number; baselineTolerance?: number } = {},
): TextOverlaySpec[] {
  const decomposed = spans.map(normalizeSpan);
  const lines = groupSpansIntoLines(decomposed, { baselineTolerance: opts.baselineTolerance });
  return lines.map((ln) => mergeLineToOverlay(ln, pageHeight, opts.ascentRatio ?? 0.8));
}
