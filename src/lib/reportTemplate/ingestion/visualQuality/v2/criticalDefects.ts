/**
 * E7 — Critical Quality Defects V1 + the hard-defect veto.
 *
 * ONE canonical defect shape and ONE veto layer. A weighted score can never
 * override a hard-veto defect: the gate consults `hasUnresolvedHardDefect` and
 * `assertDecisionPermitted` BEFORE it ever reads a score. Defect reasons and
 * problems are bounded and privacy-safe — never a raw source paragraph or a
 * financial value.
 */
import { CRITICAL_QUALITY_DEFECTS_VERSION } from './contracts';

export type CriticalQualityDefectCode =
  // Source & coverage
  | 'source_page_missing' | 'source_raster_missing' | 'rendered_raster_missing'
  | 'source_region_unscored' | 'page_unscored' | 'document_coverage_incomplete'
  | 'source_expectations_not_source_derived'
  // Composition (E6)
  | 'duplicate_source_pixels' | 'source_region_not_rendered' | 'unresolved_region_crop_overlap'
  | 'crop_and_native_both_visible' | 'nested_crop_both_visible' | 'hidden_semantic_visible'
  | 'editor_reference_visible_in_final' | 'renderer_plan_mismatch' | 'region_crop_asset_missing'
  | 'region_crop_asset_invalid' | 'page_raster_missing' | 'final_output_blank_region'
  | 'final_output_blank_page' | 'composition_unscored'
  // Chart / picture (E3)
  | 'chart_region_missing' | 'chart_region_duplicated' | 'chart_crop_blank' | 'chart_child_duplicate'
  | 'picture_region_missing' | 'picture_region_duplicated' | 'picture_crop_blank' | 'logo_region_missing'
  // Table (E4)
  | 'table_region_missing' | 'table_topology_mismatch' | 'table_cell_association_error'
  | 'table_row_missing' | 'table_column_missing' | 'table_row_clipped' | 'table_cell_clipped'
  | 'table_generic_header_visible' | 'table_native_crop_duplicate'
  // Typography & content (E5)
  | 'critical_numeric_token_missing' | 'critical_numeric_token_changed' | 'critical_numeric_token_wrong_region'
  | 'critical_numeric_token_duplicated' | 'critical_punctuation_missing' | 'critical_punctuation_changed'
  | 'range_separator_missing' | 'currency_symbol_missing' | 'percentage_symbol_missing'
  | 'multiplication_sign_changed' | 'minus_sign_changed' | 'text_clipped' | 'glyph_off_page'
  | 'source_line_count_changed' | 'typography_crop_blank' | 'typography_native_crop_duplicate'
  // Layout & visual
  | 'element_off_page' | 'severe_overlap' | 'material_occlusion' | 'foreground_occupancy_loss'
  | 'local_blank_region' | 'unreadable_contrast' | 'page_dimension_mismatch' | 'critical_edge_loss'
  // Export
  | 'export_page_missing' | 'export_page_count_mismatch' | 'export_dimension_mismatch'
  | 'export_preflight_failed' | 'renderer_parity_failed' | 'export_critical_region_missing' | 'export_text_clipped'
  // Security / audit
  | 'signed_url_persisted' | 'unauthorized_quality_override' | 'quality_evidence_invalid';

export type DefectSeverity = 'critical' | 'error' | 'warning';
export type DefectScope = 'document' | 'page' | 'region' | 'overlay' | 'text-run' | 'table-cell';

export interface CriticalQualityDefectV1 {
  version: typeof CRITICAL_QUALITY_DEFECTS_VERSION;
  code: CriticalQualityDefectCode;
  severity: DefectSeverity;
  scope: DefectScope;
  pageId: string | null; pageNumber: number | null;
  regionId: string | null; overlayId: string | null; sourceRunId: string | null;
  hardVeto: boolean;
  measured: boolean;
  reason: string;
  metric: string | null;
  observed: number | string | boolean | null;
  threshold: number | string | boolean | null;
  problems: string[];
}

/**
 * Codes that HARD-VETO an automatic native/mixed acceptance. A page carrying any
 * of these unresolved cannot be automatically accepted regardless of its score.
 * `warning`-severity instances of these codes do not veto (they explain).
 */
export const HARD_VETO_CODES: ReadonlySet<CriticalQualityDefectCode> = new Set<CriticalQualityDefectCode>([
  'source_page_missing', 'source_raster_missing', 'rendered_raster_missing',
  'source_region_unscored', 'page_unscored', 'document_coverage_incomplete',
  'source_expectations_not_source_derived',
  'duplicate_source_pixels', 'source_region_not_rendered', 'unresolved_region_crop_overlap',
  'crop_and_native_both_visible', 'nested_crop_both_visible', 'hidden_semantic_visible',
  'editor_reference_visible_in_final', 'renderer_plan_mismatch', 'region_crop_asset_missing',
  'region_crop_asset_invalid', 'page_raster_missing', 'final_output_blank_region',
  'final_output_blank_page', 'composition_unscored',
  'chart_region_missing', 'chart_region_duplicated', 'chart_crop_blank', 'chart_child_duplicate',
  'picture_region_missing', 'picture_region_duplicated', 'picture_crop_blank', 'logo_region_missing',
  'table_region_missing', 'table_topology_mismatch', 'table_cell_association_error',
  'table_row_missing', 'table_column_missing', 'table_row_clipped', 'table_cell_clipped',
  'table_generic_header_visible', 'table_native_crop_duplicate',
  'critical_numeric_token_missing', 'critical_numeric_token_changed', 'critical_numeric_token_wrong_region',
  'critical_numeric_token_duplicated', 'critical_punctuation_missing', 'critical_punctuation_changed',
  'range_separator_missing', 'currency_symbol_missing', 'percentage_symbol_missing',
  'multiplication_sign_changed', 'minus_sign_changed', 'text_clipped', 'glyph_off_page',
  'source_line_count_changed', 'typography_crop_blank', 'typography_native_crop_duplicate',
  'element_off_page', 'severe_overlap', 'material_occlusion', 'foreground_occupancy_loss',
  'local_blank_region', 'unreadable_contrast', 'page_dimension_mismatch', 'critical_edge_loss',
  'export_page_missing', 'export_page_count_mismatch', 'export_dimension_mismatch',
  'export_preflight_failed', 'renderer_parity_failed', 'export_critical_region_missing', 'export_text_clipped',
  'signed_url_persisted', 'unauthorized_quality_override', 'quality_evidence_invalid',
]);

export interface MakeDefectInput {
  code: CriticalQualityDefectCode;
  severity?: DefectSeverity;
  scope?: DefectScope;
  pageId?: string | null; pageNumber?: number | null;
  regionId?: string | null; overlayId?: string | null; sourceRunId?: string | null;
  measured?: boolean;
  reason?: string;
  metric?: string | null;
  observed?: number | string | boolean | null;
  threshold?: number | string | boolean | null;
  hardVeto?: boolean;
  problems?: string[];
}

/** Construct a defect. `hardVeto` defaults to (severity==='critical' && code∈HARD_VETO_CODES). */
export function makeDefect(input: MakeDefectInput): CriticalQualityDefectV1 {
  const severity: DefectSeverity = input.severity ?? 'critical';
  const hardVeto = input.hardVeto ?? (severity === 'critical' && HARD_VETO_CODES.has(input.code));
  return {
    version: CRITICAL_QUALITY_DEFECTS_VERSION,
    code: input.code,
    severity,
    scope: input.scope ?? 'page',
    pageId: input.pageId ?? null,
    pageNumber: input.pageNumber ?? null,
    regionId: input.regionId ?? null,
    overlayId: input.overlayId ?? null,
    sourceRunId: input.sourceRunId ?? null,
    hardVeto,
    measured: input.measured ?? true,
    reason: boundReason(input.reason ?? input.code),
    metric: input.metric ?? null,
    observed: input.observed ?? null,
    threshold: input.threshold ?? null,
    problems: (input.problems ?? []).slice(0, 12),
  };
}

/** Bound a reason to a short, privacy-safe string (no raw source paragraphs). */
function boundReason(reason: string): string {
  const s = String(reason ?? '').replace(/\s+/g, ' ').trim();
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

/** True when any unresolved hard-veto defect is present. */
export function hasUnresolvedHardDefect(defects: readonly CriticalQualityDefectV1[]): boolean {
  return defects.some((d) => d.hardVeto);
}

/** Count hard-veto defects. */
export function countHardDefects(defects: readonly CriticalQualityDefectV1[]): number {
  return defects.reduce((n, d) => n + (d.hardVeto ? 1 : 0), 0);
}

export type PermittedDecision =
  | 'accept-native' | 'accept-native-with-review' | 'accept-mixed' | 'accept-mixed-with-review'
  | 'accept-page-raster' | 'block-finalization' | 'manual-review'
  | 'apply-mixed-region-fallback' | 'apply-page-raster';

const AUTOMATIC_ACCEPT_DECISIONS: ReadonlySet<PermittedDecision> = new Set<PermittedDecision>([
  'accept-native', 'accept-native-with-review', 'accept-mixed', 'accept-mixed-with-review',
]);

export interface DecisionGuardResult { permitted: boolean; reason: string | null }

/**
 * Guard: a decision that automatically accepts native or mixed output is NEVER
 * permitted while an unresolved hard-veto defect is present. Page-raster and
 * blocked/manual decisions are always permitted (they are the safe outcomes).
 * page-raster acceptance additionally requires no page_raster_missing defect.
 */
export function assertDecisionPermitted(
  decision: PermittedDecision,
  defects: readonly CriticalQualityDefectV1[],
): DecisionGuardResult {
  const hard = defects.filter((d) => d.hardVeto);
  if (AUTOMATIC_ACCEPT_DECISIONS.has(decision) && hard.length > 0) {
    return { permitted: false, reason: `unresolved_hard_defect:${hard[0].code}` };
  }
  if (decision === 'accept-page-raster') {
    const rasterProblem = hard.find((d) => d.code === 'page_raster_missing' || d.code === 'final_output_blank_page' || d.code === 'page_dimension_mismatch');
    if (rasterProblem) return { permitted: false, reason: `raster_unsafe:${rasterProblem.code}` };
  }
  return { permitted: true, reason: null };
}
