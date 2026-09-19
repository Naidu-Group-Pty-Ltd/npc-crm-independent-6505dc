/**
 * E7 — structural validation of the ACTUAL composed output against E3/E4/E5/E6.
 *
 * E7 NEVER re-arbitrates: E3 stays authoritative for charts, E4 for tables, E5
 * for typography, E6 for composition. This module consumes their decisions
 * (as projections) plus the actual rendered evidence + region comparison
 * results, and confirms the renderer FOLLOWED them — emitting canonical
 * critical defects when it did not. Visible-text checks operate on the DOM's
 * visible text only, never CDIR / PDF text extraction.
 */
import type { RenderedPageEvidenceV1, RenderedTextEvidenceV1, RegionRenderPlanProjectionV1 } from './contracts';
import type { RegionComparisonResult } from './regionMetrics';
import { makeDefect, type CriticalQualityDefectV1 } from './criticalDefects';

// ── Projections of the upstream plans (built by the gate from E3/E4/E5/E6) ────

export interface ExpectedChartRegion {
  regionId: string; pageNumber: number;
  mode: 'chart-crop' | 'containment-fallback';
  childRegionIds: string[];
  isPicture?: boolean; isLogo?: boolean;
}
export interface ExpectedTableRegion {
  regionId: string; pageNumber: number;
  mode: 'verified-native-table' | 'table-source-crop' | 'containment-fallback' | 'blocked';
  selectedCandidateId: string | null;
  expectedRowCount: number | null; expectedColumnCount: number | null;
  hardDefectCodes: string[];
  /** true when the table used generic Column-N headers that must not appear. */
  genericHeaderGuard?: boolean;
}
export interface ExpectedTypographyRun {
  sourceRunId: string; pageNumber: number; regionId: string | null; overlayId: string | null;
  mode: 'verified-native-text' | 'source-text-crop' | 'containment-fallback' | 'blocked';
  /** Numeric tokens that MUST appear exactly in visible text (e.g. "$920,000"). */
  criticalTokens: string[];
  /** Punctuation/glyph sequences that MUST appear (e.g. "10–15", "8×8", "−$25,000"). */
  criticalPunctuation: string[];
  /** Sequences whose PRESENCE indicates a fused/altered token (e.g. "1015"). */
  forbiddenFusions: string[];
  expectedLineCount: number | null;
  hardDefectCodes: string[];
}

export interface TableRenderObservation { regionId: string; visibleRowCount: number | null; visibleColumnCount: number | null; genericHeaderVisible: boolean }

export interface StructuralValidationInput {
  pageId: string; pageNumber: number;
  evidence: RenderedPageEvidenceV1;
  regionResults: RegionComparisonResult[];
  charts: ExpectedChartRegion[];
  tables: ExpectedTableRegion[];
  typography: ExpectedTypographyRun[];
  tableObservations?: TableRenderObservation[];
  regionPlan: RegionRenderPlanProjectionV1 | null;
}

function regionResult(results: RegionComparisonResult[], regionId: string): RegionComparisonResult | undefined {
  return results.find((r) => r.regionId === regionId);
}
function visibleText(nodes: RenderedTextEvidenceV1[], predicate: (n: RenderedTextEvidenceV1) => boolean): string {
  return nodes.filter((n) => n.visible && !n.hiddenSemantic && predicate(n)).map((n) => n.rawVisibleText).join(' ');
}

// ── E3 chart / picture ───────────────────────────────────────────────────────

export function validateChartComposition(input: StructuralValidationInput): CriticalQualityDefectV1[] {
  const out: CriticalQualityDefectV1[] = [];
  const ev = input.evidence;
  for (const chart of input.charts) {
    const kindMissing = chart.isPicture ? 'picture_region_missing' : chart.isLogo ? 'logo_region_missing' : 'chart_region_missing';
    const kindBlank = chart.isPicture ? 'picture_crop_blank' : 'chart_crop_blank';
    const kindDup = chart.isPicture ? 'picture_region_duplicated' : 'chart_region_duplicated';
    const base = { pageId: input.pageId, pageNumber: input.pageNumber, regionId: chart.regionId, scope: 'region' as const };
    if (chart.mode === 'containment-fallback') continue; // page fallback owns it (E0)
    const rr = regionResult(input.regionResults, chart.regionId);
    if (!rr || !rr.scored) { out.push(makeDefect({ code: 'source_region_unscored', ...base, reason: 'chart region could not be evaluated' })); continue; }
    if (!ev.visibleRegionIds.includes(chart.regionId) && !ev.visibleCropRegionIds.includes(chart.regionId)) {
      out.push(makeDefect({ code: kindMissing, ...base, reason: 'expected chart/picture not visible in output' }));
      continue;
    }
    if (rr.blank || (rr.foregroundRecall != null && rr.foregroundRecall < 0.5)) {
      out.push(makeDefect({ code: kindBlank, ...base, metric: 'foregroundRecall', observed: rr.foregroundRecall, threshold: 0.5, reason: 'chart/picture region blank or foreground lost' }));
    }
    if (rr.representationCount > 1) out.push(makeDefect({ code: kindDup, ...base, observed: rr.representationCount, reason: 'chart/picture rendered more than once' }));
    // Detached/duplicated child labels rendered as native text over a chart crop.
    if (chart.mode === 'chart-crop') {
      for (const childId of chart.childRegionIds) {
        if (ev.visibleRegionIds.includes(childId)) {
          out.push(makeDefect({ code: 'chart_child_duplicate', ...base, regionId: childId, reason: 'chart child label duplicated over crop' }));
        }
      }
    }
  }
  return out;
}

// ── E4 tables ─────────────────────────────────────────────────────────────────

export function validateTableComposition(input: StructuralValidationInput): CriticalQualityDefectV1[] {
  const out: CriticalQualityDefectV1[] = [];
  const ev = input.evidence;
  const obsById = new Map((input.tableObservations ?? []).map((o) => [o.regionId, o]));
  for (const table of input.tables) {
    const base = { pageId: input.pageId, pageNumber: input.pageNumber, regionId: table.regionId, scope: 'region' as const };
    // E4 hard defects are authoritative — carry them into the composition report.
    for (const code of table.hardDefectCodes) out.push(makeDefect({ code: mapTableDefect(code), ...base, reason: `E4 table hard defect: ${code}` }));
    if (table.mode === 'containment-fallback') continue;
    if (table.mode === 'blocked') { out.push(makeDefect({ code: 'table_region_missing', ...base, reason: 'E4 blocked table has no safe output' })); continue; }
    const rr = regionResult(input.regionResults, table.regionId);
    if (!rr || !rr.scored) { out.push(makeDefect({ code: 'source_region_unscored', ...base, reason: 'table region could not be evaluated' })); continue; }
    const visible = ev.visibleRegionIds.includes(table.regionId) || ev.visibleCropRegionIds.includes(table.regionId);
    if (!visible) { out.push(makeDefect({ code: 'table_region_missing', ...base, reason: 'expected table not visible' })); continue; }
    const obs = obsById.get(table.regionId);
    if (table.mode === 'verified-native-table') {
      if (obs) {
        if (table.expectedRowCount != null && obs.visibleRowCount != null && obs.visibleRowCount < table.expectedRowCount) {
          out.push(makeDefect({ code: 'table_row_missing', ...base, metric: 'visibleRowCount', observed: obs.visibleRowCount, threshold: table.expectedRowCount, reason: 'visible table rows fewer than source' }));
        }
        if (table.expectedColumnCount != null && obs.visibleColumnCount != null && obs.visibleColumnCount < table.expectedColumnCount) {
          out.push(makeDefect({ code: 'table_column_missing', ...base, observed: obs.visibleColumnCount, threshold: table.expectedColumnCount, reason: 'visible table columns fewer than source' }));
        }
        if (table.genericHeaderGuard && obs.genericHeaderVisible) {
          out.push(makeDefect({ code: 'table_generic_header_visible', ...base, reason: 'generic Column-N header visible instead of source header' }));
        }
      }
      // native table AND a source crop both visible => duplicate.
      if (ev.visibleCropRegionIds.includes(table.regionId) && ev.visibleRegionIds.includes(table.regionId)) {
        out.push(makeDefect({ code: 'table_native_crop_duplicate', ...base, reason: 'native table and source crop both visible' }));
      }
    }
    if (rr.representationCount > 1) out.push(makeDefect({ code: 'table_native_crop_duplicate', ...base, observed: rr.representationCount, reason: 'table rendered more than once' }));
  }
  return out;
}

function mapTableDefect(code: string): CriticalQualityDefectV1['code'] {
  const known = new Set(['table_topology_mismatch', 'table_cell_association_error', 'table_row_missing', 'table_column_missing', 'table_row_clipped', 'table_cell_clipped', 'table_generic_header_visible']);
  return (known.has(code) ? code : 'table_topology_mismatch') as CriticalQualityDefectV1['code'];
}

// ── E5 typography ─────────────────────────────────────────────────────────────

export function validateTypographyComposition(input: StructuralValidationInput): CriticalQualityDefectV1[] {
  const out: CriticalQualityDefectV1[] = [];
  const ev = input.evidence;
  for (const run of input.typography) {
    const base = { pageId: input.pageId, pageNumber: input.pageNumber, regionId: run.regionId, sourceRunId: run.sourceRunId, scope: 'text-run' as const };
    for (const code of run.hardDefectCodes) out.push(makeDefect({ code: mapTypographyDefect(code), ...base, reason: `E5 hard defect: ${code}` }));
    if (run.mode === 'containment-fallback') continue;
    if (run.mode === 'blocked') { out.push(makeDefect({ code: 'critical_numeric_token_missing', ...base, reason: 'E5 blocked run has no safe output' })); continue; }

    if (run.mode === 'source-text-crop') {
      const rr = regionResult(input.regionResults, run.regionId ?? run.sourceRunId);
      if (rr && rr.blank) out.push(makeDefect({ code: 'typography_crop_blank', ...base, reason: 'source-text crop blank' }));
      // native overlay must be suppressed behind the crop.
      if (run.overlayId && ev.visibleOverlayIds.includes(run.overlayId)) {
        out.push(makeDefect({ code: 'typography_native_crop_duplicate', ...base, overlayId: run.overlayId, reason: 'native text visible over its own crop' }));
      }
      continue;
    }

    // verified-native-text: check the ACTUAL visible text.
    const runText = visibleText(ev.textNodes, (n) => (run.overlayId != null && n.overlayId === run.overlayId) || n.sourceRunIds.includes(run.sourceRunId));
    // clipping / off-page on the run's own node.
    const node = ev.textNodes.find((n) => n.overlayId === run.overlayId || n.sourceRunIds.includes(run.sourceRunId));
    if (node) {
      if (node.clipped) out.push(makeDefect({ code: 'text_clipped', ...base, reason: 'critical text clipped' }));
      if (node.offPage) out.push(makeDefect({ code: 'glyph_off_page', ...base, reason: 'critical glyph off page' }));
      if (node.contrastRatio != null && node.contrastRatio < 3.0) out.push(makeDefect({ code: 'unreadable_contrast', ...base, metric: 'contrastRatio', observed: node.contrastRatio, threshold: 3.0, reason: 'critical text unreadable contrast' }));
      if (run.expectedLineCount != null && node.lineRectsPx.length > 0 && node.lineRectsPx.length !== run.expectedLineCount) {
        out.push(makeDefect({ code: 'source_line_count_changed', ...base, observed: node.lineRectsPx.length, threshold: run.expectedLineCount, reason: 'fixed-layout line count changed' }));
      }
    }
    for (const token of run.criticalTokens) {
      if (!runText.includes(token)) out.push(makeDefect({ code: 'critical_numeric_token_missing', ...base, observed: false, reason: 'critical numeric token not visible' }));
    }
    for (const punct of run.criticalPunctuation) {
      if (!runText.includes(punct)) out.push(makeDefect({ code: classifyPunctuation(punct), ...base, reason: 'critical punctuation/glyph not visible' }));
    }
    for (const fusion of run.forbiddenFusions) {
      if (runText.includes(fusion)) out.push(makeDefect({ code: 'range_separator_missing', ...base, observed: fusion, reason: 'numeric range fused (separator lost)' }));
    }
  }
  return out;
}

function mapTypographyDefect(code: string): CriticalQualityDefectV1['code'] {
  const known = new Set(['critical_numeric_token_missing', 'critical_numeric_token_changed', 'critical_numeric_token_wrong_region', 'critical_punctuation_missing', 'critical_punctuation_changed', 'range_separator_missing', 'currency_symbol_missing', 'percentage_symbol_missing', 'multiplication_sign_changed', 'minus_sign_changed', 'text_clipped', 'glyph_off_page', 'source_line_count_changed']);
  return (known.has(code) ? code : 'critical_punctuation_changed') as CriticalQualityDefectV1['code'];
}
function classifyPunctuation(p: string): CriticalQualityDefectV1['code'] {
  if (p.includes('×')) return 'multiplication_sign_changed';
  if (p.includes('−')) return 'minus_sign_changed';
  if (p.includes('%')) return 'percentage_symbol_missing';
  if (/[$£€]/.test(p)) return 'currency_symbol_missing';
  if (/[–—]/.test(p)) return 'range_separator_missing';
  return 'critical_punctuation_missing';
}

// ── E6 composition ───────────────────────────────────────────────────────────

export function validateE6Composition(input: StructuralValidationInput): CriticalQualityDefectV1[] {
  const out: CriticalQualityDefectV1[] = [];
  const ev = input.evidence; const plan = input.regionPlan;
  const base = { pageId: input.pageId, pageNumber: input.pageNumber, scope: 'page' as const };
  if (!plan) { out.push(makeDefect({ code: 'composition_unscored', ...base, reason: 'no E6 render plan available for page' })); return out; }
  // 1. render-plan hash must match what the renderer stamped.
  if (ev.renderPlanHash == null) out.push(makeDefect({ code: 'composition_unscored', ...base, reason: 'renderer did not stamp a plan hash' }));
  else if (ev.renderPlanHash !== plan.renderPlanHash) out.push(makeDefect({ code: 'renderer_plan_mismatch', ...base, observed: ev.renderPlanHash, threshold: plan.renderPlanHash, reason: 'output plan hash differs from E6 plan' }));
  // 2. suppressed overlays must be absent.
  for (const id of plan.suppressedOverlayIds) if (ev.visibleOverlayIds.includes(id)) out.push(makeDefect({ code: 'crop_and_native_both_visible', ...base, overlayId: id, scope: 'overlay', reason: 'suppressed overlay is visible' }));
  // 3. hidden semantics must not be visually painted.
  for (const id of plan.hiddenSemanticRegionIds) if (ev.visibleRegionIds.includes(id)) out.push(makeDefect({ code: 'hidden_semantic_visible', ...base, regionId: id, scope: 'region', reason: 'hidden-semantic region visibly painted' }));
  // 4. editor-reference crops must not appear in final output.
  for (const id of ev.editorReferenceRegionIds) out.push(makeDefect({ code: 'editor_reference_visible_in_final', ...base, regionId: id, scope: 'region', reason: 'editor-reference crop visible in final output' }));
  // 5. final region crops must be present + loaded + non-blank.
  for (const crop of plan.finalRegionCrops) {
    const asset = ev.regionAssets.find((a) => a.regionId === crop.regionId);
    if (!asset || asset.state === 'missing') out.push(makeDefect({ code: 'region_crop_asset_missing', ...base, regionId: crop.regionId, scope: 'region', reason: 'final region crop asset missing' }));
    else if (asset.state === 'invalid' || asset.state === 'expired') out.push(makeDefect({ code: 'region_crop_asset_invalid', ...base, regionId: crop.regionId, scope: 'region', reason: 'final region crop asset invalid/expired' }));
    const rr = regionResult(input.regionResults, crop.regionId);
    if (rr && rr.blank) out.push(makeDefect({ code: 'final_output_blank_region', ...base, regionId: crop.regionId, scope: 'region', reason: 'final region crop blank' }));
  }
  // 6. duplicate source pixels: any region represented more than once.
  for (const rr of input.regionResults) if (rr.representationCount > 1) out.push(makeDefect({ code: 'duplicate_source_pixels', ...base, regionId: rr.regionId, scope: 'region', observed: rr.representationCount, reason: 'source region represented more than once' }));
  // 7. page raster present when required.
  if (plan.renderFullPageRaster && ev.fullPageRasterState !== 'ready') out.push(makeDefect({ code: 'page_raster_missing', ...base, reason: 'required page raster not ready' }));
  return out;
}

// ── Top-level ─────────────────────────────────────────────────────────────────

export function validateStructural(input: StructuralValidationInput): CriticalQualityDefectV1[] {
  return [
    ...validateChartComposition(input),
    ...validateTableComposition(input),
    ...validateTypographyComposition(input),
    ...validateE6Composition(input),
  ];
}
