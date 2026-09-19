/**
 * phase10ProductionLockDisplay — Phase 10H.
 *
 * UI-safe labels, Badge tones, and formatting for the Phase 10 production lock
 * report. Pure; no network.
 */
import type {
  Phase10ProductionLockDecision,
  Phase10ProductionLockDomain,
  Phase10ProductionLockReport,
  Phase10ProductionLockRequirementStatus,
  Phase10ProductionLockSeverity,
} from './phase10ProductionLockTypes';

export type Phase10ProductionLockDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const DECISION_LABELS: Record<string, string> = {
  locked: 'Locked',
  locked_with_warnings: 'Locked with warnings',
  not_locked: 'Not locked',
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
  documentation: 'Documentation',
  schemas: 'Schemas',
  sql: 'SQL',
  hardening: 'Hardening',
  import_intelligence: 'Import intelligence',
  repair_patterns: 'Repair patterns',
  adaptive_reconciliation: 'Adaptive reconciliation',
  self_healing: 'Self-healing',
  performance_cost: 'Performance / cost',
  operator_controls: 'Operator controls',
  golden_regression: 'Golden regression',
  export_parity: 'Export parity',
  database_storage: 'Database / storage',
  ui: 'UI',
  tests_build: 'Tests / build',
  privacy_artifacts: 'Privacy / artifacts',
  deployment: 'Deployment',
};

export function getPhase10ProductionLockDecisionLabel(
  decision: Phase10ProductionLockDecision | string | null | undefined,
): string {
  if (!decision) return 'Not locked';
  return DECISION_LABELS[decision] ?? 'Not locked';
}

export function getPhase10ProductionLockDecisionTone(
  decision: Phase10ProductionLockDecision | string | null | undefined,
): Phase10ProductionLockDisplayTone {
  switch (decision) {
    case 'locked':
      return 'default';
    case 'locked_with_warnings':
      return 'secondary';
    case 'not_locked':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function getPhase10ProductionLockStatusLabel(
  status: Phase10ProductionLockRequirementStatus | string | null | undefined,
): string {
  if (!status) return 'Unknown';
  return STATUS_LABELS[status] ?? 'Unknown';
}

export function getPhase10ProductionLockStatusTone(
  status: Phase10ProductionLockRequirementStatus | string | null | undefined,
): Phase10ProductionLockDisplayTone {
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

export function getPhase10ProductionLockSeverityLabel(
  severity: Phase10ProductionLockSeverity | string | null | undefined,
): string {
  if (!severity) return 'Info';
  return SEVERITY_LABELS[severity] ?? 'Info';
}

export function getPhase10ProductionLockDomainLabel(
  domain: Phase10ProductionLockDomain | string | null | undefined,
): string {
  if (!domain) return 'Unknown';
  return DOMAIN_LABELS[domain] ?? 'Unknown';
}

export function formatPhase10ProductionLockScore(
  score: number | null | undefined,
): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
  return `${Math.round(score)}/100`;
}

export function getPhase10ProductionLockHeadline(
  report: Phase10ProductionLockReport | null | undefined,
): string {
  if (!report) return 'No Phase 10 lock report';
  return `${getPhase10ProductionLockDecisionLabel(report.summary.decision)} · ${formatPhase10ProductionLockScore(report.summary.score)}`;
}
