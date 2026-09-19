/**
 * Pure shading-fill recovery for PDF reconstruction.
 *
 * Designed covers very often paint their background with a PDF *shading*
 * (`sh` operator — axial/radial/mesh gradient). The vector extractor walks
 * path ops only, so these pages imported as BLANK white — and a white page
 * behind white cover text is invisible. This module turns the Docling-era PDF shading
 * IR into an editable `shape` overlay: a CSS `linear-gradient` /
 * `radial-gradient` fill (the HTML renderer + WeasyPrint both support them),
 * or a flat average colour for mesh shadings.
 *
 * Pure + unit-tested. The impure operator-list walk (CTM + clip tracking)
 * lives in `extractPdfViaDocling`.
 */
import { matMul, applyMatrix, type Matrix } from './vectorExtract';

export interface ShadingStop { offset: number; color: string }

export type ParsedShading =
  | { kind: 'axial'; stops: ShadingStop[]; p0: [number, number]; p1: [number, number] }
  | { kind: 'radial'; stops: ShadingStop[] }
  | { kind: 'solid'; color: string };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const h2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

function parseStops(raw: unknown): ShadingStop[] {
  if (!Array.isArray(raw)) return [];
  const stops: ShadingStop[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const offset = Number(entry[0]);
    const color = String(entry[1] ?? '');
    if (!Number.isFinite(offset) || !color) continue;
    stops.push({ offset: clamp01(offset), color });
  }
  return stops.sort((a, b) => a.offset - b.offset);
}

/**
 * Parse a Docling-era PDF shading IR (`getOperatorList` argument of `shadingFill`).
 *
 *   RadialAxial: ['RadialAxial', type(2|3), bbox, colorStops, p0, p1, r0, r1]
 *   Mesh:        ['Mesh', type(4–7), coords, colors(RGB bytes), …]
 *
 * Defensive by design: any unexpected layout returns null and the caller
 * simply skips the op (never worse than today's behaviour).
 */
export function parseShadingIR(ir: unknown): ParsedShading | null {
  if (!Array.isArray(ir) || typeof ir[0] !== 'string') return null;
  if (ir[0] === 'RadialAxial') {
    const type = Number(ir[1]);
    const stops = parseStops(ir[3]);
    if (stops.length < 2) {
      return stops.length === 1 ? { kind: 'solid', color: stops[0].color } : null;
    }
    if (type === 2) {
      const p0 = Array.isArray(ir[4]) ? [Number(ir[4][0]) || 0, Number(ir[4][1]) || 0] as [number, number] : [0, 0] as [number, number];
      const p1 = Array.isArray(ir[5]) ? [Number(ir[5][0]) || 0, Number(ir[5][1]) || 0] as [number, number] : [1, 0] as [number, number];
      return { kind: 'axial', stops, p0, p1 };
    }
    if (type === 3) return { kind: 'radial', stops };
    return null;
  }
  if (ir[0] === 'Mesh') {
    // Average the mesh vertex colours into a flat fill (an editable
    // approximation; the SSIM fidelity loop flags it if it drifts).
    const colors = ir[3] as ArrayLike<number> | undefined;
    if (!colors || typeof colors.length !== 'number' || colors.length < 3) return null;
    let r = 0, g = 0, b = 0;
    const n = Math.floor(colors.length / 3);
    for (let i = 0; i < n; i++) { r += colors[i * 3]; g += colors[i * 3 + 1]; b += colors[i * 3 + 2]; }
    return { kind: 'solid', color: `#${h2(r / n)}${h2(g / n)}${h2(b / n)}` };
  }
  return null;
}

const fmtStops = (stops: ShadingStop[]): string =>
  stops.map((s) => `${s.color} ${Math.round(s.offset * 1000) / 10}%`).join(', ');

export interface ShadingOverlaySpec {
  x: number; y: number; width: number; height: number;
  /** CSS background value: gradient or flat colour. */
  fill: string;
  /** Representative flat colour (token derivation / engines without gradients). */
  averageColor: string;
}

/** Midpoint-ish representative colour for token derivation. */
function representativeColor(parsed: ParsedShading): string {
  if (parsed.kind === 'solid') return parsed.color;
  const stops = parsed.stops;
  return stops[Math.floor(stops.length / 2)].color;
}

/**
 * Map a parsed shading + the CTM at its `sh` op + an optional clip rect into
 * an overlay spec in page coordinates (top-left origin).
 *
 * The axial axis (p0→p1, user space) is transformed through the combined
 * matrix to compute the CSS gradient angle: CSS measures clockwise from
 * "to top", page space has y growing DOWN, so angle = atan2(dx, -dy).
 */
export function shadingToOverlaySpec(args: {
  parsed: ParsedShading;
  ctm: Matrix;
  viewportCtm: Matrix;
  pageWidth: number;
  pageHeight: number;
  clip?: { x: number; y: number; width: number; height: number } | null;
}): ShadingOverlaySpec {
  const { parsed, ctm, viewportCtm, pageWidth, pageHeight } = args;
  const rect = args.clip && args.clip.width > 1 && args.clip.height > 1
    ? args.clip
    : { x: 0, y: 0, width: pageWidth, height: pageHeight };

  let fill: string;
  if (parsed.kind === 'solid') {
    fill = parsed.color;
  } else if (parsed.kind === 'radial') {
    fill = `radial-gradient(circle, ${fmtStops(parsed.stops)})`;
  } else {
    const m = matMul(viewportCtm, ctm);
    const a = applyMatrix(m, parsed.p0[0], parsed.p0[1]);
    const b = applyMatrix(m, parsed.p1[0], parsed.p1[1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const angle = (!dx && !dy) ? 180 : Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
    fill = `linear-gradient(${((angle % 360) + 360) % 360}deg, ${fmtStops(parsed.stops)})`;
  }

  return {
    x: Math.round(rect.x * 100) / 100,
    y: Math.round(rect.y * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
    fill,
    averageColor: representativeColor(parsed),
  };
}

/** Bounding box (page space) of path points transformed by viewport×user CTM. */
export function pathPointsToPageBBox(
  points: Array<[number, number]>,
  ctm: Matrix,
  viewportCtm: Matrix,
): { x: number; y: number; width: number; height: number } | null {
  if (!points.length) return null;
  const m = matMul(viewportCtm, ctm);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of points) {
    const [x, y] = applyMatrix(m, px, py);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
