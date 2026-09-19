/**
 * pdfImportPerformanceDisplay — Phase 10F.
 *
 * UI-safe labels, Badge tones, and formatting for the Performance + Cost audit.
 * Pure; no network.
 */
import type {
  PdfImportCostLevel,
  PdfImportOptimizationAction,
  PdfImportPerformanceCostAudit,
  PdfImportPerformanceRiskLevel,
} from './pdfImportPerformanceTypes';

export type PdfImportPerformanceDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const COST_LABELS: Record<string, string> = {
  negligible: 'Negligible',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  very_high: 'Very high',
  unknown: 'Unknown',
};

const RISK_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
  unknown: 'Unknown',
};

const ACTION_LABELS: Record<string, string> = {
  no_action: 'No action',
  reuse_existing_result: 'Reuse existing result',
  rebuild_stale_metadata: 'Rebuild stale metadata',
  defer_expensive_step: 'Defer expensive step',
  require_operator_confirmation: 'Require operator confirmation',
  compact_metadata: 'Compact metadata',
  limit_query_scope: 'Limit query scope',
  cache_artifact_lookup: 'Cache artifact lookup',
  rerun_only_if_inputs_changed: 'Rerun only if inputs changed',
  avoid_ai_reconciliation: 'Avoid AI reconciliation',
  require_manual_review_before_costly_step: 'Require manual review before costly step',
  inspect_long_running_job: 'Inspect long-running job',
  inspect_storage_artifacts: 'Inspect storage artifacts',
  archive_or_prune_old_history: 'Archive or prune old history',
  document_manual_gap: 'Document manual gap',
};

export function getPdfImportCostLevelLabel(
  costLevel: PdfImportCostLevel | string | null | undefined,
): string {
  if (!costLevel) return 'Unknown';
  return COST_LABELS[costLevel] ?? 'Unknown';
}

export function getPdfImportCostLevelTone(
  costLevel: PdfImportCostLevel | string | null | undefined,
): PdfImportPerformanceDisplayTone {
  switch (costLevel) {
    case 'negligible':
    case 'low':
      return 'default';
    case 'medium':
      return 'secondary';
    case 'high':
    case 'very_high':
      return 'destructive';
    case 'unknown':
    default:
      return 'outline';
  }
}

export function getPdfImportPerformanceRiskLabel(
  risk: PdfImportPerformanceRiskLevel | string | null | undefined,
): string {
  if (!risk) return 'Unknown';
  return RISK_LABELS[risk] ?? 'Unknown';
}

export function getPdfImportPerformanceRiskTone(
  risk: PdfImportPerformanceRiskLevel | string | null | undefined,
): PdfImportPerformanceDisplayTone {
  switch (risk) {
    case 'low':
      return 'default';
    case 'medium':
      return 'secondary';
    case 'high':
    case 'critical':
      return 'destructive';
    case 'unknown':
    default:
      return 'outline';
  }
}

export function getPdfImportOptimizationActionLabel(
  action: PdfImportOptimizationAction | string | null | undefined,
): string {
  if (!action) return 'No action';
  return ACTION_LABELS[action] ?? 'No action';
}

export function formatPdfImportPerformanceScore(
  score: number | null | undefined,
): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return `${Math.round(score * 100)}%`;
}

export function getPdfImportPerformanceHeadline(
  audit: PdfImportPerformanceCostAudit | null | undefined,
): string {
  if (!audit) return 'No performance/cost audit';
  return `Performance risk ${getPdfImportPerformanceRiskLabel(audit.overallRiskLevel).toLowerCase()} · Cost ${getPdfImportCostLevelLabel(audit.overallCostLevel).toLowerCase()}`;
}

export function summarizePdfImportPerformanceAudit(
  audit: PdfImportPerformanceCostAudit | null | undefined,
): {
  label: string;
  costLabel: string;
  riskLabel: string;
  tone: PdfImportPerformanceDisplayTone;
  wasteLabel: string;
  recommendationCountLabel: string;
} {
  if (!audit) {
    return {
      label: 'No performance/cost audit',
      costLabel: 'Unknown',
      riskLabel: 'Unknown',
      tone: 'outline',
      wasteLabel: '—',
      recommendationCountLabel: '0',
    };
  }
  return {
    label: getPdfImportPerformanceHeadline(audit),
    costLabel: getPdfImportCostLevelLabel(audit.overallCostLevel),
    riskLabel: getPdfImportPerformanceRiskLabel(audit.overallRiskLevel),
    tone: getPdfImportPerformanceRiskTone(audit.overallRiskLevel),
    wasteLabel: formatPdfImportPerformanceScore(audit.estimatedWasteScore),
    recommendationCountLabel: String(audit.recommendations.length),
  };
}
