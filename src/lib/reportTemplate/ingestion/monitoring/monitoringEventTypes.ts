/**
 * monitoringEventTypes — Phase 11C durable PDF-import monitoring + alerting model.
 *
 * Phase 9F (`pdfImportMonitoring*`) evaluates an in-memory metric snapshot into a
 * transient summary. Phase 11C adds a *durable, rule-based, idempotent,
 * severity-aware, status-aware, permission-aware, NON-remediating* alert layer:
 * it detects, classifies, persists, displays, acknowledges, and resolves PDF
 * import alerts — but it never repairs, retries, reruns, reconciles, mutates
 * templates, or calls AI.
 *
 * These types are pure data. They store NO raw PDF text, NO raw OCR text, NO
 * screenshots/rasters, NO signed URLs, and NO private client PDF content. Alert
 * context is restricted to safe scalar metrics, identifiers, counts, and
 * thresholds.
 */

export const PDF_IMPORT_MONITORING_EVENT_VERSION = 'pdf-import-monitoring-event-v1';

/**
 * The 16 canonical monitoring domains. Aligned with the ingestion pipeline
 * stages and the Phase 8–11 safety layers.
 */
export type MonitoringEventDomain =
  | 'import_pipeline'
  | 'sidecar_diagnostics'
  | 'artifact_integrity'
  | 'visual_quality'
  | 'repair'
  | 'reconciliation'
  | 'export_parity'
  | 'golden_regression'
  | 'release_gates'
  | 'backend_contract'
  | 'security_privacy'
  | 'permissions'
  | 'performance'
  | 'quality_gates'
  | 'operator_controls'
  | 'monitoring_self';

export const MONITORING_EVENT_DOMAINS: MonitoringEventDomain[] = [
  'import_pipeline',
  'sidecar_diagnostics',
  'artifact_integrity',
  'visual_quality',
  'repair',
  'reconciliation',
  'export_parity',
  'golden_regression',
  'release_gates',
  'backend_contract',
  'security_privacy',
  'permissions',
  'performance',
  'quality_gates',
  'operator_controls',
  'monitoring_self',
];

/** Alert severity ladder. Ranked info < warning < high < critical. */
export type MonitoringEventSeverity = 'info' | 'warning' | 'high' | 'critical';

export const MONITORING_EVENT_SEVERITIES: MonitoringEventSeverity[] = [
  'info',
  'warning',
  'high',
  'critical',
];

export const MONITORING_EVENT_SEVERITY_RANK: Record<MonitoringEventSeverity, number> = {
  info: 0,
  warning: 1,
  high: 2,
  critical: 3,
};

/**
 * Alert lifecycle status.
 * - open: newly detected / still firing, not yet triaged.
 * - acknowledged: a permitted operator has seen it and owns it.
 * - resolved: no longer firing or explicitly closed.
 * - suppressed: intentionally muted (optionally until a timestamp).
 * - false_positive: closed as not a real problem; excluded from health rollups.
 */
export type MonitoringEventStatus =
  | 'open'
  | 'acknowledged'
  | 'resolved'
  | 'suppressed'
  | 'false_positive';

export const MONITORING_EVENT_STATUSES: MonitoringEventStatus[] = [
  'open',
  'acknowledged',
  'resolved',
  'suppressed',
  'false_positive',
];

/** Statuses that represent an alert that still needs attention. */
export const MONITORING_EVENT_ACTIVE_STATUSES: MonitoringEventStatus[] = [
  'open',
  'acknowledged',
];

/** The suggested owning discipline for triage routing (advisory only). */
export type MonitoringEventOwner =
  | 'operator'
  | 'qa'
  | 'manual_review'
  | 'developer_frontend'
  | 'developer_backend'
  | 'developer_sidecar'
  | 'developer_fullstack'
  | 'security'
  | 'unknown';

/** Fallback owner used when there is no active event to attribute. */
export const MONITORING_EVENT_RULES_FALLBACK_OWNER: MonitoringEventOwner = 'operator';

/**
 * The 34 canonical alert rule ids. Each is stable and used both as the rule key
 * and as part of the dedupe event key.
 */
export type MonitoringEventRuleId =
  // import_pipeline (4)
  | 'import_failure_detected'
  | 'import_stuck_in_progress'
  | 'import_error_rate_high'
  | 'import_duration_regression'
  // sidecar_diagnostics (3)
  | 'sidecar_diagnostics_failed'
  | 'sidecar_engine_version_missing'
  | 'sidecar_unavailable'
  // artifact_integrity (2)
  | 'source_raster_missing'
  | 'artifact_bucket_public_exposure'
  // visual_quality (2)
  | 'visual_qa_missing'
  | 'visual_qa_low_similarity'
  // repair (2)
  | 'repair_audit_missing'
  | 'repair_failure_rate_high'
  // reconciliation (2)
  | 'reconciliation_manual_backlog'
  | 'reconciliation_plan_unresolved'
  // export_parity (3)
  | 'export_parity_missing'
  | 'export_parity_failed'
  | 'export_parity_manual_required'
  // golden_regression (4)
  | 'golden_quality_gate_failed'
  | 'golden_quality_gate_blocked'
  | 'golden_baseline_degraded'
  | 'golden_corpus_coverage_incomplete'
  // release_gates (2)
  | 'release_gate_blocked'
  | 'release_readiness_regressed'
  // backend_contract (2)
  | 'backend_unknown_operation'
  | 'backend_contract_drift'
  // security_privacy (2)
  | 'private_artifact_exposure_risk'
  | 'raw_content_persistence_risk'
  // permissions (2)
  | 'permission_escalation_detected'
  | 'unauthorized_write_attempt'
  // performance (1)
  | 'performance_budget_exceeded'
  // quality_gates (1)
  | 'quality_gate_regression'
  // operator_controls (1)
  | 'operator_control_blocked_bypass'
  // monitoring_self (1)
  | 'monitoring_check_stale';

/**
 * A canonical monitoring rule. Pure metadata — the evaluator combines a rule
 * with a fired signal to produce a candidate alert event.
 */
export interface MonitoringEventRule {
  ruleId: MonitoringEventRuleId;
  domain: MonitoringEventDomain;
  /** Default severity when the signal fires at its baseline threshold. */
  defaultSeverity: MonitoringEventSeverity;
  owner: MonitoringEventOwner;
  /**
   * Whether an active (open/acknowledged) instance of this rule should be
   * treated as blocking production release readiness. Advisory only — this
   * layer never blocks anything by itself.
   */
  releaseBlocking: boolean;
  title: string;
  description: string;
  /** Anchor into the Phase 11C runbook template. */
  runbookAnchor: string;
}

/**
 * A fired signal: the evaluator's determination that a rule's condition is met
 * for a given metric snapshot. Carries only safe scalars — never raw content.
 */
export interface MonitoringEventSignal {
  ruleId: MonitoringEventRuleId;
  /** Escalated severity if the metric is far past threshold; else undefined. */
  severity?: MonitoringEventSeverity;
  /** The observed metric value (number, boolean, or null when not applicable). */
  metricValue: number | boolean | null;
  /** The threshold the metric was compared against. */
  threshold: number | boolean | null;
  /** Human-readable, non-sensitive summary of why the signal fired. */
  summary: string;
  /**
   * Optional safe correlation scalars: counts, ids that are not private
   * content. Never store raw text / OCR / screenshots / signed URLs here.
   */
  context?: Record<string, string | number | boolean | null>;
}

/**
 * A durable alert event as persisted in `public.pdf_import_monitoring_events`
 * and returned to the admin UI. Timestamps are ISO-8601 strings.
 */
export interface MonitoringEvent {
  id: string;
  version: typeof PDF_IMPORT_MONITORING_EVENT_VERSION;
  /** Deterministic dedupe key: `${ruleId}:${dedupeScope}`. */
  eventKey: string;
  ruleId: MonitoringEventRuleId;
  domain: MonitoringEventDomain;
  severity: MonitoringEventSeverity;
  status: MonitoringEventStatus;
  owner: MonitoringEventOwner;
  releaseBlocking: boolean;
  title: string;
  summary: string;
  metricValue: number | boolean | null;
  threshold: number | boolean | null;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  suppressedUntil: string | null;
  note: string | null;
  runbookAnchor: string;
  context: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}

/**
 * The raw, safe metric snapshot the check consumes. Every field is a count,
 * ratio, boolean, or timestamp — no raw content. Extends the Phase 9F snapshot
 * intent with the Phase 11C domains.
 */
export interface MonitoringMetricSnapshot {
  // import_pipeline
  failedImports24h: number;
  stuckImportsOver30m: number;
  completedImports24h: number;
  importDurationP95Ms: number | null;
  importDurationBaselineMs: number | null;
  // sidecar_diagnostics
  failedDiagnosticsJobs24h: number;
  completedImportsMissingEngineVersion: number;
  sidecarUnavailable: boolean;
  // artifact_integrity
  completedImportsMissingSourceRaster: number;
  publicArtifactBucketCount: number;
  // visual_quality
  completedImportsMissingVisualQa: number;
  lowSimilarityImports: number;
  // repair
  visualQaMissingRepairAudit: number;
  repairFailures24h: number;
  // reconciliation
  reconciliationManualBacklog: number;
  reconciliationPlansUnresolved: number;
  // export_parity
  goldenReadyMissingExportParity: number;
  exportParityFailed: number;
  exportParityManualRequired: number;
  // golden_regression
  goldenQualityGateFailed: number;
  goldenQualityGateBlocked: number;
  goldenBaselineDegraded: number;
  goldenCorpusCovered: number;
  goldenCorpusExpected: number;
  // release_gates
  releaseGateBlocked: boolean;
  releaseReadinessRegressed: boolean;
  // backend_contract
  backendUnknownOperationCount: number;
  backendContractDriftCount: number;
  // security_privacy
  privateArtifactExposureCount: number;
  rawContentPersistenceRiskCount: number;
  // permissions
  permissionEscalationCount: number;
  unauthorizedWriteAttemptCount: number;
  // performance
  performanceBudgetBreachCount: number;
  // quality_gates
  qualityGateRegressionCount: number;
  // operator_controls
  blockedControlBypassCount: number;
  // monitoring_self
  lastCheckAgeMinutes: number | null;
}

/** Tunable thresholds. All optional in overrides; defaults live in the rules module. */
export interface MonitoringThresholds {
  failedImportsWarning: number;
  failedImportsHigh: number;
  failedImportsCritical: number;
  stuckImportsHigh: number;
  errorRateWarning: number;
  errorRateHigh: number;
  durationRegressionRatioWarning: number;
  diagnosticsJobsFailedHigh: number;
  missingEngineVersionWarning: number;
  missingSourceRasterHigh: number;
  missingVisualQaWarning: number;
  lowSimilarityWarning: number;
  missingRepairAuditWarning: number;
  repairFailuresHigh: number;
  reconciliationBacklogWarning: number;
  reconciliationUnresolvedWarning: number;
  exportParityMissingWarning: number;
  exportParityFailedHigh: number;
  exportParityManualWarning: number;
  goldenGateFailedCritical: number;
  goldenGateBlockedCritical: number;
  baselineDegradedWarning: number;
  performanceBudgetHigh: number;
  qualityGateRegressionHigh: number;
  blockedControlBypassCritical: number;
  monitoringStaleMinutesWarning: number;
}

export interface MonitoringEvaluationInput {
  metrics: MonitoringMetricSnapshot;
  thresholds?: Partial<MonitoringThresholds>;
  now?: () => Date;
}

/** The full evaluation result: fired signals + candidate events + rollup. */
export interface MonitoringEvaluationResult {
  version: typeof PDF_IMPORT_MONITORING_EVENT_VERSION;
  signals: MonitoringEventSignal[];
  /** Candidate events derived from the fired signals (status always 'open'). */
  candidates: MonitoringEvent[];
  /** Rule ids that did NOT fire — used for auto-resolution of stale open events. */
  clearedRuleIds: MonitoringEventRuleId[];
  rollup: MonitoringHealthRollup;
  generatedAt: string;
}

export type MonitoringHealthStatus =
  | 'healthy'
  | 'info_present'
  | 'warnings_present'
  | 'high_alerts_present'
  | 'critical_alerts_present';

/** A severity/status-aware rollup over a set of events. */
export interface MonitoringHealthRollup {
  status: MonitoringHealthStatus;
  highestActiveSeverity: MonitoringEventSeverity;
  primaryOwner: MonitoringEventOwner;
  releaseBlockingActive: boolean;
  counts: {
    total: number;
    active: number;
    open: number;
    acknowledged: number;
    resolved: number;
    suppressed: number;
    falsePositive: number;
    info: number;
    warning: number;
    high: number;
    critical: number;
  };
  generatedAt: string;
}

/** Lifecycle actions a permitted operator can request on an event. */
export type MonitoringEventLifecycleAction =
  | 'acknowledge'
  | 'resolve'
  | 'suppress'
  | 'mark_false_positive';

/** Edge-function operation names for `pdf-import-monitoring`. */
export type MonitoringEventOperation =
  | 'run_check'
  | 'list_events'
  | 'acknowledge_event'
  | 'resolve_event'
  | 'suppress_event'
  | 'mark_false_positive';
