import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  resolveExportParityAutomationLevel,
  runExportParityAutomation,
  runExportParityAutomationFromEvidence,
  type ExportParityEvidenceRef,
  type ExportParityRunnerInput,
} from '../ingestion/exportParity';
import { loadExportParityRunnerEvidence } from '@/lib/reportTemplate/ingestion/exportParity/exportParityEvidence';
import { saveExportParitySummary } from '@/lib/reportTemplate/ingestion/exportParity/exportParityPersistence';

vi.mock('@/lib/reportTemplate/ingestion/exportParity/exportParityEvidence', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/exportParity/exportParityEvidence')>();
  return { ...actual, loadExportParityRunnerEvidence: vi.fn() };
});
vi.mock('@/lib/reportTemplate/ingestion/exportParity/exportParityPersistence', async (orig) => {
  const actual = await orig<typeof import('@/lib/reportTemplate/ingestion/exportParity/exportParityPersistence')>();
  return { ...actual, saveExportParitySummary: vi.fn() };
});

const NOW = () => new Date('2026-07-05T00:00:00.000Z');

const ref = (kind: ExportParityEvidenceRef['kind'], pageNumber: number | null, extra: Partial<ExportParityEvidenceRef> = {}): ExportParityEvidenceRef => ({
  kind, pageNumber, path: 'p', url: null, width: null, height: null, score: null, available: true, reason: null, ...extra,
});

function input(overrides: Partial<ExportParityRunnerInput> = {}): ExportParityRunnerInput {
  return { importId: 'imp-1', templateId: 'tpl-1', mode: 'auto', ...overrides };
}

function pure(opts: { input: ExportParityRunnerInput; evidence?: ExportParityEvidenceRef[]; existingSummary?: any }) {
  return runExportParityAutomationFromEvidence({
    input: opts.input,
    evidence: opts.evidence ?? [],
    existingSummary: opts.existingSummary ?? null,
    now: NOW,
  });
}

const level2Evidence = [ref('source_raster', 1), ref('editor_raster', 1), ref('visual_quality_summary', 1, { score: 0.95 })];

describe('runExportParityAutomationFromEvidence (pure)', () => {
  it('fails with import_id_missing when importId is blank', () => {
    const r = pure({ input: input({ importId: '' }) });
    expect(r.status).toBe('failed');
    expect(r.blockers).toContain('import_id_missing');
    expect(r.summary).toBeNull();
  });

  it('returns not_ready/manual_required with blockers when there is no useful evidence', () => {
    const r = pure({ input: input() });
    expect(['not_ready', 'manual_required']).toContain(r.status);
    expect(r.blockers.length).toBeGreaterThan(0);
  });

  it('manual scores only produce level_1', () => {
    const r = pure({ input: input({ manualScores: { exportVsSourceScore: 0.9, editorVsSourceScore: 0.9, exportVsEditorScore: 0.9 } }) });
    expect(r.automationLevel).toBe('level_1_manual_compatible');
  });

  it('manual scores for all three pairs produce a completed summary', () => {
    const r = pure({ input: input({ manualScores: { exportVsSourceScore: 0.9, editorVsSourceScore: 0.9, exportVsEditorScore: 0.9 } }) });
    expect(r.status).toBe('completed');
    expect(r.summary?.status).toBe('completed');
  });

  it('source + editor evidence produces level_2', () => {
    const r = pure({ input: input(), evidence: level2Evidence });
    expect(r.automationLevel).toBe('level_2_source_editor');
  });

  it('source + editor only in auto returns partial or manual_required', () => {
    const r = pure({ input: input({ mode: 'auto' }), evidence: level2Evidence });
    expect(['partial', 'manual_required']).toContain(r.status);
  });

  it('source + editor + export evidence produces level_3', () => {
    const r = pure({
      input: input(),
      evidence: [...level2Evidence, ref('export_raster', 1, { score: 0.9 })],
    });
    expect(r.automationLevel).toBe('level_3_source_editor_export');
  });

  it('can reuse an existing summary', () => {
    const existing = { editorVsSourceScore: 0.9, exportVsSourceScore: 0.88, exportVsEditorScore: 0.87 };
    const r = pure({ input: input(), existingSummary: existing });
    expect(r.scores.exportVsSourceScore).toBe(0.88);
  });

  it('warns existing_summary_reused when an existing summary is used', () => {
    const r = pure({ input: input(), existingSummary: { editorVsSourceScore: 0.9, exportVsSourceScore: 0.88, exportVsEditorScore: 0.87 } });
    expect(r.warnings).toContain('existing_summary_reused');
  });

  it('warns manual_scores_used when manual scores are provided', () => {
    const r = pure({ input: input({ manualScores: { exportVsSourceScore: 0.9 } }) });
    expect(r.warnings).toContain('manual_scores_used');
  });

  it('reports export_rasterization_unavailable when export evidence is missing (auto)', () => {
    const r = pure({ input: input({ mode: 'auto' }), evidence: level2Evidence });
    expect(r.warnings).toContain('export_rasterization_unavailable');
  });

  it('source_editor_only mode does not require export evidence', () => {
    const r = pure({ input: input({ mode: 'source_editor_only' }), evidence: level2Evidence });
    expect(r.status).toBe('completed');
    expect(r.blockers).not.toContain('export_evidence_missing');
  });

  it('full mode requires export evidence', () => {
    const r = pure({ input: input({ mode: 'full' }), evidence: level2Evidence });
    expect(r.blockers).toContain('export_evidence_missing');
  });

  it('summary status completed when all required scores are available', () => {
    const r = pure({ input: input({ manualScores: { exportVsSourceScore: 0.9, editorVsSourceScore: 0.9, exportVsEditorScore: 0.9 } }) });
    expect(r.summary?.status).toBe('completed');
  });

  it('summary status manual_required when the export comparison is missing', () => {
    const r = pure({ input: input({ mode: 'auto' }), evidence: level2Evidence });
    expect(r.status).toBe('manual_required');
    expect(r.summary?.status).toBe('manual_required');
  });

  it('generatedAt uses now()', () => {
    const r = pure({ input: input(), evidence: level2Evidence });
    expect(r.generatedAt).toBe('2026-07-05T00:00:00.000Z');
  });
});

describe('resolveExportParityAutomationLevel', () => {
  it('is level_1 with no raster evidence', () => {
    expect(resolveExportParityAutomationLevel([])).toBe('level_1_manual_compatible');
  });
  it('is level_2 with source + editor rasters', () => {
    expect(resolveExportParityAutomationLevel([ref('source_raster', 1), ref('editor_raster', 1)])).toBe('level_2_source_editor');
  });
  it('is level_3 with source + editor + export rasters', () => {
    expect(resolveExportParityAutomationLevel([ref('source_raster', 1), ref('editor_raster', 1), ref('export_raster', 1)])).toBe('level_3_source_editor_export');
  });
});

describe('runExportParityAutomation (async)', () => {
  beforeEach(() => {
    vi.mocked(loadExportParityRunnerEvidence).mockReset();
    vi.mocked(saveExportParitySummary).mockReset();
    vi.mocked(loadExportParityRunnerEvidence).mockResolvedValue({ kind: 'ok', evidence: level2Evidence, existingSummary: null });
    vi.mocked(saveExportParitySummary).mockResolvedValue({ kind: 'ok', summaryPath: 'imp-1/export-parity/export-parity.json' });
  });

  it('persist=false does not call saveExportParitySummary', async () => {
    const r = await runExportParityAutomation({ input: input({ persist: false }), now: NOW });
    expect(saveExportParitySummary).not.toHaveBeenCalled();
    expect(r.persisted).toBe(false);
  });

  it('persist=true calls saveExportParitySummary and sets persisted true', async () => {
    const r = await runExportParityAutomation({ input: input({ persist: true }), now: NOW });
    expect(saveExportParitySummary).toHaveBeenCalledTimes(1);
    expect(r.persisted).toBe(true);
  });

  it('persistence failure sets persisted false and persistenceError', async () => {
    vi.mocked(saveExportParitySummary).mockResolvedValue({ kind: 'error', message: 'boom' });
    const r = await runExportParityAutomation({ input: input({ persist: true }), now: NOW });
    expect(r.persisted).toBe(false);
    expect(r.persistenceError).toBe('boom');
    expect(r.blockers).toContain('persistence_failed');
    expect(r.status).toBe('failed');
  });

  it('missing importId fails without a network call', async () => {
    const r = await runExportParityAutomation({ input: input({ importId: '' }), now: NOW });
    expect(loadExportParityRunnerEvidence).not.toHaveBeenCalled();
    expect(r.blockers).toContain('import_id_missing');
  });
});
