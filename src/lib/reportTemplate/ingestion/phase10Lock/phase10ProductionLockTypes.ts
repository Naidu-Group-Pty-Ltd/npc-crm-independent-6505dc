/**
 * phase10ProductionLockTypes — Phase 10H.
 *
 * Data model for the final Phase 10 Production Intelligence Lock. The lock
 * framework is read-only and deterministic: it evaluates a checklist of
 * requirements into a lock decision (locked / locked_with_warnings / not_locked).
 * It adds no runtime behaviour, calls no AI, and mutates nothing.
 */
export const PHASE_10_PRODUCTION_LOCK_VERSION = 'pdf-import-phase-10-production-lock-v1';

export type Phase10ProductionLockDomain =
  | 'documentation'
  | 'schemas'
  | 'sql'
  | 'hardening'
  | 'import_intelligence'
  | 'repair_patterns'
  | 'adaptive_reconciliation'
  | 'self_healing'
  | 'performance_cost'
  | 'operator_controls'
  | 'golden_regression'
  | 'export_parity'
  | 'database_storage'
  | 'ui'
  | 'tests_build'
  | 'privacy_artifacts'
  | 'deployment';

export type Phase10ProductionLockSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';

export type Phase10ProductionLockRequirementStatus =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'unknown'
  | 'not_applicable';

export type Phase10ProductionLockDecision =
  | 'locked'
  | 'locked_with_warnings'
  | 'not_locked';

export interface Phase10ProductionLockRequirement {
  id: string;
  domain: Phase10ProductionLockDomain;
  title: string;
  description: string;
  severity: Phase10ProductionLockSeverity;
  status: Phase10ProductionLockRequirementStatus;
  evidence: string[];
  remediation: string;
}

export interface Phase10ProductionLockSummary {
  version: typeof PHASE_10_PRODUCTION_LOCK_VERSION;
  total: number;
  pass: number;
  warning: number;
  fail: number;
  unknown: number;
  notApplicable: number;
  criticalFailures: number;
  highFailures: number;
  score: number;
  decision: Phase10ProductionLockDecision;
  generatedAt: string;
}

export interface Phase10ProductionLockReport {
  version: typeof PHASE_10_PRODUCTION_LOCK_VERSION;
  requirements: Phase10ProductionLockRequirement[];
  summary: Phase10ProductionLockSummary;
  criticalBlockers: Phase10ProductionLockRequirement[];
  warnings: Phase10ProductionLockRequirement[];
}

export interface EvaluatePhase10ProductionLockOptions {
  requirements: Phase10ProductionLockRequirement[];
  now?: () => Date;
}
