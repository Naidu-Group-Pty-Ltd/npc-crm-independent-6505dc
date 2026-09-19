/**
 * Pure code-grounding for raw-codebase ingestion (plan WS1 §3.2).
 *
 * The `render-source` service renders HTML/CSS/JSX/a-URL to a page and returns a
 * DOM box tree (computed positions + styles in CSS px) plus a screenshot. This
 * module turns that box tree into the SAME `GroundedReference` shape that OCR
 * image grounding produces — so raw-codebase ingestion reuses the existing
 * grounded-classify (`screenshot_to_block`) + SSIM fidelity pipeline UNCHANGED:
 * the screenshot is the reference image, these are the measured elements.
 *
 * Pure + unit-tested; the impure render call lives in `ingestion/codeIngest.ts`.
 */
import { computePageSize, type GroundedElement, type GroundedReference } from './imageGrounding';

/** A single measured text run from the rendered DOM (CSS px, document coords). */
export interface DomTextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSizePx: number;
  lineHeightPx?: number;
  fontWeight?: number;
  fontFamily?: string;
  color?: string;
  italic?: boolean;
  letterSpacingPx?: number;
  textAlign?: 'center' | 'right' | 'justify';
  /** Effective opacity (own × ancestors), present only when < 1. */
  opacity?: number;
}

export interface DomImageBox {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A painted element box (section fill / card / button / rule) from the DOM. */
export interface DomShapeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor?: string;
  gradient?: string;       // raw CSS background-image when it is a gradient
  borderColor?: string;
  borderWidthPx?: number;
  borderRadiusPx?: number;
  blurPx?: number;         // CSS filter: blur(Npx) — glow orbs / soft accents
  boxShadow?: string;      // raw computed box-shadow
  /** Effective opacity (own × ancestors), present only when < 1. */
  opacity?: number;
  domOrder?: number;
}

/** What `render-source` returns (alongside the screenshot raster). */
export interface DomBoxTree {
  pageWidthPx: number;
  pageHeightPx: number;
  textBoxes: DomTextBox[];
  shapeBoxes?: DomShapeBox[];
  imageBoxes?: DomImageBox[];
  background?: string;
  palette?: string[];
  fonts?: string[];
}

export interface CodeGroundOptions {
  maxPageWidth?: number;  // pt, default 595 (A4 width)
  maxPageHeight?: number; // pt, default 842 (A4 height)
  maxElements?: number;   // cap to keep the prompt bounded (default 200)
  minFontPt?: number;     // floor for derived font size (default 6)
}

const round = (n: number): number => Math.round(n);

/**
 * DOM box tree (CSS px) → measured `GroundedReference` (page points), scaled to
 * fit an A4-proportional page. Output is the exact shape `screenshot_to_block`
 * already consumes, so no pipeline change is needed downstream.
 */
export function groundDomBoxTree(tree: DomBoxTree, opts: CodeGroundOptions = {}): GroundedReference {
  const imgW = Math.max(1, Number(tree.pageWidthPx) || 0);
  const imgH = Math.max(1, Number(tree.pageHeightPx) || 0);
  const { pageWidth, pageHeight, scale } = computePageSize(imgW, imgH, opts.maxPageWidth, opts.maxPageHeight);
  const minPt = opts.minFontPt ?? 6;

  const boxes = (Array.isArray(tree.textBoxes) ? tree.textBoxes : [])
    .filter((b) => b && typeof b.text === 'string' && b.text.trim().length > 0 && b.width > 0 && b.height > 0)
    // Reading order: top→bottom, then left→right.
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, opts.maxElements ?? 200);

  // Style fields measured from the DOM (color/font/weight/italic) ride along —
  // they are authoritative ground truth for the AI repair path, which otherwise
  // re-guesses colours and typefaces from the screenshot.
  const elements: GroundedElement[] = boxes.map((b, i) => ({
    id: `el_${i + 1}`,
    text: b.text.trim().replace(/\s+/g, ' '),
    x: Math.max(0, round(b.x * scale)),
    y: Math.max(0, round(b.y * scale)),
    width: round(b.width * scale),
    height: round(b.height * scale),
    fontSize: Math.max(minPt, round((b.fontSizePx || b.height) * scale)),
    ...(b.color ? { color: b.color } : {}),
    ...(b.fontFamily ? { fontFamily: b.fontFamily } : {}),
    ...(b.fontWeight != null ? { fontWeight: b.fontWeight } : {}),
    ...(b.italic ? { italic: true } : {}),
  }));

  return { pageWidth, pageHeight, imageWidth: imgW, imageHeight: imgH, elements };
}

/** Optional: harvest a small deduped palette + font list as a token hint. */
export function harvestTokensFromBoxTree(tree: DomBoxTree): { colors: string[]; fonts: string[] } {
  const boxColors = (tree.textBoxes ?? []).map((b) => b.color).filter(Boolean) as string[];
  const shapeColors = (tree.shapeBoxes ?? [])
    .flatMap((s) => [s.backgroundColor, s.borderColor])
    .filter(Boolean) as string[];
  const boxFonts = (tree.textBoxes ?? []).map((b) => b.fontFamily).filter(Boolean) as string[];
  return {
    colors: uniqLimited([...(tree.palette ?? []), ...boxColors, ...shapeColors], 12),
    fonts: uniqLimited([...(tree.fonts ?? []), ...boxFonts], 6),
  };
}

function uniqLimited(arr: string[], n: number): string[] {
  const out: string[] = [];
  for (const v of arr) {
    const s = String(v).trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= n) break;
  }
  return out;
}
