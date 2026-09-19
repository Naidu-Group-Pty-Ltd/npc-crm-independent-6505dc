import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PDF_IMPORT_MONITORING_THRESHOLDS,
  PDF_IMPORT_MONITORING_RULES,
  getPdfImportMonitoringActionLabel,
  getPdfImportMonitoringRule,
} from '../ingestion/monitoring';

describe('DEFAULT_PDF_IMPORT_MONITORING_THRESHOLDS', () => {
  it('includes failedImportsError = 1', () => {
    expect(DEFAULT_PDF_IMPORT_MONITORING_THRESHOLDS.failedImportsError).toBe(1);
  });
});

describe('PDF_IMPORT_MONITORING_RULES', () => {
  it('has unique codes', () => {
    const codes = PDF_IMPORT_MONITORING_RULES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('includes failed_imports_recent', () => {
    expect(PDF_IMPORT_MONITORING_RULES.some((r) => r.code === 'failed_imports_recent')).toBe(true);
  });

  it('golden_quality_gate_failed is critical and release-blocking', () => {
    const r = getPdfImportMonitoringRule('golden_quality_gate_failed');
    expect(r.severity).toBe('critical');
    expect(r.releaseBlocking).toBe(true);
  });

  it('release_blocked_database is critical and release-blocking', () => {
    const r = getPdfImportMonitoringRule('release_blocked_database');
    expect(r.severity).toBe('critical');
    expect(r.releaseBlocking).toBe(true);
  });

  it('private_artifact_risk is critical and release-blocking', () => {
    const r = getPdfImportMonitoringRule('private_artifact_risk');
    expect(r.severity).toBe('critical');
    expect(r.releaseBlocking).toBe(true);
  });

  it('visual_quality_missing is warning and not release-blocking', () => {
    const r = getPdfImportMonitoringRule('visual_quality_missing');
    expect(r.severity).toBe('warning');
    expect(r.releaseBlocking).toBe(false);
  });
});

describe('getPdfImportMonitoringRule', () => {
  it('returns the known rule', () => {
    expect(getPdfImportMonitoringRule('failed_imports_recent').code).toBe('failed_imports_recent');
  });

  it('returns a safe fallback for an unknown code', () => {
    const r = getPdfImportMonitoringRule('totally_unknown_code' as any);
    expect(r.owner).toBe('unknown');
    expect(r.primaryAction).toBe('escalate');
    expect(r.releaseBlocking).toBe(false);
  });
});

describe('getPdfImportMonitoringActionLabel', () => {
  it('returns a readable label for inspect_cloud_run_logs', () => {
    expect(getPdfImportMonitoringActionLabel('inspect_cloud_run_logs')).toBe('Inspect Cloud Run logs');
  });

  it('has a non-empty label for every rule primary action', () => {
    for (const rule of PDF_IMPORT_MONITORING_RULES) {
      expect(getPdfImportMonitoringActionLabel(rule.primaryAction).length).toBeGreaterThan(0);
    }
  });

  it('has a non-empty label for every rule secondary action', () => {
    for (const rule of PDF_IMPORT_MONITORING_RULES) {
      for (const action of rule.secondaryActions) {
        expect(getPdfImportMonitoringActionLabel(action).length).toBeGreaterThan(0);
      }
    }
  });
});
