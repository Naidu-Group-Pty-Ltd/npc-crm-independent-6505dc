/**
 * Map a Docling `DoclingDocument` into the existing `RawImportBlock[]` IR,
 * grouped by page. The downstream reconciliation/plan builders already know
 * how to turn `RawImportBlock` into editor overlays — so this is the single
 * bridge between Docling's schema and our import pipeline.
 *
 * Coordinate convention: our overlays use top-left origin in PDF points.
 * Docling bboxes may be either TOPLEFT or BOTTOMLEFT — we normalise to
 * TOPLEFT using the page height when needed.
 *
 * Phase A enrichments:
 *   - Reading order is preserved from the Docling document iteration order
 *     (DocLayNet → reading-order model). Final per-page sort is by that
 *     index, not raw y/x, so 2-column layouts flow correctly.
 *   - Heading levels (`section_header` H1–H6) drive font size + meta.headingLevel.
 *   - Contiguous `list_item` runs are tagged with a shared `listGroupId`.
 *   - Tables expose the full cell grid via `meta.tableData` so downstream
 *     overlay builders can populate `TableOverlay.columns/rows` instead of
 *     just a preview string.
 */
import type {
  RawImportBlock,
  RawImportBlockSource,
  RawImportBlockType,
  ImportBBox,
} from '@/lib/reportTemplate/ingestion/reconciliation';
import { resolveSourceFontFamily, lookupEmbeddedFamily } from '../fontResolver';
import {
  detrackJoinedLines,
  deriveTrackingPt,
  deriveTrackingFromLines,
  type WidthMeasurer,
} from '../detrackText.pure';
import { deriveWeight } from '../fontFaceBuilder';
import { countDistinctBaselines, splitBaselineColumns } from '../splitBaselineColumns.pure';
import type {
  DoclingBBox,
  DoclingDocument,
  DoclingPageInfo,
  DoclingPictureItem,
  DoclingProvenance,
  DoclingRef,
  DoclingTableCell,
  DoclingTableItem,
  DoclingTextItem,
  DoclingTextLabel,
  DoclingVectorItem,
} from './doclingTypes';

/** Resolve a Docling ref ($ref / cref / string) to the string self_ref form. */
function refToString(ref: DoclingRef | string | undefined): string | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'string') return ref;
  return ref.$ref ?? ref.cref;
}

/** Pick the top classifier label from either schema variant. */
function topPictureClass(picture: DoclingPictureItem): string | undefined {
  const c = picture.classification;
  if (!c) return undefined;
  if (c.predicted_class) return c.predicted_class;
  if (Array.isArray(c.predicted_classes) && c.predicted_classes.length) {
    const sorted = [...c.predicted_classes].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
    );
    return sorted[0]?.class_name;
  }
  return undefined;
}

/** First VLM description annotation, if present. */
function pictureAltText(picture: DoclingPictureItem): string | undefined {
  const ann = (picture.annotations ?? []).find(
    (a) => (a.kind ?? '').toLowerCase().includes('descr') && (a.text ?? '').trim().length > 0,
  );
  return ann?.text?.trim();
}

const DEFAULT_FONT_FAMILY = 'Helvetica';

// Imported picture URIs are later emitted into HTML and rendered by WeasyPrint.
// Keep this boundary deliberately narrow so parser-controlled values cannot
// trigger network/file fetches, SVG execution, binding resolution, or large
// data-URI allocations during preview/export.
// Raised from 10 MB alongside the picture-crop DPI increase (DOCLING_IMAGES_SCALE
// 2.0 -> 4.0): a legitimate full-bleed image at 288 DPI now exceeds the old
// bound, and tripping it produces a grey placeholder rather than a picture.
// This is an allocation guard, not a correctness one — the format allow-list
// above it is what keeps the boundary narrow.
// Exported so the rejection spec derives its "oversized" fixture from the real
// bound — a hardcoded fixture silently stopped being oversized when this grew.
export const MAX_DOCLING_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_DOCLING_IMAGE_BASE64_LENGTH = Math.ceil(MAX_DOCLING_IMAGE_BYTES / 3) * 4;

/** Why a picture URI was refused — surfaced so the drop is never silent. */
export type DoclingImageRejection = 'not-a-string' | 'unsupported-format' | 'too-large';

export interface DoclingImageUriResult {
  uri?: string;
  rejected?: DoclingImageRejection;
  /** Decoded byte estimate, present when the reason is `too-large`. */
  approxBytes?: number;
}

/**
 * Validate a picture data URI.
 *
 * Returns the reason on refusal instead of a bare `undefined`. An oversize
 * image previously vanished into a grey checkerboard with nothing anywhere
 * explaining why, which is indistinguishable from a parse failure to whoever is
 * reviewing the import.
 */
function inspectDoclingImageUri(uri: unknown): DoclingImageUriResult {
  if (typeof uri !== 'string') return { rejected: 'not-a-string' };
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(uri);
  if (!match || !match[1]) return { rejected: 'unsupported-format' };
  if (match[1].length > MAX_DOCLING_IMAGE_BASE64_LENGTH) {
    return { rejected: 'too-large', approxBytes: Math.floor((match[1].length * 3) / 4) };
  }
  return { uri };
}

function safeDoclingImageUri(uri: unknown): string | undefined {
  return inspectDoclingImageUri(uri).uri;
}

function nearestDesignFont(family: string | undefined, label?: DoclingTextLabel): string {
  const f = (family ?? '').toLowerCase();
  if (label === 'code' || /mono|courier|consolas|menlo|source code/.test(f)) return 'Menlo, Consolas, monospace';
  if (/serif|times|georgia|garamond|playfair|cambria/.test(f)) return 'Georgia, "Times New Roman", serif';
  if (/inter|arial|helvetica|roboto|lato|open sans|source sans|calibri/.test(f)) return 'Inter, Arial, sans-serif';
  return label === 'title' || label === 'section_header' ? 'Inter, Arial, sans-serif' : DEFAULT_FONT_FAMILY;
}

function bboxToTopLeft(bbox: DoclingBBox, pageHeight: number): ImportBBox {
  const width = Math.max(0, bbox.r - bbox.l);
  const height = Math.max(0, bbox.t - bbox.b !== 0 ? Math.abs(bbox.t - bbox.b) : 0);
  if (bbox.coord_origin === 'BOTTOMLEFT') {
    const top = Math.max(0, pageHeight - Math.max(bbox.t, bbox.b));
    return { x: bbox.l, y: top, width, height };
  }
  const top = Math.min(bbox.t, bbox.b);
  return { x: bbox.l, y: top, width, height };
}

function pickProv(prov: DoclingProvenance[] | undefined, pageNo: number): DoclingProvenance | null {
  if (!prov || prov.length === 0) return null;
  const onPage = prov.find((p) => p.page_no === pageNo);
  return onPage ?? prov[0];
}

function labelToBlockType(label: DoclingTextLabel | undefined): RawImportBlockType {
  if (label === 'formula' || label === 'equation') return 'formula';
  if (label === 'code') return 'code';
  return 'text';
}

function labelDefaultWeight(label: DoclingTextLabel | undefined): 'bold' | 'normal' {
  if (label === 'title' || label === 'section_header' || label === 'page_header') return 'bold';
  return 'normal';
}

/**
 * Map heading depth → font size. Mirrors a typical doc rhythm (22/18/15/13/12/11).
 * For `title` we always use H1.
 */
function headingFontSize(level: number): number {
  const clamped = Math.max(1, Math.min(6, Math.round(level)));
  return [22, 18, 15, 13, 12, 11][clamped - 1];
}

function labelDefaultFontSize(label: DoclingTextLabel | undefined, level?: number): number {
  if (label === 'title') return headingFontSize(1);
  if (label === 'section_header') return headingFontSize(level ?? 2);
  switch (label) {
    case 'page_header':
    case 'page_footer':
    case 'caption':
    case 'footnote': return 9;
    default: return 11;
  }
}

/**
 * Derive a font size from the measured box, mirroring the fallback that
 * `ingestion/reconciliation/hybridPlan.ts` has always used.
 *
 * Only applied to boxes that plausibly hold a SINGLE line: for a wrapped
 * paragraph the box height is a function of line count, not glyph size, so
 * `height * 0.72` would produce an absurd size. A multi-line box therefore
 * returns null and falls through to the label default, which is at least a
 * reading-order-aware guess.
 *
 * Returns null rather than a default so the caller's `??` chain stays explicit.
 */
function boxDerivedFontSize(boxHeight: number, text: string | undefined): number | null {
  if (!Number.isFinite(boxHeight) || boxHeight <= 0) return null;
  // An explicit newline means the producer already knows this wraps.
  if ((text ?? '').includes('\n')) return null;
  const derived = boxHeight * 0.72;
  // Outside these bounds the box is not describing one line of type.
  if (derived < 4 || derived > 96) return null;
  return Math.round(derived * 100) / 100;
}

/**
 * Normalise a source weight WITHOUT discarding its precision.
 *
 * This used to return `n >= 600 ? 'bold' : 'normal'`, which destroyed the real
 * grade before the schema ever saw it — so a source Light 300 became 400 and a
 * SemiBold 600 became 700. Both substitutions are WIDER than the source, and
 * widening text inside a bbox copied verbatim from the source is exactly how a
 * text box ends up unable to hold its own contents.
 *
 * The numeric grade is preserved here and written to `fontWeightNumeric`
 * downstream; `templateSchema` still derives the coarse enum for renderers that
 * only understand normal/bold.
 */
function normaliseWeight(value: unknown): number | 'normal' | 'bold' | undefined {
  if (value === 'bold' || value === 'normal') return value;
  const n = Number(value);
  // CSS weights are 1-1000; anything outside that is not a weight.
  if (Number.isFinite(n) && n >= 1 && n <= 1000) return Math.round(n);
  return undefined;
}

/**
 * Phase 6E — numeric weight from a font family / PostScript name (e.g.
 * "OpenSans-Light" → 300, "Inter-SemiBold" → 600). Used only when the text item
 * carries no explicit weight AND the name actually encodes one — `deriveWeight`
 * returns its 400 default for plain names, which we treat as "no signal" so a
 * heading's label-default weight is never clobbered.
 */
function weightFromFamilyName(family?: string): number | undefined {
  if (!family) return undefined;
  const w = deriveWeight(family, false);
  return w !== 400 ? w : undefined;
}

function blockId(prefix: string, pageNo: number, index: number): string {
  return `docling-${prefix}-p${pageNo}-${index.toString(36)}`;
}

/**
 * Docling emits `GLYPH<n>` placeholder tokens when a font has no usable
 * ToUnicode map (each unmapped glyph becomes an 8+ char token interleaved with
 * the recoverable characters). Left in place they balloon the text to many
 * times its true width, wrap across everything below, and read as garbage —
 * strip the tokens, keep the recoverable characters, and flag the block so it
 * is confidence-capped (locked in hybrid) and surfaced as a page warning.
 */
const GLYPH_ARTIFACT = /GLYPH<[^>]{0,16}>/g;

function sanitizeExtractedText(raw: string | undefined): { text: string | undefined; hadGlyphArtifacts: boolean } {
  if (!raw || !raw.includes('GLYPH<')) return { text: raw, hadGlyphArtifacts: false };
  const stripped = raw
    .replace(GLYPH_ARTIFACT, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { text: stripped, hadGlyphArtifacts: true };
}

/** Confidence ceiling for blocks whose text carried GLYPH extraction artifacts. */
const GLYPH_ARTIFACT_MAX_CONFIDENCE = 0.5;

interface MapOptions {
  defaultConfidence?: number;
  source?: RawImportBlockSource;
  /** Phase 3: source-font-name → embedded `@font-face` family (for full fonts). */
  embeddedFontFamilies?: Record<string, string>;
  /**
   * R1 — width measurer for deriving tracking on de-tracked text. Injected so
   * the mapper stays pure; the importer passes a canvas-backed one in the
   * browser. Absent, a documented glyph-advance estimate stands in.
   */
  measureTextWidth?: WidthMeasurer | null;
}

/**
 * Give a tracked box back the one letter-space that line-breaking charges it.
 *
 * CSS `letter-spacing` behaves two different ways at once, and the difference
 * is a whole line. Measured against WeasyPrint with `CONSULTING SERVICES` at
 * 11.25pt, tracked 3.72pt:
 *
 *   drawn ink extent   natural + spacing × (n − 1)  = 199.71pt
 *   layout width       natural + spacing × n        = 203.43pt
 *   observed wrap point                             between 203.0 and 203.5pt
 *
 * The box is copied from the source's own INK extent, so it is exactly as wide
 * as the glyphs — and then the trailing space nobody can see pushes the line
 * over it. The brand lockup's second line wrapped for want of 3.7pt of nothing.
 *
 * Widening the box by one space adds room for the space that is already there.
 * No glyph moves: the text still starts at the source's x and its ink still
 * ends where the source's ink ended. Only the phantom wrap goes away.
 */
function withTrackingSlack(bbox: ImportBBox, letterSpacingPt: number | null): ImportBBox {
  const slack = Number(letterSpacingPt);
  if (!Number.isFinite(slack) || slack <= 0) return bbox;
  return { ...bbox, width: bbox.width + slack };
}

function textItemToBlock(
  item: DoclingTextItem,
  pageInfo: DoclingPageInfo,
  index: number,
  readingOrder: number,
  listGroupId: string | undefined,
  opts: MapOptions,
): RawImportBlock[] {
  const prov = pickProv(item.prov, pageInfo.page_no);
  if (!prov) return [];
  const bbox = bboxToTopLeft(prov.bbox, pageInfo.size.height);
  if (bbox.width <= 0 || bbox.height <= 0) return [];
  const headingLevel = item.label === 'title'
    ? 1
    : item.label === 'section_header'
      ? Math.max(1, Math.min(6, Math.round(item.level ?? 2)))
      : undefined;
  // Font size, most-trustworthy source first.
  //
  // The label-derived table (22/18/15/13/12/11pt for h1..h6) is a LAST resort,
  // not a second choice. It invents a size with no relationship to the source
  // box, so a source heading actually set at 14pt was being re-rendered at 22pt
  // inside its original ~16pt-tall bbox — a guaranteed overflow, and one of the
  // direct causes of text boxes unable to hold their contents.
  //
  // The sibling non-Docling path (ingestion/reconciliation/hybridPlan.ts) has
  // always derived a size from the box when the source does not state one; this
  // mapper simply never did. `bbox.height * 0.72` approximates cap-height plus
  // leading for a single-line box, and is clamped to sane typographic bounds.
  const fontSize = item.font?.size
    ?? boxDerivedFontSize(bbox.height, item.text)
    ?? labelDefaultFontSize(item.label, headingLevel);
  const fontWeight = normaliseWeight(item.font?.weight)
    ?? weightFromFamilyName(item.font?.family)
    ?? labelDefaultWeight(item.label);
  const fontStyle = item.font?.italic ? 'italic' : 'normal';
  // Phase B: tag page furniture so the plan builder can route it to a master page.
  const pageRegion: 'header' | 'footer' | undefined =
    item.label === 'page_header' ? 'header'
    : item.label === 'page_footer' ? 'footer'
    : undefined;
  const masterGroupId = pageRegion
    ? `docling-master-${pageRegion}-p${pageInfo.page_no}`
    : undefined;
  const blockType = labelToBlockType(item.label);
  // Phase D: prefer LaTeX when this is a formula; preserve raw text otherwise.
  const latex = item.latex ?? item.equation;
  const codeLanguage = item.code_language;
  const sanitized = sanitizeExtractedText(item.text);
  // R1 — recover real words from tracked (letter-spaced) source text. The
  // extractor turns "NAIDU" set as N A I D U into per-letter tokens with the
  // real word gaps degraded or lost; stored as-is it reads, edits and searches
  // as gibberish. Untracked text passes through byte-identical.
  //
  // De-track PER SOURCE LINE. The extractor joins an item's lines with a single
  // space, and inside tracked text a single space is a letter gap — so the join
  // itself erased the PROPERTY|CONSULTING boundary in the brand lockup, and no
  // amount of looking at the merged string could find it again. The line char
  // counts locate the seam exactly, because a line break is always a word break.
  const sourceLines = item.source_measure?.lines;
  const detracked = detrackJoinedLines(sanitized.text ?? '', sourceLines);
  const singleLineMeasure = item.source_measure?.lineCount === 1
    ? sourceLines?.[0]
    : undefined;
  const displayText = blockType === 'formula' && latex ? latex : detracked.text;
  // Nothing recoverable after stripping GLYPH artifacts → no overlay at all
  // (hybrid keeps the raster reference; semantic drops the garbage cleanly).
  if (!displayText || !displayText.trim()) return [];
  // Phase D: capture explicit cross-reference if exactly one ref present.
  const refList = (item.refs ?? []).map((r) => (typeof r === 'string' ? r : (r.$ref ?? r.cref))).filter(Boolean) as string[];
  const xref = refList.length === 1 ? refList[0] : undefined;
  // Phase 3: preserve the source font family (→ Google Fonts via the catalog)
  // instead of bucketing into the tiny design catalog; fall back to the
  // label-aware design font only when the source font isn't catalog-known.
  const sourceFont = item.font?.family;
  const fontResolution = sourceFont ? resolveSourceFontFamily(sourceFont) : undefined;
  // Phase 3: prefer an embedded (full, non-subset) program when available; else
  // the catalog/web-font match; else the label-aware design fallback.
  const embeddedFamily = sourceFont
    ? lookupEmbeddedFamily(sourceFont, opts.embeddedFontFamilies)
    : undefined;
  const fontFamily = embeddedFamily
    ? `"${embeddedFamily}", ${fontResolution?.family ?? nearestDesignFont(sourceFont, item.label)}`
    : fontResolution && !fontResolution.substituted
      ? fontResolution.family
      : nearestDesignFont(sourceFont, item.label);
  // R1 — de-tracked text needs its tracking back as a STYLE, or the collapsed
  // words render far narrower than the box the source measured. Derived from
  // measured width minus natural width. Overrides the (always-absent) sidecar
  // `letter_spacing` when de-tracking actually changed the text.
  //
  // Measured against `fontFamily` — the stack the overlay will actually render
  // in, not `fontResolution.family`. Those two differ whenever the source font
  // was SUBSTITUTED, because the overlay then falls back to the label-aware
  // design font while the resolution keeps its own guess. Deriving spacing from
  // one font and rendering it in another is the same error as deriving it with
  // no measurer at all, only harder to see: on this cover the lockup was
  // measured in a Helvetica stack and drawn in an Inter one, and came out wide
  // enough to wrap.
  //
  // Derived per LINE and reconciled, not from the joined string: the equation is
  // (measured width − natural width) ÷ gaps, and the joined string has every
  // line's glyphs while the only width available for it is the widest single
  // line. That mismatch produced no tracking at all for the two-line brand
  // lockup while the single-line labels around it kept theirs — which is what
  // "inconsistent letter-spacing" was.
  const derivedTracking = detracked.changed
    ? (detracked.lines?.length && sourceLines?.length
        ? deriveTrackingFromLines(
            detracked.lines,
            sourceLines.map((l) => Number(l?.widthPt)),
            fontSize,
            fontFamily,
            opts.measureTextWidth,
            fontWeight,
          )
        : deriveTrackingPt(
            displayText,
            singleLineMeasure?.widthPt ?? bbox.width,
            fontSize,
            fontFamily,
            opts.measureTextWidth,
            fontWeight,
          ))
    : null;
  const letterSpacing = derivedTracking
    ?? (typeof item.font?.letter_spacing === 'number' ? item.font.letter_spacing : null);
  const block: RawImportBlock = {
    id: blockId(String(item.label ?? 'text'), pageInfo.page_no, index),
    type: blockType,
    text: displayText,
    bbox: withTrackingSlack(bbox, letterSpacing),
    style: {
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
      color: item.font?.color ?? '#111111',
      // Phase 2: prefer real alignment/leading/tracking from the PyMuPDF pass.
      textAlign: item.text_align ?? 'left',
      ...(typeof item.font?.line_height === 'number' ? { lineHeight: item.font.line_height } : {}),
      ...(letterSpacing != null ? { letterSpacing } : {}),
    },
    confidence: Math.min(
      typeof item.confidence === 'number' ? item.confidence : opts.defaultConfidence ?? 0.85,
      sanitized.hadGlyphArtifacts ? GLYPH_ARTIFACT_MAX_CONFIDENCE : 1,
    ),
    source: opts.source ?? 'pdf-text',
    meta: {
      label: item.label,
      ...(sanitized.hadGlyphArtifacts ? { glyphArtifacts: true } : {}),
      headingLevel,
      listGroupId,
      readingOrder,
      pageRegion,
      groupId: masterGroupId,
      latex,
      codeLanguage,
      language: item.language,
      xref,
      // How many lines the SOURCE drew in this box. Docling joins them with a
      // space, so the string cannot say; this can, and it is what stops a
      // two-line title being forced onto one line and off the page.
      ...(Number.isFinite(Number(item.source_measure?.lineCount))
        && Number(item.source_measure?.lineCount) >= 1
        ? { sourceLineCount: Math.round(Number(item.source_measure!.lineCount)) }
        : {}),
      // And how many ROWS those lines occupy. From v2 geometry this is exact,
      // so the box-height heuristic above it never has to run.
      ...(() => {
        const rows = countDistinctBaselines(sourceLines);
        return rows ? { sourceBaselineCount: rows } : {};
      })(),
      // D1 — where the source's FIRST line actually sits. The sidecar sorts
      // the matched lines by baseline, so [0] is the topmost.
      ...(Number.isFinite(Number(sourceLines?.[0]?.baselineYPt))
        ? { sourceFirstBaselineY: Number(sourceLines![0]!.baselineYPt) }
        : {}),
      ...(sourceFont ? { sourceFont } : {}),
      ...(!embeddedFamily && fontResolution?.substituted ? { fontSubstituted: true } : {}),
    },
  };

  // Two fields that share a baseline are not one field. Docling groups the
  // footer's `PRIVATE AND CONFIDENTIAL` and `REF 90E5DF34` — 260pt apart at
  // opposite ends of the page — into one item, and one left-aligned overlay
  // walks the reference number into the middle of the page. Split on the
  // source's own per-line x, so each half lands where it was drawn.
  return splitIntoBaselineColumns(block, detracked.lines, sourceLines, fontSize, letterSpacing);
}

/**
 * Expand one block into per-column blocks when its source lines are separable
 * fields sharing a baseline. Returns `[block]` unchanged in every other case,
 * including when the de-tracked per-line text is unavailable to fill them.
 */
function splitIntoBaselineColumns(
  block: RawImportBlock,
  lineTexts: string[] | undefined,
  sourceLines: readonly { widthPt?: number; x0Pt?: number; x1Pt?: number; baselineYPt?: number }[] | undefined,
  fontSizePt: number,
  letterSpacingPt: number | null,
): RawImportBlock[] {
  const columns = splitBaselineColumns(sourceLines, fontSizePt);
  if (!columns || !lineTexts || lineTexts.length !== (sourceLines?.length ?? -1)) return [block];
  const parts: RawImportBlock[] = [];
  for (let c = 0; c < columns.length; c += 1) {
    const column = columns[c];
    const text = column.lineIndices.map((i) => lineTexts[i]).filter(Boolean).join(' ').trim();
    if (!text) return [block];
    parts.push({
      ...block,
      id: `${block.id}-c${c}`,
      text,
      // The row's vertical extent is shared; only the horizontal changes. Each
      // column carries its own ink width, so each needs its own tracking slack.
      bbox: withTrackingSlack(
        { ...block.bbox, x: column.xPt, width: column.widthPt },
        letterSpacingPt,
      ),
      meta: {
        ...block.meta,
        // Each column is one drawn line, whatever the item as a whole was.
        sourceLineCount: column.lineIndices.length,
      },
    });
  }
  return parts;
}

type DoclingMappedTableCell = {
  text: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  columnHeader?: boolean;
  rowHeader?: boolean;
};

// Docling output is derived from uploaded PDFs, so table dimensions and cell
// coordinates must be treated as untrusted input. Keep enough cells for useful
// editing while preventing a malformed document from forcing a huge dense grid.
const MAX_TABLE_ROWS = 1_000;
const MAX_TABLE_COLS = 100;
const MAX_TABLE_CELLS = 10_000;

function boundedTableDimension(value: unknown, maximum: number): number {
  const dimension = Number(value);
  if (!Number.isFinite(dimension) || dimension <= 0) return 0;
  return Math.min(Math.floor(dimension), maximum);
}

function boundedCellOffset(value: unknown, fallback: number, maximum: number): number {
  const offset = Number(value);
  if (!Number.isFinite(offset)) return fallback;
  return Math.max(0, Math.min(Math.floor(offset), maximum));
}

/** Build a dense row-major string grid from Docling's sparse `table_cells`. */
function buildTableGrid(item: DoclingTableItem): {
  rows: string[][];
  cells: DoclingMappedTableCell[];
  headerRows: number;
  numRows: number;
  numCols: number;
  hadGlyphArtifacts: boolean;
} {
  let hadGlyphArtifacts = false;
  const numRows = boundedTableDimension(item.data?.num_rows, MAX_TABLE_ROWS);
  const requestedCols = boundedTableDimension(item.data?.num_cols, MAX_TABLE_COLS);
  const numCols = numRows > 0
    ? Math.min(requestedCols, Math.floor(MAX_TABLE_CELLS / numRows))
    : requestedCols;
  const grid: string[][] = Array.from({ length: numRows }, () => Array<string>(numCols).fill(''));
  const cells: DoclingTableCell[] = item.data?.table_cells?.slice(0, MAX_TABLE_CELLS)
    ?? (item.data?.grid
      ? item.data.grid.slice(0, numRows).flatMap((row) => row.slice(0, numCols))
      : []);
  const structuralCells: DoclingMappedTableCell[] = [];

  for (const [idx, cell] of cells.entries()) {
    const hasExplicitPosition = cell.start_row_offset_idx !== undefined || cell.start_col_offset_idx !== undefined;
    const inferredRow = numCols > 0 ? Math.floor(idx / numCols) : 0;
    const inferredCol = numCols > 0 ? idx % numCols : 0;
    const r0 = boundedCellOffset(
      cell.start_row_offset_idx,
      hasExplicitPosition ? 0 : inferredRow,
      Math.max(0, numRows - 1),
    );
    const c0 = boundedCellOffset(
      cell.start_col_offset_idx,
      hasExplicitPosition ? 0 : inferredCol,
      Math.max(0, numCols - 1),
    );
    const r1 = boundedCellOffset(
      cell.end_row_offset_idx,
      r0 + boundedCellOffset(cell.row_span, 1, numRows),
      numRows,
    );
    const c1 = boundedCellOffset(
      cell.end_col_offset_idx,
      c0 + boundedCellOffset(cell.col_span, 1, numCols),
      numCols,
    );
    const cellSanitized = sanitizeExtractedText(cell.text ?? '');
    if (cellSanitized.hadGlyphArtifacts) hadGlyphArtifacts = true;
    const text = (cellSanitized.text ?? '').trim();
    structuralCells.push({
      text,
      row: r0,
      col: c0,
      rowSpan: Math.max(1, r1 - r0),
      colSpan: Math.max(1, c1 - c0),
      ...(cell.column_header ? { columnHeader: true } : {}),
      ...(cell.row_header ? { rowHeader: true } : {}),
    });
    for (let r = r0; r < r1 && r < numRows; r += 1) {
      for (let c = c0; c < c1 && c < numCols; c += 1) {
        // Only the anchor cell gets the text; merged spans leave duplicates blank
        // so downstream renderers can detect spans if they care.
        if (r === r0 && c === c0) grid[r][c] = text;
      }
    }
  }

  // Header row count = max(column_header rows) — count contiguous rows from top
  // where every populated cell is flagged column_header.
  let headerRows = 0;
  if (cells.length) {
    const headerRowSet = new Set<number>();
    for (const cell of cells) {
      if (cell.column_header) headerRowSet.add(cell.start_row_offset_idx ?? 0);
    }
    if (headerRowSet.size) {
      // Take contiguous header rows starting at 0.
      for (let r = 0; r < numRows; r += 1) {
        if (headerRowSet.has(r)) headerRows = r + 1;
        else break;
      }
    }
  }

  return { rows: grid, cells: structuralCells, headerRows, numRows, numCols, hadGlyphArtifacts };
}

function tableItemToBlock(
  item: DoclingTableItem,
  pageInfo: DoclingPageInfo,
  index: number,
  readingOrder: number,
  captionGroupId: string | undefined,
  opts: MapOptions,
): RawImportBlock | null {
  const prov = pickProv(item.prov, pageInfo.page_no);
  if (!prov) return null;
  const bbox = bboxToTopLeft(prov.bbox, pageInfo.size.height);
  if (bbox.width <= 0 || bbox.height <= 0) return null;
  const { hadGlyphArtifacts, ...tableData } = buildTableGrid(item);
  const previewCells: string[] = [];
  for (const row of tableData.rows) {
    for (const cell of row) {
      if (cell) previewCells.push(cell);
      if (previewCells.length === 12) break;
    }
    if (previewCells.length === 12) break;
  }
  const preview = previewCells.join(' · ');
  return {
    id: blockId('table', pageInfo.page_no, index),
    type: 'table',
    text: preview || '[table]',
    bbox,
    style: {
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: 9,
      fontWeight: 'normal',
      color: '#111111',
    },
    confidence: Math.min(
      typeof item.confidence === 'number' ? item.confidence : opts.defaultConfidence ?? 0.7,
      hadGlyphArtifacts ? GLYPH_ARTIFACT_MAX_CONFIDENCE : 1,
    ),
    source: opts.source ?? 'pdf-text',
    meta: {
      label: 'table',
      readingOrder,
      tableData,
      caption: item.caption,
      groupId: captionGroupId,
      ...(hadGlyphArtifacts ? { glyphArtifacts: true } : {}),
    },
  };
}

function pictureItemToBlock(
  item: DoclingPictureItem,
  pageInfo: DoclingPageInfo,
  index: number,
  readingOrder: number,
  captionPair: { groupId: string; text?: string } | undefined,
  opts: MapOptions,
): RawImportBlock | null {
  const prov = pickProv(item.prov, pageInfo.page_no);
  if (!prov) return null;
  const bbox = bboxToTopLeft(prov.bbox, pageInfo.size.height);
  if (bbox.width <= 0 || bbox.height <= 0) return null;
  const altText = pictureAltText(item);
  const pictureClass = topPictureClass(item);
  const imageInspection = inspectDoclingImageUri(item.image?.uri);
  const imageUri = imageInspection.uri;
  const imageDiagnosticsPath = item.image?.diagnostics_path;
  const displayText = altText || item.caption || (pictureClass ? `[${pictureClass}]` : '[image]');
  return {
    id: blockId('picture', pageInfo.page_no, index),
    type: 'image',
    text: displayText,
    bbox,
    style: { backgroundColor: '#00000000' },
    confidence: typeof item.confidence === 'number' ? item.confidence : opts.defaultConfidence ?? 0.6,
    source: opts.source ?? 'pdf-text',
    meta: {
      label: 'picture',
      readingOrder,
      caption: item.caption,
      // The paired caption's words. Docling states a caption by REFERENCE, so
      // `item.caption` is usually empty while the text sits in its own block —
      // which is why a figure's alternative text could never see it.
      ...(captionPair?.text ? { captionText: captionPair.text } : {}),
      altText,
      pictureClass,
      groupId: captionPair?.groupId,
      imageUri,
      imageDiagnosticsPath,
      // A refused picture renders as a grey placeholder. Recording WHY makes the
      // difference between "the source had no image here" and "we dropped it"
      // visible to review, instead of leaving a mystery box on the page.
      ...(imageInspection.rejected && item.image?.uri != null
        ? {
            imageRejected: imageInspection.rejected,
            ...(imageInspection.approxBytes != null
              ? { imageApproxBytes: imageInspection.approxBytes }
              : {}),
          }
        : {}),
    },
  };
}

function vectorItemToBlock(
  item: DoclingVectorItem,
  pageInfo: DoclingPageInfo,
  index: number,
  readingOrder: number,
  opts: MapOptions,
): RawImportBlock | null {
  const prov = pickProv(item.prov, pageInfo.page_no);
  if (!prov) return null;
  const bbox = bboxToTopLeft(prov.bbox, pageInfo.size.height);
  if (bbox.width <= 0 || bbox.height <= 0) return null;
  const paths = (item.paths ?? []).filter((p) => typeof p?.d === 'string' && p.d.trim().length > 0);
  if (!paths.length) return null;
  // viewBox defaults to the item bbox so the SVG paths (page-point coords) align
  // with the overlay box; the sidecar normally supplies an explicit page viewBox.
  const viewBox = item.viewBox ?? `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`;
  return {
    id: blockId('vector', pageInfo.page_no, index),
    type: 'vector',
    bbox,
    // Geometry is exact, so vectors are high-confidence (stay editable in hybrid).
    confidence: typeof item.confidence === 'number' ? item.confidence : opts.defaultConfidence ?? 0.9,
    source: opts.source ?? 'detected',
    meta: {
      label: 'vector',
      readingOrder,
      vector: { viewBox, paths },
    },
  };
}

export interface MappedDoclingBlocks {
  byPage: Record<number, RawImportBlock[]>;
  all: RawImportBlock[];
  pages: DoclingPageInfo[];
  /** Phase D: document outline / TOC. */
  outline: Array<{ title: string; level: number; page_no?: number | null }>;
}

// Docling output is derived from untrusted PDFs. Keep the optional proximity
// heuristic bounded so caption-heavy documents cannot turn figure mapping into
// quadratic work on the browser's main thread. Explicit caption refs do not use
// this budget and remain authoritative.
const MAX_PROXIMITY_CAPTIONS_PER_PAGE = 256;
const MAX_PROXIMITY_CAPTION_COMPARISONS = 16_384;

export function mapDoclingToRawBlocks(
  doc: DoclingDocument,
  opts: MapOptions = {},
): MappedDoclingBlocks {
  const pages = Object.values(doc.pages ?? {}).sort((a, b) => a.page_no - b.page_no);
  const byPage: Record<number, RawImportBlock[]> = {};
  const orderCounters: Record<number, number> = {};
  for (const page of pages) {
    byPage[page.page_no] = [];
    orderCounters[page.page_no] = 0;
  }

  const nextOrder = (pageNo: number): number => {
    const n = orderCounters[pageNo] ?? 0;
    orderCounters[pageNo] = n + 1;
    return n;
  };

  // --- Text items: iterate in document order so reading order is preserved.
  // Contiguous list_item runs share a listGroupId.
  // Phase B: track text blocks by self_ref so figures/tables can link captions.
  const textBlocksBySelfRef = new Map<string, RawImportBlock>();
  /** Per-page caption pool keyed for proximity fallback. */
  const captionPool: Record<number, Array<{ block: RawImportBlock; text: DoclingTextItem }>> = {};
  let textIdx = 0;
  let activeListPage: number | null = null;
  let activeListId: string | null = null;
  let listSeq = 0;
  for (const text of doc.texts ?? []) {
    const prov = pickProv(text.prov, text.prov?.[0]?.page_no ?? 0);
    if (!prov) { textIdx += 1; continue; }
    const page = pages.find((p) => p.page_no === prov.page_no);
    if (!page) { textIdx += 1; continue; }

    let listGroupId: string | undefined;
    if (text.label === 'list_item') {
      if (activeListPage !== page.page_no || !activeListId) {
        listSeq += 1;
        activeListId = `docling-list-p${page.page_no}-${listSeq}`;
        activeListPage = page.page_no;
      }
      listGroupId = activeListId;
    } else {
      activeListPage = null;
      activeListId = null;
    }

    const order = typeof text.reading_order === 'number' ? text.reading_order : nextOrder(page.page_no);
    // One Docling item can reconstruct as several blocks — two fields sharing a
    // baseline are separated back out. The first is the one everything else
    // (captions, cross-references, self_ref lookups) binds to, since it holds
    // the item's leading text.
    const blocks = textItemToBlock(text, page, textIdx, order, listGroupId, opts);
    for (const extra of blocks.slice(1)) byPage[page.page_no]?.push(extra);
    const block = blocks[0];
    if (block) {
      byPage[page.page_no]?.push(block);
      if (text.self_ref) textBlocksBySelfRef.set(text.self_ref, block);
      if (text.label === 'caption') {
        const pageCaptionPool = (captionPool[page.page_no] ??= []);
        if (pageCaptionPool.length < MAX_PROXIMITY_CAPTIONS_PER_PAGE) {
          pageCaptionPool.push({ block, text });
        }
      }
    }
    textIdx += 1;
  }

  /** Resolve a figure's caption refs (or fall back to the nearest caption-labeled text). */
  const PROXIMITY_PT = 36;
  let captionGroupSeq = 0;
  let remainingProximityComparisons = MAX_PROXIMITY_CAPTION_COMPARISONS;
  function pairCaption(
    refs: Array<DoclingRef | string> | undefined,
    pageNo: number,
    figureBBox: ImportBBox,
  ): { groupId: string; text?: string } | undefined {
    // 1) explicit refs from the parser
    const explicit: RawImportBlock[] = [];
    for (const ref of refs ?? []) {
      const key = refToString(ref);
      if (!key) continue;
      const t = textBlocksBySelfRef.get(key);
      if (t && t.meta?.label === 'caption') explicit.push(t);
    }
    if (explicit.length) {
      captionGroupSeq += 1;
      const gid = `docling-figure-p${pageNo}-${captionGroupSeq}`;
      for (const t of explicit) {
        t.meta = { ...(t.meta ?? {}), groupId: gid };
      }
      // The caption's WORDS, not just the link. A figure needs alternative text
      // or it is a PDF/UA failure, and this text is the page's own description
      // of the figure — a far better answer than the classifier's "Bar chart".
      // Pairing only ever returned the group id, so nothing could reach it.
      return { groupId: gid, text: explicit.map((t) => t.text ?? '').filter(Boolean).join(' ').trim() || undefined };
    }
    // 2) proximity fallback — nearest caption above/below within PROXIMITY_PT
    const pool = captionPool[pageNo] ?? [];
    let best: { block: RawImportBlock; dist: number } | null = null;
    for (const entry of pool) {
      if (remainingProximityComparisons <= 0) break;
      remainingProximityComparisons -= 1;
      if (entry.block.meta?.groupId) continue; // already paired
      const cy = entry.block.bbox.y + entry.block.bbox.height / 2;
      const fyTop = figureBBox.y;
      const fyBot = figureBBox.y + figureBBox.height;
      const dist = cy < fyTop ? fyTop - cy : cy > fyBot ? cy - fyBot : 0;
      if (dist <= PROXIMITY_PT && (!best || dist < best.dist)) {
        best = { block: entry.block, dist };
      }
    }
    if (best) {
      captionGroupSeq += 1;
      const gid = `docling-figure-p${pageNo}-${captionGroupSeq}`;
      best.block.meta = { ...(best.block.meta ?? {}), groupId: gid };
      return { groupId: gid, text: best.block.text?.trim() || undefined };
    }
    return undefined;
  }

  // --- Tables (preserve their relative document order on each page).
  let tableIdx = 0;
  for (const table of doc.tables ?? []) {
    const prov = pickProv(table.prov, table.prov?.[0]?.page_no ?? 0);
    if (!prov) { tableIdx += 1; continue; }
    const page = pages.find((p) => p.page_no === prov.page_no);
    if (!page) { tableIdx += 1; continue; }
    const order = typeof table.reading_order === 'number' ? table.reading_order : nextOrder(page.page_no);
    const figureBBox = bboxToTopLeft(prov.bbox, page.size.height);
    const captionPair = pairCaption(table.captions, page.page_no, figureBBox);
    const block = tableItemToBlock(table, page, tableIdx, order, captionPair?.groupId, opts);
    if (block) byPage[page.page_no]?.push(block);
    tableIdx += 1;
  }

  // --- Pictures.
  let pictureIdx = 0;
  for (const picture of doc.pictures ?? []) {
    const prov = pickProv(picture.prov, picture.prov?.[0]?.page_no ?? 0);
    if (!prov) { pictureIdx += 1; continue; }
    const page = pages.find((p) => p.page_no === prov.page_no);
    if (!page) { pictureIdx += 1; continue; }
    const order = typeof picture.reading_order === 'number' ? picture.reading_order : nextOrder(page.page_no);
    const figureBBox = bboxToTopLeft(prov.bbox, page.size.height);
    const captionPair = pairCaption(picture.captions, page.page_no, figureBBox);
    const block = pictureItemToBlock(picture, page, pictureIdx, order, captionPair, opts);
    if (block) byPage[page.page_no]?.push(block);
    pictureIdx += 1;
  }

  // --- Vectors (Phase 2): geometry primitives from the PyMuPDF pass.
  let vectorIdx = 0;
  for (const vector of doc.vectors ?? []) {
    const prov = pickProv(vector.prov, vector.prov?.[0]?.page_no ?? 0);
    if (!prov) { vectorIdx += 1; continue; }
    const page = pages.find((p) => p.page_no === prov.page_no);
    if (!page) { vectorIdx += 1; continue; }
    const order = nextOrder(page.page_no);
    const block = vectorItemToBlock(vector, page, vectorIdx, order, opts);
    if (block) byPage[page.page_no]?.push(block);
    vectorIdx += 1;
  }

  // Final sort: reading order first (Docling document order), then y/x as a
  // deterministic tiebreaker for blocks without a meta index.
  for (const pageNo of Object.keys(byPage)) {
    byPage[Number(pageNo)].sort((a, b) => {
      const ao = a.meta?.readingOrder ?? Number.POSITIVE_INFINITY;
      const bo = b.meta?.readingOrder ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return (a.bbox.y - b.bbox.y) || (a.bbox.x - b.bbox.x);
    });
  }

  const all = Object.values(byPage).flat();
  // Phase D: surface document outline (TOC). Prefer sidecar-provided `doc.outline`,
  // fall back to deriving from title/section_header text items.
  const outline: MappedDoclingBlocks['outline'] = Array.isArray(doc.outline) && doc.outline.length
    ? doc.outline.map((n) => ({ title: n.title ?? '', level: n.level ?? 1, page_no: n.page_no ?? null }))
    : (doc.texts ?? [])
        .filter((t) => t.label === 'title' || t.label === 'section_header')
        .map((t) => ({
          title: t.text ?? '',
          level: t.label === 'title' ? 1 : Math.max(1, Math.min(6, Math.round(t.level ?? 2))),
          page_no: t.prov?.[0]?.page_no ?? null,
        }));
  return { byPage, all, pages, outline };
}
