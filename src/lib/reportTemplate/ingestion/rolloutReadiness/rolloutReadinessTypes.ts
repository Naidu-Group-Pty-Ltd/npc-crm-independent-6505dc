/**
 * rolloutReadinessTypes — Phase 11A.
 *
 * Data model for the Production Rollout Readiness Review. The review is
 * read-only, deterministic, and decision-oriented: it evaluates a checklist of
 * rollout-readiness checks into a rollout decision and a recommended rollout
 * mode. It adds no runtime behaviour, calls no AI, and mutates nothing.
 */
export const PDF_IMPORT_ROLLOUT_READINESS_VERSION = 'pdf-import-rollout-readiness-v1';

export type PdfImportRolloutReadinessDomain =
  | 'phase10_lock'
  | 'security_access'
  | 'deployment'
  | 'operator_workflow'
  | 'permissions'
  | 'monitoring_alerting'
  | 'release_governance'
  | 'data_privacy'
  | 'support_runbooks'
  | 'performance_cost'
  | 'artifact_retention'
  | 'client_impact'
  | 'rollout_scope';

export type PdfImportRolloutReadinessSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';

export type PdfImportRolloutReadinessStatus =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'unknown'
  | 'not_applicable';

export type PdfImportRolloutDecision =
  | 'rollout_ready'
  | 'rollout_ready_with_conditions'
  | 'rollout_not_ready';

export type PdfImportRolloutMode =
  | 'internal_dev_only'
  | 'admin_limited'
  | 'controlled_team_rollout'
  | 'broad_production'
  | 'blocked';

export interface PdfImportRolloutReadinessCheck {
  id: string;
  domain: PdfImportRolloutReadinessDomain;
  title: string;
  description: string;
  severity: PdfImportRolloutReadinessSeverity;
  status: PdfImportRolloutReadinessStatus;
  evidence: string[];
  requiredFor: PdfImportRolloutMode[];
  remediation: string;
  targetPhase: string;
}

export interface PdfImportRolloutReadinessSummary {
  version: typeof PDF_IMPORT_ROLLOUT_READINESS_VERSION;
  total: number;
  pass: number;
  warning: number;
  fail: number;
  unknown: number;
  notApplicable: number;
  criticalFailures: number;
  highFailures: number;
  score: number;
  decision: PdfImportRolloutDecision;
  recommendedMode: PdfImportRolloutMode;
  generatedAt: string;
}

export interface PdfImportRolloutReadinessReport {
  version: typeof PDF_IMPORT_ROLLOUT_READINESS_VERSION;
  checks: PdfImportRolloutReadinessCheck[];
  summary: PdfImportRolloutReadinessSummary;
  criticalBlockers: PdfImportRolloutReadinessCheck[];
  conditions: PdfImportRolloutReadinessCheck[];
  recommendedNextPhases: string[];
}

export interface EvaluatePdfImportRolloutReadinessOptions {
  checks: PdfImportRolloutReadinessCheck[];
  now?: () => Date;
}
