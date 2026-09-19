/**
 * Typed view of the slice of Docling `DoclingDocument` JSON we consume.
 *
 * Docling emits a much richer schema; we intentionally narrow it to the fields
 * the adapter needs. Unknown fields are preserved as `unknown` so we don't
 * break if Docling adds new properties between versions.
 *
 * Reference: https://github.com/docling-project/docling/blob/main/docling_core/types/doc/document.py
 */

export type DoclingCoordOrigin = 'TOPLEFT' | 'BOTTOMLEFT';

export interface DoclingBBox {
  l: number;
  t: number;
  r: number;
  b: number;
  coord_origin?: DoclingCoordOrigin;
}

export interface DoclingProvenance {
  page_no: number;
  bbox: DoclingBBox;
  charspan?: [number, number];
}

export type DoclingTextLabel =
  | 'title'
  | 'section_header'
  | 'paragraph'
  | 'text'
  | 'caption'
  | 'list_item'
  | 'footnote'
  | 'page_header'
  | 'page_footer'
  | 'code'
  | 'formula'
  | 'equation'
  | string;

export interface DoclingTextItem {
  self_ref?: string;
  label?: DoclingTextLabel;
  text: string;
  prov?: DoclingProvenance[];
  /** Heading depth (1–6) when label is `section_header` / `title`. */
  level?: number;
  /** Some Docling versions emit per-item font hints. */
  font?: {
    family?: string;
    size?: number;
    weight?: number | string;
    color?: string;
    italic?: boolean;
    /** Phase 2: real typography metrics reconciled from the PyMuPDF span pass. */
    line_height?: number;     // multiplier (line advance ÷ font size)
    letter_spacing?: number;  // pt
  };
  /** Phase 2: text alignment inferred from span x-extents (PyMuPDF pass). */
  text_align?: 'left' | 'center' | 'right' | 'justify';
  /**
   * W1 — the measurement the client cannot make for itself: how much space this
   * text occupies in the SOURCE's own font, per line, with per-span extents.
   * Span char-counts double as WORD-BOUNDARY evidence for tracked (letter-
   * spaced) text, where the extracted string has lost its word gaps.
   */
  source_measure?: {
    version?: string;
    lineCount?: number;
    measuredWidthPt?: number;
    totalCharCount?: number;
    lines?: Array<{
      widthPt?: number;
      charCount?: number;
      sizePt?: number;
      /** source-measure-v2. Where the line sits; absent on v1 artifacts. */
      x0Pt?: number;
      x1Pt?: number;
      baselineYPt?: number;
      spans?: Array<{ width?: number; chars?: number; size?: number; font?: string }>;
    }>;
  };
  confidence?: number;
  /** Docling reading-order model index; lower values should be read first. */
  reading_order?: number;
  /** Phase D: LaTeX representation produced by the formula enrichment model. */
  latex?: string;
  equation?: string;
  /** Phase D: detected code language. */
  code_language?: string;
  language?: string;
  /** Phase D: explicit cross-references (figure refs, section refs). */
  refs?: Array<DoclingRef | string>;
}

export interface DoclingTableCell {
  text: string;
  row_span?: number;
  col_span?: number;
  start_row_offset_idx?: number;
  end_row_offset_idx?: number;
  start_col_offset_idx?: number;
  end_col_offset_idx?: number;
  column_header?: boolean;
  row_header?: boolean;
}

export interface DoclingTableData {
  num_rows: number;
  num_cols: number;
  table_cells?: DoclingTableCell[];
  grid?: DoclingTableCell[][];
}

export interface DoclingTableItem {
  self_ref?: string;
  prov?: DoclingProvenance[];
  data: DoclingTableData;
  caption?: string;
  /** Refs to caption text items linked by the parser. */
  captions?: Array<DoclingRef | string>;
  confidence?: number;
  reading_order?: number;
}

export interface DoclingPictureClassification {
  predicted_class?: string;
  /** Some Docling builds emit `predicted_classes: [{class_name, confidence}, …]`. */
  predicted_classes?: Array<{ class_name?: string; confidence?: number }>;
  confidence?: number;
}

export interface DoclingPictureAnnotation {
  /** e.g. 'description' (SmolVLM caption), 'classification'. */
  kind?: string;
  text?: string;
  provenance?: string; // model name
  confidence?: number;
}

export interface DoclingRef {
  $ref?: string;
  cref?: string;
}

export interface DoclingPictureItem {
  self_ref?: string;
  prov?: DoclingProvenance[];
  /** Storage path or data URI for the extracted image, when present. */
  image?: { uri?: string; diagnostics_path?: string; mimetype?: string; size?: { width: number; height: number } };
  caption?: string;
  /** Refs to caption text items (Docling links captions explicitly when it can). */
  captions?: Array<DoclingRef | string>;
  /** Phase B: picture classifier output (chart, logo, photo, diagram, etc). */
  classification?: DoclingPictureClassification;
  /** Phase B: VLM-generated annotations (alt-text / description). */
  annotations?: DoclingPictureAnnotation[];
  confidence?: number;
  reading_order?: number;
}

/**
 * Phase 2: a vector-graphic primitive extracted by the PyMuPDF (`fitz`) pass.
 * Page-scoped via `prov[].page_no`; geometry is in PDF points, top-left origin
 * (matching the overlay convention). One item ≈ one Docling "drawing" and may
 * contain several sub-paths (lines/curves/rects) sharing fill/stroke.
 */
export interface DoclingVectorPath {
  d: string;                                   // SVG path data
  fill?: string;                               // hex or 'none'
  stroke?: string;                             // hex or 'none'
  strokeWidth?: number;                        // pt
  fillRule?: 'nonzero' | 'evenodd';
  opacity?: number;
  /** Phase 6E — stroke styling from the fitz drawing dict. */
  strokeDasharray?: string;                    // e.g. "3 2" (omitted = solid)
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
}

export interface DoclingVectorItem {
  self_ref?: string;
  prov?: DoclingProvenance[];
  /** SVG viewBox in page points, e.g. "0 0 595 842". */
  viewBox?: string;
  paths: DoclingVectorPath[];
  confidence?: number;
}

/**
 * Phase 3: a document font surfaced by the PyMuPDF pass. `base64` is present
 * only when the program is safely reusable as `@font-face`: a font whose cmap
 * coverage was read (subset or full — `coverage_ranges` carries it, and the
 * face must be scoped by `unicode-range` to exactly those codepoints), or a
 * full font whose coverage was unreadable. A subset with unreadable coverage
 * never embeds — an unscoped face claims codepoints it lacks. Name-only fonts
 * are matched to a web font via the catalog.
 */
export interface DoclingEmbeddedFont {
  basename: string;         // tag-stripped font name, e.g. "Unbounded-Bold"
  psName?: string;          // raw name incl. subset tag, e.g. "ABCDEF+Unbounded-Bold"
  ext?: string;             // 'ttf' | 'otf' | ...
  mimetype?: string;        // 'font/ttf' | 'font/otf'
  subset?: boolean;
  hasUnicodeCmap?: boolean;
  glyphCount?: number;
  bold?: boolean;
  italic?: boolean;
  bytes?: number;
  base64?: string;          // present only when embeddable
  /** R2: CSS unicode-range segments the font's cmap actually maps, e.g. ["U+0041-005A"]. */
  coverage_ranges?: string[];
  /**
   * B5: Unicode→glyph entries the sidecar ADDED to this program's cmap before
   * embedding it, from the PDF's own ToUnicode CMap.
   *
   * A PDF subset selects glyphs by CID, so its cmap need not be complete — and
   * a web font is looked up by Unicode, so whatever the cmap omits is
   * unreachable. Diagnostic only; the widened `coverage_ranges` above is what
   * the renderer acts on.
   */
  cmapRepairedCodepoints?: number;
  /**
   * D1: the program's own hhea metrics, in em (descender as a magnitude).
   *
   * CSS puts a line's first baseline at
   * `(lineHeight - (ascender + descender)) / 2 + ascender` below the box top,
   * so these are what let the importer place a block by its BASELINE instead of
   * by its ink top. Absent on pre-D1 sidecar payloads.
   */
  ascender?: number;
  descender?: number;
}

export interface DoclingPageSize {
  width: number;
  height: number;
}

export interface DoclingPageInfo {
  page_no: number;
  size: DoclingPageSize;
  /** Optional rasterised reference (sidecar may attach a URL when /raster ran). */
  image_uri?: string;
}

export interface DoclingSummary {
  text_chars?: number;
  ocr_chars?: number;
  ocr_pages?: number[];
  avg_text_confidence?: number | null;
  page_confidence?: Array<{ page_no: number; avg_text_confidence?: number | null; text_block_count?: number }>;
  table_count?: number;
  table_cell_count?: number;
  picture_count?: number;
  text_block_count?: number;
}

export interface DoclingDocument {
  schema_version?: string;
  origin?: { filename?: string; mimetype?: string };
  pages?: Record<string, DoclingPageInfo>;
  texts?: DoclingTextItem[];
  tables?: DoclingTableItem[];
  pictures?: DoclingPictureItem[];
  /** Phase 2: vector graphics extracted by the PyMuPDF pass. */
  vectors?: DoclingVectorItem[];
  /** Phase 3: document fonts (names + optional embeddable programs). */
  fonts?: DoclingEmbeddedFont[];
  /** Wave F4: parser quality summary surfaced to reconciliation + manual review. */
  summary?: DoclingSummary;
  /** Phase D: outline / TOC nodes (optional, surfaced via sidecar). */
  outline?: Array<{ title: string; level: number; page_no?: number | null }>;
}

/** The envelope our `pdf-parse-service /parse` endpoint returns. */
export interface DoclingParseResponse {
  engine: 'docling';
  engine_version?: string;
  pages: Array<{ page_no: number; width: number; height: number; language?: string }>;
  docling_document: DoclingDocument;
  /** Phase D extras */
  outline?: Array<{ title: string; level: number; page_no?: number | null }>;
  page_languages?: Record<number, string>;
  doctags?: string;
  markdown?: string;
  summary?: DoclingSummary;
}

/** Optional /raster sidecar envelope (one entry per page). */
export interface DoclingRasterResponse {
  format?: 'png' | 'jpeg';
  dpi: number;
  pages: Array<{
    page_no: number;
    mime?: 'image/png' | 'image/jpeg';
    width?: number;
    height?: number;
    image_base64?: string;
    width_px?: number;
    height_px?: number;
    base64?: string;
  }>;
}

/** Convenience: page-keyed lookup of rasters. */
export type DoclingRasterByPage = Record<number, { width: number; height: number; dataUrl: string }>;

// ─── Phase 3: Storage-backed raster manifest ─────────────────────────────────
// The Cloud Run sidecar now writes one PNG per page to Storage plus a single
// lightweight manifest. Template schema MUST only carry references (paths),
// never the raw page image bytes.

export interface RasterManifestPage {
  page_no: number;
  width: number;
  height: number;
  /** Storage object path inside `pdf-import-diagnostics`. */
  path: string;
  /** e.g. `image/png` */
  mime: string;
  bytes?: number;
}

export interface RasterManifest {
  /** e.g. `phase3-raster-manifest-v1` */
  version: string;
  /** `png` | `jpeg` */
  format: string;
  dpi: number;
  page_count: number;
  pages: RasterManifestPage[];
}

/**
 * Per-page raster reference embedded in `page.meta.sourceRasterRef`. Renderers
 * resolve `path` to a signed URL on demand via `getArtifactSignedUrl`.
 */
export interface PdfImportRasterRef {
  kind: 'pdf_import_raster_ref';
  jobId: string;
  manifestPath: string | null;
  pageNo: number;
  path: string;
  width: number;
  height: number;
  mime: string;
  dpi: number | null;
}

