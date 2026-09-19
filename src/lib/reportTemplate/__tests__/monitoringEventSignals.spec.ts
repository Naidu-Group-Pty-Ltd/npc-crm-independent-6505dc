import { describe, expect, it } from 'vitest';
import {
  calculateDurationRegressionRatio,
  calculateImportErrorRate,
  deriveMonitoringSignals,
  type MonitoringMetricSnapshot,
} from '../ingestion/monitoring';

function makeHealthyMetrics(
  overrides: Partial<MonitoringMetricSnapshot> = {},
): MonitoringMetricSnapshot {
  return {
    failedImports24h: 0,
    stuckImportsOver30m: 0,
    completedImports24h: 20,
    importDurationP95Ms: 1000,
    importDurationBaselineMs: 1000,
    failedDiagnosticsJobs24h: 0,
    completedImportsMissingEngineVersion: 0,
    sidecarUnavailable: false,
    completedImportsMissingSourceRaster: 0,
    publicArtifactBucketCount: 0,
    completedImportsMissingVisualQa: 0,
    lowSimilarityImports: 0,
    visualQaMissingRepairAudit: 0,
    repairFailures24h: 0,
    reconciliationManualBacklog: 0,
    reconciliationPlansUnresolved: 0,
    goldenReadyMissingExportParity: 0,
    exportParityFailed: 0,
    exportParityManualRequired: 0,
    goldenQualityGateFailed: 0,
    goldenQualityGateBlocked: 0,
    goldenBaselineDegraded: 0,
    goldenCorpusCovered: 6,
    goldenCorpusExpected: 6,
    releaseGateBlocked: false,
    releaseReadinessRegressed: false,
    backendUnknownOperationCount: 0,
    backendContractDriftCount: 0,
    privateArtifactExposureCount: 0,
    rawContentPersistenceRiskCount: 0,
    permissionEscalationCount: 0,
    unauthorizedWriteAttemptCount: 0,
    performanceBudgetBreachCount: 0,
    qualityGateRegressionCount: 0,
    blockedControlBypassCount: 0,
    lastCheckAgeMinutes: 0,
    ...overrides,
  };
}

describe('deriveMonitoringSignals', () => {
  it('fires nothing for a healthy snapshot', () => {
    expect(deriveMonitoringSignals(makeHealthyMetrics())).toEqual([]);
  });

  it('escalates import failures from warning → high → critical', () => {
    const warn = deriveMonitoringSignals(makeHealthyMetrics({ failedImports24h: 1 }));
    expect(warn.find((s) => s.ruleId === 'import_failure_detected')?.severity).toBe('warning');

    const high = deriveMonitoringSignals(makeHealthyMetrics({ failedImports24h: 3 }));
    expect(high.find((s) => s.ruleId === 'import_failure_detected')?.severity).toBe('high');

    const crit = deriveMonitoringSignals(makeHealthyMetrics({ failedImports24h: 8 }));
    expect(crit.find((s) => s.ruleId === 'import_failure_detected')?.severity).toBe('critical');
  });

  it('fires security + permission signals as discrete rules', () => {
    const signals = deriveMonitoringSignals(
      makeHealthyMetrics({
        privateArtifactExposureCount: 1,
        permissionEscalationCount: 2,
        publicArtifactBucketCount: 1,
      }),
    );
    const ids = signals.map((s) => s.ruleId);
    expect(ids).toContain('private_artifact_exposure_risk');
    expect(ids).toContain('permission_escalation_detected');
    expect(ids).toContain('artifact_bucket_public_exposure');
  });

  it('computes error rate and fires high above the high threshold', () => {
    const m = makeHealthyMetrics({ failedImports24h: 10, completedImports24h: 10 });
    expect(calculateImportErrorRate(m)).toBe(0.5);
    const signal = deriveMonitoringSignals(m).find((s) => s.ruleId === 'import_error_rate_high');
    expect(signal?.severity).toBe('high');
  });

  it('returns null error rate when there is no import volume', () => {
    expect(calculateImportErrorRate(makeHealthyMetrics({ completedImports24h: 0, failedImports24h: 0 }))).toBeNull();
  });

  it('computes duration regression ratio and fires past threshold', () => {
    const m = makeHealthyMetrics({ importDurationP95Ms: 3000, importDurationBaselineMs: 1000 });
    expect(calculateDurationRegressionRatio(m)).toBe(3);
    expect(deriveMonitoringSignals(m).some((s) => s.ruleId === 'import_duration_regression')).toBe(true);
  });

  it('never emits raw content in context', () => {
    const signals = deriveMonitoringSignals(makeHealthyMetrics({ failedImports24h: 2 }));
    for (const s of signals) {
      for (const v of Object.values(s.context ?? {})) {
        expect(['number', 'boolean', 'string', 'object']).toContain(typeof v);
      }
    }
  });
});
