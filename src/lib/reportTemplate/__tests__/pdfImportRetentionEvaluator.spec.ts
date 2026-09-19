import { describe, expect, it } from 'vitest';
import {
  buildPdfImportRetentionDedupeKey,
  buildPdfImportRetentionSignals,
  evaluatePdfImportRetention,
} from '../ingestion/retention';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');
const OLD = '2026-01-01T00:00:00.000Z'; // ~189 days before NOW

function evalWith(over: Partial<Parameters<typeof buildPdfImportRetentionSignals>[0]>) {
  return evaluatePdfImportRetention(buildPdfImportRetentionSignals({ now: NOW, ...over }));
}
function ruleIds(events: { retentionRuleId: string }[]) {
  return events.map((e) => e.retentionRuleId);
}

describe('evaluatePdfImportRetention', () => {
  it('emits source_pdf_retained (blocked) for imports with a source', () => {
    const res = evalWith({ imports: [{ id: 'imp-1', status: 'succeeded', source_filename: 'a.pdf', meta: {} }] });
    const e = res.events.find((x) => x.retentionRuleId === 'source_pdf_retained');
    expect(e?.decision).toBe('blocked');
    expect(e?.cleanupAction).toBe('blocked_from_cleanup');
  });

  it('archives old successful-import diagnostics', () => {
    const res = evalWith({ imports: [{ id: 'imp-1', status: 'succeeded', updated_at: OLD, meta: { sign_pdf_diagnostics_artifact_path: 'imports/imp-1/diag.json' } }] });
    const e = res.events.find((x) => x.retentionRuleId === 'diagnostics_old_success');
    expect(e?.decision).toBe('archive_candidate');
  });

  it('retains failed-import diagnostics', () => {
    const res = evalWith({ imports: [{ id: 'imp-1', status: 'failed', updated_at: OLD, meta: { sign_pdf_diagnostics_artifact_path: 'imports/imp-1/diag.json' } }] });
    expect(ruleIds(res.events)).toContain('diagnostics_failed_import_retained');
  });

  it('archives old accepted Visual QA', () => {
    const res = evalWith({ imports: [{ id: 'imp-1', status: 'succeeded', updated_at: OLD, meta: { visual_quality_artifact_path: 'imports/imp-1/vq.json', production_operator_control_audit: { operatorState: { decision: 'accepted' } } } }] });
    expect(ruleIds(res.events)).toContain('visual_quality_old_accepted');
  });

  it('retains manual-review Visual QA', () => {
    const res = evalWith({ imports: [{ id: 'imp-1', status: 'succeeded', updated_at: OLD, meta: { visual_quality_artifact_path: 'imports/imp-1/vq.json', visual_quality_summary: { manualReviewRequired: true } } }] });
    expect(ruleIds(res.events)).toContain('visual_quality_manual_review_retained');
  });

  it('archives old export parity but retains golden export parity', () => {
    const oldEp = evalWith({ imports: [{ id: 'imp-1', status: 'succeeded', updated_at: OLD, meta: { export_parity_artifact_path: 'imports/imp-1/ep.json' } }] });
    expect(ruleIds(oldEp.events)).toContain('export_parity_old');

    const golden = evalWith({ imports: [{ id: 'imp-2', status: 'succeeded', updated_at: OLD, meta: { export_parity_artifact_path: 'imports/imp-2/ep.json', export_parity_summary: { isGoldenBaseline: true } } }] });
    expect(ruleIds(golden.events)).toContain('export_parity_golden_retained');
  });

  it('retains golden history', () => {
    const res = evalWith({ goldenRuns: [{ id: 'run-1', corpus_id: 'golden-simple-001' }] });
    const e = res.events.find((x) => x.retentionRuleId === 'golden_history_retained');
    expect(e?.decision).toBe('retain');
  });

  it('archives old resolved monitoring events but retains open ones', () => {
    const oldResolved = evalWith({ monitoringEvents: [{ id: 'evt-1', status: 'resolved', updated_at: OLD }] });
    expect(ruleIds(oldResolved.events)).toContain('monitoring_event_old_resolved');

    const open = evalWith({ monitoringEvents: [{ id: 'evt-2', status: 'open', updated_at: OLD }] });
    expect(ruleIds(open.events)).not.toContain('monitoring_event_old_resolved');
  });

  it('flags oversized phase10 metadata for compaction', () => {
    const res = evalWith({ imports: [{ id: 'imp-1', status: 'succeeded', meta_size_bytes: 900000, meta: {} }] });
    const e = res.events.find((x) => x.retentionRuleId === 'phase10_metadata_large');
    expect(e?.cleanupAction).toBe('compact_metadata_later');
    expect(e?.estimatedBytes).toBe(900000);
  });

  it('flags orphaned storage objects as delete candidates (developer approval)', () => {
    const res = evalWith({ storageObjects: [{ id: 'o1', name: 'imports/old/orphan.json', created_at: OLD, metadata: { size: 2048 } }] });
    const e = res.events.find((x) => x.retentionRuleId === 'storage_object_orphaned');
    expect(e?.decision).toBe('delete_candidate');
    expect(e?.safetyLevel).toBe('requires_developer_approval');
    expect(e?.estimatedBytes).toBe(2048);
  });

  it('flags missing referenced objects for repair', () => {
    const res = evalWith({
      imports: [{ id: 'imp-1', status: 'succeeded', meta: { visual_quality_artifact_path: 'imports/imp-1/vq.json' } }],
      storageObjects: [{ id: 'o1', name: 'imports/other/keep.json', created_at: NOW().toISOString() }],
    });
    expect(ruleIds(res.events)).toContain('metadata_reference_missing_object');
  });

  it('flags recent unreferenced storage objects for review', () => {
    const res = evalWith({ storageObjects: [{ id: 'o1', name: 'imports/recent/new.json', created_at: NOW().toISOString() }] });
    expect(ruleIds(res.events)).toContain('unknown_artifact_review');
  });

  it('produces a stable dedupe key and no duplicate events', () => {
    expect(buildPdfImportRetentionDedupeKey({ retentionRuleId: 'r', scopeType: 't', scopeId: 'i' })).toBe('r:t:i');
    const res = evalWith({ imports: [{ id: 'imp-1', status: 'succeeded', source_filename: 'a.pdf', meta: {} }] });
    const keys = res.events.map((e) => e.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('calculates recoverable bytes and decision counts', () => {
    const res = evalWith({
      storageObjects: [
        { id: 'o1', name: 'a/orphan1.json', created_at: OLD, metadata: { size: 1000 } },
        { id: 'o2', name: 'a/orphan2.json', created_at: OLD, metadata: { size: 500 } },
      ],
    });
    expect(res.deleteCandidateCount).toBe(2);
    expect(res.estimatedRecoverableBytes).toBe(1500);
  });
});
