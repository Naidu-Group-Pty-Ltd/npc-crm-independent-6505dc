/**
 * productionRolloutLockDisplay — Phase 11H.
 *
 * UI-safe labels, Badge tones, and formatting for the Final Production Rollout
 * Lock report. Pure; no network.
 */
import type {
  PdfImportProductionRolloutLockDecision,
  PdfImportProductionRolloutLockDomain,
  PdfImportProductionRolloutLockReport,
  PdfImportProductionRolloutLockSeverity,
  PdfImportProductionRolloutLockStatus,
  PdfImportProductionRolloutMode,
} from './productionRolloutLockTypes';

export type PdfImportProductionRolloutLockDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const DECISION_LABELS: Record<string, string> = {
  production_rollout_locked: 'Production rollout locked',
  production_rollout_locked_with_conditions: 'Locked with conditions',
  production_rollout_not_locked: 'Not locked',
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
  rollout_readiness: 'Rollout readiness',
  permissions: 'Permissions',
  monitoring_alerting: 'Monitoring / alerting',
  release_gate: 'Release gate',
  retention: 'Retention',
  runbooks: 'Runbooks',
  client_reporting: 'Client reporting',
  security_privacy: 'Security / privacy',
  database_storage: 'Database / storage',
  ui_routes: 'UI routes',
  tests_build: 'Tests / build',
  production_preview: 'Production preview',
  private_artifacts: 'Private artifacts',
  deployment: 'Deployment',
  rollout_scope: 'Rollout scope',
};

export function getPdfImportProductionRolloutLockDecisionLabel(
  decision: PdfImportProductionRolloutLockDecision | string | null | undefined,
): string {
  if (!decision) return 'Not locked';
  return DECISION_LABELS[decision] ?? 'Not locked';
}

export function getPdfImportProductionRolloutLockDecisionTone(
  decision: PdfImportProductionRolloutLockDecision | string | null | undefined,
): PdfImportProductionRolloutLockDisplayTone {
  switch (decision) {
    case 'production_rollout_locked':
      return 'default';
    case 'production_rollout_locked_with_conditions':
      return 'secondary';
    case 'production_rollout_not_locked':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function getPdfImportProductionRolloutModeLabel(
  mode: PdfImportProductionRolloutMode | string | null | undefined,
): string {
  if (!mode) return 'Blocked';
  return MODE_LABELS[mode] ?? 'Blocked';
}

export function getPdfImportProductionRolloutModeTone(
  mode: PdfImportProductionRolloutMode | string | null | undefined,
): PdfImportProductionRolloutLockDisplayTone {
  switch (mode) {
    case 'broad_production':
      return 'default';
    case 'controlled_team_rollout':
    case 'admin_limited':
      return 'secondary';
    case 'internal_dev_only':
      return 'outline';
    case 'blocked':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function getPdfImportProductionRolloutLockStatusLabel(
  status: PdfImportProductionRolloutLockStatus | string | null | undefined,
): string {
  if (!status) return 'Unknown';
  return STATUS_LABELS[status] ?? 'Unknown';
}

export function getPdfImportProductionRolloutLockStatusTone(
  status: PdfImportProductionRolloutLockStatus | string | null | undefined,
): PdfImportProductionRolloutLockDisplayTone {
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

export function getPdfImportProductionRolloutLockSeverityLabel(
  severity: PdfImportProductionRolloutLockSeverity | string | null | undefined,
): string {
  if (!severity) return 'Info';
  return SEVERITY_LABELS[severity] ?? 'Info';
}

export function getPdfImportProductionRolloutLockDomainLabel(
  domain: PdfImportProductionRolloutLockDomain | string | null | undefined,
): string {
  if (!domain) return 'Unknown';
  return DOMAIN_LABELS[domain] ?? 'Unknown';
}

export function formatPdfImportProductionRolloutLockScore(
  score: number | null | undefined,
): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return `${Math.round(score)}/100`;
}

export function getPdfImportProductionRolloutLockHeadline(
  report: PdfImportProductionRolloutLockReport | null | undefined,
): string {
  if (!report) return 'No production rollout lock report';
  return [
    getPdfImportProductionRolloutLockDecisionLabel(report.decision),
    getPdfImportProductionRolloutModeLabel(report.rolloutMode),
    formatPdfImportProductionRolloutLockScore(report.score),
  ].join(' · ');
}
