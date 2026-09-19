/**
 * monitoringEventRules — Phase 11C canonical alert rule catalog + thresholds.
 *
 * 34 canonical rules across the 16 monitoring domains. Pure data — no I/O, no
 * remediation. Each rule maps a fired signal to a domain, default severity,
 * advisory owner, release-blocking flag, and runbook anchor.
 */
import {
  MONITORING_EVENT_DOMAINS,
  type MonitoringEventRule,
  type MonitoringEventRuleId,
  type MonitoringThresholds,
} from './monitoringEventTypes';

export const DEFAULT_MONITORING_THRESHOLDS: MonitoringThresholds = {
  failedImportsWarning: 1,
  failedImportsHigh: 3,
  failedImportsCritical: 8,
  stuckImportsHigh: 1,
  errorRateWarning: 0.1,
  errorRateHigh: 0.25,
  durationRegressionRatioWarning: 1.5,
  diagnosticsJobsFailedHigh: 1,
  missingEngineVersionWarning: 1,
  missingSourceRasterHigh: 1,
  missingVisualQaWarning: 1,
  lowSimilarityWarning: 1,
  missingRepairAuditWarning: 1,
  repairFailuresHigh: 1,
  reconciliationBacklogWarning: 5,
  reconciliationUnresolvedWarning: 1,
  exportParityMissingWarning: 1,
  exportParityFailedHigh: 1,
  exportParityManualWarning: 1,
  goldenGateFailedCritical: 1,
  goldenGateBlockedCritical: 1,
  baselineDegradedWarning: 1,
  performanceBudgetHigh: 1,
  qualityGateRegressionHigh: 1,
  blockedControlBypassCritical: 1,
  monitoringStaleMinutesWarning: 180,
};

export const MONITORING_EVENT_RULES: MonitoringEventRule[] = [
  // ── import_pipeline ──
  {
    ruleId: 'import_failure_detected',
    domain: 'import_pipeline',
    defaultSeverity: 'high',
    owner: 'developer_fullstack',
    releaseBlocking: true,
    title: 'PDF import failures detected',
    description: 'One or more PDF imports failed in the recent window.',
    runbookAnchor: 'import-failure-detected',
  },
  {
    ruleId: 'import_stuck_in_progress',
    domain: 'import_pipeline',
    defaultSeverity: 'high',
    owner: 'developer_backend',
    releaseBlocking: true,
    title: 'PDF imports stuck in progress',
    description: 'One or more imports have been non-terminal beyond the stuck threshold.',
    runbookAnchor: 'import-stuck-in-progress',
  },
  {
    ruleId: 'import_error_rate_high',
    domain: 'import_pipeline',
    defaultSeverity: 'high',
    owner: 'developer_fullstack',
    releaseBlocking: true,
    title: 'PDF import error rate is high',
    description: 'The failed:completed ratio over the window exceeds the error-rate threshold.',
    runbookAnchor: 'import-error-rate-high',
  },
  {
    ruleId: 'import_duration_regression',
    domain: 'import_pipeline',
    defaultSeverity: 'warning',
    owner: 'developer_backend',
    releaseBlocking: false,
    title: 'PDF import duration regression',
    description: 'The recent p95 import duration regressed well past its baseline.',
    runbookAnchor: 'import-duration-regression',
  },

  // ── sidecar_diagnostics ──
  {
    ruleId: 'sidecar_diagnostics_failed',
    domain: 'sidecar_diagnostics',
    defaultSeverity: 'high',
    owner: 'developer_sidecar',
    releaseBlocking: true,
    title: 'Sidecar diagnostics jobs failed',
    description: 'Docling / Cloud Run sidecar diagnostics jobs failed in the window.',
    runbookAnchor: 'sidecar-diagnostics-failed',
  },
  {
    ruleId: 'sidecar_engine_version_missing',
    domain: 'sidecar_diagnostics',
    defaultSeverity: 'warning',
    owner: 'developer_backend',
    releaseBlocking: false,
    title: 'Engine version missing',
    description: 'Completed imports are missing engine-version diagnostics metadata.',
    runbookAnchor: 'sidecar-engine-version-missing',
  },
  {
    ruleId: 'sidecar_unavailable',
    domain: 'sidecar_diagnostics',
    defaultSeverity: 'critical',
    owner: 'developer_sidecar',
    releaseBlocking: true,
    title: 'Sidecar unavailable',
    description: 'The PDF parse sidecar service appears to be unavailable.',
    runbookAnchor: 'sidecar-unavailable',
  },

  // ── artifact_integrity ──
  {
    ruleId: 'source_raster_missing',
    domain: 'artifact_integrity',
    defaultSeverity: 'high',
    owner: 'developer_backend',
    releaseBlocking: true,
    title: 'Source rasters missing',
    description: 'Source raster artifacts are missing for imports that should have them.',
    runbookAnchor: 'source-raster-missing',
  },
  {
    ruleId: 'artifact_bucket_public_exposure',
    domain: 'artifact_integrity',
    defaultSeverity: 'critical',
    owner: 'security',
    releaseBlocking: true,
    title: 'Artifact bucket publicly exposed',
    description: 'A template-import artifact bucket is public and may expose private content.',
    runbookAnchor: 'artifact-bucket-public-exposure',
  },

  // ── visual_quality ──
  {
    ruleId: 'visual_qa_missing',
    domain: 'visual_quality',
    defaultSeverity: 'warning',
    owner: 'developer_frontend',
    releaseBlocking: false,
    title: 'Visual QA missing',
    description: 'Completed imports are missing Visual QA output.',
    runbookAnchor: 'visual-qa-missing',
  },
  {
    ruleId: 'visual_qa_low_similarity',
    domain: 'visual_quality',
    defaultSeverity: 'high',
    owner: 'qa',
    releaseBlocking: true,
    title: 'Visual QA low similarity',
    description: 'One or more imports scored below the visual-similarity floor.',
    runbookAnchor: 'visual-qa-low-similarity',
  },

  // ── repair ──
  {
    ruleId: 'repair_audit_missing',
    domain: 'repair',
    defaultSeverity: 'warning',
    owner: 'developer_backend',
    releaseBlocking: false,
    title: 'Repair audit missing',
    description: 'Imports with Visual QA are missing a repair audit.',
    runbookAnchor: 'repair-audit-missing',
  },
  {
    ruleId: 'repair_failure_rate_high',
    domain: 'repair',
    defaultSeverity: 'high',
    owner: 'developer_backend',
    releaseBlocking: true,
    title: 'Repair failure rate high',
    description: 'Repair execution failures exceed the threshold for the window.',
    runbookAnchor: 'repair-failure-rate-high',
  },

  // ── reconciliation ──
  {
    ruleId: 'reconciliation_manual_backlog',
    domain: 'reconciliation',
    defaultSeverity: 'warning',
    owner: 'manual_review',
    releaseBlocking: false,
    title: 'Reconciliation manual backlog',
    description: 'Manual reconciliation items awaiting review exceed the backlog threshold.',
    runbookAnchor: 'reconciliation-manual-backlog',
  },
  {
    ruleId: 'reconciliation_plan_unresolved',
    domain: 'reconciliation',
    defaultSeverity: 'warning',
    owner: 'manual_review',
    releaseBlocking: false,
    title: 'Reconciliation plans unresolved',
    description: 'One or more reconciliation plans remain unresolved.',
    runbookAnchor: 'reconciliation-plan-unresolved',
  },

  // ── export_parity ──
  {
    ruleId: 'export_parity_missing',
    domain: 'export_parity',
    defaultSeverity: 'warning',
    owner: 'operator',
    releaseBlocking: false,
    title: 'Export parity missing',
    description: 'Golden-ready imports are missing export parity.',
    runbookAnchor: 'export-parity-missing',
  },
  {
    ruleId: 'export_parity_failed',
    domain: 'export_parity',
    defaultSeverity: 'high',
    owner: 'developer_frontend',
    releaseBlocking: true,
    title: 'Export parity failed',
    description: 'Export parity failed or produced invalid output.',
    runbookAnchor: 'export-parity-failed',
  },
  {
    ruleId: 'export_parity_manual_required',
    domain: 'export_parity',
    defaultSeverity: 'warning',
    owner: 'manual_review',
    releaseBlocking: false,
    title: 'Export parity manual review required',
    description: 'Export parity requires manual review to complete.',
    runbookAnchor: 'export-parity-manual-required',
  },

  // ── golden_regression ──
  {
    ruleId: 'golden_quality_gate_failed',
    domain: 'golden_regression',
    defaultSeverity: 'critical',
    owner: 'qa',
    releaseBlocking: true,
    title: 'Golden quality gate failed',
    description: 'Golden regression failed required quality gates.',
    runbookAnchor: 'golden-quality-gate-failed',
  },
  {
    ruleId: 'golden_quality_gate_blocked',
    domain: 'golden_regression',
    defaultSeverity: 'critical',
    owner: 'operator',
    releaseBlocking: true,
    title: 'Golden quality gate blocked',
    description: 'Golden regression quality gates are blocked.',
    runbookAnchor: 'golden-quality-gate-blocked',
  },
  {
    ruleId: 'golden_baseline_degraded',
    domain: 'golden_regression',
    defaultSeverity: 'warning',
    owner: 'qa',
    releaseBlocking: false,
    title: 'Golden baseline degraded',
    description: 'The latest golden run is worse than the previous baseline.',
    runbookAnchor: 'golden-baseline-degraded',
  },
  {
    ruleId: 'golden_corpus_coverage_incomplete',
    domain: 'golden_regression',
    defaultSeverity: 'warning',
    owner: 'qa',
    releaseBlocking: false,
    title: 'Golden corpus coverage incomplete',
    description: 'One or more canonical corpus items have no history run.',
    runbookAnchor: 'golden-corpus-coverage-incomplete',
  },

  // ── release_gates ──
  {
    ruleId: 'release_gate_blocked',
    domain: 'release_gates',
    defaultSeverity: 'critical',
    owner: 'developer_fullstack',
    releaseBlocking: true,
    title: 'Release gate blocked',
    description: 'The database-side release gate indicates a release-blocking state.',
    runbookAnchor: 'release-gate-blocked',
  },
  {
    ruleId: 'release_readiness_regressed',
    domain: 'release_gates',
    defaultSeverity: 'high',
    owner: 'developer_fullstack',
    releaseBlocking: true,
    title: 'Release readiness regressed',
    description: 'Rollout readiness signals regressed relative to the prior state.',
    runbookAnchor: 'release-readiness-regressed',
  },

  // ── backend_contract ──
  {
    ruleId: 'backend_unknown_operation',
    domain: 'backend_contract',
    defaultSeverity: 'critical',
    owner: 'developer_backend',
    releaseBlocking: true,
    title: 'Backend unknown operation detected',
    description: 'The frontend attempted an operation the backend does not support.',
    runbookAnchor: 'backend-unknown-operation',
  },
  {
    ruleId: 'backend_contract_drift',
    domain: 'backend_contract',
    defaultSeverity: 'high',
    owner: 'developer_backend',
    releaseBlocking: true,
    title: 'Backend contract drift',
    description: 'Backend request/response contract drift was detected.',
    runbookAnchor: 'backend-contract-drift',
  },

  // ── security_privacy ──
  {
    ruleId: 'private_artifact_exposure_risk',
    domain: 'security_privacy',
    defaultSeverity: 'critical',
    owner: 'security',
    releaseBlocking: true,
    title: 'Private artifact exposure risk',
    description: 'Private artifacts appear to be staged or at risk of exposure.',
    runbookAnchor: 'private-artifact-exposure-risk',
  },
  {
    ruleId: 'raw_content_persistence_risk',
    domain: 'security_privacy',
    defaultSeverity: 'critical',
    owner: 'security',
    releaseBlocking: true,
    title: 'Raw content persistence risk',
    description: 'Signals indicate raw PDF/OCR content may be persisted where it should not be.',
    runbookAnchor: 'raw-content-persistence-risk',
  },

  // ── permissions ──
  {
    ruleId: 'permission_escalation_detected',
    domain: 'permissions',
    defaultSeverity: 'critical',
    owner: 'security',
    releaseBlocking: true,
    title: 'Permission escalation detected',
    description: 'A role appears to have been granted capabilities beyond its policy.',
    runbookAnchor: 'permission-escalation-detected',
  },
  {
    ruleId: 'unauthorized_write_attempt',
    domain: 'permissions',
    defaultSeverity: 'high',
    owner: 'security',
    releaseBlocking: false,
    title: 'Unauthorized write attempt',
    description: 'A write operation was attempted without the required capability.',
    runbookAnchor: 'unauthorized-write-attempt',
  },

  // ── performance ──
  {
    ruleId: 'performance_budget_exceeded',
    domain: 'performance',
    defaultSeverity: 'high',
    owner: 'developer_backend',
    releaseBlocking: false,
    title: 'Performance budget exceeded',
    description: 'One or more performance budgets were breached.',
    runbookAnchor: 'performance-budget-exceeded',
  },

  // ── quality_gates ──
  {
    ruleId: 'quality_gate_regression',
    domain: 'quality_gates',
    defaultSeverity: 'high',
    owner: 'qa',
    releaseBlocking: true,
    title: 'Quality gate regression',
    description: 'A quality gate regressed relative to its accepted baseline.',
    runbookAnchor: 'quality-gate-regression',
  },

  // ── operator_controls ──
  {
    ruleId: 'operator_control_blocked_bypass',
    domain: 'operator_controls',
    defaultSeverity: 'critical',
    owner: 'security',
    releaseBlocking: true,
    title: 'Blocked operator control bypass',
    description: 'A safety-blocked operator control appears available or was executed.',
    runbookAnchor: 'operator-control-blocked-bypass',
  },

  // ── monitoring_self ──
  {
    ruleId: 'monitoring_check_stale',
    domain: 'monitoring_self',
    defaultSeverity: 'warning',
    owner: 'developer_fullstack',
    releaseBlocking: false,
    title: 'Monitoring check is stale',
    description: 'No monitoring check has run within the freshness window.',
    runbookAnchor: 'monitoring-check-stale',
  },
];

const RULES_BY_ID: Record<string, MonitoringEventRule> = Object.fromEntries(
  MONITORING_EVENT_RULES.map((rule) => [rule.ruleId, rule]),
);

/** Fallback rule for an unrecognized id (never release-blocking). */
function fallbackRule(ruleId: MonitoringEventRuleId): MonitoringEventRule {
  return {
    ruleId,
    domain: 'monitoring_self',
    defaultSeverity: 'warning',
    owner: 'unknown',
    releaseBlocking: false,
    title: 'Unknown monitoring rule',
    description: `No rule is registered for id "${ruleId}".`,
    runbookAnchor: 'unknown-rule',
  };
}

export function getMonitoringEventRule(ruleId: MonitoringEventRuleId): MonitoringEventRule {
  return RULES_BY_ID[ruleId] ?? fallbackRule(ruleId);
}

/** Integrity assertion for tests + CI: unique ids, valid domains, coverage. */
export function assertMonitoringEventRuleCatalogIntegrity(): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const seen = new Set<string>();
  const domains = new Set(MONITORING_EVENT_DOMAINS);

  for (const rule of MONITORING_EVENT_RULES) {
    if (seen.has(rule.ruleId)) errors.push(`duplicate_rule_id:${rule.ruleId}`);
    seen.add(rule.ruleId);
    if (!domains.has(rule.domain)) errors.push(`unknown_domain:${rule.ruleId}:${rule.domain}`);
    if (!rule.runbookAnchor) errors.push(`missing_runbook_anchor:${rule.ruleId}`);
    if (!rule.title) errors.push(`missing_title:${rule.ruleId}`);
  }

  // Every domain must have at least one rule.
  for (const d of MONITORING_EVENT_DOMAINS) {
    if (!MONITORING_EVENT_RULES.some((r) => r.domain === d)) {
      errors.push(`domain_without_rule:${d}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
