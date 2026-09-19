/**
 * Pure image-grounding for the AI "reconstruct" path (R5).
 *
 * Turns raw OCR word boxes (pixel space, top-left origin) into MEASURED text
 * elements in page points — the ground truth the design agent must transcribe
 * and place, instead of re-inventing copy and geometry from a vibe-based design
 * brief. Words are merged into visual lines, scaled to a proportional page, and
 * given stable ids the agent references.
 *
 * Pure + unit-tested. The impure Tesseract run lives in the import dialog.
 */

export interface OcrWord {
  text: string;
  x0: number; y0: number; x1: number; y1: number; // pixel bbox (top-left origin)
  /** Optional ink colour sampled from the source raster at this word's bbox. */
  color?: string;
}

export interface GroundedElement {
  id: string;
  text: string;
  x: number; y: number; width: number; height: number; // page points (top-left)
  fontSize: number;
  /** Optional measured style ground truth (DOM grounding / raster sampling). */
  color?: string;
  fontFamily?: string;
  fontWeight?: number;
  italic?: boolean;
}

export interface GroundedReference {
  pageWidth: number;
  pageHeight: number;
  imageWidth: number;
  imageHeight: number;
  elements: GroundedElement[];
}

export interface GroundOptions {
  maxPageWidth?: number;   // default 595 (A4 width in pt)
  maxPageHeight?: number;  // default 842 (A4 height in pt)
  lineTolerance?: number;  // vertical-overlap fraction to join a line (default 0.6)
  maxElements?: number;    // cap to keep the prompt bounded (default 160)
}

const round = (n: number): number => Math.round(n);

/** Scale an image (px) to a proportional page (pt) that fits within the max box. */
export function computePageSize(
  imgW: number,
  imgH: number,
  maxW = 595,
  maxH = 842,
): { pageWidth: number; pageHeight: number; scale: number } {
  if (!(imgW > 0) || !(imgH > 0)) return { pageWidth: maxW, pageHeight: maxH, scale: 1 };
  const scale = Math.min(maxW / imgW, maxH / imgH);
  return { pageWidth: round(imgW * scale), pageHeight: round(imgH * scale), scale };
}

/** Group OCR words into visual lines (top→bottom, then left→right). */
function groupWordsIntoLines(words: OcrWord[], tol: number): OcrWord[][] {
  const items = words
    .filter((w) => w && typeof w.text === 'string' && w.text.trim().length > 0)
    .map((w) => ({ w, midY: (w.y0 + w.y1) / 2, h: Math.max(1, w.y1 - w.y0) }));
  items.sort((a, b) => a.midY - b.midY || a.w.x0 - b.w.x0);
  const lines: { words: OcrWord[]; refMidY: number; refH: number }[] = [];
  for (const it of items) {
    const line = lines.find((ln) => Math.abs(ln.refMidY - it.midY) <= Math.max(ln.refH, it.h) * tol);
    if (line) line.words.push(it.w);
    else lines.push({ words: [it.w], refMidY: it.midY, refH: it.h });
  }
  for (const ln of lines) ln.words.sort((a, b) => a.x0 - b.x0);
  return lines.map((l) => l.words);
}

function mergeLine(line: OcrWord[], scale: number): Omit<GroundedElement, 'id'> {
  const x0 = Math.min(...line.map((w) => w.x0));
  const y0 = Math.min(...line.map((w) => w.y0));
  const x1 = Math.max(...line.map((w) => w.x1));
  const y1 = Math.max(...line.map((w) => w.y1));
  const text = line.map((w) => w.text.trim()).filter(Boolean).join(' ');
  const heightPx = Math.max(1, y1 - y0);
  // Majority ink colour across the line's words (when sampling supplied one).
  const colorVotes = new Map<string, number>();
  for (const w of line) {
    if (!w.color) continue;
    colorVotes.set(w.color, (colorVotes.get(w.color) ?? 0) + Math.max(1, w.text.trim().length));
  }
  const lineColor = Array.from(colorVotes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    text,
    x: round(x0 * scale),
    y: round(y0 * scale),
    width: round((x1 - x0) * scale),
    height: round(heightPx * scale),
    fontSize: Math.max(6, round(heightPx * scale * 0.82)),
    ...(lineColor ? { color: lineColor } : {}),
  };
}

/** Build the measured ground-truth reference from raw OCR words. */
export function groundOcrWords(
  words: OcrWord[],
  imgW: number,
  imgH: number,
  opts: GroundOptions = {},
): GroundedReference {
  const { pageWidth, pageHeight, scale } = computePageSize(imgW, imgH, opts.maxPageWidth, opts.maxPageHeight);
  const lines = groupWordsIntoLines(words, opts.lineTolerance ?? 0.6);
  const merged = lines.map((ln) => mergeLine(ln, scale)).filter((e) => e.text.length > 0);
  const limited = merged.slice(0, opts.maxElements ?? 160);
  const elements: GroundedElement[] = limited.map((e, i) => ({ id: `el_${i + 1}`, ...e }));
  return { pageWidth, pageHeight, imageWidth: imgW, imageHeight: imgH, elements };
}

/** Compact, prompt-ready rendering of the measured elements. */
export function formatGroundedReference(ref: GroundedReference): string {
  const head = `MEASURED TEXT ELEMENTS — ${ref.elements.length} item(s), OCR ground truth on a ${ref.pageWidth}×${ref.pageHeight}pt page (top-left origin).`;
  const rows = ref.elements.map(
    (e) => `[${e.id}] x=${e.x} y=${e.y} w=${e.width} h=${e.height} size≈${e.fontSize}pt :: ${JSON.stringify(e.text)}`,
  );
  return [head, ...rows].join('\n');
}
