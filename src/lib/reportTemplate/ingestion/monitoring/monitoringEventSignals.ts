/**
 * monitoringEventSignals — Phase 11C pure signal derivation.
 *
 * Maps a safe metric snapshot + thresholds into the set of fired signals (one
 * per triggered rule). Pure and deterministic — no I/O, no remediation, no raw
 * content. The evaluator consumes these to build durable alert events.
 */
import { DEFAULT_MONITORING_THRESHOLDS } from './monitoringEventRules';
import {
  type MonitoringEventSignal,
  type MonitoringMetricSnapshot,
  type MonitoringThresholds,
} from './monitoringEventTypes';

/** Compute the failed:completed error rate over the window, or null when no volume. */
export function calculateImportErrorRate(m: MonitoringMetricSnapshot): number | null {
  const total = m.completedImports24h + m.failedImports24h;
  if (!(total > 0)) return null;
  return m.failedImports24h / total;
}

/** Compute the duration regression ratio vs baseline, or null when unknown. */
export function calculateDurationRegressionRatio(m: MonitoringMetricSnapshot): number | null {
  if (m.importDurationP95Ms == null || m.importDurationBaselineMs == null) return null;
  if (!(m.importDurationBaselineMs > 0)) return null;
  return m.importDurationP95Ms / m.importDurationBaselineMs;
}

/**
 * Derive the fired signals from a snapshot. Each entry carries safe scalars
 * only. Severity is escalated inline where a metric is far past threshold.
 */
export function deriveMonitoringSignals(
  metrics: MonitoringMetricSnapshot,
  thresholds?: Partial<MonitoringThresholds>,
): MonitoringEventSignal[] {
  const t: MonitoringThresholds = { ...DEFAULT_MONITORING_THRESHOLDS, ...(thresholds ?? {}) };
  const m = metrics;
  const out: MonitoringEventSignal[] = [];

  // ── import_pipeline ──
  if (m.failedImports24h >= t.failedImportsWarning) {
    const severity =
      m.failedImports24h >= t.failedImportsCritical
        ? 'critical'
        : m.failedImports24h >= t.failedImportsHigh
        ? 'high'
        : 'warning';
    out.push({
      ruleId: 'import_failure_detected',
      severity,
      metricValue: m.failedImports24h,
      threshold: t.failedImportsWarning,
      summary: `${m.failedImports24h} PDF import(s) failed in the last 24h.`,
      context: { failedImports24h: m.failedImports24h },
    });
  }

  if (m.stuckImportsOver30m >= t.stuckImportsHigh) {
    out.push({
      ruleId: 'import_stuck_in_progress',
      metricValue: m.stuckImportsOver30m,
      threshold: t.stuckImportsHigh,
      summary: `${m.stuckImportsOver30m} import(s) stuck in a non-terminal state beyond 30m.`,
      context: { stuckImportsOver30m: m.stuckImportsOver30m },
    });
  }

  const errorRate = calculateImportErrorRate(m);
  if (errorRate !== null && errorRate >= t.errorRateWarning) {
    out.push({
      ruleId: 'import_error_rate_high',
      severity: errorRate >= t.errorRateHigh ? 'high' : 'warning',
      metricValue: Number(errorRate.toFixed(4)),
      threshold: t.errorRateWarning,
      summary: `Import error rate ${Math.round(errorRate * 100)}% over the last 24h.`,
      context: { failedImports24h: m.failedImports24h, completedImports24h: m.completedImports24h },
    });
  }

  const durationRatio = calculateDurationRegressionRatio(m);
  if (durationRatio !== null && durationRatio >= t.durationRegressionRatioWarning) {
    out.push({
      ruleId: 'import_duration_regression',
      metricValue: Number(durationRatio.toFixed(3)),
      threshold: t.durationRegressionRatioWarning,
      summary: `Import p95 duration is ${durationRatio.toFixed(2)}× the baseline.`,
      context: {
        p95Ms: m.importDurationP95Ms ?? null,
        baselineMs: m.importDurationBaselineMs ?? null,
      },
    });
  }

  // ── sidecar_diagnostics ──
  if (m.failedDiagnosticsJobs24h >= t.diagnosticsJobsFailedHigh) {
    out.push({
      ruleId: 'sidecar_diagnostics_failed',
      metricValue: m.failedDiagnosticsJobs24h,
      threshold: t.diagnosticsJobsFailedHigh,
      summary: `${m.failedDiagnosticsJobs24h} diagnostics job(s) failed in the last 24h.`,
      context: { failedDiagnosticsJobs24h: m.failedDiagnosticsJobs24h },
    });
  }

  if (m.completedImportsMissingEngineVersion >= t.missingEngineVersionWarning) {
    out.push({
      ruleId: 'sidecar_engine_version_missing',
      metricValue: m.completedImportsMissingEngineVersion,
      threshold: t.missingEngineVersionWarning,
      summary: `${m.completedImportsMissingEngineVersion} completed import(s) missing engine version.`,
      context: { completedImportsMissingEngineVersion: m.completedImportsMissingEngineVersion },
    });
  }

  if (m.sidecarUnavailable === true) {
    out.push({
      ruleId: 'sidecar_unavailable',
      metricValue: true,
      threshold: true,
      summary: 'The PDF parse sidecar service appears to be unavailable.',
    });
  }

  // ── artifact_integrity ──
  if (m.completedImportsMissingSourceRaster >= t.missingSourceRasterHigh) {
    out.push({
      ruleId: 'source_raster_missing',
      metricValue: m.completedImportsMissingSourceRaster,
      threshold: t.missingSourceRasterHigh,
      summary: `${m.completedImportsMissingSourceRaster} import(s) missing source rasters.`,
      context: { completedImportsMissingSourceRaster: m.completedImportsMissingSourceRaster },
    });
  }

  if (m.publicArtifactBucketCount > 0) {
    out.push({
      ruleId: 'artifact_bucket_public_exposure',
      metricValue: m.publicArtifactBucketCount,
      threshold: 0,
      summary: `${m.publicArtifactBucketCount} template-import artifact bucket(s) are public.`,
      context: { publicArtifactBucketCount: m.publicArtifactBucketCount },
    });
  }

  // ── visual_quality ──
  if (m.completedImportsMissingVisualQa >= t.missingVisualQaWarning) {
    out.push({
      ruleId: 'visual_qa_missing',
      metricValue: m.completedImportsMissingVisualQa,
      threshold: t.missingVisualQaWarning,
      summary: `${m.completedImportsMissingVisualQa} completed import(s) missing Visual QA.`,
      context: { completedImportsMissingVisualQa: m.completedImportsMissingVisualQa },
    });
  }

  if (m.lowSimilarityImports >= t.lowSimilarityWarning) {
    out.push({
      ruleId: 'visual_qa_low_similarity',
      metricValue: m.lowSimilarityImports,
      threshold: t.lowSimilarityWarning,
      summary: `${m.lowSimilarityImports} import(s) below the visual-similarity floor.`,
      context: { lowSimilarityImports: m.lowSimilarityImports },
    });
  }

  // ── repair ──
  if (m.visualQaMissingRepairAudit >= t.missingRepairAuditWarning) {
    out.push({
      ruleId: 'repair_audit_missing',
      metricValue: m.visualQaMissingRepairAudit,
      threshold: t.missingRepairAuditWarning,
      summary: `${m.visualQaMissingRepairAudit} import(s) with Visual QA missing a repair audit.`,
      context: { visualQaMissingRepairAudit: m.visualQaMissingRepairAudit },
    });
  }

  if (m.repairFailures24h >= t.repairFailuresHigh) {
    out.push({
      ruleId: 'repair_failure_rate_high',
      metricValue: m.repairFailures24h,
      threshold: t.repairFailuresHigh,
      summary: `${m.repairFailures24h} repair failure(s) in the last 24h.`,
      context: { repairFailures24h: m.repairFailures24h },
    });
  }

  // ── reconciliation ──
  if (m.reconciliationManualBacklog >= t.reconciliationBacklogWarning) {
    out.push({
      ruleId: 'reconciliation_manual_backlog',
      metricValue: m.reconciliationManualBacklog,
      threshold: t.reconciliationBacklogWarning,
      summary: `${m.reconciliationManualBacklog} manual reconciliation item(s) awaiting review.`,
      context: { reconciliationManualBacklog: m.reconciliationManualBacklog },
    });
  }

  if (m.reconciliationPlansUnresolved >= t.reconciliationUnresolvedWarning) {
    out.push({
      ruleId: 'reconciliation_plan_unresolved',
      metricValue: m.reconciliationPlansUnresolved,
      threshold: t.reconciliationUnresolvedWarning,
      summary: `${m.reconciliationPlansUnresolved} reconciliation plan(s) unresolved.`,
      context: { reconciliationPlansUnresolved: m.reconciliationPlansUnresolved },
    });
  }

  // ── export_parity ──
  if (m.goldenReadyMissingExportParity >= t.exportParityMissingWarning) {
    out.push({
      ruleId: 'export_parity_missing',
      metricValue: m.goldenReadyMissingExportParity,
      threshold: t.exportParityMissingWarning,
      summary: `${m.goldenReadyMissingExportParity} golden-ready import(s) missing export parity.`,
      context: { goldenReadyMissingExportParity: m.goldenReadyMissingExportParity },
    });
  }

  if (m.exportParityFailed >= t.exportParityFailedHigh) {
    out.push({
      ruleId: 'export_parity_failed',
      metricValue: m.exportParityFailed,
      threshold: t.exportParityFailedHigh,
      summary: `${m.exportParityFailed} export parity failure(s).`,
      context: { exportParityFailed: m.exportParityFailed },
    });
  }

  if (m.exportParityManualRequired >= t.exportParityManualWarning) {
    out.push({
      ruleId: 'export_parity_manual_required',
      metricValue: m.exportParityManualRequired,
      threshold: t.exportParityManualWarning,
      summary: `${m.exportParityManualRequired} export parity result(s) require manual review.`,
      context: { exportParityManualRequired: m.exportParityManualRequired },
    });
  }

  // ── golden_regression ──
  if (m.goldenQualityGateFailed >= t.goldenGateFailedCritical) {
    out.push({
      ruleId: 'golden_quality_gate_failed',
      metricValue: m.goldenQualityGateFailed,
      threshold: t.goldenGateFailedCritical,
      summary: `${m.goldenQualityGateFailed} golden run(s) failed the quality gate.`,
      context: { goldenQualityGateFailed: m.goldenQualityGateFailed },
    });
  }

  if (m.goldenQualityGateBlocked >= t.goldenGateBlockedCritical) {
    out.push({
      ruleId: 'golden_quality_gate_blocked',
      metricValue: m.goldenQualityGateBlocked,
      threshold: t.goldenGateBlockedCritical,
      summary: `${m.goldenQualityGateBlocked} golden run(s) are blocked.`,
      context: { goldenQualityGateBlocked: m.goldenQualityGateBlocked },
    });
  }

  if (m.goldenBaselineDegraded >= t.baselineDegradedWarning) {
    out.push({
      ruleId: 'golden_baseline_degraded',
      metricValue: m.goldenBaselineDegraded,
      threshold: t.baselineDegradedWarning,
      summary: `${m.goldenBaselineDegraded} baseline comparison(s) degraded.`,
      context: { goldenBaselineDegraded: m.goldenBaselineDegraded },
    });
  }

  if (m.goldenCorpusExpected > 0 && m.goldenCorpusCovered < m.goldenCorpusExpected) {
    out.push({
      ruleId: 'golden_corpus_coverage_incomplete',
      metricValue: m.goldenCorpusCovered,
      threshold: m.goldenCorpusExpected,
      summary: `Only ${m.goldenCorpusCovered}/${m.goldenCorpusExpected} corpus items are covered.`,
      context: { covered: m.goldenCorpusCovered, expected: m.goldenCorpusExpected },
    });
  }

  // ── release_gates ──
  if (m.releaseGateBlocked === true) {
    out.push({
      ruleId: 'release_gate_blocked',
      metricValue: true,
      threshold: true,
      summary: 'Database-side release gate is blocked.',
    });
  }

  if (m.releaseReadinessRegressed === true) {
    out.push({
      ruleId: 'release_readiness_regressed',
      metricValue: true,
      threshold: true,
      summary: 'Rollout readiness regressed relative to the prior state.',
    });
  }

  // ── backend_contract ──
  if (m.backendUnknownOperationCount > 0) {
    out.push({
      ruleId: 'backend_unknown_operation',
      metricValue: m.backendUnknownOperationCount,
      threshold: 0,
      summary: `${m.backendUnknownOperationCount} backend unknown-operation signal(s) detected.`,
      context: { backendUnknownOperationCount: m.backendUnknownOperationCount },
    });
  }

  if (m.backendContractDriftCount > 0) {
    out.push({
      ruleId: 'backend_contract_drift',
      metricValue: m.backendContractDriftCount,
      threshold: 0,
      summary: `${m.backendContractDriftCount} backend contract drift signal(s) detected.`,
      context: { backendContractDriftCount: m.backendContractDriftCount },
    });
  }

  // ── security_privacy ──
  if (m.privateArtifactExposureCount > 0) {
    out.push({
      ruleId: 'private_artifact_exposure_risk',
      metricValue: m.privateArtifactExposureCount,
      threshold: 0,
      summary: `${m.privateArtifactExposureCount} private artifact exposure signal(s) detected.`,
      context: { privateArtifactExposureCount: m.privateArtifactExposureCount },
    });
  }

  if (m.rawContentPersistenceRiskCount > 0) {
    out.push({
      ruleId: 'raw_content_persistence_risk',
      metricValue: m.rawContentPersistenceRiskCount,
      threshold: 0,
      summary: `${m.rawContentPersistenceRiskCount} raw-content persistence risk signal(s) detected.`,
      context: { rawContentPersistenceRiskCount: m.rawContentPersistenceRiskCount },
    });
  }

  // ── permissions ──
  if (m.permissionEscalationCount > 0) {
    out.push({
      ruleId: 'permission_escalation_detected',
      metricValue: m.permissionEscalationCount,
      threshold: 0,
      summary: `${m.permissionEscalationCount} permission escalation signal(s) detected.`,
      context: { permissionEscalationCount: m.permissionEscalationCount },
    });
  }

  if (m.unauthorizedWriteAttemptCount > 0) {
    out.push({
      ruleId: 'unauthorized_write_attempt',
      metricValue: m.unauthorizedWriteAttemptCount,
      threshold: 0,
      summary: `${m.unauthorizedWriteAttemptCount} unauthorized write attempt(s) detected.`,
      context: { unauthorizedWriteAttemptCount: m.unauthorizedWriteAttemptCount },
    });
  }

  // ── performance ──
  if (m.performanceBudgetBreachCount >= t.performanceBudgetHigh) {
    out.push({
      ruleId: 'performance_budget_exceeded',
      metricValue: m.performanceBudgetBreachCount,
      threshold: t.performanceBudgetHigh,
      summary: `${m.performanceBudgetBreachCount} performance budget breach(es).`,
      context: { performanceBudgetBreachCount: m.performanceBudgetBreachCount },
    });
  }

  // ── quality_gates ──
  if (m.qualityGateRegressionCount >= t.qualityGateRegressionHigh) {
    out.push({
      ruleId: 'quality_gate_regression',
      metricValue: m.qualityGateRegressionCount,
      threshold: t.qualityGateRegressionHigh,
      summary: `${m.qualityGateRegressionCount} quality gate regression(s).`,
      context: { qualityGateRegressionCount: m.qualityGateRegressionCount },
    });
  }

  // ── operator_controls ──
  if (m.blockedControlBypassCount >= t.blockedControlBypassCritical) {
    out.push({
      ruleId: 'operator_control_blocked_bypass',
      metricValue: m.blockedControlBypassCount,
      threshold: t.blockedControlBypassCritical,
      summary: `${m.blockedControlBypassCount} blocked operator control bypass signal(s).`,
      context: { blockedControlBypassCount: m.blockedControlBypassCount },
    });
  }

  // ── monitoring_self ──
  if (m.lastCheckAgeMinutes !== null && m.lastCheckAgeMinutes >= t.monitoringStaleMinutesWarning) {
    out.push({
      ruleId: 'monitoring_check_stale',
      metricValue: m.lastCheckAgeMinutes,
      threshold: t.monitoringStaleMinutesWarning,
      summary: `Last monitoring check ran ${m.lastCheckAgeMinutes} minute(s) ago.`,
      context: { lastCheckAgeMinutes: m.lastCheckAgeMinutes },
    });
  }

  return out;
}
