import { describe, expect, it } from 'vitest';
import {
  buildPdfImportAlertPayload,
  buildPdfImportMonitoringAlert,
  calculateManualReviewRate,
  evaluatePdfImportMonitoring,
  resolvePdfImportMonitoringStatus,
  resolvePrimaryMonitoringOwner,
  type PdfImportMonitoringMetricSnapshot,
} from '../ingestion/monitoring';

const NOW = () => new Date('2026-07-06T00:00:00.000Z');

function makeHealthyMetrics(
  overrides: Partial<PdfImportMonitoringMetricSnapshot> = {},
): PdfImportMonitoringMetricSnapshot {
  return {
    failedImports24h: 0,
    stuckImports30m: 0,
    failedDiagnosticsJobs24h: 0,
    completedImportsWithoutEngineVersion: 0,
    completedImportsMissingVisualQa: 0,
    visualQaMissingRepairAudit: 0,
    goldenReadyMissingExportParity: 0,
    exportParityFailed: 0,
    exportParityManualRequired: 0,
    recentCompletedImports: 10,
    recentManualReviewRequired: 0,
    goldenQualityGateFailed: 0,
    goldenQualityGateBlocked: 0,
    // A healthy system has at least one persisted summary + history row and full coverage.
    goldenSummariesCount: 1,
    goldenHistoryRowsCount: 1,
    corpusCoveredCount: 6,
    baselineDegradedCount: 0,
    releaseBlockedDatabase: false,
    backendUnknownOperationCount: 0,
    privateArtifactRiskCount: 0,
    ...overrides,
  };
}

function evalMetrics(overrides: Partial<PdfImportMonitoringMetricSnapshot> = {}) {
  return evaluatePdfImportMonitoring({ metrics: makeHealthyMetrics(overrides), now: NOW });
}

function codes(summary: ReturnType<typeof evalMetrics>) {
  return summary.alerts.map((a) => a.code);
}

describe('evaluatePdfImportMonitoring — signal derivation', () => {
  it('healthy metrics return healthy status and no alerts', () => {
    const s = evalMetrics();
    expect(s.status).toBe('healthy');
    expect(s.alerts).toHaveLength(0);
  });

  it('failedImports24h = 1 creates a failed_imports_recent error', () => {
    const s = evalMetrics({ failedImports24h: 1 });
    const a = s.alerts.find((x) => x.code === 'failed_imports_recent');
    expect(a?.severity).toBe('error');
  });

  it('failedImports24h = 3 creates a failed_imports_recent critical', () => {
    const s = evalMetrics({ failedImports24h: 3 });
    const a = s.alerts.find((x) => x.code === 'failed_imports_recent');
    expect(a?.severity).toBe('critical');
  });

  it('stuckImports30m = 1 creates stuck_imports_recent', () => {
    expect(codes(evalMetrics({ stuckImports30m: 1 }))).toContain('stuck_imports_recent');
  });

  it('failedDiagnosticsJobs24h = 1 creates diagnostics_jobs_failed', () => {
    expect(codes(evalMetrics({ failedDiagnosticsJobs24h: 1 }))).toContain('diagnostics_jobs_failed');
  });

  it('completedImportsWithoutEngineVersion = 1 creates engine_version_missing', () => {
    expect(codes(evalMetrics({ completedImportsWithoutEngineVersion: 1 }))).toContain('engine_version_missing');
  });

  it('completedImportsMissingVisualQa = 1 creates visual_quality_missing', () => {
    expect(codes(evalMetrics({ completedImportsMissingVisualQa: 1 }))).toContain('visual_quality_missing');
  });

  it('visualQaMissingRepairAudit = 1 creates repair_audit_missing', () => {
    expect(codes(evalMetrics({ visualQaMissingRepairAudit: 1 }))).toContain('repair_audit_missing');
  });

  it('goldenReadyMissingExportParity = 1 creates export_parity_missing', () => {
    expect(codes(evalMetrics({ goldenReadyMissingExportParity: 1 }))).toContain('export_parity_missing');
  });

  it('exportParityFailed = 1 creates export_parity_failed', () => {
    expect(codes(evalMetrics({ exportParityFailed: 1 }))).toContain('export_parity_failed');
  });

  it('exportParityManualRequired = 1 creates export_parity_manual_required', () => {
    expect(codes(evalMetrics({ exportParityManualRequired: 1 }))).toContain('export_parity_manual_required');
  });

  it('manual review rate > 0.5 creates manual_review_rate_high', () => {
    expect(codes(evalMetrics({ recentManualReviewRequired: 6, recentCompletedImports: 10 }))).toContain('manual_review_rate_high');
  });

  it('manual review rate exactly 0.5 does not alert', () => {
    expect(codes(evalMetrics({ recentManualReviewRequired: 5, recentCompletedImports: 10 }))).not.toContain('manual_review_rate_high');
  });

  it('goldenQualityGateFailed = 1 creates a critical release-blocking alert', () => {
    const s = evalMetrics({ goldenQualityGateFailed: 1 });
    const a = s.alerts.find((x) => x.code === 'golden_quality_gate_failed');
    expect(a?.severity).toBe('critical');
    expect(a?.releaseBlocking).toBe(true);
  });

  it('goldenQualityGateBlocked = 1 creates a critical release-blocking alert', () => {
    const s = evalMetrics({ goldenQualityGateBlocked: 1 });
    const a = s.alerts.find((x) => x.code === 'golden_quality_gate_blocked');
    expect(a?.severity).toBe('critical');
    expect(a?.releaseBlocking).toBe(true);
  });

  it('goldenSummariesCount = 0 creates golden_summary_missing', () => {
    expect(codes(evalMetrics({ goldenSummariesCount: 0 }))).toContain('golden_summary_missing');
  });

  it('goldenHistoryRowsCount = 0 creates golden_history_missing', () => {
    expect(codes(evalMetrics({ goldenHistoryRowsCount: 0 }))).toContain('golden_history_missing');
  });

  it('corpusCoveredCount 5 creates corpus_coverage_incomplete', () => {
    expect(codes(evalMetrics({ corpusCoveredCount: 5 }))).toContain('corpus_coverage_incomplete');
  });

  it('baselineDegradedCount = 1 creates baseline_degraded', () => {
    expect(codes(evalMetrics({ baselineDegradedCount: 1 }))).toContain('baseline_degraded');
  });

  it('releaseBlockedDatabase true creates release_blocked_database', () => {
    expect(codes(evalMetrics({ releaseBlockedDatabase: true }))).toContain('release_blocked_database');
  });

  it('backendUnknownOperationCount = 1 creates backend_unknown_operation', () => {
    expect(codes(evalMetrics({ backendUnknownOperationCount: 1 }))).toContain('backend_unknown_operation');
  });

  it('privateArtifactRiskCount = 1 creates private_artifact_risk', () => {
    expect(codes(evalMetrics({ privateArtifactRiskCount: 1 }))).toContain('private_artifact_risk');
  });
});

describe('status + owner resolution', () => {
  it('a release-blocking critical sets status release_blocked', () => {
    expect(evalMetrics({ goldenQualityGateFailed: 1 }).status).toBe('release_blocked');
  });

  it('a critical non-release alert sets critical_alerts_present', () => {
    const alert = buildPdfImportMonitoringAlert({
      code: 'visual_quality_missing', // rule is not release-blocking
      metricValue: 1, threshold: 1, message: 'x', severityOverride: 'critical', now: NOW,
    });
    expect(resolvePdfImportMonitoringStatus([alert])).toBe('critical_alerts_present');
  });

  it('an error non-release alert sets errors_present', () => {
    const alert = buildPdfImportMonitoringAlert({
      code: 'visual_quality_missing', metricValue: 1, threshold: 1, message: 'x', severityOverride: 'error', now: NOW,
    });
    expect(resolvePdfImportMonitoringStatus([alert])).toBe('errors_present');
  });

  it('a warning alert sets warnings_present', () => {
    expect(evalMetrics({ completedImportsMissingVisualQa: 1 }).status).toBe('warnings_present');
  });

  it('primary owner resolves from the highest severity alert', () => {
    const s = evalMetrics({ goldenQualityGateFailed: 1, completedImportsMissingVisualQa: 1 });
    expect(s.primaryOwner).toBe('qa'); // golden_quality_gate_failed owner
    expect(resolvePrimaryMonitoringOwner([])).toBe('operator');
  });
});

describe('alert payload + helpers', () => {
  it('payload includes the top alert and counts', () => {
    const summary = evalMetrics({ goldenQualityGateFailed: 1, completedImportsMissingVisualQa: 1 });
    const payload = buildPdfImportAlertPayload(summary);
    expect(payload.releaseBlocked).toBe(true);
    expect(payload.criticalCount).toBe(1);
    expect(payload.warningCount).toBe(1);
    expect(payload.alertCount).toBe(2);
    expect(payload.alerts[0].code).toBe('golden_quality_gate_failed'); // sorted most-severe first
    expect(payload.title).toBe('PDF import release blocked');
  });

  it('calculateManualReviewRate returns null when recentCompletedImports is 0', () => {
    expect(calculateManualReviewRate(makeHealthyMetrics({ recentCompletedImports: 0 }))).toBeNull();
  });

  it('uses now() for generatedAt', () => {
    expect(evalMetrics().generatedAt).toBe('2026-07-06T00:00:00.000Z');
  });
});
