/**
 * rolloutReadinessDisplay — Phase 11A.
 *
 * UI-safe labels, Badge tones, and formatting for the rollout readiness report.
 * Pure; no network.
 */
import type {
  PdfImportRolloutDecision,
  PdfImportRolloutMode,
  PdfImportRolloutReadinessDomain,
  PdfImportRolloutReadinessReport,
  PdfImportRolloutReadinessSeverity,
  PdfImportRolloutReadinessStatus,
} from './rolloutReadinessTypes';

export type PdfImportRolloutReadinessDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const DECISION_LABELS: Record<string, string> = {
  rollout_ready: 'Rollout ready',
  rollout_ready_with_conditions: 'Rollout ready with conditions',
  rollout_not_ready: 'Rollout not ready',
};

const MODE_LABELS: Record<string, string> = {
  internal_dev_only: 'Internal dev only',
  admin_limited: 'Admin limited',
  controlled_team_rollout: 'Controlled team rollout',
  broad_production: 'Broad production',
  blocked: 'Blocked',
};

const STATUS_LABELS: Record<string, string> = {
  pass: 'Pass',
  warning: 'Warning',
  fail: 'Fail',
  unknown: 'Unknown',
  not_applicable: 'Not applicable',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

const DOMAIN_LABELS: Record<string, string> = {
  phase10_lock: 'Phase 10 lock',
  security_access: 'Security / access',
  deployment: 'Deployment',
  operator_workflow: 'Operator workflow',
  permissions: 'Permissions',
  monitoring_alerting: 'Monitoring / alerting',
  release_governance: 'Release governance',
  data_privacy: 'Data privacy',
  support_runbooks: 'Support / runbooks',
  performance_cost: 'Performance / cost',
  artifact_retention: 'Artifact retention',
  client_impact: 'Client impact',
  rollout_scope: 'Rollout scope',
};

export function getPdfImportRolloutDecisionLabel(
  decision: PdfImportRolloutDecision | string | null | undefined,
): string {
  if (!decision) return 'Rollout not ready';
  return DECISION_LABELS[decision] ?? 'Rollout not ready';
}

export function getPdfImportRolloutDecisionTone(
  decision: PdfImportRolloutDecision | string | null | undefined,
): PdfImportRolloutReadinessDisplayTone {
  switch (decision) {
    case 'rollout_ready':
      return 'default';
    case 'rollout_ready_with_conditions':
      return 'secondary';
    case 'rollout_not_ready':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function getPdfImportRolloutModeLabel(
  mode: PdfImportRolloutMode | string | null | undefined,
): string {
  if (!mode) return 'Blocked';
  return MODE_LABELS[mode] ?? 'Blocked';
}

export function getPdfImportRolloutModeTone(
  mode: PdfImportRolloutMode | string | null | undefined,
): PdfImportRolloutReadinessDisplayTone {
  switch (mode) {
    case 'broad_production':
      return 'default';
    case 'controlled_team_rollout':
    case 'admin_limited':
      return 'secondary';
    case 'blocked':
      return 'destructive';
    case 'internal_dev_only':
    default:
      return 'outline';
  }
}

export function getPdfImportRolloutReadinessStatusLabel(
  status: PdfImportRolloutReadinessStatus | string | null | undefined,
): string {
  if (!status) return 'Unknown';
  return STATUS_LABELS[status] ?? 'Unknown';
}

export function getPdfImportRolloutReadinessStatusTone(
  status: PdfImportRolloutReadinessStatus | string | null | undefined,
): PdfImportRolloutReadinessDisplayTone {
  switch (status) {
    case 'pass':
      return 'default';
    case 'warning':
    case 'unknown':
      return 'secondary';
    case 'fail':
      return 'destructive';
    case 'not_applicable':
    default:
      return 'outline';
  }
}

export function getPdfImportRolloutReadinessSeverityLabel(
  severity: PdfImportRolloutReadinessSeverity | string | null | undefined,
): string {
  if (!severity) return 'Info';
  return SEVERITY_LABELS[severity] ?? 'Info';
}

export function getPdfImportRolloutReadinessDomainLabel(
  domain: PdfImportRolloutReadinessDomain | string | null | undefined,
): string {
  if (!domain) return 'Unknown';
  return DOMAIN_LABELS[domain] ?? 'Unknown';
}

export function formatPdfImportRolloutReadinessScore(
  score: number | null | undefined,
): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return `${Math.round(score)}/100`;
}

export function getPdfImportRolloutReadinessHeadline(
  report: PdfImportRolloutReadinessReport | null | undefined,
): string {
  if (!report) return 'No rollout readiness report';
  const { decision, recommendedMode, score } = report.summary;
  return `${getPdfImportRolloutDecisionLabel(decision)} · ${getPdfImportRolloutModeLabel(recommendedMode)} · ${formatPdfImportRolloutReadinessScore(score)}`;
}
