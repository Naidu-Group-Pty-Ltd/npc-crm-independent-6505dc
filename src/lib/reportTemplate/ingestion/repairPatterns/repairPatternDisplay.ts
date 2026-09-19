/**
 * repairPatternDisplay — Phase 10C.
 *
 * UI-safe labels, Badge tones, and formatting for the Repair Pattern Analysis.
 * Pure; no network.
 */
import type {
  RepairPatternAnalysis,
  RepairPatternId,
  RepairPatternSeverity,
  RepairPatternDeterministicRepairStrategy,
  RepairPatternOperatorReviewRequirement,
} from './repairPatternTypes';

export type RepairPatternDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const PATTERN_LABELS: Record<string, string> = {
  page_margin_drift: 'Page margin drift',
  background_block_shift: 'Background block shift',
  font_scale_mismatch: 'Font scale mismatch',
  table_grid_drift: 'Table grid drift',
  image_crop_mismatch: 'Image crop mismatch',
  layer_order_conflict: 'Layer order conflict',
  ocr_text_fragments: 'OCR text fragments',
  header_footer_alignment: 'Header/footer alignment',
  multi_page_spacing_drift: 'Multi-page spacing drift',
  missing_major_visual_element: 'Missing major visual element',
  export_renderer_mismatch: 'Export renderer mismatch',
  manual_review_only: 'Manual review only',
  unknown: 'Unknown',
};

const SEVERITY_LABELS: Record<string, string> = {
  info: 'Info',
  low: 'Low severity',
  medium: 'Medium severity',
  high: 'High severity',
  critical: 'Critical severity',
};

const STRATEGY_LABELS: Record<string, string> = {
  safe: 'Safe',
  safe_with_review: 'Safe with review',
  constrained: 'Constrained',
  manual_only: 'Manual only',
  blocked: 'Blocked',
  unknown: 'Unknown',
};

const REVIEW_LABELS: Record<string, string> = {
  not_required: 'Not required',
  recommended: 'Recommended',
  required: 'Required',
  block_until_review: 'Block until review',
};

export function getRepairPatternLabel(
  patternId: RepairPatternId | string | null | undefined,
): string {
  if (!patternId) return 'Unknown';
  return PATTERN_LABELS[patternId] ?? 'Unknown';
}

export function getRepairPatternSeverityLabel(
  severity: RepairPatternSeverity | string | null | undefined,
): string {
  if (!severity) return 'Info';
  return SEVERITY_LABELS[severity] ?? 'Info';
}

export function getRepairPatternSeverityTone(
  severity: RepairPatternSeverity | string | null | undefined,
): RepairPatternDisplayTone {
  switch (severity) {
    case 'info':
      return 'outline';
    case 'low':
      return 'default';
    case 'medium':
      return 'secondary';
    case 'high':
    case 'critical':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function getRepairPatternStrategyLabel(
  strategy: RepairPatternDeterministicRepairStrategy | string | null | undefined,
): string {
  if (!strategy) return 'Unknown';
  return STRATEGY_LABELS[strategy] ?? 'Unknown';
}

export function getRepairPatternOperatorReviewLabel(
  requirement: RepairPatternOperatorReviewRequirement | string | null | undefined,
): string {
  if (!requirement) return 'Not required';
  return REVIEW_LABELS[requirement] ?? 'Not required';
}

/** Format a 0..1 score as a percentage, or em dash when null. */
export function formatRepairPatternScore(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '—';
  return `${Math.round(score * 100)}%`;
}

/** Human headline like "Table grid drift · High severity". */
export function getRepairPatternAnalysisHeadline(
  analysis: RepairPatternAnalysis | null | undefined,
): string {
  if (!analysis) return 'No repair pattern analysis';
  if (!analysis.primaryPatternId) return `No pattern matched · ${getRepairPatternSeverityLabel(analysis.overallSeverity)}`;
  return `${getRepairPatternLabel(analysis.primaryPatternId)} · ${getRepairPatternSeverityLabel(analysis.overallSeverity)}`;
}

/** Compact display bundle for a chip/summary. */
export function summarizeRepairPatternAnalysis(
  analysis: RepairPatternAnalysis | null | undefined,
): {
  label: string;
  severityLabel: string;
  tone: RepairPatternDisplayTone;
  confidenceLabel: string;
  strategyLabel: string;
  reviewLabel: string;
} {
  if (!analysis) {
    return {
      label: 'No repair pattern analysis',
      severityLabel: 'Info',
      tone: 'outline',
      confidenceLabel: '—',
      strategyLabel: 'Unknown',
      reviewLabel: 'Not required',
    };
  }
  return {
    label: getRepairPatternLabel(analysis.primaryPatternId),
    severityLabel: getRepairPatternSeverityLabel(analysis.overallSeverity),
    tone: getRepairPatternSeverityTone(analysis.overallSeverity),
    confidenceLabel: formatRepairPatternScore(analysis.overallConfidence),
    strategyLabel: getRepairPatternStrategyLabel(analysis.deterministicRepairStrategy),
    reviewLabel: getRepairPatternOperatorReviewLabel(analysis.operatorReviewRequirement),
  };
}
