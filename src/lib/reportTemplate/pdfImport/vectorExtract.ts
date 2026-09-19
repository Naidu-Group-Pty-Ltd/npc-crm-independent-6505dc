/**
 * Pure vector-geometry extraction for PDF reconstruction (R2).
 *
 * Turns a PDF page's path-painting operator stream into editable SVG-path
 * overlays — so a logo, icon or divider imports as *vector paths you can
 * recolour and reshape*, not a flattened JPEG.
 *
 * The module is deliberately free of any `PDF parser` import so it is fully
 * unit-testable and independent of Docling-era PDF operator-code values: the impure
 * caller (`extractPdfViaDocling`) translates Docling-era PDF' `getOperatorList()` into
 * the abstract `DrawCommand[]` stream this module interprets, passing the
 * concrete path-op codes through `decodeConstructPath`.
 *
 * Pipeline:
 *   raw pdf ops → DrawCommand[]            (impure, in the extractor)
 *   DrawCommand[] → RawVectorPath[]        runDrawCommands  (graphics-state walk)
 *   RawVectorPath[] → VectorOverlaySpec[]  clusterToOverlays (group icons/logos)
 *
 * Coordinates: paths are emitted in the page's *device* space (top-left
 * origin) by seeding the interpreter with the page viewport transform as the
 * initial CTM. viewBox + overlay box then share that absolute frame, so a path
 * renders exactly where it sat on the page with no scale distortion.
 */

export type Matrix = [number, number, number, number, number, number];

export interface BBox { minX: number; minY: number; maxX: number; maxY: number; }

/** A path-construction segment in *user* space (pre-CTM). */
export interface PathSegment {
  /** m=moveTo, l=lineTo, c=cubic, re=rectangle, h=closePath. */
  type: 'm' | 'l' | 'c' | 're' | 'h';
  /** m/l: [x,y]; c: [x1,y1,x2,y2,x,y]; re: [x,y,w,h]; h: []. */
  coords: number[];
}

export type DrawCommand =
  | { op: 'save' }
  | { op: 'restore' }
  | { op: 'transform'; m: Matrix }
  | { op: 'constructPath'; segments: PathSegment[] }
  | { op: 'setFillColor'; color: string }
  | { op: 'setStrokeColor'; color: string }
  | { op: 'setLineWidth'; width: number }
  | { op: 'fill'; rule?: 'nonzero' | 'evenodd' }
  | { op: 'stroke' }
  | { op: 'fillStroke'; rule?: 'nonzero' | 'evenodd' }
  | { op: 'endPath' };

export interface RawVectorPath {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillRule?: 'nonzero' | 'evenodd';
  bbox: BBox;
}

export interface VectorPathSpec {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillRule?: 'nonzero' | 'evenodd';
}

export interface VectorOverlaySpec {
  x: number; y: number; width: number; height: number;
  viewBox: string;
  paths: VectorPathSpec[];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ─── matrix maths (mirrors Docling-era PDF Util.transform / applyTransform) ─────────────

/** Concatenate CTM with a local transform: result == Util.transform(ctm, m). */
export function matMul(ctm: Matrix, m: Matrix): Matrix {
  return [
    ctm[0] * m[0] + ctm[2] * m[1],
    ctm[1] * m[0] + ctm[3] * m[1],
    ctm[0] * m[2] + ctm[2] * m[3],
    ctm[1] * m[2] + ctm[3] * m[3],
    ctm[0] * m[4] + ctm[2] * m[5] + ctm[4],
    ctm[1] * m[4] + ctm[3] * m[5] + ctm[5],
  ];
}

/** Apply a CTM to a point: (a*x + c*y + e, b*x + d*y + f). */
export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Uniform scale factor of a matrix (sqrt|det|) — used to map line widths. */
export function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

// ─── constructPath decoding (PDF path ops → user-space segments) ───────────────

export interface PathOpCodes {
  moveTo: number;
  lineTo: number;
  curveTo: number;   // c — two control points + endpoint
  curveTo2: number;  // v — first control point = current point
  curveTo3: number;  // y — second control point = endpoint
  rectangle: number;
  closePath: number;
}

/**
 * Decode a Docling-era PDF `constructPath` payload (`ops` codes + flat `coords`) into
 * user-space segments. Converts the abbreviated cubics (`v`,`y`) into full
 * cubics by tracking the current point, so downstream only sees m/l/c/re/h.
 */
export function decodeConstructPath(ops: number[], coords: ArrayLike<number>, codes: PathOpCodes): PathSegment[] {
  const segs: PathSegment[] = [];
  let k = 0;
  let cx = 0, cy = 0;   // current point
  let sx = 0, sy = 0;   // subpath start (for closePath)
  const next = (): number => Number(coords[k++] ?? 0);
  for (const op of ops) {
    if (op === codes.moveTo) {
      cx = next(); cy = next(); sx = cx; sy = cy;
      segs.push({ type: 'm', coords: [cx, cy] });
    } else if (op === codes.lineTo) {
      cx = next(); cy = next();
      segs.push({ type: 'l', coords: [cx, cy] });
    } else if (op === codes.curveTo) {
      const x1 = next(), y1 = next(), x2 = next(), y2 = next(), x3 = next(), y3 = next();
      segs.push({ type: 'c', coords: [x1, y1, x2, y2, x3, y3] });
      cx = x3; cy = y3;
    } else if (op === codes.curveTo2) {
      // v: first control point = current point.
      const x2 = next(), y2 = next(), x3 = next(), y3 = next();
      segs.push({ type: 'c', coords: [cx, cy, x2, y2, x3, y3] });
      cx = x3; cy = y3;
    } else if (op === codes.curveTo3) {
      // y: second control point = endpoint.
      const x1 = next(), y1 = next(), x3 = next(), y3 = next();
      segs.push({ type: 'c', coords: [x1, y1, x3, y3, x3, y3] });
      cx = x3; cy = y3;
    } else if (op === codes.rectangle) {
      const x = next(), y = next(), w = next(), h = next();
      segs.push({ type: 're', coords: [x, y, w, h] });
      cx = x; cy = y; sx = x; sy = y;
    } else if (op === codes.closePath) {
      segs.push({ type: 'h', coords: [] });
      cx = sx; cy = sy;
    }
  }
  return segs;
}

// ─── interpret the draw stream into painted paths ──────────────────────────────

type DeviceSeg = { t: 'M' | 'L' | 'C' | 'Z'; p: number[] };

/** Transform user-space segments through the CTM into device-space draw ops. */
function transformSegments(segments: PathSegment[], ctm: Matrix): DeviceSeg[] {
  const out: DeviceSeg[] = [];
  for (const seg of segments) {
    switch (seg.type) {
      case 'm': out.push({ t: 'M', p: applyMatrix(ctm, seg.coords[0], seg.coords[1]) }); break;
      case 'l': out.push({ t: 'L', p: applyMatrix(ctm, seg.coords[0], seg.coords[1]) }); break;
      case 'c': {
        const a = applyMatrix(ctm, seg.coords[0], seg.coords[1]);
        const b = applyMatrix(ctm, seg.coords[2], seg.coords[3]);
        const c = applyMatrix(ctm, seg.coords[4], seg.coords[5]);
        out.push({ t: 'C', p: [a[0], a[1], b[0], b[1], c[0], c[1]] });
        break;
      }
      case 're': {
        const [x, y, w, h] = seg.coords;
        const c0 = applyMatrix(ctm, x, y);
        const c1 = applyMatrix(ctm, x + w, y);
        const c2 = applyMatrix(ctm, x + w, y + h);
        const c3 = applyMatrix(ctm, x, y + h);
        out.push({ t: 'M', p: c0 }, { t: 'L', p: c1 }, { t: 'L', p: c2 }, { t: 'L', p: c3 }, { t: 'Z', p: [] });
        break;
      }
      case 'h': out.push({ t: 'Z', p: [] }); break;
    }
  }
  return out;
}

/** Serialise device-space segments into an SVG path `d` + its bbox. */
function buildPath(dev: DeviceSeg[]): { d: string; bbox: BBox } | null {
  if (!dev.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x: number, y: number) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };
  const r = (n: number) => round2(n);
  const parts: string[] = [];
  for (const s of dev) {
    if (s.t === 'M') { parts.push(`M${r(s.p[0])} ${r(s.p[1])}`); ext(s.p[0], s.p[1]); }
    else if (s.t === 'L') { parts.push(`L${r(s.p[0])} ${r(s.p[1])}`); ext(s.p[0], s.p[1]); }
    else if (s.t === 'C') {
      parts.push(`C${r(s.p[0])} ${r(s.p[1])} ${r(s.p[2])} ${r(s.p[3])} ${r(s.p[4])} ${r(s.p[5])}`);
      ext(s.p[0], s.p[1]); ext(s.p[2], s.p[3]); ext(s.p[4], s.p[5]);
    } else if (s.t === 'Z') parts.push('Z');
  }
  if (!Number.isFinite(minX)) return null;
  return { d: parts.join(' '), bbox: { minX, minY, maxX, maxY } };
}

interface GState { ctm: Matrix; fill: string; stroke: string; lineWidth: number; }

export interface VectorExtractOptions {
  /** Initial CTM — pass the page viewport transform to land in device space. */
  initialCtm?: Matrix;
  /** Safety cap on emitted paths (defends against pathological pages). */
  maxPaths?: number;
}

/** Walk a DrawCommand stream into individually-painted vector paths. */
export function runDrawCommands(commands: DrawCommand[], opts: VectorExtractOptions = {}): RawVectorPath[] {
  const maxPaths = opts.maxPaths ?? 4000;
  let state: GState = { ctm: opts.initialCtm ?? IDENTITY, fill: '#000000', stroke: '#000000', lineWidth: 1 };
  const stack: GState[] = [];
  let pending: DeviceSeg[] = [];
  const out: RawVectorPath[] = [];

  const strokeW = (): number => {
    const w = state.lineWidth * matrixScale(state.ctm);
    return round2(w > 0 ? w : 0.5);
  };
  const emit = (mode: 'fill' | 'stroke' | 'fillStroke', rule?: 'nonzero' | 'evenodd') => {
    const built = buildPath(pending);
    pending = [];
    if (!built || out.length >= maxPaths) return;
    const p: RawVectorPath = { d: built.d, bbox: built.bbox };
    if (mode === 'fill' || mode === 'fillStroke') { p.fill = state.fill; if (rule === 'evenodd') p.fillRule = 'evenodd'; }
    if (mode === 'stroke' || mode === 'fillStroke') { p.stroke = state.stroke; p.strokeWidth = strokeW(); }
    out.push(p);
  };

  for (const c of commands) {
    switch (c.op) {
      case 'save': stack.push({ ...state, ctm: [...state.ctm] as Matrix }); break;
      case 'restore': if (stack.length) state = stack.pop()!; break;
      case 'transform': state = { ...state, ctm: matMul(state.ctm, c.m) }; break;
      case 'setFillColor': state = { ...state, fill: c.color }; break;
      case 'setStrokeColor': state = { ...state, stroke: c.color }; break;
      case 'setLineWidth': state = { ...state, lineWidth: c.width }; break;
      case 'constructPath': pending.push(...transformSegments(c.segments, state.ctm)); break;
      case 'fill': emit('fill', c.rule); break;
      case 'stroke': emit('stroke'); break;
      case 'fillStroke': emit('fillStroke', c.rule); break;
      case 'endPath': pending = []; break;
    }
  }
  return out;
}

// ─── cluster painted paths into editable icon/logo overlays ────────────────────

const inflate = (b: BBox, g: number): BBox => ({ minX: b.minX - g, minY: b.minY - g, maxX: b.maxX + g, maxY: b.maxY + g });
const intersects = (a: BBox, b: BBox): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const unionBox = (a: BBox, b: BBox): BBox => ({
  minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
});

export interface ClusterOptions {
  /** Proximity (page units) below which two path bboxes join one icon. */
  gap?: number;
  /** Above this many input paths, skip clustering and emit one page overlay. */
  clusterLimit?: number;
  /** Above this many resulting clusters, collapse to one page overlay. */
  maxClusters?: number;
}

function pathToSpec(p: RawVectorPath): VectorPathSpec {
  const spec: VectorPathSpec = { d: p.d };
  if (p.fill && p.fill !== 'none') spec.fill = p.fill;
  if (p.stroke && p.stroke !== 'none') spec.stroke = p.stroke;
  if (p.strokeWidth != null) spec.strokeWidth = p.strokeWidth;
  if (p.fillRule) spec.fillRule = p.fillRule;
  return spec;
}

function overlayFromBox(bbox: BBox, items: RawVectorPath[]): VectorOverlaySpec {
  const x = round2(bbox.minX), y = round2(bbox.minY);
  const width = Math.max(1, round2(bbox.maxX - bbox.minX));
  const height = Math.max(1, round2(bbox.maxY - bbox.minY));
  return {
    x, y, width, height,
    viewBox: `${x} ${y} ${width} ${height}`,
    paths: items.map(pathToSpec),
  };
}

/**
 * Group painted paths into one overlay per visually-connected drawing, so each
 * logo/icon/divider becomes an independently selectable vector element. Falls
 * back to a single page-level overlay when a page has an unwieldy number of
 * paths or clusters (keeps the editor usable).
 */
export function clusterToOverlays(paths: RawVectorPath[], opts: ClusterOptions = {}): VectorOverlaySpec[] {
  if (!paths.length) return [];
  const gap = opts.gap ?? 8;
  const clusterLimit = opts.clusterLimit ?? 600;
  const maxClusters = opts.maxClusters ?? 80;

  const wholePage = (): VectorOverlaySpec[] => {
    let box = paths[0].bbox;
    for (const p of paths) box = unionBox(box, p.bbox);
    return [overlayFromBox(box, paths)];
  };

  if (paths.length > clusterLimit) return wholePage();

  let clusters: { bbox: BBox; items: RawVectorPath[] }[] = paths.map((p) => ({ bbox: p.bbox, items: [p] }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (intersects(inflate(clusters[i].bbox, gap), clusters[j].bbox)) {
          clusters[i] = { bbox: unionBox(clusters[i].bbox, clusters[j].bbox), items: clusters[i].items.concat(clusters[j].items) };
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  if (clusters.length > maxClusters) return wholePage();
  return clusters.map((c) => overlayFromBox(c.bbox, c.items));
}

/** Convenience: full DrawCommand stream → clustered, editable vector overlays. */
export function extractVectorOverlays(
  commands: DrawCommand[],
  opts: VectorExtractOptions & ClusterOptions = {},
): VectorOverlaySpec[] {
  const paths = runDrawCommands(commands, opts);
  return clusterToOverlays(paths, opts);
}
