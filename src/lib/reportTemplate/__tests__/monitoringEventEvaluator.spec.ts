import { describe, expect, it } from 'vitest';
import {
  applyLifecycleAction,
  buildCandidateEvent,
  buildMonitoringEventKey,
  buildMonitoringHealthRollup,
  evaluateMonitoringEvents,
  isSuppressionExpired,
  mergeCandidateIntoExisting,
  resolveHighestActiveSeverity,
  shouldAutoResolve,
  type MonitoringEvent,
  type MonitoringMetricSnapshot,
} from '../ingestion/monitoring';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');
const LATER = () => new Date('2026-07-09T01:00:00.000Z');

function makeHealthyMetrics(overrides: Partial<MonitoringMetricSnapshot> = {}): MonitoringMetricSnapshot {
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

function candidate(ruleId: string, severity?: MonitoringEvent['severity']): MonitoringEvent {
  return buildCandidateEvent(
    { ruleId: ruleId as never, severity, metricValue: 1, threshold: 0, summary: 'x' },
    { now: NOW },
  );
}

describe('evaluateMonitoringEvents', () => {
  it('is healthy for a clean snapshot with all rules cleared', () => {
    const result = evaluateMonitoringEvents({ metrics: makeHealthyMetrics(), now: NOW });
    expect(result.candidates).toEqual([]);
    expect(result.rollup.status).toBe('healthy');
    expect(result.clearedRuleIds).toHaveLength(34);
    expect(result.generatedAt).toBe('2026-07-09T00:00:00.000Z');
  });

  it('builds open candidates and a critical rollup when critical fires', () => {
    const result = evaluateMonitoringEvents({
      metrics: makeHealthyMetrics({ goldenQualityGateFailed: 1, failedImports24h: 1 }),
      now: NOW,
    });
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    expect(result.candidates.every((e) => e.status === 'open')).toBe(true);
    expect(result.rollup.status).toBe('critical_alerts_present');
    expect(result.rollup.releaseBlockingActive).toBe(true);
    expect(result.clearedRuleIds).not.toContain('golden_quality_gate_failed');
  });
});

describe('buildMonitoringEventKey', () => {
  it('is deterministic and scoped', () => {
    expect(buildMonitoringEventKey('import_failure_detected')).toBe('import_failure_detected:global');
    expect(buildMonitoringEventKey('import_failure_detected', 'corpus-a')).toBe('import_failure_detected:corpus-a');
  });
});

describe('mergeCandidateIntoExisting', () => {
  it('increments occurrence and refreshes an active event', () => {
    const existing = candidate('import_failure_detected', 'warning');
    const next = candidate('import_failure_detected', 'high');
    const merged = mergeCandidateIntoExisting(existing, next, LATER);
    expect(merged.occurrenceCount).toBe(2);
    expect(merged.severity).toBe('high');
    expect(merged.status).toBe('open');
    expect(merged.lastSeenAt).toBe('2026-07-09T01:00:00.000Z');
  });

  it('reopens a resolved event when the signal fires again', () => {
    const existing: MonitoringEvent = { ...candidate('import_failure_detected'), status: 'resolved', resolvedAt: NOW().toISOString(), resolvedBy: 'u1' };
    const merged = mergeCandidateIntoExisting(existing, candidate('import_failure_detected'), LATER);
    expect(merged.status).toBe('open');
    expect(merged.resolvedAt).toBeNull();
  });

  it('keeps a false_positive event false_positive (idempotent)', () => {
    const existing: MonitoringEvent = { ...candidate('import_failure_detected'), status: 'false_positive' };
    const merged = mergeCandidateIntoExisting(existing, candidate('import_failure_detected'), LATER);
    expect(merged.status).toBe('false_positive');
    expect(merged.occurrenceCount).toBe(2);
  });

  it('keeps an unexpired suppression suppressed', () => {
    const existing: MonitoringEvent = {
      ...candidate('import_failure_detected'),
      status: 'suppressed',
      suppressedUntil: '2026-07-10T00:00:00.000Z',
    };
    const merged = mergeCandidateIntoExisting(existing, candidate('import_failure_detected'), LATER);
    expect(merged.status).toBe('suppressed');
  });
});

describe('applyLifecycleAction', () => {
  it('acknowledges only an open event', () => {
    const open = candidate('import_failure_detected');
    const ack = applyLifecycleAction(open, 'acknowledge', { actorId: 'u1', now: LATER });
    expect(ack?.status).toBe('acknowledged');
    expect(ack?.acknowledgedBy).toBe('u1');
    expect(applyLifecycleAction(ack!, 'acknowledge', { actorId: 'u1', now: LATER })).toBeNull();
  });

  it('resolves an acknowledged event', () => {
    const ack: MonitoringEvent = { ...candidate('import_failure_detected'), status: 'acknowledged' };
    const resolved = applyLifecycleAction(ack, 'resolve', { actorId: 'u2', now: LATER });
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedBy).toBe('u2');
  });

  it('suppresses with an optional window and refuses on resolved', () => {
    const open = candidate('import_failure_detected');
    const sup = applyLifecycleAction(open, 'suppress', { suppressUntil: '2026-07-10T00:00:00.000Z', now: LATER });
    expect(sup?.status).toBe('suppressed');
    expect(sup?.suppressedUntil).toBe('2026-07-10T00:00:00.000Z');
    const resolved: MonitoringEvent = { ...open, status: 'resolved' };
    expect(applyLifecycleAction(resolved, 'suppress', { now: LATER })).toBeNull();
  });

  it('marks false positive', () => {
    const open = candidate('import_failure_detected');
    const fp = applyLifecycleAction(open, 'mark_false_positive', { actorId: 'u3', now: LATER });
    expect(fp?.status).toBe('false_positive');
  });
});

describe('rollup + helpers', () => {
  it('reports highest active severity ignoring resolved/suppressed', () => {
    const events: MonitoringEvent[] = [
      { ...candidate('import_failure_detected', 'critical'), status: 'resolved' },
      { ...candidate('visual_qa_missing', 'warning'), status: 'open' },
    ];
    expect(resolveHighestActiveSeverity(events)).toBe('warning');
    expect(buildMonitoringHealthRollup(events, NOW).status).toBe('warnings_present');
  });

  it('auto-resolves only open/acknowledged events', () => {
    expect(shouldAutoResolve(candidate('import_failure_detected'))).toBe(true);
    expect(shouldAutoResolve({ ...candidate('import_failure_detected'), status: 'suppressed' })).toBe(false);
    expect(shouldAutoResolve({ ...candidate('import_failure_detected'), status: 'false_positive' })).toBe(false);
  });

  it('detects expired suppression', () => {
    const sup: MonitoringEvent = { ...candidate('import_failure_detected'), status: 'suppressed', suppressedUntil: '2026-07-09T00:30:00.000Z' };
    expect(isSuppressionExpired(sup, NOW)).toBe(false);
    expect(isSuppressionExpired(sup, LATER)).toBe(true);
  });
});
