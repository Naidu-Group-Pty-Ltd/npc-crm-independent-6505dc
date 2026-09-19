import { describe, expect, it } from 'vitest';
import {
  evaluatePdfImportFailureTriage,
  extractFailureSignalsFromGoldenRegression,
  normalizeFailureCode,
} from '../ingestion/failureTriage';

const NOW = () => new Date('2026-07-04T00:00:00.000Z');

function evalCodes(codes: string[]) {
  return evaluatePdfImportFailureTriage({ signals: codes.map((code) => ({ code })), now: NOW });
}

describe('evaluatePdfImportFailureTriage', () => {
  it('returns resolved/no_action/info for no signals', () => {
    const summary = evaluatePdfImportFailureTriage({ signals: [], now: NOW });
    expect(summary.severity).toBe('info');
    expect(summary.outcome).toBe('resolved');
    expect(summary.primaryAction).toBe('no_action');
    expect(summary.actionLabels).toEqual(['No action']);
    expect(summary.recommendations).toEqual([]);
  });

  it('looks up an exact rule', () => {
    const summary = evalCodes(['repair_audit_missing']);
    const rec = summary.recommendations[0];
    expect(rec.rule.category).toBe('repair');
    expect(rec.rule.primaryAction).toBe('rerun_repair');
    expect(rec.rule.owner).toBe('developer_backend');
  });

  it('falls back to the default unknown rule', () => {
    const summary = evalCodes(['something_totally_unmapped']);
    expect(summary.recommendations[0].rule.code).toBe('unknown');
    expect(summary.recommendations[0].rule.primaryAction).toBe('escalate_to_developer');
  });

  it('generatedAt honors now()', () => {
    expect(evalCodes(['repair_failed']).generatedAt).toBe('2026-07-04T00:00:00.000Z');
  });

  it('escalates when a critical rule is present (critical beats warning)', () => {
    const summary = evalCodes(['backend_unknown_operation', 'repair_skipped_no_eligible_pages']);
    expect(summary.severity).toBe('critical');
    expect(summary.primaryAction).toBe('patch_supabase_function');
    expect(summary.outcome).toBe('escalate');
  });

  it('error severity beats warning', () => {
    const summary = evalCodes(['manual_review_required', 'repair_failed']);
    expect(summary.severity).toBe('error');
    expect(summary.primaryOwner).toBe('developer_frontend'); // repair_failed
  });

  it('warning-only monitor rule → warning severity + monitor outcome', () => {
    const summary = evalCodes(['repair_skipped_no_eligible_pages']);
    expect(summary.severity).toBe('warning');
    expect(summary.outcome).toBe('monitor');
  });

  it('deduplicates recommendations by normalized code', () => {
    const summary = evalCodes(['repair_failed', 'repair_failed']);
    expect(summary.recommendations).toHaveLength(1);
  });

  it('deduplicates action labels', () => {
    const summary = evalCodes(['repair_failed', 'repair_audit_missing']);
    const unique = new Set(summary.actionLabels);
    expect(unique.size).toBe(summary.actionLabels.length);
  });
});

describe('normalizeFailureCode', () => {
  it('strips the fail_ prefix', () => {
    expect(normalizeFailureCode('fail_visual_quality_missing')).toBe('visual_quality_artifact_missing');
  });

  it('strips the message after a colon (gate id → failure code)', () => {
    expect(normalizeFailureCode('visual_quality_score_threshold:Visual QA score is below registry threshold.'))
      .toBe('visual_quality_below_threshold');
  });

  it('maps gate ids to failure codes', () => {
    expect(normalizeFailureCode('template_page_count_match')).toBe('template_page_count_mismatch');
    expect(normalizeFailureCode('repair_audit_present')).toBe('repair_audit_missing');
    expect(normalizeFailureCode('export_parity_artifact_present')).toBe('export_parity_artifact_missing');
  });

  it('strips warning_ prefix and maps variants', () => {
    expect(normalizeFailureCode('warning_repair_skipped')).toBe('repair_skipped_no_eligible_pages');
  });
});

describe('extractFailureSignalsFromGoldenRegression', () => {
  it('converts failures into signals', () => {
    const signals = extractFailureSignalsFromGoldenRegression({ failures: ['repair_audit_missing'] });
    expect(signals.map((s) => s.code)).toContain('repair_audit_missing');
  });

  it('adds quality_gate_failed when the gate status is fail', () => {
    const signals = extractFailureSignalsFromGoldenRegression({ qualityGateStatus: 'fail' });
    expect(signals.map((s) => s.code)).toContain('quality_gate_failed');
  });

  it('adds quality_gate_blocked when the gate status is blocked', () => {
    const signals = extractFailureSignalsFromGoldenRegression({ qualityGateStatus: 'blocked' });
    expect(signals.map((s) => s.code)).toContain('quality_gate_blocked');
  });

  it('adds operator_rejected when the operator rejected the run', () => {
    const signals = extractFailureSignalsFromGoldenRegression({ operatorDecision: 'rejected' });
    expect(signals.map((s) => s.code)).toContain('operator_rejected');
  });

  it('adds operator_needs_rerun when flagged for rerun', () => {
    const signals = extractFailureSignalsFromGoldenRegression({ operatorDecision: 'needs_rerun' });
    expect(signals.map((s) => s.code)).toContain('operator_needs_rerun');
  });

  it('deduplicates by raw code', () => {
    const signals = extractFailureSignalsFromGoldenRegression({
      failures: ['repair_failed', 'repair_failed'],
      warnings: ['repair_failed'],
    });
    expect(signals.filter((s) => s.code === 'repair_failed')).toHaveLength(1);
  });

  it('end-to-end: golden regression → triage summary', () => {
    const signals = extractFailureSignalsFromGoldenRegression({
      failures: ['visual_quality_artifact_present:Visual QA artifact is missing.'],
      qualityGateStatus: 'fail',
      operatorDecision: 'rejected',
    });
    const summary = evaluatePdfImportFailureTriage({ signals, now: NOW });
    expect(summary.severity).toBe('error');
    expect(summary.outcome).toBe('action_required');
    const codes = summary.recommendations.map((r) => r.rule.code);
    expect(codes).toContain('visual_quality_artifact_missing');
    expect(codes).toContain('quality_gate_failed');
    expect(codes).toContain('operator_rejected');
  });
});
