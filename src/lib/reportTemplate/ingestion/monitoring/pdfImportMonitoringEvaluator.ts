/**
 * pdfImportMonitoringEvaluator — Phase 9F.
 *
 * Pure evaluation of a monitoring metric snapshot into alerts + a summary +
 * an (un-sent) alert payload. Given counts from the Phase 9F SQL (or any future
 * scheduled collector), it derives signal codes, builds `open` alerts from the
 * rule catalog, and rolls them into a status: `healthy` / `warnings_present` /
 * `errors_present` / `critical_alerts_present` / `release_blocked`. No I/O and no
 * external alert delivery.
 */
import {
  DEFAULT_PDF_IMPORT_MONITORING_THRESHOLDS,
  getPdfImportMonitoringRule,
} from './pdfImportMonitoringRules';
import {
  PDF_IMPORT_MONITORING_VERSION,
  type PdfImportAlertPayload,
  type PdfImportMonitoringAlert,
  type PdfImportMonitoringEvaluationInput,
  type PdfImportMonitoringMetricSnapshot,
  type PdfImportMonitoringOwner,
  type PdfImportMonitoringSeverity,
  type PdfImportMonitoringSignalCode,
  type PdfImportMonitoringSummary,
  type PdfImportMonitoringThresholds,
} from './pdfImportMonitoringTypes';

const SEVERITY_RANK: Record<PdfImportMonitoringSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

interface DerivedSignal {
  code: PdfImportMonitoringSignalCode;
  metricValue: number | boolean | null;
  threshold: number | boolean | null;
  message: string;
  severityOverride?: PdfImportMonitoringSeverity;
}

/** Manual review rate over recent completed imports, or null when none. */
export function calculateManualReviewRate(
  metrics: PdfImportMonitoringMetricSnapshot,
): number | null {
  if (!metrics || !(metrics.recentCompletedImports > 0)) return null;
  return metrics.recentManualReviewRequired / metrics.recentCompletedImports;
}

/** Derive the triggered signal codes (+ metric/threshold/message) from a snapshot. */
export function derivePdfImportMonitoringSignalCodes(
  metrics: PdfImportMonitoringMetricSnapshot,
  thresholds?: Partial<PdfImportMonitoringThresholds>,
): DerivedSignal[] {
  const t: PdfImportMonitoringThresholds = { ...DEFAULT_PDF_IMPORT_MONITORING_THRESHOLDS, ...(thresholds ?? {}) };
  const m = metrics;
  const out: DerivedSignal[] = [];

  if (m.failedImports24h >= t.failedImportsError) {
    const critical = m.failedImports24h >= t.failedImportsCritical;
    out.push({
      code: 'failed_imports_recent',
      metricValue: m.failedImports24h,
      threshold: critical ? t.failedImportsCritical : t.failedImportsError,
      message: `${m.failedImports24h} PDF import(s) failed in the last 24h.`,
      severityOverride: critical ? 'critical' : 'error',
    });
  }

  if (m.stuckImports30m >= t.stuckImportsError) {
    out.push({ code: 'stuck_imports_recent', metricValue: m.stuckImports30m, threshold: t.stuckImportsError, message: `${m.stuckImports30m} import(s) stuck for more than 30 minutes.` });
  }

  if (m.failedDiagnosticsJobs24h >= t.diagnosticsJobsFailedError) {
    out.push({ code: 'diagnostics_jobs_failed', metricValue: m.failedDiagnosticsJobs24h, threshold: t.diagnosticsJobsFailedError, message: `${m.failedDiagnosticsJobs24h} diagnostics job(s) failed in the last 24h.` });
  }

  if (m.completedImportsWithoutEngineVersion > 0) {
    out.push({ code: 'engine_version_missing', metricValue: m.completedImportsWithoutEngineVersion, threshold: 0, message: `${m.completedImportsWithoutEngineVersion} completed import(s) missing engine version.` });
  }

  if (m.completedImportsMissingVisualQa >= t.missingVisualQaWarning) {
    out.push({ code: 'visual_quality_missing', metricValue: m.completedImportsMissingVisualQa, threshold: t.missingVisualQaWarning, message: `${m.completedImportsMissingVisualQa} completed import(s) missing Visual QA.` });
  }

  if (m.visualQaMissingRepairAudit >= t.missingRepairAuditWarning) {
    out.push({ code: 'repair_audit_missing', metricValue: m.visualQaMissingRepairAudit, threshold: t.missingRepairAuditWarning, message: `${m.visualQaMissingRepairAudit} import(s) with Visual QA missing a repair audit.` });
  }

  if (m.goldenReadyMissingExportParity > 0) {
    out.push({ code: 'export_parity_missing', metricValue: m.goldenReadyMissingExportParity, threshold: 0, message: `${m.goldenReadyMissingExportParity} golden-ready import(s) missing export parity.` });
  }

  if (m.exportParityFailed >= t.exportParityFailedError) {
    out.push({ code: 'export_parity_failed', metricValue: m.exportParityFailed, threshold: t.exportParityFailedError, message: `${m.exportParityFailed} export parity failure(s).` });
  }

  if (m.exportParityManualRequired > 0) {
    out.push({ code: 'export_parity_manual_required', metricValue: m.exportParityManualRequired, threshold: 0, message: `${m.exportParityManualRequired} export parity result(s) require manual review.` });
  }

  const rate = calculateManualReviewRate(m);
  if (rate !== null && rate > t.manualReviewRateWarning) {
    out.push({ code: 'manual_review_rate_high', metricValue: rate, threshold: t.manualReviewRateWarning, message: `Manual review rate ${Math.round(rate * 100)}% exceeds ${Math.round(t.manualReviewRateWarning * 100)}%.` });
  }

  if (m.goldenQualityGateFailed >= t.goldenGateFailedCritical) {
    out.push({ code: 'golden_quality_gate_failed', metricValue: m.goldenQualityGateFailed, threshold: t.goldenGateFailedCritical, message: `${m.goldenQualityGateFailed} golden run(s) failed the quality gate.` });
  }

  if (m.goldenQualityGateBlocked >= t.goldenGateFailedCritical) {
    out.push({ code: 'golden_quality_gate_blocked', metricValue: m.goldenQualityGateBlocked, threshold: t.goldenGateFailedCritical, message: `${m.goldenQualityGateBlocked} golden run(s) are blocked.` });
  }

  if (m.goldenSummariesCount === 0) {
    out.push({ code: 'golden_summary_missing', metricValue: 0, threshold: 0, message: 'No golden regression summaries are present.' });
  }

  if (m.goldenHistoryRowsCount === 0) {
    out.push({ code: 'golden_history_missing', metricValue: 0, threshold: 0, message: 'No golden run history rows are present.' });
  }

  if (m.corpusCoveredCount < t.corpusCoverageExpected) {
    out.push({ code: 'corpus_coverage_incomplete', metricValue: m.corpusCoveredCount, threshold: t.corpusCoverageExpected, message: `Only ${m.corpusCoveredCount}/${t.corpusCoverageExpected} corpus items are covered.` });
  }

  if (m.baselineDegradedCount >= t.baselineDegradedWarning) {
    out.push({ code: 'baseline_degraded', metricValue: m.baselineDegradedCount, threshold: t.baselineDegradedWarning, message: `${m.baselineDegradedCount} baseline comparison(s) degraded.` });
  }

  if (m.releaseBlockedDatabase === true) {
    out.push({ code: 'release_blocked_database', metricValue: true, threshold: true, message: 'Database-side release gate is blocked.' });
  }

  if (m.backendUnknownOperationCount >= t.backendUnknownOperationCritical) {
    out.push({ code: 'backend_unknown_operation', metricValue: m.backendUnknownOperationCount, threshold: t.backendUnknownOperationCritical, message: `${m.backendUnknownOperationCount} backend unknown-operation signal(s) detected.` });
  }

  if (m.privateArtifactRiskCount >= t.privateArtifactRiskCritical) {
    out.push({ code: 'private_artifact_risk', metricValue: m.privateArtifactRiskCount, threshold: t.privateArtifactRiskCritical, message: `${m.privateArtifactRiskCount} private artifact risk signal(s) detected.` });
  }

  return out;
}

export function buildPdfImportMonitoringAlert(options: {
  code: PdfImportMonitoringSignalCode;
  metricValue: number | boolean | null;
  threshold: number | boolean | null;
  message: string;
  severityOverride?: PdfImportMonitoringSeverity;
  now?: () => Date;
}): PdfImportMonitoringAlert {
  const rule = getPdfImportMonitoringRule(options.code);
  const now = options.now ?? (() => new Date());
  return {
    version: PDF_IMPORT_MONITORING_VERSION,
    code: options.code,
    domain: rule.domain,
    severity: options.severityOverride ?? rule.severity,
    status: 'open',
    owner: rule.owner,
    primaryAction: rule.primaryAction,
    secondaryActions: rule.secondaryActions,
    releaseBlocking: rule.releaseBlocking,
    title: rule.title,
    message: options.message,
    metricValue: options.metricValue,
    threshold: options.threshold,
    runbookAnchor: rule.runbookAnchor,
    createdAt: now().toISOString(),
  };
}

export function resolveHighestMonitoringSeverity(
  alerts: PdfImportMonitoringAlert[],
): PdfImportMonitoringSeverity {
  let highest: PdfImportMonitoringSeverity = 'info';
  for (const a of Array.isArray(alerts) ? alerts : []) {
    if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[highest]) highest = a.severity;
  }
  return highest;
}

export function resolvePdfImportMonitoringStatus(
  alerts: PdfImportMonitoringAlert[],
): PdfImportMonitoringSummary['status'] {
  const list = Array.isArray(alerts) ? alerts : [];
  if (list.some((a) => a.releaseBlocking && (a.severity === 'critical' || a.severity === 'error'))) return 'release_blocked';
  if (list.some((a) => a.severity === 'critical')) return 'critical_alerts_present';
  if (list.some((a) => a.severity === 'error')) return 'errors_present';
  if (list.some((a) => a.severity === 'warning')) return 'warnings_present';
  return 'healthy';
}

export function resolvePrimaryMonitoringOwner(
  alerts: PdfImportMonitoringAlert[],
): PdfImportMonitoringOwner {
  const list = Array.isArray(alerts) ? alerts : [];
  if (list.length === 0) return 'operator';
  const highest = resolveHighestMonitoringSeverity(list);
  const first = list.find((a) => a.severity === highest);
  return first?.owner ?? 'operator';
}

export function evaluatePdfImportMonitoring(
  input: PdfImportMonitoringEvaluationInput,
): PdfImportMonitoringSummary {
  const now = input?.now ?? (() => new Date());
  const metrics = input.metrics;

  const signals = derivePdfImportMonitoringSignalCodes(metrics, input?.thresholds);
  const alerts = signals
    .map((s) => buildPdfImportMonitoringAlert({ ...s, now }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const counts = {
    total: alerts.length,
    info: alerts.filter((a) => a.severity === 'info').length,
    warning: alerts.filter((a) => a.severity === 'warning').length,
    error: alerts.filter((a) => a.severity === 'error').length,
    critical: alerts.filter((a) => a.severity === 'critical').length,
    releaseBlocking: alerts.filter((a) => a.releaseBlocking).length,
  };

  const status = resolvePdfImportMonitoringStatus(alerts);

  return {
    version: PDF_IMPORT_MONITORING_VERSION,
    status,
    alerts,
    counts,
    primaryOwner: resolvePrimaryMonitoringOwner(alerts),
    highestSeverity: resolveHighestMonitoringSeverity(alerts),
    releaseBlocked: status === 'release_blocked',
    generatedAt: now().toISOString(),
  };
}

const STATUS_TITLE: Record<PdfImportMonitoringSummary['status'], string> = {
  healthy: 'PDF import monitoring healthy',
  warnings_present: 'PDF import monitoring warnings present',
  errors_present: 'PDF import monitoring errors present',
  critical_alerts_present: 'PDF import monitoring critical alerts present',
  release_blocked: 'PDF import release blocked',
};

export function buildPdfImportAlertPayload(
  summary: PdfImportMonitoringSummary,
): PdfImportAlertPayload {
  const alerts = Array.isArray(summary.alerts) ? summary.alerts : [];
  const summaryText =
    `${summary.counts.total} alert(s): ${summary.counts.critical} critical, ${summary.counts.error} error, ` +
    `${summary.counts.warning} warning. Owner: ${summary.primaryOwner}.` +
    (summary.releaseBlocked ? ' Release is blocked.' : '');

  return {
    version: PDF_IMPORT_MONITORING_VERSION,
    title: STATUS_TITLE[summary.status],
    severity: summary.highestSeverity,
    status: summary.status,
    releaseBlocked: summary.releaseBlocked,
    primaryOwner: summary.primaryOwner,
    alertCount: summary.counts.total,
    criticalCount: summary.counts.critical,
    errorCount: summary.counts.error,
    warningCount: summary.counts.warning,
    summaryText,
    alerts: alerts.slice(0, 10).map((a) => ({
      code: a.code,
      title: a.title,
      severity: a.severity,
      owner: a.owner,
      action: a.primaryAction,
      message: a.message,
    })),
    generatedAt: summary.generatedAt,
  };
}
