/**
 * E8 — canonical E7-defect → repairability classifier (pure).
 *
 * Every E7 hard-defect code is mapped explicitly. An UNKNOWN critical code is
 * NEVER marked safe — it is `nonrepairable`, or `page-fallback` when a verified
 * page raster exists. Classification only says HOW a defect could be repaired;
 * whether the operation is actually permissible is decided later by the
 * source-evidence preconditions.
 */
import type { CriticalQualityDefectCode } from '../../v2/criticalDefects';

export type RepairabilityClass =
  | 'safe-deterministic' | 'candidate-switch' | 'region-fallback' | 'page-fallback'
  | 'nonrepairable' | 'evidence-retry';

const MAP: Partial<Record<CriticalQualityDefectCode, RepairabilityClass>> = {
  // geometry / text-fit (only when exact source geometry + permissible bounds)
  text_clipped: 'safe-deterministic',
  source_line_count_changed: 'safe-deterministic',
  element_off_page: 'safe-deterministic',
  glyph_off_page: 'safe-deterministic',
  page_dimension_mismatch: 'safe-deterministic',
  severe_overlap: 'safe-deterministic',
  material_occlusion: 'safe-deterministic',
  unreadable_contrast: 'safe-deterministic',

  // suppression / composition (E6 plan/suppression only)
  duplicate_source_pixels: 'safe-deterministic',
  crop_and_native_both_visible: 'safe-deterministic',
  nested_crop_both_visible: 'safe-deterministic',
  chart_child_duplicate: 'safe-deterministic',
  table_native_crop_duplicate: 'safe-deterministic',
  typography_native_crop_duplicate: 'safe-deterministic',
  hidden_semantic_visible: 'safe-deterministic',
  editor_reference_visible_in_final: 'safe-deterministic',
  renderer_plan_mismatch: 'safe-deterministic',

  // asset retry (only when a durable trusted asset exists)
  region_crop_asset_missing: 'evidence-retry',
  region_crop_asset_invalid: 'evidence-retry',
  rendered_raster_missing: 'evidence-retry',

  // table candidate switch → else source crop
  table_topology_mismatch: 'candidate-switch',
  table_cell_association_error: 'candidate-switch',
  table_row_missing: 'candidate-switch',
  table_column_missing: 'candidate-switch',
  table_row_clipped: 'candidate-switch',
  table_cell_clipped: 'candidate-switch',
  table_generic_header_visible: 'candidate-switch',

  // typography candidate switch → else source-text crop
  critical_punctuation_missing: 'candidate-switch',
  critical_punctuation_changed: 'candidate-switch',
  range_separator_missing: 'candidate-switch',
  currency_symbol_missing: 'candidate-switch',
  percentage_symbol_missing: 'candidate-switch',
  multiplication_sign_changed: 'candidate-switch',
  minus_sign_changed: 'candidate-switch',
  critical_numeric_token_missing: 'candidate-switch',
  critical_numeric_token_changed: 'candidate-switch',
  critical_numeric_token_duplicated: 'candidate-switch',

  // region fallback (exact source-region crop; never redraw)
  chart_region_missing: 'region-fallback',
  chart_crop_blank: 'region-fallback',
  chart_region_duplicated: 'region-fallback',
  picture_region_missing: 'region-fallback',
  picture_crop_blank: 'region-fallback',
  picture_region_duplicated: 'region-fallback',
  logo_region_missing: 'region-fallback',
  table_region_missing: 'region-fallback',
  typography_crop_blank: 'region-fallback',
  local_blank_region: 'region-fallback',
  foreground_occupancy_loss: 'region-fallback',
  critical_edge_loss: 'region-fallback',
  final_output_blank_region: 'region-fallback',

  // page fallback (page raster where valid)
  source_region_unscored: 'page-fallback',
  composition_unscored: 'page-fallback',
  unresolved_region_crop_overlap: 'page-fallback',
  source_region_not_rendered: 'page-fallback',
  final_output_blank_page: 'page-fallback',
  critical_numeric_token_wrong_region: 'page-fallback',

  // export
  export_critical_region_missing: 'region-fallback',
  export_text_clipped: 'safe-deterministic',
  export_dimension_mismatch: 'page-fallback',
  renderer_parity_failed: 'page-fallback',
  export_preflight_failed: 'page-fallback',
  export_page_missing: 'page-fallback',
  export_page_count_mismatch: 'nonrepairable',

  // nonrepairable / block
  source_page_missing: 'nonrepairable',
  source_raster_missing: 'nonrepairable',
  page_raster_missing: 'nonrepairable',
  page_unscored: 'page-fallback',
  document_coverage_incomplete: 'nonrepairable',
  source_expectations_not_source_derived: 'nonrepairable',
  signed_url_persisted: 'nonrepairable',
  unauthorized_quality_override: 'nonrepairable',
  quality_evidence_invalid: 'nonrepairable',
};

export interface ClassifyContext { pageRasterAvailable: boolean }

/**
 * Classify one defect code. Unknown codes are conservative: `page-fallback` when
 * a valid page raster exists, else `nonrepairable`. Never `safe-deterministic`
 * by default.
 */
export function classifyDefectCode(code: CriticalQualityDefectCode | string, ctx: ClassifyContext): RepairabilityClass {
  const mapped = MAP[code as CriticalQualityDefectCode];
  if (mapped) return mapped;
  return ctx.pageRasterAvailable ? 'page-fallback' : 'nonrepairable';
}

/** Overall repair strategy tier for a set of defects — the SAFEST class needed. */
export type RepairStrategyTier = 'safe-deterministic' | 'candidate-switch' | 'region-fallback' | 'page-fallback' | 'block';

const TIER_ORDER: RepairStrategyTier[] = ['safe-deterministic', 'candidate-switch', 'region-fallback', 'page-fallback', 'block'];

export function classifyDefects(codes: Array<CriticalQualityDefectCode | string>, ctx: ClassifyContext): { perCode: Record<string, RepairabilityClass>; strategyTier: RepairStrategyTier } {
  const perCode: Record<string, RepairabilityClass> = {};
  let worst: RepairStrategyTier = 'safe-deterministic';
  for (const code of codes) {
    const cls = classifyDefectCode(code, ctx);
    perCode[code] = cls;
    const tier: RepairStrategyTier = cls === 'nonrepairable'
      ? (ctx.pageRasterAvailable ? 'page-fallback' : 'block')
      : cls === 'evidence-retry' ? 'safe-deterministic' : cls;
    if (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(worst)) worst = tier;
  }
  return { perCode, strategyTier: worst };
}
