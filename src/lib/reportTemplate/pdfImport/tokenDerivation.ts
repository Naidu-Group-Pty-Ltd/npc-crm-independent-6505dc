/**
 * Pure design-token derivation for PDF reconstruction.
 *
 * The importer used to hard-code the template tokens (gold `#BF9B50` primary,
 * white bg, Helvetica everywhere) regardless of what the source document looked
 * like — so anything token-driven in the editor or renderer (new elements,
 * theme controls, token-bound blocks) ignored the reference file. This module
 * derives `tokens.colors` and `tokens.fonts` from what extraction actually
 * measured: text colours weighted by glyph count, font families weighted by
 * usage and size, and vector fills weighted by painted area.
 *
 * Pure + unit-tested. The extractor feeds it observations as it walks pages.
 */

export interface TextObservation {
  color?: string;          // '#rrggbb'
  fontFamily?: string;     // resolved family or embedded family name
  fontSize: number;        // pt
  /** Weight proxy: characters drawn with this style. */
  chars: number;
}

export interface FillObservation {
  color: string;           // '#rrggbb'
  area: number;            // pt² painted with this fill
}

export interface DerivedTokens {
  colors: { primary: string; bg: string; text: string; muted: string };
  fonts: { heading: string; body: string };
}

const DEFAULTS: DerivedTokens = {
  colors: { primary: '#BF9B50', bg: '#FFFFFF', text: '#111111', muted: '#666666' },
  fonts: { heading: 'Helvetica', body: 'Helvetica' },
};

/** Parse '#rgb', '#rrggbb', 'rgb(r, g, b)', or 'rgba(r, g, b, a)' (CSS computed colours). */
function parseHex(color: string): { r: number; g: number; b: number } | null {
  const s = String(color ?? '').trim();
  const m6 = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m6) {
    const v = parseInt(m6[1], 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }
  const m3 = /^#([0-9a-f]{3})$/i.exec(s);
  if (m3) {
    const [r, g, b] = m3[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  const mRgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (mRgb) {
    const alpha = mRgb[4] != null ? Number(mRgb[4]) : 1;
    if (alpha < 0.05) return null; // effectively invisible
    return { r: Number(mRgb[1]), g: Number(mRgb[2]), b: Number(mRgb[3]) };
  }
  return null;
}

function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0.5;
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

function saturation(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max === 0 ? 0 : (max - min) / max;
}

const normHex = (hex: string): string => {
  const c = parseHex(hex);
  if (!c) return '';
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
};

function topByWeight<T>(map: Map<string, { weight: number; value: T }>): Array<{ key: string; weight: number; value: T }> {
  return Array.from(map.entries())
    .map(([key, { weight, value }]) => ({ key, weight, value }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Derive document-level tokens from extraction observations.
 *
 * - `text`  = the dominant body text colour (most glyphs).
 * - `muted` = the next-most-common low-saturation text colour, else derived.
 * - `primary` = the most *prominent saturated* colour across text + fills.
 * - `bg`    = the largest near-page-sized light fill, else white.
 * - `fonts.body`    = family drawing the most characters.
 * - `fonts.heading` = family with the largest average size (≥ body's size),
 *                     else the body family.
 */
export function deriveTokensFromExtraction(
  texts: TextObservation[],
  fills: FillObservation[],
  opts: { pageArea?: number } = {},
): DerivedTokens {
  const out: DerivedTokens = {
    colors: { ...DEFAULTS.colors },
    fonts: { ...DEFAULTS.fonts },
  };

  // ── text colour ────────────────────────────────────────────────────────────
  const colorWeights = new Map<string, { weight: number; value: string }>();
  for (const t of texts) {
    const hex = t.color ? normHex(t.color) : '';
    if (!hex) continue;
    const cur = colorWeights.get(hex) ?? { weight: 0, value: hex };
    cur.weight += Math.max(1, t.chars);
    colorWeights.set(hex, cur);
  }
  const rankedColors = topByWeight(colorWeights);
  if (rankedColors.length) {
    out.colors.text = rankedColors[0].key;
    const mutedCandidate = rankedColors.slice(1).find((c) => saturation(c.key) < 0.25 && Math.abs(luminance(c.key) - luminance(out.colors.text)) > 0.08);
    if (mutedCandidate) out.colors.muted = mutedCandidate.key;
  }

  // ── primary accent: most prominent saturated colour (text or fill) ─────────
  const accentWeights = new Map<string, { weight: number; value: string }>();
  const addAccent = (hex: string, weight: number) => {
    const n = normHex(hex);
    if (!n) return;
    const sat = saturation(n);
    const lum = luminance(n);
    if (sat < 0.25 || lum > 0.95 || lum < 0.04) return; // greys / near-white / near-black
    const cur = accentWeights.get(n) ?? { weight: 0, value: n };
    cur.weight += weight * (0.5 + sat);
    accentWeights.set(n, cur);
  };
  for (const t of texts) if (t.color) addAccent(t.color, Math.max(1, t.chars) * 4); // coloured text is a strong accent signal
  for (const f of fills) addAccent(f.color, Math.sqrt(Math.max(0, f.area)));
  const rankedAccents = topByWeight(accentWeights);
  if (rankedAccents.length) out.colors.primary = rankedAccents[0].key;

  // ── page background: dominant large, light fill ────────────────────────────
  const pageArea = opts.pageArea ?? 595 * 842;
  const bgCandidate = fills
    .filter((f) => f.area >= pageArea * 0.5 && luminance(f.color) > 0.55)
    .sort((a, b) => b.area - a.area)[0];
  if (bgCandidate) out.colors.bg = normHex(bgCandidate.color) || out.colors.bg;

  // ── fonts ──────────────────────────────────────────────────────────────────
  const famWeights = new Map<string, { weight: number; value: { sizeSum: number; chars: number } }>();
  for (const t of texts) {
    const fam = (t.fontFamily ?? '').trim();
    if (!fam) continue;
    const cur = famWeights.get(fam) ?? { weight: 0, value: { sizeSum: 0, chars: 0 } };
    cur.weight += Math.max(1, t.chars);
    cur.value.sizeSum += t.fontSize * Math.max(1, t.chars);
    cur.value.chars += Math.max(1, t.chars);
    famWeights.set(fam, cur);
  }
  const rankedFams = topByWeight(famWeights);
  if (rankedFams.length) {
    out.fonts.body = rankedFams[0].key;
    const bodyAvg = rankedFams[0].value.sizeSum / Math.max(1, rankedFams[0].value.chars);
    // Heading = the family whose average size is clearly larger than body's.
    const heading = rankedFams
      .slice(1)
      .map((f) => ({ ...f, avg: f.value.sizeSum / Math.max(1, f.value.chars) }))
      .filter((f) => f.avg >= bodyAvg * 1.25 && f.value.chars >= 4)
      .sort((a, b) => b.avg - a.avg)[0];
    out.fonts.heading = heading ? heading.key : rankedFams[0].key;
  }

  return out;
}

/**
 * Dominant page-edge colour from raw RGBA pixels (a low-DPI page raster):
 * sample the border ring — the page background dominates there — bucket the
 * colours coarsely, and return the winner. Used to give imported pages a real
 * `background.color` when the source paints its background in ways the
 * deterministic extractors can't recover (flattened art, exotic paint ops).
 */
export function dominantEdgeColor(
  pixels: Uint8ClampedArray | number[],
  width: number,
  height: number,
  opts: { ring?: number } = {},
): string | undefined {
  if (width < 4 || height < 4) return undefined;
  const ring = Math.max(1, Math.min(opts.ring ?? Math.ceil(Math.min(width, height) * 0.06), 8));
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (i + 3 >= pixels.length || pixels[i + 3] < 200) return;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  };
  for (let y = 0; y < height; y++) {
    const isEdgeRow = y < ring || y >= height - ring;
    for (let x = 0; x < width; x++) {
      if (isEdgeRow || x < ring || x >= width - ring) sample(x, y);
    }
  }
  const best = Array.from(buckets.values()).sort((a, b) => b.count - a.count)[0];
  if (!best || best.count < 16) return undefined;
  const h = (n: number) => Math.round(n / best.count).toString(16).padStart(2, '0');
  return `#${h(best.r)}${h(best.g)}${h(best.b)}`.toUpperCase();
}

/** Is this background close enough to plain white that setting it adds nothing? */
export function isNearWhite(hex: string | undefined): boolean {
  if (!hex) return true;
  const c = parseHex(hex);
  if (!c) return true;
  return c.r > 246 && c.g > 246 && c.b > 246;
}

/**
 * Pick the "ink" colour of a text region from raw RGBA pixels: the average of
 * the pixels on the dark side of the luminance split (paper is the light
 * majority; glyph pixels are the dark minority). Used by OCR mode to stop
 * hard-coding every recognised word to near-black.
 */
export function pickInkColor(
  pixels: Uint8ClampedArray | number[],
  opts: { minAlpha?: number } = {},
): string | undefined {
  const minAlpha = opts.minAlpha ?? 64;
  const lums: Array<{ lum: number; r: number; g: number; b: number }> = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < minAlpha) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    lums.push({ lum: 0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b });
  }
  if (lums.length < 8) return undefined;
  let lumMin = Infinity, lumMax = -Infinity;
  for (const p of lums) { if (p.lum < lumMin) lumMin = p.lum; if (p.lum > lumMax) lumMax = p.lum; }
  // A glyph box is bimodal (paper vs ink). If the box is flat it's not text.
  if (lumMax - lumMin < 24) return undefined;
  // Average only the pixels on the ink side of the luminance split — a fixed
  // "darkest third" would blend paper pixels in whenever glyph coverage is low.
  const threshold = lumMin + (lumMax - lumMin) * 0.45;
  let r = 0, g = 0, b = 0, take = 0;
  for (const p of lums) {
    if (p.lum > threshold) continue;
    r += p.r; g += p.g; b += p.b; take++;
  }
  if (take < 4) return undefined;
  const h = (n: number) => Math.round(n / take).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
