/**
 * Paint one of our own chart SVGs into a jsPDF document, as vectors.
 *
 * ## Why a painter and not twelve chart renderers
 *
 * A `{{bars: …}}` directive in a report's prose is drawn by
 * `_shared/reportDesign/charts.pure.ts`, which is the one place a chart's
 * geometry, proportions and type sizes are decided. WeasyPrint draws that SVG
 * directly. Writing a second set of chart renderers for jsPDF would make the
 * browser document and the printed one two designs that have to be kept in
 * step by hand — the "no second design system" rule, which is also why the
 * catalogue is 50 masters × 10 palettes rather than 500 templates.
 *
 * So the chart design stays in one module and this paints its OUTPUT. Adding a
 * chart kind never touches this file.
 *
 * ## What it accepts
 *
 * The vocabulary our chart renderers emit, measured across all twelve
 * directive kinds rather than assumed: `svg` (viewBox, preserveAspectRatio),
 * `g` (transform, fill, color), `rect`, `line`, `circle`, `path`, `polygon`,
 * `polyline`, `text`, and `defs`/`linearGradient`/`stop`. Anything else is
 * ignored rather than guessed at — an unknown element drawn wrongly is worse
 * on a client's page than one left out, and `charts.pure.ts` emitting a new
 * element is a change to this repository, not to somebody else's file.
 *
 * A gradient is painted as its first stop, the same approximation the overlay
 * shape renderer already makes: jsPDF has no gradient fill, and the two
 * gradients in the corpus are a gauge's sweep.
 */
import type { jsPDF } from 'jspdf';

/** `[a, b, c, d, e, f]` — the SVG/canvas affine, row-major by column. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Uniform scale factor — our transforms never skew, so one number is honest. */
function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

function parseTransform(value: string): Matrix {
  let out: Matrix = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const n = m[2].split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v));
    switch (m[1]) {
      case 'translate': out = multiply(out, [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]); break;
      case 'scale': out = multiply(out, [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]); break;
      case 'rotate': {
        const a = ((n[0] ?? 0) * Math.PI) / 180;
        const cx = n[1] ?? 0; const cy = n[2] ?? 0;
        out = multiply(out, [1, 0, 0, 1, cx, cy]);
        out = multiply(out, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
        out = multiply(out, [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'matrix':
        if (n.length >= 6) out = multiply(out, [n[0], n[1], n[2], n[3], n[4], n[5]] as Matrix);
        break;
      default: break;
    }
  }
  return out;
}

export interface Rgb { r: number; g: number; b: number }

const NAMED: Record<string, Rgb> = {
  black: { r: 0, g: 0, b: 0 },
  white: { r: 255, g: 255, b: 255 },
  grey: { r: 128, g: 128, b: 128 },
  gray: { r: 128, g: 128, b: 128 },
  silver: { r: 192, g: 192, b: 192 },
  gainsboro: { r: 220, g: 220, b: 220 },
  seagreen: { r: 46, g: 139, b: 87 },
  firebrick: { r: 178, g: 34, b: 34 },
  darkgoldenrod: { r: 184, g: 134, b: 11 },
};

/** Hex, `rgb()`, the keywords `planningChartContext` uses, or null. */
export function svgColor(value: string | undefined | null): Rgb | null {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent' || v === 'currentcolor') return null;
  if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    const n = parseInt(h, 16);
    if (!Number.isFinite(n) || h.length !== 6) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(v);
  if (rgb) {
    const p = rgb[1].split(/[\s,/]+/).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) {
      return { r: p[0] | 0, g: p[1] | 0, b: p[2] | 0 };
    }
  }
  return NAMED[v] ?? null;
}

interface Tag { name: string; attrs: Record<string, string>; close: boolean; selfClose: boolean }

function tags(svg: string): Tag[] {
  const out: Tag[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|[^>])*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const attrs: Record<string, string> = {};
    const ar = /([a-zA-Z][a-zA-Z0-9:-]*)="([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[3] ?? '')) !== null) attrs[a[1]] = a[2];
    out.push({ name: m[2].toLowerCase(), attrs, close: m[1] === '/', selfClose: m[4] === '/' });
  }
  return out;
}

/** Text content is only ever needed for `<text>`, so it is read positionally. */
function textAfter(svg: string, from: number): string {
  const end = svg.indexOf('<', from);
  return end < 0 ? svg.slice(from) : svg.slice(from, end);
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENT[body.toLowerCase()] ?? whole;
  });
}

const num = (v: string | undefined, fallback = 0): number => {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
};

export interface SvgPaintBox {
  x: number;
  y: number;
  width: number;
  /** Omitted: derived from the viewBox's aspect so a chart is never distorted. */
  height?: number;
}

export interface SvgPaintResult {
  /** The height actually occupied, so a caller can advance its cursor. */
  height: number;
  /** Elements the vocabulary does not cover, counted rather than guessed at. */
  skipped: number;
}

/**
 * Draw `svg` into `box`. Returns the height used; draws nothing and returns 0
 * when the SVG carries no viewBox, because without one there is no mapping
 * from its coordinates to the page and a guess would misplace every mark.
 */
export function paintSvgFigure(doc: jsPDF, svg: string, box: SvgPaintBox): SvgPaintResult {
  const all = tags(svg);
  const root = all.find((t) => t.name === 'svg' && !t.close);
  const vb = (root?.attrs.viewBox ?? '').split(/[\s,]+/).map(Number);
  if (!root || vb.length !== 4 || !vb.every(Number.isFinite) || vb[2] <= 0 || vb[3] <= 0) {
    return { height: 0, skipped: 0 };
  }
  const [vx, vy, vw, vh] = vb;
  const k = box.width / vw;
  const height = box.height ?? vh * k;
  const base: Matrix = multiply([k, 0, 0, height / vh, box.x, box.y], [1, 0, 0, 1, -vx, -vy]);

  // First stop of every gradient, by id — jsPDF paints no gradient.
  const gradients = new Map<string, Rgb>();
  let currentId = '';
  for (const t of all) {
    if (t.name === 'lineargradient' && !t.close) currentId = t.attrs.id ?? '';
    else if (t.name === 'stop' && currentId && !gradients.has(currentId)) {
      const c = svgColor(t.attrs['stop-color']);
      if (c) gradients.set(currentId, c);
    } else if (t.name === 'lineargradient' && t.close) currentId = '';
  }
  const paintOf = (value: string | undefined, inherited: Rgb | null): Rgb | null => {
    const v = String(value ?? '').trim();
    if (!v) return inherited;
    const url = /^url\(#([^)]+)\)$/.exec(v);
    if (url) return gradients.get(url[1]) ?? null;
    if (v.toLowerCase() === 'currentcolor') return inherited;
    return svgColor(v);
  };

  interface Frame { m: Matrix; fill: Rgb | null; colour: Rgb | null }
  const stack: Frame[] = [{ m: base, fill: { r: 0, g: 0, b: 0 }, colour: null }];
  const top = () => stack[stack.length - 1];
  let skipped = 0;
  let inDefs = 0;

  const ctx = (doc as unknown as { context2d?: CanvasRenderingContext2D }).context2d;

  const setStroke = (t: Tag, m: Matrix): number => {
    const c = paintOf(t.attrs.stroke, top().colour);
    if (!c) return 0;
    const w = num(t.attrs['stroke-width'], 1) * scaleOf(m);
    doc.setDrawColor(c.r, c.g, c.b);
    doc.setLineWidth(Math.max(w, 0.1));
    return w;
  };
  const setFill = (t: Tag): Rgb | null => {
    const c = paintOf(t.attrs.fill, top().fill);
    if (c) doc.setFillColor(c.r, c.g, c.b);
    return c;
  };
  const style = (hasFill: boolean, hasStroke: boolean) =>
    (hasFill && hasStroke ? 'FD' : hasFill ? 'F' : hasStroke ? 'S' : null);

  // Cursor into the source, so `<text>` can read the characters after its tag.
  let cursor = 0;
  const advance = (t: Tag): number => {
    const at = svg.indexOf('>', svg.indexOf(`<${t.close ? '/' : ''}${t.name}`, cursor));
    cursor = at < 0 ? cursor : at + 1;
    return cursor;
  };

  for (const t of all) {
    const after = advance(t);
    if (t.name === 'defs') { inDefs += t.close ? -1 : 1; continue; }
    if (inDefs > 0) continue;

    if (t.name === 'svg') continue;
    if (t.name === 'g') {
      if (t.close) { if (stack.length > 1) stack.pop(); continue; }
      const parent = top();
      const m = t.attrs.transform ? multiply(parent.m, parseTransform(t.attrs.transform)) : parent.m;
      stack.push({
        m,
        fill: t.attrs.fill ? paintOf(t.attrs.fill, parent.fill) : parent.fill,
        colour: t.attrs.color ? svgColor(t.attrs.color) : parent.colour,
      });
      if (t.selfClose && stack.length > 1) stack.pop();
      continue;
    }
    if (t.close) continue;

    const m = t.attrs.transform ? multiply(top().m, parseTransform(t.attrs.transform)) : top().m;

    switch (t.name) {
      case 'rect': {
        const fill = setFill(t);
        const strokeW = setStroke(t, m);
        const st = style(!!fill, strokeW > 0);
        if (!st) break;
        const [x, y] = apply(m, num(t.attrs.x), num(t.attrs.y));
        const w = num(t.attrs.width) * scaleOf(m);
        const h = num(t.attrs.height) * scaleOf(m);
        const rx = num(t.attrs.rx) * scaleOf(m);
        if (rx > 0) doc.roundedRect(x, y, w, h, rx, rx, st);
        else doc.rect(x, y, w, h, st);
        break;
      }
      case 'line': {
        if (!setStroke(t, m)) break;
        const [x1, y1] = apply(m, num(t.attrs.x1), num(t.attrs.y1));
        const [x2, y2] = apply(m, num(t.attrs.x2), num(t.attrs.y2));
        doc.line(x1, y1, x2, y2);
        break;
      }
      case 'circle': {
        const fill = setFill(t);
        const strokeW = setStroke(t, m);
        const st = style(!!fill, strokeW > 0);
        if (!st) break;
        const [cx, cy] = apply(m, num(t.attrs.cx), num(t.attrs.cy));
        doc.circle(cx, cy, num(t.attrs.r) * scaleOf(m), st);
        break;
      }
      case 'polygon': case 'polyline': {
        const pts = (t.attrs.points ?? '').trim().split(/[\s,]+/).map(Number);
        if (pts.length < 4) break;
        const fill = t.name === 'polygon' ? setFill(t) : (String(t.attrs.fill ?? '') === 'none' ? null : setFill(t));
        const strokeW = setStroke(t, m);
        const st = style(!!fill, strokeW > 0);
        if (!st || !ctx) break;
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i + 1 < pts.length; i += 2) {
          const [px, py] = apply(m, pts[i], pts[i + 1]);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        if (t.name === 'polygon') ctx.closePath();
        paint(ctx, st, fill, t, m);
        ctx.restore();
        break;
      }
      case 'path': {
        const fill = setFill(t);
        const strokeW = setStroke(t, m);
        const st = style(!!fill, strokeW > 0);
        if (!st || !ctx) break;
        ctx.save();
        ctx.beginPath();
        tracePath(ctx, t.attrs.d ?? '', m);
        paint(ctx, st, fill, t, m);
        ctx.restore();
        break;
      }
      case 'text': {
        const c = paintOf(t.attrs.fill, top().fill);
        if (!c) break;
        const body = unescapeXml(textAfter(svg, after)).trim();
        if (!body) break;
        const size = num(t.attrs['font-size'], 10) * scaleOf(m);
        if (size <= 0) break;
        const [x, y] = apply(m, num(t.attrs.x), num(t.attrs.y));
        doc.setTextColor(c.r, c.g, c.b);
        doc.setFontSize(size);
        doc.setFont(
          /mono|courier/i.test(t.attrs['font-family'] ?? '') ? 'courier'
            : /serif|georgia|times/i.test(t.attrs['font-family'] ?? '') ? 'times' : 'helvetica',
          num(t.attrs['font-weight'], 400) >= 600 ? 'bold' : 'normal',
        );
        const anchor = t.attrs['text-anchor'];
        // The rotation our axis labels carry, read off the matrix rather than
        // re-parsed, so a `g` that rotates is honoured the same way.
        const angle = -(Math.atan2(m[1], m[0]) * 180) / Math.PI;
        doc.text(body, x, y, {
          align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
          ...(Math.abs(angle) > 0.5 ? { angle } : {}),
        });
        break;
      }
      default:
        skipped += 1;
        break;
    }
  }
  return { height, skipped };
}

function paint(
  ctx: CanvasRenderingContext2D, st: string, fill: Rgb | null, t: Tag, m: Matrix,
): void {
  if (st.includes('F') && fill) {
    const opacity = Number.parseFloat(t.attrs['fill-opacity'] ?? '1');
    ctx.fillStyle = `rgba(${fill.r},${fill.g},${fill.b},${Number.isFinite(opacity) ? opacity : 1})`;
    ctx.fill();
  }
  if (st.includes('D') || st === 'S') {
    const c = svgColor(t.attrs.stroke);
    if (c) {
      ctx.strokeStyle = `rgb(${c.r},${c.g},${c.b})`;
      ctx.lineWidth = Math.max(num(t.attrs['stroke-width'], 1) * scaleOf(m), 0.1);
      if (t.attrs['stroke-linecap']) ctx.lineCap = t.attrs['stroke-linecap'] as CanvasLineCap;
      if (t.attrs['stroke-linejoin']) ctx.lineJoin = t.attrs['stroke-linejoin'] as CanvasLineJoin;
      ctx.stroke();
    }
  }
}

/**
 * Walk an SVG `d` and emit the canvas path in page coordinates.
 *
 * Every point is transformed as it is produced rather than by setting a canvas
 * transform, so stroke widths stay in page units and a rotated group does not
 * also scale the line it draws.
 */
export function tracePath(ctx: CanvasRenderingContext2D, d: string, m: Matrix): void {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  let cmd = '';
  let x = 0; let y = 0; let startX = 0; let startY = 0;
  let lastC: [number, number] | null = null;
  let lastQ: [number, number] | null = null;
  const next = () => Number(tokens[i++]);
  const to = (px: number, py: number) => apply(m, px, py);
  const moveTo = (px: number, py: number) => { const [a, b] = to(px, py); ctx.moveTo(a, b); };
  const lineTo = (px: number, py: number) => { const [a, b] = to(px, py); ctx.lineTo(a, b); };
  const curveTo = (
    c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number,
  ) => {
    const [a1, b1] = to(c1x, c1y); const [a2, b2] = to(c2x, c2y); const [a3, b3] = to(ex, ey);
    ctx.bezierCurveTo(a1, b1, a2, b2, a3, b3);
  };

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) { cmd = tokens[i]; i += 1; }
    const rel = cmd === cmd.toLowerCase();
    const base = cmd.toUpperCase();
    const ox = rel ? x : 0; const oy = rel ? y : 0;
    switch (base) {
      case 'M': {
        x = next() + ox; y = next() + oy;
        moveTo(x, y); startX = x; startY = y;
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': x = next() + ox; y = next() + oy; lineTo(x, y); break;
      case 'H': x = next() + ox; lineTo(x, y); break;
      case 'V': y = next() + oy; lineTo(x, y); break;
      case 'C': {
        const c1x = next() + ox; const c1y = next() + oy;
        const c2x = next() + ox; const c2y = next() + oy;
        const ex = next() + ox; const ey = next() + oy;
        curveTo(c1x, c1y, c2x, c2y, ex, ey);
        lastC = [c2x, c2y]; lastQ = null; x = ex; y = ey;
        break;
      }
      case 'S': {
        const c2x = next() + ox; const c2y = next() + oy;
        const ex = next() + ox; const ey = next() + oy;
        const c1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        curveTo(c1[0], c1[1], c2x, c2y, ex, ey);
        lastC = [c2x, c2y]; lastQ = null; x = ex; y = ey;
        break;
      }
      case 'Q': {
        const qx = next() + ox; const qy = next() + oy;
        const ex = next() + ox; const ey = next() + oy;
        curveTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
          ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey);
        lastQ = [qx, qy]; lastC = null; x = ex; y = ey;
        break;
      }
      case 'T': {
        const ex = next() + ox; const ey = next() + oy;
        const q = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        curveTo(x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y),
          ex + (2 / 3) * (q[0] - ex), ey + (2 / 3) * (q[1] - ey), ex, ey);
        lastQ = [q[0], q[1]]; lastC = null; x = ex; y = ey;
        break;
      }
      case 'A': {
        const rx = next(); const ry = next(); const rot = next();
        const large = next(); const sweep = next();
        const ex = next() + ox; const ey = next() + oy;
        for (const seg of arcToCurves(x, y, rx, ry, rot, large, sweep, ex, ey)) {
          curveTo(seg[0], seg[1], seg[2], seg[3], seg[4], seg[5]);
        }
        lastC = null; lastQ = null; x = ex; y = ey;
        break;
      }
      case 'Z': ctx.closePath(); x = startX; y = startY; break;
      default: i += 1; break;
    }
  }
}

/**
 * Endpoint-parameterised elliptical arc → cubic segments, per the SVG spec's
 * implementation notes (F.6). The gauge and the donut are arcs, so this is the
 * difference between a ring and nothing.
 */
function arcToCurves(
  x1: number, y1: number, rx: number, ry: number, rotDeg: number,
  large: number, sweep: number, x2: number, y2: number,
): Array<[number, number, number, number, number, number]> {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi); const sinP = Math.sin(phi);
  const dx2 = (x1 - x2) / 2; const dy2 = (y1 - y2) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;
  let rxa = Math.abs(rx); let rya = Math.abs(ry);
  const lambda = (x1p * x1p) / (rxa * rxa) + (y1p * y1p) / (rya * rya);
  if (lambda > 1) { const s = Math.sqrt(lambda); rxa *= s; rya *= s; }
  const sign = large !== sweep ? 1 : -1;
  const numer = rxa * rxa * rya * rya - rxa * rxa * y1p * y1p - rya * rya * x1p * x1p;
  const denom = rxa * rxa * y1p * y1p + rya * rya * x1p * x1p;
  const co = denom === 0 ? 0 : sign * Math.sqrt(Math.max(0, numer / denom));
  const cxp = co * ((rxa * y1p) / rya);
  const cyp = co * (-(rya * x1p) / rxa);
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    const a = Math.acos(Math.min(1, Math.max(-1, len === 0 ? 1 : dot / len)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const theta = angle(1, 0, (x1p - cxp) / rxa, (y1p - cyp) / rya);
  let delta = angle((x1p - cxp) / rxa, (y1p - cyp) / rya, (-x1p - cxp) / rxa, (-y1p - cyp) / rya);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const segs = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Array<[number, number, number, number, number, number]> = [];
  const at = (t: number): [number, number] => {
    const c = Math.cos(t); const s = Math.sin(t);
    return [cx + rxa * cosP * c - rya * sinP * s, cy + rxa * sinP * c + rya * cosP * s];
  };
  const slope = (t: number): [number, number] => {
    const c = Math.cos(t); const s = Math.sin(t);
    return [-rxa * cosP * s - rya * sinP * c, -rxa * sinP * s + rya * cosP * c];
  };
  for (let n = 0; n < segs; n += 1) {
    const t0 = theta + n * step; const t1 = t0 + step;
    const [px0, py0] = at(t0); const [dx0, dy0] = slope(t0);
    const [px1, py1] = at(t1); const [dx1, dy1] = slope(t1);
    out.push([px0 + k * dx0, py0 + k * dy0, px1 - k * dx1, py1 - k * dy1, px1, py1]);
  }
  return out;
}
