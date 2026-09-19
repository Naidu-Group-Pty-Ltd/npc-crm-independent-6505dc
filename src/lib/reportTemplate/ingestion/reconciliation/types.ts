import type { ReportTemplate, Overlay } from '../../templateSchema';

export type ImportFileType = 'pdf' | 'image';
export type ImportPageSource = 'pdf-render' | 'image-normalized';
export type ImportWarningSeverity = 'info' | 'warning' | 'error';

export interface ImportWarning {
  code: string;
  message: string;
  severity: ImportWarningSeverity;
  pageId?: string;
  blockId?: string;
}

export interface ImportPage {
  id: string;
  pageIndex: number;
  width: number;
  height: number;
  referenceImageUrl: string;
  dpiScale: number;
  source: ImportPageSource;
  backgroundColor?: string;
}

export interface ImportAsset {
  fileId: string;
  fileName?: string;
  fileType: ImportFileType;
  pages: ImportPage[];
  createdAt: string;
}

// W3 — 'chart' lets the import IR carry a reconstructed chart at all. Without
// it `pictureItemToBlock` had no choice but to emit `type: 'image'` even when
// Docling had classified the picture as `bar_chart`: the class rode along in
// meta and was then dropped, so a chart could only ever become a picture.
export type RawImportBlockType = 'text' | 'image' | 'shape' | 'table' | 'formula' | 'code' | 'vector' | 'chart' | 'unknown';
export type RawImportBlockSource = 'pdf-text' | 'ocr' | 'vision' | 'detected' | 'dom';

export interface ImportBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawImportBlock {
  id: string;
  type: RawImportBlockType;
  text?: string;
  bbox: ImportBBox;
  style?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number | 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    color?: string;
    backgroundColor?: string;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    /** Phase 2: real typography from the PyMuPDF span pass. */
    lineHeight?: number;     // multiplier
    letterSpacing?: number;  // pt
  };
  confidence: number;
  source: RawImportBlockSource;
  /**
   * Optional structural metadata preserved from the parser (Docling, etc).
   * Consumers may use it to build richer overlays without re-inferring structure.
   */
  meta?: {
    /** Original semantic label (e.g. 'title', 'section_header', 'list_item'). */
    label?: string;
    /** Heading depth 1–6 when label is a heading. */
    headingLevel?: number;
    /** Stable id grouping contiguous list_items into a single visual list. */
    listGroupId?: string;
    /** Monotonic reading-order index within the page (Docling document order). */
    readingOrder?: number;
    /**
     * W3 — a reconstructed chart, present only when the sidecar extracted
     * series AND `chartArbitration` cleared it for native rendering. Absent
     * means the chart stays a source crop, which is the safe default and by far
     * the common case.
     */
    chartData?: {
      chartKind: string;
      series: Array<{ label: string; value: number; color?: string }>;
      title?: string;
      renderMode: string;
      defects: string[];
      manualReviewRequired: boolean;
      sourceCropUrl?: string;
      sourceRegionId?: string;
      axisScaleR2?: number;
      detectionMethod?: string;
    };
    /** Parsed table cell grid — row-major strings, plus the header row count. */
    tableData?: {
      rows: string[][];
      headerRows: number;
      numRows: number;
      numCols: number;
      cells?: Array<{
        text: string;
        row: number;
        col: number;
        rowSpan: number;
        colSpan: number;
        columnHeader?: boolean;
        rowHeader?: boolean;
      }>;
    };
    /** Caption text linked to this image/table item (when the parser provides it). */
    caption?: string;
    /** The paired caption's WORDS — Docling states a caption by reference. */
    captionText?: string;
    /**
     * Chart-likeness decided from the page's own geometry. Detection only: it
     * never carries a value read off the chart.
     */
    chartCandidate?: import('../../pdfImport/chartCandidate.pure').ChartCandidate;
    /** Phase B: VLM-generated alt-text/description for images. */
    altText?: string;
    /** Phase B: picture classifier label (e.g. chart, logo, photo, diagram, map). */
    pictureClass?: string;
    /** Phase B: stable group id for caption↔figure / header↔footer co-movement. */
    groupId?: string;
    /** Phase B: master-page eligibility — 'header' or 'footer'. */
    pageRegion?: 'header' | 'footer';
    /** Phase D: LaTeX representation for `formula` blocks. */
    latex?: string;
    /** Phase D: detected language for `code` blocks (python, sql, …). */
    codeLanguage?: string;
    /** Phase D: data URI / storage URI for the extracted picture crop. */
    imageUri?: string;
    /** Wave F3: diagnostics-bucket object path for the extracted picture crop. */
    imageDiagnosticsPath?: string;
    /** Phase D: BCP-47 language detected for this block. */
    language?: string;
    /** Phase D: cross-reference target ($ref form). */
    xref?: string;
    /**
     * Lines the SOURCE actually drew inside this block's box
     * (`source_measure.lineCount` — a count from PyMuPDF, not an inference).
     *
     * The extractor joins a multi-line paragraph's lines with a SPACE, so the
     * string alone cannot say whether the source wrapped. This can, and it is
     * what decides `whiteSpace: 'nowrap'` — see resolveTextWrapping.pure.ts.
     */
    sourceLineCount?: number;
    /**
     * Distinct baselines among those lines (`source-measure-v2`).
     *
     * `sourceLineCount` counts line RECORDS, and two runs set side by side on
     * one baseline are two records. This counts rows, which is what "did the
     * source wrap here" actually asks.
     */
    sourceBaselineCount?: number;
    /**
     * Baseline of the FIRST source line, in page points (`source-measure-v2`).
     *
     * The box's top is the top of the INK; CSS puts the first baseline a full
     * ascent plus half-leading below the box top, which is lower. This is the
     * one number that lets the two be reconciled without guessing a cap height.
     */
    sourceFirstBaselineY?: number;
    /** Phase 3: original source PostScript font name (pre-resolution). */
    sourceFont?: string;
    /** Phase 3: true when the source font was not catalog-known and was substituted. */
    fontSubstituted?: boolean;
    /**
     * True when the extracted text contained `GLYPH<n>` extraction artifacts
     * (fonts without a usable ToUnicode map). The tokens are stripped from the
     * overlay text; confidence is capped so hybrid mode keeps the block locked.
     */
    glyphArtifacts?: boolean;
    /** Phase 2: vector geometry for `vector` blocks (SVG paths + viewBox). */
    vector?: {
      viewBox: string;
      paths: Array<{
        d: string;
        fill?: string;
        stroke?: string;
        strokeWidth?: number;
        fillRule?: 'nonzero' | 'evenodd';
        opacity?: number;
      }>;
    };
  };
}


export interface RawImportManifest {
  importId: string;
  page: {
    id: string;
    pageIndex: number;
    width: number;
    height: number;
    backgroundColor?: string;
    referenceImageUrl: string;
    dpiScale: number;
  };
  palette: string[];
  rawBlocks: RawImportBlock[];
  extractionSummary: {
    hasPdfTextLayer: boolean;
    hasOcrTextLayer: boolean;
    hasEmbeddedImages: boolean;
    blockCount: number;
    textBlockCount: number;
    imageBlockCount: number;
  };
  warnings: ImportWarning[];
}

export interface TypographyRole {
  id: string;
  role: 'title' | 'heading' | 'subheading' | 'body' | 'caption' | 'label' | 'unknown';
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  color?: string;
}

export interface VisionSection {
  id: string;
  role: 'hero' | 'header' | 'footer' | 'kpi-card' | 'body' | 'table' | 'map' | 'decorative' | 'unknown';
  bbox: ImportBBox;
  confidence: number;
  rawBlockIds?: string[];
}

export interface VisionLayoutAnalysis {
  pageId: string;
  pageType: 'cover' | 'market_summary' | 'suburb_analysis' | 'cashflow' | 'appendix' | 'unknown';
  sections: VisionSection[];
  designSystem: {
    palette: string[];
    typographyRoles: TypographyRole[];
    spacingStyle: 'tight' | 'balanced' | 'luxury' | 'unknown';
  };
  recommendations: {
    keepAsBackground: string[];
    makeEditable: string[];
    needsManualReview: string[];
  };
  confidence: number;
}

export interface TemplateImportPagePlan {
  id: string;
  name: string;
  width: number;
  height: number;
  background: {
    color?: string;
    imageUrl: string;
    opacity?: number;
    /** Sizing for the background image; 'fill' for full-page source rasters. */
    imageFit?: 'cover' | 'contain' | 'fill';
    /**
     * Editor-only reference underlay (hybrid PDF import): the source raster is
     * an alignment backdrop for the canvas and must NOT appear in preview/
     * print/export renders — the overlays are the deliverable.
     */
    underlay?: boolean;
  };
  overlays: Overlay[];
  sourcePageId: string;
  warnings: ImportWarning[];
}

export interface TemplateImportPlan {
  version: 1;
  importId: string;
  pages: TemplateImportPagePlan[];
  /**
   * The design system measured FROM this import — the source's own palette and
   * typefaces, weighted by glyph count and painted area.
   *
   * Until this field existed an import shipped `{ colors: {}, fonts: {} }` and
   * every overlay carried a literal, so a reconstructed template could not be
   * restyled at all. `applyTemplateImportPlan` merges these under any base
   * template's tokens and binds the overlays that match — see
   * `pdfImport/designSystemBinding.pure.ts` for why the match must be exact.
   */
  tokens?: { colors?: Record<string, string>; fonts?: Record<string, string> };
  warnings: ImportWarning[];
  confidenceScore: number;
  importSummary: {
    visualFidelityMode: 'background-first' | 'hybrid' | 'semantic';
    editableElementsCreated: number;
    manualReviewRequired: boolean;
    repairPassesApplied: number;
  };
}

export interface PlanValidationResult {
  ok: boolean;
  errors: string[];
  warnings: ImportWarning[];
}

export interface ParserQualitySummary {
  engine?: string;
  engineVersion?: string | null;
  textChars?: number;
  ocrChars?: number;
  ocrPages?: number[];
  totalPages?: number;
  ocrRatio?: number | null;
  avgTextConfidence?: number | null;
  tableCount?: number;
  pictureCount?: number;
  lowConfidencePages?: Array<{ pageNo: number; avgTextConfidence: number }>;
}

export interface ReconciliationRequest {
  importAsset: ImportAsset;
  manifests: RawImportManifest[];
  vision?: VisionLayoutAnalysis[];
  existingTemplate?: ReportTemplate;
  constraints?: Record<string, unknown>;
  /** Wave F4: parser quality roll-up (Docling summary) used by AI reconciliation. */
  parserSummary?: ParserQualitySummary;
}

export type TemplateImportPatch =
  | {
      operation: 'updatePageBackground';
      pageId: string;
      changes: { color?: string; imageUrl?: string; opacity?: number };
    }
  | {
      operation: 'updateOverlay';
      pageId: string;
      blockId: string;
      overlayId: string;
      changes: Partial<Overlay>;
    }
  | {
      operation: 'addOverlay';
      pageId: string;
      blockId: string;
      overlay: Overlay;
    }
  | {
      operation: 'removeOverlay';
      pageId: string;
      blockId: string;
      overlayId: string;
      reason: string;
    };
