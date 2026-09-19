import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MONITORING_THRESHOLDS,
  MONITORING_EVENT_DOMAINS,
  MONITORING_EVENT_RULES,
  MONITORING_EVENT_SEVERITIES,
  MONITORING_EVENT_STATUSES,
  assertMonitoringEventRuleCatalogIntegrity,
  getMonitoringEventRule,
} from '../ingestion/monitoring';

describe('monitoringEventRules — catalog integrity', () => {
  it('defines exactly 34 canonical rules across 16 domains', () => {
    expect(MONITORING_EVENT_RULES).toHaveLength(34);
    expect(MONITORING_EVENT_DOMAINS).toHaveLength(16);
    expect(MONITORING_EVENT_SEVERITIES).toEqual(['info', 'warning', 'high', 'critical']);
    expect(MONITORING_EVENT_STATUSES).toEqual([
      'open',
      'acknowledged',
      'resolved',
      'suppressed',
      'false_positive',
    ]);
  });

  it('passes catalog integrity (unique ids, valid domains, full coverage)', () => {
    const result = assertMonitoringEventRuleCatalogIntegrity();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('has a rule for every domain', () => {
    for (const domain of MONITORING_EVENT_DOMAINS) {
      expect(MONITORING_EVENT_RULES.some((r) => r.domain === domain)).toBe(true);
    }
  });

  it('marks security/permission/backend criticals as release-blocking', () => {
    const critical = MONITORING_EVENT_RULES.filter((r) => r.defaultSeverity === 'critical');
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.every((r) => r.releaseBlocking)).toBe(true);
  });

  it('returns a safe fallback rule for an unknown id', () => {
    const rule = getMonitoringEventRule('nope' as never);
    expect(rule.domain).toBe('monitoring_self');
    expect(rule.releaseBlocking).toBe(false);
  });

  it('provides sane default thresholds', () => {
    expect(DEFAULT_MONITORING_THRESHOLDS.failedImportsWarning).toBeLessThan(
      DEFAULT_MONITORING_THRESHOLDS.failedImportsHigh,
    );
    expect(DEFAULT_MONITORING_THRESHOLDS.failedImportsHigh).toBeLessThan(
      DEFAULT_MONITORING_THRESHOLDS.failedImportsCritical,
    );
  });
});
