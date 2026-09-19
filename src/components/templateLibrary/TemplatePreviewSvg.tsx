/**
 * Schematic page preview rendered straight from the template schema.
 *
 * Deliberately not a PDF and not a stored image. `render-template-pdf` returns
 * 24-hour signed URLs from a private bucket, so a persisted thumbnail URL would
 * break the following day; and rendering a real PDF per card would put a
 * multi-second, metered round-trip on the browse path. An SVG drawn from the
 * schema is instant, always matches the current design, and costs nothing.
 *
 * ## Why this draws the template's OWN colours
 *
 * The first version filled every card with the dashboard's `--card` token and
 * mapped blocks to grey tints. That is the correct instinct for chrome, and the
 * wrong one here: it made twelve visually distinct templates render as twelve
 * identical near-blank rectangles, because nine of them open on a dark cover
 * page whose single `cover` block carries no geometry at all.
 *
 * A template's palette is *content* — the same class of thing as a user's
 * uploaded image — so the preview resolves `token:*` against the template's own
 * `tokens.colors` and paints with it. No literal colour is authored here; every
 * value comes from the data, with the dashboard's own tokens as the fallback
 * when a template does not define one.
 */
import { useMemo } from 'react';

interface Props {
  /** `preview_schema` from a list row, or a full schema from a detail fetch. */
  schema: unknown;
  /** Which page to draw. List rows only carry page 1. */
  pageIndex?: number;
  className?: string;
  /** Announced to assistive technology in place of the drawing. */
  label: string;
}

interface Band { x: number; y: number; w: number; h: number; fill: string; opacity?: number; r?: number }

/** Blocks that occupy the whole page and imply their own composition. */
const FULL_PAGE = new Set(['cover', 'hero']);
const TEXTUAL = new Set([
  'text', 'text-block', 'disclaimer', 'pull-quote', 'faq', 'definition-list',
  'footer', 'page-number', 'toc', 'auto-toc', 'signature',
]);
const MEDIA = new Set(['image', 'gallery', 'map', 'image-text', 'before-after', 'qr']);
const CHARTY = /^(chart|heatmap|sparkline|kpi|scorecard|progress|metric|bar)/;
const TABULAR = /^(data-table|data-grid|pivot-table|comparison|risk-register|planning-table|amenity-matrix|dd-checklist)/;

/** Fallback height by block family, used when a block declares none. */
function impliedHeight(kind: string): number {
  if (TEXTUAL.has(kind)) return 40;
  if (TABULAR.test(kind)) return 120;
  if (CHARTY.test(kind)) return 110;
  if (MEDIA.has(kind)) return 130;
  return 70;
}

/**
 * Resolve a schema colour reference to something paintable.
 *
 * Accepts `token:name` (looked up in the template's palette), a literal colour,
 * or a `{{binding}}` — which cannot be resolved without report data, so it
 * falls back rather than painting the brace text.
 */
function resolveColour(
  value: unknown,
  palette: Record<string, string>,
  fallback: string,
): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.startsWith('{{')) return fallback;
  if (raw.startsWith('token:')) return palette[raw.slice(6)] ?? fallback;
  if (/^(#|rgb|hsl)/i.test(raw)) return raw;
  return fallback;
}

/** Perceived lightness, so text bands can be drawn legibly on any background. */
function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.replace('#', '#'));
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Rec. 601 luma — good enough to choose between two ink tones.
  return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
}

/**
 * A cover block declares no geometry because the renderer composes it. Draw a
 * representative cover instead of one stray bar: accent rule, eyebrow, title,
 * subtitle, footnote.
 */
function coverBands(
  props: Record<string, unknown>,
  palette: Record<string, string>,
  W: number, H: number, ink: string, accent: string,
): Band[] {
  const bands: Band[] = [];
  const m = W * 0.12;
  const inner = W - m * 2;
  let y = H * 0.42;

  if (props.eyebrow) {
    bands.push({ x: m, y, w: inner * 0.42, h: 9, fill: accent, r: 2 });
    y += 26;
  }
  // Title — two bands read as a wrapped headline without faking glyphs.
  const titleH = Math.max(14, Number(props.titleSize ?? 40) * 0.42);
  bands.push({ x: m, y, w: inner * 0.92, h: titleH, fill: ink, opacity: 0.92, r: 3 });
  y += titleH + 8;
  bands.push({ x: m, y, w: inner * 0.6, h: titleH, fill: ink, opacity: 0.92, r: 3 });
  y += titleH + 18;

  bands.push({ x: m, y, w: inner * 0.34, h: 5, fill: accent, r: 2 });
  y += 22;

  if (props.subtitle) {
    bands.push({ x: m, y, w: inner * 0.76, h: 8, fill: ink, opacity: 0.5, r: 2 });
    y += 14;
    bands.push({ x: m, y, w: inner * 0.52, h: 8, fill: ink, opacity: 0.5, r: 2 });
  }
  if (props.footnote) {
    bands.push({ x: m, y: H - m, w: inner * 0.3, h: 7, fill: ink, opacity: 0.42, r: 2 });
  }
  return bands;
}

/** Content blocks become a stack of bands tinted by what they are. */
function blockBands(
  block: any, index: number, cursor: { y: number },
  palette: Record<string, string>, W: number, H: number,
  ink: string, accent: string, panel: string,
): Band[] {
  const props = (block?.props ?? {}) as Record<string, unknown>;
  const kind = String(block?.type ?? '');
  if (!kind) return [];

  const x = Number.isFinite(Number(props.x)) ? Number(props.x) : W * 0.07;
  const w = Number.isFinite(Number(props.width)) ? Number(props.width) : W * 0.86;
  const h = Number.isFinite(Number(props.height)) ? Number(props.height) : impliedHeight(kind);
  const y = Number.isFinite(Number(props.y)) ? Number(props.y) : cursor.y;
  cursor.y = y + h + 14;

  const cx = Math.max(0, Math.min(x, W));
  const cy = Math.max(0, Math.min(y, H));
  const cw = Math.max(4, Math.min(w, W - cx));
  const ch = Math.max(3, Math.min(h, H - cy));
  const bands: Band[] = [];

  if (kind === 'divider') {
    return [{ x: cx, y: cy, w: cw, h: 2.5, fill: accent, r: 1 }];
  }
  if (kind === 'footer') {
    return [{ x: 0, y: H - ch, w: W, h: ch, fill: ink, opacity: 0.12 }];
  }
  if (kind === 'page-number') {
    return [{ x: cx, y: cy, w: cw * 0.6, h: 6, fill: ink, opacity: 0.3, r: 2 }];
  }

  if (TABULAR.test(kind)) {
    // Header rule plus alternating rows reads unmistakably as a table.
    bands.push({ x: cx, y: cy, w: cw, h: 13, fill: accent, r: 2 });
    const rows = Math.max(2, Math.min(7, Math.floor((ch - 16) / 16)));
    for (let i = 0; i < rows; i++) {
      bands.push({
        x: cx, y: cy + 17 + i * 15, w: cw, h: 11,
        fill: i % 2 ? panel : ink, opacity: i % 2 ? 0.9 : 0.08, r: 1,
      });
    }
    return bands;
  }

  if (CHARTY.test(kind)) {
    const items = Array.isArray(props.items) ? props.items.length : 4;
    const n = Math.max(3, Math.min(6, items));
    const gap = 6;
    const colW = (cw - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      // Varying heights so it reads as a chart rather than a block of colour.
      const frac = 0.42 + ((i * 37) % 58) / 100;
      const barH = Math.max(8, ch * frac);
      bands.push({
        x: cx + i * (colW + gap), y: cy + (ch - barH),
        w: colW, h: barH, fill: accent, opacity: 0.55 + (i % 3) * 0.15, r: 2,
      });
    }
    return bands;
  }

  if (MEDIA.has(kind)) {
    return [{ x: cx, y: cy, w: cw, h: ch, fill: ink, opacity: 0.14, r: 3 }];
  }

  // Textual and everything else: a heading rule plus copy lines.
  const lines = Math.max(1, Math.min(5, Math.floor(ch / 14)));
  if (props.heading || props.title) {
    bands.push({ x: cx, y: cy, w: cw * 0.45, h: 10, fill: accent, opacity: 0.9, r: 2 });
  }
  const start = props.heading || props.title ? cy + 16 : cy;
  for (let i = 0; i < lines; i++) {
    bands.push({
      x: cx, y: start + i * 12, w: cw * (i === lines - 1 ? 0.62 : 0.97),
      h: 6, fill: ink, opacity: 0.45, r: 1,
    });
  }
  return bands;
}

export function TemplatePreviewSvg({ schema, pageIndex = 0, className, label }: Props) {
  const { width, height, bg, bands } = useMemo(() => {
    const pages = Array.isArray((schema as any)?.pages) ? (schema as any).pages : [];
    const page = pages[pageIndex] ?? pages[0];
    const W = Number(page?.size?.width ?? 595);
    const H = Number(page?.size?.height ?? 842);
    const palette = ((schema as any)?.tokens?.colors ?? {}) as Record<string, string>;

    // Dashboard tokens are the fallback, so a template that defines no palette
    // still renders in the viewer's theme rather than a hard-coded colour.
    const background = resolveColour(page?.background?.color, palette, 'hsl(var(--card))');
    const dark = isDark(background);
    // On a dark cover the template's own `text` token is the ink; the fallback
    // is the semantic token for ink-on-a-strong-fill, which is the same
    // situation and stays legible in either dashboard theme.
    const ink = resolveColour(
      dark ? palette.text ?? palette.surface : palette.ink, palette,
      dark ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
    );
    const accent = resolveColour(palette.primary, palette, 'hsl(var(--primary))');
    const panel = resolveColour(palette.panel ?? palette.surface, palette, 'hsl(var(--muted))');

    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    const out: Band[] = [];
    const cursor = { y: H * 0.07 };
    for (const [i, b] of blocks.slice(0, 40).entries()) {
      const kind = String(b?.type ?? '');
      out.push(
        ...(FULL_PAGE.has(kind)
          ? coverBands((b?.props ?? {}) as Record<string, unknown>, palette, W, H, ink, accent)
          : blockBands(b, i, cursor, palette, W, H, ink, accent, panel)),
      );
    }
    return { width: W, height: H, bg: background, bands: out };
  }, [schema, pageIndex]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={label}
    >
      <rect x={0} y={0} width={width} height={height} fill={bg} />
      {bands.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={b.r ?? 2}
          fill={b.fill}
          opacity={b.opacity ?? 1}
        />
      ))}
      {bands.length === 0 && (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={28}
        >
          No preview
        </text>
      )}
    </svg>
  );
}
