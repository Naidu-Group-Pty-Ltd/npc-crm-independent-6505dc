/**
 * productionRolloutLockTypes — Phase 11H.
 *
 * Data model for the Final Production Rollout Lock. This layer is read-only and
 * deterministic: it validates every Phase 10/11 production governance pillar and
 * resolves a final rollout decision and rollout mode. It adds no runtime
 * behaviour, calls no AI, mutates nothing, and deletes nothing.
 */
export const PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_VERSION =
  'pdf-import-production-rollout-lock-v1';

export type PdfImportProductionRolloutLockDecision =
  | 'production_rollout_locked'
  | 'production_rollout_locked_with_conditions'
  | 'production_rollout_not_locked';

export type PdfImportProductionRolloutMode =
  | 'internal_dev_only'
  | 'admin_limited'
  | 'controlled_team_rollout'
  | 'broad_production'
  | 'blocked';

export type PdfImportProductionRolloutLockDomain =
  | 'phase10_lock'
  | 'rollout_readiness'
  | 'permissions'
  | 'monitoring_alerting'
  | 'release_gate'
  | 'retention'
  | 'runbooks'
  | 'client_reporting'
  | 'security_privacy'
  | 'database_storage'
  | 'ui_routes'
  | 'tests_build'
  | 'production_preview'
  | 'private_artifacts'
  | 'deployment'
  | 'rollout_scope';

export type PdfImportProductionRolloutLockSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';

export type PdfImportProductionRolloutLockStatus =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'unknown'
  | 'not_applicable';

export interface PdfImportProductionRolloutLockCheck {
  id: string;
  domain: PdfImportProductionRolloutLockDomain;
  severity: PdfImportProductionRolloutLockSeverity;
  status: PdfImportProductionRolloutLockStatus;
  title: string;
  message: string;
  evidence: string[];
  remediation: string;
  requiredFor: PdfImportProductionRolloutMode[];
}

export interface PdfImportProductionRolloutLockSummary {
  total: number;
  pass: number;
  warning: number;
  fail: number;
  unknown: number;
  notApplicable: number;
  criticalFailures: number;
  highFailures: number;
}

export interface PdfImportProductionRolloutLockReport {
  version: typeof PDF_IMPORT_PRODUCTION_ROLLOUT_LOCK_VERSION;
  decision: PdfImportProductionRolloutLockDecision;
  rolloutMode: PdfImportProductionRolloutMode;
  score: number;
  checks: PdfImportProductionRolloutLockCheck[];
  summary: PdfImportProductionRolloutLockSummary;
  blockers: PdfImportProductionRolloutLockCheck[];
  conditions: PdfImportProductionRolloutLockCheck[];
  generatedAt: string;
}

export interface EvaluatePdfImportProductionRolloutLockOptions {
  checks: PdfImportProductionRolloutLockCheck[];
  now?: () => Date;
}
