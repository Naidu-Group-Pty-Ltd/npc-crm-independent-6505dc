/**
 * repairPatternLibrary — Phase 10C.
 *
 * The canonical catalogue of deterministic repair patterns. Each definition is a
 * fixed advisory record: category, default severity, recommended deterministic
 * action, manual fallback, and downstream requirements. No I/O, no AI.
 */
import type {
  RepairPatternDefinition,
  RepairPatternId,
} from './repairPatternTypes';

export const REPAIR_PATTERN_LIBRARY: RepairPatternDefinition[] = [
  {
    patternId: 'page_margin_drift',
    category: 'geometry',
    title: 'Page margin drift',
    description:
      'Content appears shifted from the source with a consistent page-level offset across major elements.',
    defaultSeverity: 'medium',
    recommendedAction: 'normalize_page_margins',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'low',
    exportParityRequirement: 'rerun_required',
    operatorReviewRequirement: 'recommended',
    eligibleProfileCategories: ['simple_document', 'multi_page_report', 'design_heavy', 'mixed_complex'],
    symptoms: ['content shifted from source', 'page-level alignment mismatch', 'consistent offset across elements'],
    riskNotes: ['Usually deterministically repairable when the offset is uniform.'],
  },
  {
    patternId: 'background_block_shift',
    category: 'geometry',
    title: 'Background block shift',
    description:
      'Large colored/background blocks are shifted or resized so section backgrounds no longer align with text.',
    defaultSeverity: 'medium',
    recommendedAction: 'adjust_background_blocks',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'medium',
    exportParityRequirement: 'rerun_required',
    operatorReviewRequirement: 'required',
    eligibleProfileCategories: ['design_heavy', 'image_heavy', 'mixed_complex'],
    symptoms: ['background blocks shifted or resized', 'section backgrounds misaligned with text'],
    riskNotes: ['Design-sensitive; review the visual result before applying.'],
  },
  {
    patternId: 'font_scale_mismatch',
    category: 'typography',
    title: 'Font scale mismatch',
    description:
      'Text is too large or small, causing line-break drift, overflow, or clipping that affects visual QA.',
    defaultSeverity: 'medium',
    recommendedAction: 'normalize_font_scale',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'medium',
    exportParityRequirement: 'required',
    operatorReviewRequirement: 'recommended',
    eligibleProfileCategories: ['simple_document', 'multi_page_report', 'design_heavy', 'table_heavy', 'mixed_complex'],
    symptoms: ['text too large/small', 'line breaks drift', 'text overflow/clipping'],
    riskNotes: ['Typography changes can cascade across pages; verify reflow.'],
  },
  {
    patternId: 'table_grid_drift',
    category: 'table',
    title: 'Table grid drift',
    description:
      'Row/column alignment and table borders no longer match the source; structured layout is at risk.',
    defaultSeverity: 'high',
    recommendedAction: 'preserve_table_as_raster_or_rebuild_grid',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'high',
    exportParityRequirement: 'required',
    operatorReviewRequirement: 'required',
    eligibleProfileCategories: ['table_heavy', 'multi_page_report', 'mixed_complex'],
    symptoms: ['row/column alignment issues', 'table borders/grid mismatch', 'numerical layout risk'],
    riskNotes: ['Rebuilding grids is risky; preserving as raster is often safer.'],
  },
  {
    patternId: 'image_crop_mismatch',
    category: 'image',
    title: 'Image crop mismatch',
    description:
      'Image aspect ratio, crop, or position drifts from the source, producing export parity visual mismatch.',
    defaultSeverity: 'medium',
    recommendedAction: 'adjust_image_fit',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'low',
    exportParityRequirement: 'required',
    operatorReviewRequirement: 'required',
    eligibleProfileCategories: ['image_heavy', 'design_heavy', 'mixed_complex'],
    symptoms: ['image aspect/crop/position drift', 'object-fit mismatch'],
    riskNotes: ['Object-fit adjustments should be verified against the source raster.'],
  },
  {
    patternId: 'layer_order_conflict',
    category: 'layering',
    title: 'Layer order conflict',
    description:
      'Text, images, and backgrounds are stacked incorrectly; elements may be hidden behind backgrounds.',
    defaultSeverity: 'high',
    recommendedAction: 'repair_layer_order',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'medium',
    exportParityRequirement: 'required',
    operatorReviewRequirement: 'required',
    eligibleProfileCategories: ['design_heavy', 'image_heavy', 'mixed_complex'],
    symptoms: ['incorrect z-order/stacking', 'elements hidden behind backgrounds'],
    riskNotes: ['Z-order repair can hide/expose elements; review carefully.'],
  },
  {
    patternId: 'ocr_text_fragments',
    category: 'ocr',
    title: 'OCR text fragments',
    description:
      'Scanned/OCR content with low text density produces fragmented editable text that is unsafe to rebuild.',
    defaultSeverity: 'high',
    recommendedAction: 'preserve_source_raster',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'manual_review_only',
    exportParityRequirement: 'manual_required',
    operatorReviewRequirement: 'required',
    eligibleProfileCategories: ['scanned_ocr', 'high_risk', 'mixed_complex'],
    symptoms: ['scanned/OCR profile', 'low text density', 'fragmented editable text'],
    riskNotes: ['Preserving the source raster is safest; do not trust OCR structure.'],
  },
  {
    patternId: 'header_footer_alignment',
    category: 'multipage',
    title: 'Header/footer alignment',
    description:
      'Repeated page header/footer regions drift across pages in a multi-page report.',
    defaultSeverity: 'medium',
    recommendedAction: 'align_repeated_header_footer',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'low',
    exportParityRequirement: 'required',
    operatorReviewRequirement: 'recommended',
    eligibleProfileCategories: ['multi_page_report', 'mixed_complex'],
    symptoms: ['repeated header/footer drift', 'page-level repeated region mismatch'],
    riskNotes: ['Align repeated regions consistently across all pages.'],
  },
  {
    patternId: 'multi_page_spacing_drift',
    category: 'multipage',
    title: 'Multi-page spacing drift',
    description:
      'Vertical spacing and section positions drift inconsistently across multiple pages.',
    defaultSeverity: 'medium',
    recommendedAction: 'normalize_vertical_spacing',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'medium',
    exportParityRequirement: 'required',
    operatorReviewRequirement: 'recommended',
    eligibleProfileCategories: ['multi_page_report', 'mixed_complex'],
    symptoms: ['spacing changes across pages', 'inconsistent section positions'],
    riskNotes: ['Normalize spacing without collapsing intended gaps.'],
  },
  {
    patternId: 'missing_major_visual_element',
    category: 'missing_content',
    title: 'Missing major visual element',
    description:
      'A major image, background, or table section is missing; visual QA and export parity drop sharply.',
    defaultSeverity: 'critical',
    recommendedAction: 'restore_missing_visual_element',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'high',
    exportParityRequirement: 'manual_required',
    operatorReviewRequirement: 'block_until_review',
    eligibleProfileCategories: ['design_heavy', 'image_heavy', 'table_heavy', 'mixed_complex', 'high_risk'],
    symptoms: ['image/background/table section missing', 'very low visual QA', 'export parity missing/low'],
    riskNotes: ['Do not trust automated structure when a major element is missing.'],
  },
  {
    patternId: 'export_renderer_mismatch',
    category: 'export',
    title: 'Export renderer mismatch',
    description:
      'The editor/source render looks acceptable but export parity fails or drops, indicating a renderer difference.',
    defaultSeverity: 'high',
    recommendedAction: 'inspect_export_renderer',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'low',
    exportParityRequirement: 'rerun_required',
    operatorReviewRequirement: 'required',
    eligibleProfileCategories: ['simple_document', 'design_heavy', 'multi_page_report', 'table_heavy', 'image_heavy', 'mixed_complex'],
    symptoms: ['editor/source acceptable but export fails', 'export renderer differs from editor render'],
    riskNotes: ['Investigate the export renderer before repeated repair attempts.'],
  },
  {
    patternId: 'manual_review_only',
    category: 'manual_review',
    title: 'Manual review only',
    description:
      'Multiple risk factors indicate automation is unsafe; the import must be reviewed by a human.',
    defaultSeverity: 'critical',
    recommendedAction: 'block_automation',
    manualFallback: 'manual_review',
    aiReconciliationUsefulness: 'manual_review_only',
    exportParityRequirement: 'manual_required',
    operatorReviewRequirement: 'block_until_review',
    eligibleProfileCategories: ['scanned_ocr', 'high_risk', 'mixed_complex', 'unknown'],
    symptoms: ['high risk/scanned/OCR/critical profile', 'repair fallback required', 'quality gate failed/blocked'],
    riskNotes: ['Do not run automated repair; escalate to manual review.'],
  },
];

const UNKNOWN_DEFINITION: RepairPatternDefinition = {
  patternId: 'unknown',
  category: 'unknown',
  title: 'Unknown pattern',
  description: 'Insufficient evidence to match a known repair pattern.',
  defaultSeverity: 'info',
  recommendedAction: 'no_action',
  manualFallback: 'manual_review',
  aiReconciliationUsefulness: 'not_needed',
  exportParityRequirement: 'not_required',
  operatorReviewRequirement: 'not_required',
  eligibleProfileCategories: [],
  symptoms: ['insufficient evidence'],
  riskNotes: ['Degrade to unknown rather than guessing a pattern.'],
};

const REQUIRED_PATTERN_IDS: RepairPatternId[] = [
  'page_margin_drift',
  'background_block_shift',
  'font_scale_mismatch',
  'table_grid_drift',
  'image_crop_mismatch',
  'layer_order_conflict',
  'ocr_text_fragments',
  'header_footer_alignment',
  'multi_page_spacing_drift',
  'missing_major_visual_element',
  'export_renderer_mismatch',
  'manual_review_only',
];

const VALID_CATEGORIES = new Set([
  'geometry', 'typography', 'table', 'image', 'layering', 'ocr',
  'multipage', 'export', 'missing_content', 'manual_review', 'unknown',
]);
const VALID_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);

/** Defensive copy of the full library. */
export function listRepairPatternDefinitions(): RepairPatternDefinition[] {
  return REPAIR_PATTERN_LIBRARY.map((d) => ({
    ...d,
    eligibleProfileCategories: [...d.eligibleProfileCategories],
    symptoms: [...d.symptoms],
    riskNotes: [...d.riskNotes],
  }));
}

/** Look up a pattern definition by id (includes the internal `unknown` fallback), or null. */
export function getRepairPatternDefinition(
  patternId: RepairPatternId | string,
): RepairPatternDefinition | null {
  if (patternId === 'unknown') return { ...UNKNOWN_DEFINITION };
  const found = REPAIR_PATTERN_LIBRARY.find((d) => d.patternId === patternId);
  return found
    ? {
        ...found,
        eligibleProfileCategories: [...found.eligibleProfileCategories],
        symptoms: [...found.symptoms],
        riskNotes: [...found.riskNotes],
      }
    : null;
}

/** Structural integrity check of the library. */
export function assertRepairPatternLibraryIntegrity(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const ids = REPAIR_PATTERN_LIBRARY.map((d) => d.patternId);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`duplicate_pattern_id_${id}`);
    seen.add(id);
  }
  for (const req of REQUIRED_PATTERN_IDS) {
    if (!seen.has(req)) errors.push(`missing_required_pattern_${req}`);
  }
  for (const d of REPAIR_PATTERN_LIBRARY) {
    if (!d.title) errors.push(`missing_title_${d.patternId}`);
    if (!d.description) errors.push(`missing_description_${d.patternId}`);
    if (!d.recommendedAction) errors.push(`missing_action_${d.patternId}`);
    if (!d.manualFallback) errors.push(`missing_fallback_${d.patternId}`);
    if (!Array.isArray(d.symptoms) || d.symptoms.length === 0) errors.push(`missing_symptoms_${d.patternId}`);
    if (!Array.isArray(d.eligibleProfileCategories)) errors.push(`missing_eligible_${d.patternId}`);
    if (!VALID_CATEGORIES.has(d.category)) errors.push(`invalid_category_${d.patternId}`);
    if (!VALID_SEVERITIES.has(d.defaultSeverity)) errors.push(`invalid_severity_${d.patternId}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
