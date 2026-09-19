/**
 * Convert mapped Docling blocks → TemplateImportPagePlan[] (the contract the
 * existing reconciliation/plan validators already consume).
 *
 * Mode policy (matches the implementation plan):
 *   - 'semantic'      → no raster background; all overlays editable.
 *   - 'hybrid'        → raster page background + editable overlays for items
 *                       with confidence ≥ 0.7; lower-confidence items locked.
 *   - 'pixel-perfect' → raster background + ALL overlays locked.
 */
import type { Overlay } from '@/lib/reportTemplate/templateSchema';
import { DEFAULT_IMPORT_FONT_STACK } from '@/lib/reportTemplate/rendering/fontNormalization';

type TextOverlay = Extract<Overlay, { type: 'text' }>;
type ImageOverlay = Extract<Overlay, { type: 'image' }>;
type TableOverlay = Extract<Overlay, { type: 'table' }>;
type VectorOverlay = Extract<Overlay, { type: 'vector' }>;
import type {
  ImportWarning,
  RawImportBlock,
  TemplateImportPagePlan,
  TemplateImportPlan,
} from '@/lib/reportTemplate/ingestion/reconciliation';
import type { DoclingDocument, DoclingPageInfo, DoclingRasterByPage } from './doclingTypes';
import { mapDoclingToRawBlocks } from './mapDoclingToRawBlocks';
import { deriveNativeHeaderPolicy, TABLE_PRESERVATION_VERSION } from '../tableArbitration.pure';
import { CHART_ARBITRATION_VERSION as CHART_PRESERVATION_VERSION } from '../chartArbitration.pure';
import { matchChartToPicture, type BridgedChart } from '../sourceChartBridge.pure';
import { resolveTextWrapping } from '../resolveTextWrapping.pure';
import { alignBoxToSourceBaseline, type FontVerticalMetrics } from '../firstBaseline.pure';
import { annotateFromSource, figureAltText } from '../semanticRole.pure';
import { detectChartCandidate, chartCandidateAltText } from '../chartCandidate.pure';
import { deriveTokensFromExtraction, type FillObservation, type TextObservation } from '../tokenDerivation';
import { fontLookupKey } from '../fontResolver';

export type DoclingPlanMode = 'semantic' | 'hybrid' | 'pixel-perfect';

export interface DoclingPlanOptions {
  importId: string;
  mode: DoclingPlanMode;
  /** Per-page raster URLs (when /raster ran upstream). */
  rastersByPage?: DoclingRasterByPage;
  /** Engine version recorded in importSummary. */
  engineVersion?: string;
  /** Confidence cutoff for hybrid lock policy. */
  lockBelowConfidence?: number;
  /** Phase 3: source-font-name → embedded `@font-face` family (for full fonts). */
  embeddedFontFamilies?: Record<string, string>;
  /**
   * W3 — charts the sidecar read and arbitration cleared, keyed by page number.
   * A picture that matches one becomes an editable chart; everything else keeps
   * its existing behaviour and becomes an image.
   */
  sourceChartsByPage?: Record<number, BridgedChart[]>;
  /** R1 — width measurer for tracked-text spacing derivation (browser: canvas). */
  measureTextWidth?: import('../detrackText.pure').WidthMeasurer | null;
  /**
   * D1 — per-source-font vertical metrics, keyed the same way as
   * `embeddedFontFamilies`. Needed to place a block by its BASELINE rather than
   * by its ink top; without them the block stays where the source's box put it.
   */
  fontMetrics?: Record<string, FontVerticalMetrics>;
}

// Phase 4: lowered 0.7 → 0.6 now that reconstruction (vectors/typography/fonts) is
// faithful — default-confidence pictures (0.6) and medium-confidence text become
// editable in hybrid instead of locked. Locking only gates editing; the overlay
// still renders identically either way.
const DEFAULT_LOCK_THRESHOLD = 0.6;
const MAX_OVERLAY_NAME_LENGTH = 64;

/**
 * Promote a picture block to a chart block when the sidecar read a chart at the
 * same place on the page.
 *
 * Both bboxes are top-left, y-down, PDF points — `normalize_bbox` in the
 * sidecar and `bboxToTopLeft` in the raw-block mapper each say so — which is
 * what makes a direct geometric match valid. See sourceChartBridge.pure.ts for
 * why that is worth stating rather than assuming.
 *
 * A chart binds to at most one picture: once matched it is removed from the
 * pool, so two adjacent pictures cannot both claim the same reconstruction and
 * end up displaying identical numbers.
 */
function promotePicturesToCharts(
  blocks: RawImportBlock[],
  charts: readonly BridgedChart[],
): RawImportBlock[] {
  if (!charts.length) return blocks;
  const available = [...charts];
  return blocks.map((block) => {
    if (block.type !== 'image' || !available.length) return block;
    const match = matchChartToPicture(block.bbox, available);
    if (!match) return block;
    available.splice(available.indexOf(match), 1);
    return {
      ...block,
      type: 'chart' as const,
      meta: {
        ...(block.meta ?? {}),
        chartData: {
          chartKind: match.chartKind,
          series: match.series,
          ...(match.title ? { title: match.title } : {}),
          renderMode: match.renderMode,
          defects: match.defects,
          manualReviewRequired: match.manualReviewRequired,
          ...(match.axisScaleR2 != null ? { axisScaleR2: match.axisScaleR2 } : {}),
          ...(match.detectionMethod ? { detectionMethod: match.detectionMethod } : {}),
          sourceRegionId: match.sourceRegionId,
        },
      },
    };
  });
}

/**
 * Mark the pictures that are charts, from the page's own geometry.
 *
 * The sidecar's chart detection lives behind the source scene graph, which does
 * not run in production — 0 of 84 jobs produced one — and Docling's picture
 * classifier runs on the `design_heavy` lane only, 2 of 84 jobs. So the class
 * that would have said "this is a bar chart" is absent from essentially every
 * import, which is why 1,111 of 1,226 stored image overlays are named
 * `[image]` and **none of them carries alternative text**.
 *
 * The evidence is here regardless: vectors are extracted with exact geometry
 * (5,741 of them in production), and every axis tick and value label is a
 * measured text block. Classification costs nothing extra and needs no model.
 *
 * It classifies only. A chart's VALUES are never read — a misread number in a
 * client's financial report is this programme's stated top risk, and this
 * cannot misstate a figure because it never states one.
 */
function annotateChartCandidates(blocks: RawImportBlock[]): RawImportBlock[] {
  const pictures = blocks.filter((b) => b.type === 'image');
  if (!pictures.length) return blocks;
  const vectors = blocks
    .filter((b) => b.type === 'vector')
    .map((b) => ({ ...b.bbox, paths: (b.meta?.vector?.paths ?? []).map((p: { d?: string }) => String(p?.d ?? '')) }));
  const labels = blocks
    .filter((b) => b.type === 'text')
    .map((b) => ({ ...b.bbox, text: b.text }));
  if (!vectors.length && !labels.length) return blocks;

  return blocks.map((block) => {
    if (block.type !== 'image') return block;
    const candidate = detectChartCandidate(block.bbox, vectors, labels);
    if (!candidate) return block;
    return { ...block, meta: { ...(block.meta ?? {}), chartCandidate: candidate } };
  });
}

/** Metrics for a source font, keyed exactly as `embeddedFontFamilies` is. */
function lookupFontMetrics(
  sourceFont: string | undefined,
  metrics: Record<string, FontVerticalMetrics> | undefined,
): FontVerticalMetrics | null {
  if (!sourceFont || !metrics) return null;
  return metrics[fontLookupKey(sourceFont)] ?? null;
}

function pageId(pageNo: number): string {
  return `docling-page-${pageNo}`;
}

function overlayId(block: RawImportBlock, suffix = 'ov'): string {
  return `${block.id}-${suffix}`;
}

function blockToOverlay(
  block: RawImportBlock,
  locked: boolean,
  opts: Pick<DoclingPlanOptions, 'measureTextWidth' | 'fontMetrics'> = {},
): Overlay | null {
  // Phase B: prefer alt-text / caption for the human-readable layer label.
  // A detected chart kind comes before the raw text because that text is
  // `[image]` for 1,111 of the 1,226 image overlays in production — a layer
  // list of identical `[image]` entries is not a layer list.
  const meta = (block.meta ?? {}) as Record<string, any>;
  const chartLabel = block.type === 'image'
    ? chartCandidateAltText(meta.chartCandidate) || undefined
    : undefined;
  const rawLayerName: string =
    meta.altText || meta.caption || meta.captionText || chartLabel || block.text || block.type;
  const layerName = rawLayerName.trim().slice(0, MAX_OVERLAY_NAME_LENGTH);
  // What the source said this IS. The raw mapper already reads Docling's label
  // to pick a default size and weight; carrying it through is what lets the
  // renderer emit a heading as a heading, and lets anything downstream act on
  // meaning rather than on a box. Annotation only — it moves nothing.
  const semantics = annotateFromSource({
    label: block.meta?.label,
    headingLevel: block.meta?.headingLevel,
    readingOrder: block.meta?.readingOrder,
    listGroupId: block.meta?.listGroupId,
  });
  const base = {
    id: overlayId(block),
    x: block.bbox.x,
    y: block.bbox.y,
    width: block.bbox.width,
    height: block.bbox.height,
    rotation: 0,
    opacity: 1,
    confidence: block.confidence,
    locked,
    name: layerName,
    ...(block.meta?.groupId ? { groupId: block.meta.groupId } : {}),
    ...(semantics ? { semantics } : {}),
  } as const;

  if (block.type === 'text' || block.type === 'formula' || block.type === 'code') {
    const isCode = block.type === 'code';
    const isFormula = block.type === 'formula';
    const fontSize = block.style?.fontSize ?? 11;
    const lineHeight = block.style?.lineHeight ?? (isCode ? 1.4 : 1.3);
    const fontFamily = isCode ? 'Menlo, Consolas, monospace'
      : isFormula ? 'Times, "Times New Roman", serif'
      : (block.style?.fontFamily ?? DEFAULT_IMPORT_FONT_STACK);
    const letterSpacing = block.style?.letterSpacing ?? 0;
    // Wrapping is a fidelity decision, not a style default, and both answers
    // have a production defect behind them: text the source set on one line
    // must not gain a second (it lands on the block below), and text the
    // source set on TWO lines must not be forced onto one (it leaves the
    // page — the BC Snapshot cover title did exactly that). The source's own
    // line count settles it; see resolveTextWrapping.pure.ts.
    const wrapping = resolveTextWrapping({
      text: block.text ?? '',
      boxWidthPt: block.bbox.width,
      boxHeightPt: block.bbox.height,
      fontSizePt: fontSize,
      lineHeight,
      letterSpacingPt: letterSpacing,
      fontFamily,
      sourceLineCount: block.meta?.sourceLineCount ?? null,
      sourceBaselineCount: block.meta?.sourceBaselineCount ?? null,
      sourceAlign: block.style?.textAlign ?? null,
      measure: opts.measureTextWidth,
    });
    // D1 — place the block by its BASELINE, not by its ink top.
    //
    // The box's top is where the source's ink starts; CSS puts the first
    // baseline a full ascent plus half the leading below the box top, and
    // ascent sits well above the cap line. Every imported line therefore
    // rendered ~0.36em low — 2.5pt at 6.75pt type and 12.3pt at 34.5pt, which
    // looked like an outlier and is the same constant. Solving the renderer's
    // own formula for the box position removes it exactly; see
    // firstBaseline.pure.ts for the measurement behind the formula.
    const aligned = alignBoxToSourceBaseline(
      base.y,
      block.meta?.sourceFirstBaselineY,
      lookupFontMetrics(block.meta?.sourceFont, opts.fontMetrics),
      fontSize,
      lineHeight,
    );
    const overlay: TextOverlay = {
      ...base,
      ...(aligned ? { y: aligned.y } : {}),
      type: 'text',
      content: block.text ?? '',
      fontFamily,
      fontSize,
      // Phase 6E — preserve a numeric weight grade (e.g. 300/600 derived from the
      // source font name) instead of collapsing every weight to bold/normal.
      //
      // `fontWeight` is coerced to the coarse normal/bold enum by templateSchema,
      // so writing ONLY it loses the grade: 300 renders as 400 and 600 as 700,
      // both wider than the source inside a source-sized box. `fontWeightNumeric`
      // is the field every renderer actually prefers, so write both.
      fontWeight: (typeof block.style?.fontWeight === 'number'
        ? block.style.fontWeight
        : block.style?.fontWeight === 'bold' ? 'bold' : 'normal') as number | 'normal' | 'bold',
      ...(typeof block.style?.fontWeight === 'number'
        && block.style.fontWeight >= 100 && block.style.fontWeight <= 900
        ? { fontWeightNumeric: Math.round(block.style.fontWeight) }
        : {}),
      fontStyle: isFormula ? 'italic' : (block.style?.fontStyle ?? 'normal'),
      color: block.style?.color ?? '#111111',
      align: (block.style?.textAlign ?? 'left') as TextOverlay['align'],
      // Phase 2: prefer real leading/tracking from the PyMuPDF span pass.
      lineHeight,
      letterSpacing,
      ...(wrapping.nowrap ? { whiteSpace: 'nowrap' as const } : {}),
    } as TextOverlay;
    return overlay;
  }
  // W3 — a chart the sidecar read AND arbitration cleared. `chartData` is only
  // ever set for a native render mode; a chart that failed any hard defect
  // arrives as an image block carrying its source crop, exactly as before.
  if (block.type === 'chart' && block.meta?.chartData) {
    const c = block.meta.chartData;
    const overlay = {
      ...base,
      type: 'chart' as const,
      chartKind: c.chartKind,
      series: c.series,
      ...(c.title ? { title: c.title } : {}),
      chartPreservation: {
        version: CHART_PRESERVATION_VERSION,
        renderMode: c.renderMode,
        defects: c.defects ?? [],
        manualReviewRequired: Boolean(c.manualReviewRequired),
        ...(c.detectionMethod ? { detectionMethod: c.detectionMethod } : {}),
        // Retained even for a native chart: review needs to compare the
        // reconstruction against the pixels it was read from, and that
        // comparison is the last line of defence against a wrong number.
        ...(c.sourceCropUrl ? { sourceCropUrl: c.sourceCropUrl } : {}),
        ...(c.sourceRegionId ? { sourceRegionId: c.sourceRegionId } : {}),
        ...(c.axisScaleR2 != null ? { axisScaleR2: c.axisScaleR2 } : {}),
      },
    } as unknown as Overlay;
    return overlay;
  }
  if (block.type === 'vector' && block.meta?.vector) {
    const overlay: VectorOverlay = {
      ...base,
      type: 'vector',
      viewBox: block.meta.vector.viewBox,
      paths: block.meta.vector.paths,
    } as VectorOverlay;
    return overlay;
  }
  if (block.type === 'image') {
    // The source's own description of the picture. It was already extracted —
    // `pictureAltText` reads Docling's description annotation, and the caption
    // is resolved by ref — and then spent on the Layers-panel name and nothing
    // else, so every exported figure was a `/Figure` with no `/Alt`, which is a
    // hard PDF/UA failure in a document rendered as `pdf/ua-1`.
    const alt = figureAltText({
      altText: block.meta?.altText,
      caption: block.meta?.caption,
      captionText: block.meta?.captionText,
      // Last: a detected kind is a weak description and must never beat the
      // source's own words. It is also the only one that ever arrives — the
      // Docling `pictureClass` this used to fall back to is empty on 98% of
      // production traffic, which is why no imported figure has ever carried
      // alternative text.
      pictureClass: block.meta?.pictureClass
        ?? chartCandidateAltText(block.meta?.chartCandidate) ?? undefined,
    });
    const overlay: ImageOverlay = {
      ...base,
      type: 'image',
      // Phase D: wire embedded picture crop URI when the parser provided one.
      src: block.meta?.imageUri ?? '',
      fit: 'contain',
      ...(alt ? { alt } : {}),
    } as ImageOverlay;
    return overlay;
  }
  if (block.type === 'table') {
    const td = block.meta?.tableData;
    const numCols = td?.numCols ?? 0;
    const headerRows = td?.headerRows ?? 0;
    // E4 — SOURCE-DERIVED header policy. The mapper NO LONGER synthesizes generic
    // `Column N` labels: labels come from the source header row only (a blank stays
    // blank), and `showHeader` follows the source (a header-less table shows no
    // header rather than fabricated column titles). The sidecar arbitration +
    // preservation plan remain authoritative for native-vs-crop; this fixes the
    // visible-header defect at the reconstruction boundary.
    const headerPolicy = deriveNativeHeaderPolicy({ headerRows, numCols, rows: td?.rows ?? [] });
    const columns = Array.from({ length: numCols }, (_, i) => ({
      key: `c${i}`,
      label: headerPolicy.columnLabels[i] ?? '',
      align: 'left' as const,
      format: 'raw' as const,
    }));
    // Skip header rows from `rows` (they live in `columns.label`).
    const bodyRows = (td?.rows ?? []).slice(headerRows).map((row) => {
      const out = row.slice(0, numCols);
      while (out.length < numCols) out.push('');
      return out;
    });
    const overlay: TableOverlay = {
      ...base,
      type: 'table',
      columns,
      rows: bodyRows,
      showHeader: headerPolicy.showHeader,
      headerHeight: 22,
      rowHeight: 20,
      fontSize: block.style?.fontSize ?? 9,
      headerFontWeight: 'bold',
      borderWidth: 0.5,
      cellPadding: 6,
      fitPolicy: headerPolicy.hasSourceHeaders ? 'source-derived' : 'auto',
      // Bounded E4 audit — flags only, never source text or a URL. `renderMode`
      // is intentionally omitted here (the persisted arbitration decides it); the
      // header-safety flags let the review UI surface a generic-header risk.
      tablePreservation: {
        version: TABLE_PRESERVATION_VERSION,
        integrityState: 'unarbitrated',
        genericHeaderInSource: headerPolicy.genericHeaderInSource,
        hasSourceHeaders: headerPolicy.hasSourceHeaders,
      },
      cellSpans: (td?.cells ?? [])
        .filter((cell) => cell.rowSpan > 1 || cell.colSpan > 1)
        .map((cell) => ({
          row: cell.row - headerRows,
          col: cell.col,
          rowSpan: cell.rowSpan,
          colSpan: cell.colSpan,
        }))
        .filter((cell) => cell.row >= -1),
    } as TableOverlay;
    return overlay;
  }
  return null;
}

function pageWarnings(
  pageNo: number,
  blocks: RawImportBlock[],
  lockThreshold: number,
  doc: DoclingDocument,
): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  const pageConfidence = doc.summary?.page_confidence?.find((p) => Number(p.page_no) === pageNo);
  const avgTextConfidence = typeof pageConfidence?.avg_text_confidence === 'number'
    ? pageConfidence.avg_text_confidence
    : null;
  if (avgTextConfidence != null && avgTextConfidence < 0.6) {
    warnings.push({
      code: 'docling.page_low_text_confidence',
      severity: 'warning',
      pageId: pageId(pageNo),
      message: `Page ${pageNo} average text confidence is ${Math.round(avgTextConfidence * 100)}%; manual review is required.`,
    });
  }
  if (doc.summary?.ocr_pages?.includes(pageNo)) {
    warnings.push({
      code: 'docling.page_ocr_detected',
      severity: 'info',
      pageId: pageId(pageNo),
      message: `Page ${pageNo} used OCR text extraction; verify text fidelity against the page image.`,
    });
  }
  // Phase 3: surface non-catalog (substituted) source fonts so designers know
  // which text won't render in its original typeface.
  const substitutedFonts = Array.from(new Set(
    blocks
      .filter((b) => b.meta?.fontSubstituted && b.meta?.sourceFont)
      .map((b) => String(b.meta!.sourceFont).replace(/^[A-Z]{6}\+/, '')),
  ));
  if (substitutedFonts.length) {
    warnings.push({
      code: 'docling.font_substituted',
      severity: 'info',
      pageId: pageId(pageNo),
      message: `Page ${pageNo}: ${substitutedFonts.length} source font(s) are not available as web fonts and were substituted (${substitutedFonts.slice(0, 4).join(', ')}${substitutedFonts.length > 4 ? '…' : ''}).`,
    });
  }
  const glyphArtifactBlocks = blocks.filter((b) => b.meta?.glyphArtifacts).length;
  if (glyphArtifactBlocks > 0) {
    warnings.push({
      code: 'docling.glyph_extraction_artifacts',
      severity: 'warning',
      pageId: pageId(pageNo),
      message: `Page ${pageNo}: ${glyphArtifactBlocks} text block(s) contained GLYPH<n> extraction artifacts (font without a usable character map); the artifacts were stripped but the text needs manual review.`,
    });
  }
  // A chart shipped as a picture is a chart nobody can edit, and until now
  // nothing said so — the chart path is inert in production for four
  // independent reasons (see `chartCandidate.pure.ts`) and an import reported
  // "no charts" identically whether the document had none or the pipeline
  // never looked. Saying it per page is what turns silence into a decision.
  const chartPictures = blocks.filter((b) => b.type === 'image' && b.meta?.chartCandidate);
  if (chartPictures.length) {
    const kinds = Array.from(new Set(chartPictures.map((b) => String(b.meta!.chartCandidate.kind))));
    warnings.push({
      code: 'docling.chart_kept_as_picture',
      severity: 'info',
      pageId: pageId(pageNo),
      message: `Page ${pageNo}: ${chartPictures.length} chart(s) detected (${kinds.join(', ')}) and kept as source pictures — the reconstruction is not editable and its values are not extracted.`,
    });
  }
  const lowConf = blocks.filter((b) => b.confidence < lockThreshold).length;
  if (!blocks.length) return warnings;
  const ratio = lowConf / blocks.length;
  if (ratio >= 0.2) {
    warnings.push({
      code: 'docling.low_confidence_majority',
      severity: 'warning',
      pageId: pageId(pageNo),
      message: `Docling reported low confidence on ${Math.round(ratio * 100)}% of blocks; review the editable overlays carefully.`,
    });
  }
  return warnings;
}

function pagePlanForPage(
  page: DoclingPageInfo,
  blocks: RawImportBlock[],
  opts: DoclingPlanOptions,
  doc: DoclingDocument,
): TemplateImportPagePlan {
  const lockThreshold = opts.lockBelowConfidence ?? DEFAULT_LOCK_THRESHOLD;
  const raster = opts.rastersByPage?.[page.page_no];
  const overlays: Overlay[] = [];
  for (const block of blocks) {
    let locked: boolean;
    if (block.meta?.pageRegion) {
      // Phase B: page headers/footers always lock — they're master-page furniture
      // and shouldn't be nudged on individual pages.
      locked = true;
    } else if (opts.mode === 'pixel-perfect') locked = true;
    else if (opts.mode === 'hybrid') locked = block.confidence < lockThreshold;
    else locked = false; // semantic
    const ov = blockToOverlay(block, locked, opts);
    if (ov) overlays.push(ov);
  }
  return {
    id: pageId(page.page_no),
    name: `Page ${page.page_no}`,
    width: page.size.width,
    height: page.size.height,
    background: {
      color: '#FFFFFF',
      // Semantic output must not retain the source page raster: opacity only
      // hides it visually and render/export paths can still fetch or extract it.
      imageUrl: opts.mode === 'semantic' ? '' : raster?.dataUrl ?? page.image_uri ?? '',
      // Phase 6B — hybrid demotes the raster to a faint reference underlay (was
      // 0.85, which let the flat raster dominate and ghost the overlays); the
      // reconstruction now leads, with the raster as a dim alignment backdrop.
      // pixel-perfect keeps the full raster; semantic has none.
      opacity: opts.mode === 'pixel-perfect' ? 1 : opts.mode === 'hybrid' ? 0.5 : 0,
      // Full-page source raster must fill the exact page box, never crop/stretch.
      ...(opts.mode === 'semantic' ? {} : { imageFit: 'fill' as const }),
      // Hybrid's raster is an editor-only alignment underlay: the overlays are
      // the printable reconstruction, so preview/print/export must skip the
      // raster or every element renders twice (dim ghost + overlay).
      ...(opts.mode === 'hybrid' ? { underlay: true } : {}),
    },
    overlays,
    sourcePageId: pageId(page.page_no),
    warnings: pageWarnings(page.page_no, blocks, lockThreshold, doc),
  };
}

export function mapDoclingToPagePlan(
  doc: DoclingDocument,
  opts: DoclingPlanOptions,
): TemplateImportPlan {
  const mapped = mapDoclingToRawBlocks(doc, {
    embeddedFontFamilies: opts.embeddedFontFamilies,
    measureTextWidth: opts.measureTextWidth,
  });
  const pages: TemplateImportPagePlan[] = mapped.pages.map((page) =>
    pagePlanForPage(
      page,
      // W3 — join the sidecar's chart reads onto Docling's picture blocks here,
      // rather than inside mapDoclingToRawBlocks, so that mapper stays a pure
      // function of the Docling document and knows nothing about scene graphs.
      annotateChartCandidates(promotePicturesToCharts(
        mapped.byPage[page.page_no] ?? [],
        opts.sourceChartsByPage?.[page.page_no] ?? [],
      )),
      opts,
      doc,
    ),
  );
  const warnings: ImportWarning[] = pages.flatMap((p) => p.warnings);
  const editableElementsCreated = pages.reduce(
    (acc, p) => acc + p.overlays.filter((o) => !o.locked).length,
    0,
  );
  const lockThreshold = opts.lockBelowConfidence ?? DEFAULT_LOCK_THRESHOLD;
  const allConfidences = mapped.all.map((b) => b.confidence).filter((n) => Number.isFinite(n));
  const meanConfidence = allConfidences.length
    ? allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length
    : 0.7;
  // The design system, measured from this document rather than assumed.
  //
  // `deriveTokensFromExtraction` has always been able to read a source's real
  // palette and typefaces — it ran only on the CDIR→template direction, which
  // this path never takes, so a Docling import shipped `{ colors: {}, fonts: {} }`
  // and every overlay carried a literal. Weighting is the module's own: text
  // colours by glyph count, families by usage and size, fills by painted area.
  const textObservations: TextObservation[] = [];
  const fillObservations: FillObservation[] = [];
  for (const page of pages) {
    for (const overlay of page.overlays as Array<Record<string, unknown>>) {
      if (overlay?.type === 'text') {
        textObservations.push({
          color: typeof overlay.color === 'string' ? overlay.color : undefined,
          fontFamily: typeof overlay.fontFamily === 'string' ? overlay.fontFamily : undefined,
          fontSize: Number(overlay.fontSize) || 11,
          chars: String(overlay.content ?? '').length,
        });
      } else if (overlay?.type === 'shape' || overlay?.type === 'vector') {
        const fill = typeof overlay.fill === 'string' ? overlay.fill : null;
        const area = (Number(overlay.width) || 0) * (Number(overlay.height) || 0);
        if (fill && area > 0) fillObservations.push({ color: fill, area });
      }
    }
    if (page.background?.color) {
      fillObservations.push({
        color: page.background.color,
        area: (page.width ?? 0) * (page.height ?? 0),
      });
    }
  }
  const derivedTokens = deriveTokensFromExtraction(textObservations, fillObservations, {
    pageArea: (pages[0]?.width ?? 0) * (pages[0]?.height ?? 0) || undefined,
  });

  return {
    version: 1,
    importId: opts.importId,
    pages,
    tokens: { colors: { ...derivedTokens.colors }, fonts: { ...derivedTokens.fonts } },
    warnings,
    confidenceScore: Number(meanConfidence.toFixed(3)),
    importSummary: {
      visualFidelityMode:
        opts.mode === 'semantic' ? 'semantic' : opts.mode === 'pixel-perfect' ? 'background-first' : 'hybrid',
      editableElementsCreated,
      manualReviewRequired:
        warnings.length > 0 || mapped.all.some((b) => b.confidence < lockThreshold),
      repairPassesApplied: 0,
    },
  };
}
