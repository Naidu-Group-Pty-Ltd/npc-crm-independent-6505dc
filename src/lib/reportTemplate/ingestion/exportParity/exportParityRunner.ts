/**
 * exportParityRunner — Phase 9D automated export parity runner.
 *
 * Automation-first, fallback-safe. It builds an export parity evaluation from
 * whatever render evidence is available:
 *   - Level 1 — manual/existing scores only
 *   - Level 2 — reuse Visual QA source/editor rasters + per-page scores
 *   - Level 3 — full source/editor/export comparison (only when export raster
 *     evidence exists; the current stack has none, so the runner reports
 *     `export_rasterization_unavailable` and returns partial/manual_required)
 *
 * The pure core (`runExportParityAutomationFromEvidence`) does no network I/O.
 * The async wrapper loads evidence and optionally persists via the existing
 * Phase 7F `saveExportParitySummary`. Runner-only metadata (automation level,
 * blockers, warnings, overall score) lives on the result — the persisted
 * `ExportParitySummary` keeps its strict Phase 7F shape (blockers are mirrored
 * into its `problems[]` so they survive persistence).
 */
import { EXPORT_PARITY_SUMMARY_VERSION, type ExportParitySummary } from './exportParityTypes';
import { exportParityPaths, saveExportParitySummary } from './exportParityPersistence';
import { loadExportParityRunnerEvidence } from './exportParityEvidence';
import {
  averageExportParityScores,
  buildExportParityPageComparison,
  clampExportParityScore,
  summarizeExportParityPairScores,
} from './exportParityScore';
import { groupExportParityEvidenceByPage } from './exportParityEvidence';
import {
  EXPORT_PARITY_RUNNER_VERSION,
  type ExportParityAutomationLevel,
  type ExportParityEvidenceRef,
  type ExportParityPageComparison,
  type ExportParityRunnerInput,
  type ExportParityRunnerMode,
  type ExportParityRunnerOptions,
  type ExportParityRunnerResult,
  type ExportParityRunnerScores,
  type ExportParityRunnerStatus,
} from './exportParityRunnerTypes';

function uniq(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (v && !out.includes(v)) out.push(v);
  return out;
}

function normalizeNotes(notes: unknown): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(notes) ? notes : []) {
    const s = String(raw ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** First valid (0..1) score from the candidates, else null. */
function firstScore(candidates: Array<number | null | undefined>): number | null {
  for (const c of candidates) {
    const s = clampExportParityScore(c);
    if (s !== null) return s;
  }
  return null;
}

/** Highest automation level supported by the available evidence. */
export function resolveExportParityAutomationLevel(
  evidence: ExportParityEvidenceRef[],
): ExportParityAutomationLevel {
  const list = Array.isArray(evidence) ? evidence : [];
  const hasSource = list.some((e) => e.kind === 'source_raster' && e.available);
  const hasEditor = list.some((e) => e.kind === 'editor_raster' && e.available);
  const hasExport = list.some((e) => e.kind === 'export_raster' && e.available);
  if (hasSource && hasEditor && hasExport) return 'level_3_source_editor_export';
  if (hasSource && hasEditor) return 'level_2_source_editor';
  return 'level_1_manual_compatible';
}

/** Resolve the runner status from the mode, blockers, and available scores. */
export function resolveExportParityRunnerStatus(input: {
  mode: ExportParityRunnerMode;
  blockers: string[];
  warnings: string[];
  scores: ExportParityRunnerScores;
  evidence: ExportParityEvidenceRef[];
}): ExportParityRunnerStatus {
  const { mode, blockers, scores } = input;
  if (blockers.includes('import_id_missing')) return 'failed';
  if (blockers.includes('persistence_failed')) return 'failed';

  const hasEditor = scores.editorVsSourceScore != null;
  const hasExportSource = scores.exportVsSourceScore != null;
  const hasExportEditor = scores.exportVsEditorScore != null;
  const anyScore = hasEditor || hasExportSource || hasExportEditor;
  if (!anyScore) return 'not_ready';

  switch (mode) {
    case 'source_editor_only':
      return hasEditor ? 'completed' : 'not_ready';
    case 'source_export_only':
      return hasExportSource ? 'completed' : 'manual_required';
    case 'editor_export_only':
      return hasExportEditor ? 'completed' : 'manual_required';
    case 'full':
    case 'auto':
    default:
      if (hasEditor && hasExportSource && hasExportEditor) return 'completed';
      if (hasExportSource || hasExportEditor) return 'partial';
      return 'manual_required';
  }
}

/** Map a runner result (minus summary) into a strict Phase 7F ExportParitySummary. */
export function buildExportParitySummaryFromRunnerResult(
  result: Omit<ExportParityRunnerResult, 'summary'>,
): ExportParitySummary {
  const importId = result.importId ?? '';
  const summaryStatus: ExportParitySummary['status'] =
    result.status === 'manual_required' ? 'manual_required'
      : result.status === 'failed' || result.status === 'not_ready' ? 'failed'
      : 'completed';

  const summaryMode: ExportParitySummary['mode'] =
    result.automationLevel === 'level_3_source_editor_export' && result.status === 'completed' ? 'automated'
      : result.automationLevel === 'level_2_source_editor' || result.warnings.includes('manual_scores_used') ? 'hybrid'
      : 'manual';

  const pages = result.pageComparisons
    .filter((c) => c.pair === 'source_vs_editor')
    .map((c) => ({
      pageNumber: c.pageNumber,
      editorVsSourceScore: c.score,
      exportVsSourceScore: null,
      exportVsEditorScore: null,
      manualReviewRequired: c.status !== 'pass',
      problems: c.status === 'fail' ? ['editor_vs_source_below_threshold'] : [],
    }));

  return {
    version: EXPORT_PARITY_SUMMARY_VERSION,
    importId,
    templateId: result.templateId ?? null,
    mode: summaryMode,
    status: summaryStatus,
    sourcePageCount: null,
    editorPageCount: null,
    exportedPageCount: null,
    editorVsSourceScore: result.scores.editorVsSourceScore,
    exportVsSourceScore: result.scores.exportVsSourceScore,
    exportVsEditorScore: result.scores.exportVsEditorScore,
    manualReviewRequired: result.status !== 'completed',
    pages,
    problems: uniq([...result.blockers]),
    artifactPaths: { summaryPath: importId ? exportParityPaths.summary(importId) : null },
    generatedAt: result.generatedAt,
  };
}

/** Pure runner — no network. Builds comparisons/scores/status from evidence. */
export function runExportParityAutomationFromEvidence(options: {
  input: ExportParityRunnerInput;
  evidence: ExportParityEvidenceRef[];
  existingSummary?: ExportParitySummary | null;
  now?: () => Date;
}): ExportParityRunnerResult {
  const input = options.input ?? ({} as ExportParityRunnerInput);
  const evidence = Array.isArray(options.evidence) ? options.evidence : [];
  const existingSummary = options.existingSummary ?? null;
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const mode: ExportParityRunnerMode = input.mode ?? 'auto';
  const importId = typeof input.importId === 'string' ? input.importId.trim() : '';
  const notes = normalizeNotes(input.notes);

  const emptyScores: ExportParityRunnerScores = {
    exportVsSourceScore: null, editorVsSourceScore: null, exportVsEditorScore: null, overallScore: null,
  };

  if (!importId) {
    return {
      version: EXPORT_PARITY_RUNNER_VERSION,
      importId: null,
      templateId: input.templateId ?? null,
      mode,
      status: 'failed',
      automationLevel: 'level_1_manual_compatible',
      summary: null,
      pageComparisons: [],
      evidence,
      scores: emptyScores,
      blockers: ['import_id_missing'],
      warnings: [],
      notes,
      persisted: false,
      persistenceError: null,
      generatedAt,
    };
  }

  const automationLevel = resolveExportParityAutomationLevel(evidence);
  const grouped = groupExportParityEvidenceByPage(evidence);

  const pageComparisons: ExportParityPageComparison[] = [];
  for (const [pageStr, refs] of Object.entries(grouped)) {
    const pageNumber = Number(pageStr);
    const vq = refs.find((r) => r.kind === 'visual_quality_summary');
    if (!vq) continue;
    pageComparisons.push(buildExportParityPageComparison({
      pageNumber,
      pair: 'source_vs_editor',
      score: vq.score ?? null,
      missingIsManual: false,
      left: refs.find((r) => r.kind === 'source_raster') ?? null,
      right: refs.find((r) => r.kind === 'editor_raster') ?? null,
    }));
  }
  pageComparisons.sort((a, b) => a.pageNumber - b.pageNumber);

  const base = summarizeExportParityPairScores(pageComparisons);
  const vqDocScore = evidence.find((e) => e.kind === 'visual_quality_summary' && e.pageNumber == null)?.score ?? null;
  const exportEvidenceScore = evidence.find((e) => e.kind === 'export_raster' && e.available && e.score != null)?.score ?? null;
  const manual = input.manualScores ?? {};

  const editorVsSourceScore = firstScore([manual.editorVsSourceScore, base.editorVsSourceScore, vqDocScore, existingSummary?.editorVsSourceScore]);
  const exportVsSourceScore = firstScore([manual.exportVsSourceScore, existingSummary?.exportVsSourceScore, exportEvidenceScore]);
  const exportVsEditorScore = firstScore([manual.exportVsEditorScore, existingSummary?.exportVsEditorScore, exportEvidenceScore]);
  const overallScore = averageExportParityScores([editorVsSourceScore, exportVsSourceScore, exportVsEditorScore]);
  const scores: ExportParityRunnerScores = { editorVsSourceScore, exportVsSourceScore, exportVsEditorScore, overallScore };

  const hasSourceEvidence = evidence.some((e) => e.kind === 'source_raster' && e.available);
  const hasEditorEvidence = evidence.some((e) => e.kind === 'editor_raster' && e.available) || vqDocScore != null || base.editorVsSourceScore != null;
  const hasExportEvidence = evidence.some((e) => e.kind === 'export_raster' && e.available);
  const manualUsed = [manual.exportVsSourceScore, manual.editorVsSourceScore, manual.exportVsEditorScore].some((v) => clampExportParityScore(v) != null);
  const existingUsed = Boolean(existingSummary) &&
    [existingSummary?.exportVsSourceScore, existingSummary?.exportVsEditorScore, existingSummary?.editorVsSourceScore].some((v) => clampExportParityScore(v) != null);

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!hasSourceEvidence && editorVsSourceScore == null && !manualUsed) blockers.push('source_evidence_missing');

  const needsEditor = mode === 'source_editor_only' || mode === 'editor_export_only' || mode === 'full' || mode === 'auto';
  if (needsEditor && !hasEditorEvidence && editorVsSourceScore == null) blockers.push('editor_evidence_missing');

  const needsExport = mode === 'source_export_only' || mode === 'editor_export_only' || mode === 'full';
  if (needsExport && !hasExportEvidence && exportVsSourceScore == null && exportVsEditorScore == null) blockers.push('export_evidence_missing');

  if (!hasExportEvidence) {
    if (mode === 'full') blockers.push('export_rasterization_unavailable');
    else if (mode === 'auto') warnings.push('export_rasterization_unavailable');
  }

  if (automationLevel === 'level_2_source_editor') warnings.push('partial_automation_only');
  if (manualUsed) warnings.push('manual_scores_used');
  if (existingUsed) warnings.push('existing_summary_reused');
  if ((mode === 'auto' || mode === 'full' || mode === 'source_export_only' || mode === 'editor_export_only')
    && exportVsSourceScore == null && exportVsEditorScore == null) {
    warnings.push('export_comparison_manual_required');
  }
  if (pageComparisons.length === 0) warnings.push('no_page_level_scores');

  const status = resolveExportParityRunnerStatus({ mode, blockers, warnings, scores, evidence });

  const partial: Omit<ExportParityRunnerResult, 'summary'> = {
    version: EXPORT_PARITY_RUNNER_VERSION,
    importId,
    templateId: input.templateId ?? null,
    mode,
    status,
    automationLevel,
    pageComparisons,
    evidence,
    scores,
    blockers: uniq(blockers),
    warnings: uniq(warnings),
    notes,
    persisted: false,
    persistenceError: null,
    generatedAt,
  };

  const summary = status === 'failed' || status === 'not_ready'
    ? null
    : buildExportParitySummaryFromRunnerResult(partial);

  return { ...partial, summary };
}

/** Async runner — loads evidence, runs the pure core, and optionally persists. */
export async function runExportParityAutomation(
  options: ExportParityRunnerOptions,
): Promise<ExportParityRunnerResult> {
  const input = options.input ?? ({} as ExportParityRunnerInput);
  const now = options.now ?? (() => new Date());
  const importId = typeof input.importId === 'string' ? input.importId.trim() : '';

  if (!importId) {
    return runExportParityAutomationFromEvidence({ input: { ...input, importId: '' }, evidence: [], existingSummary: null, now });
  }

  const load = await loadExportParityRunnerEvidence(importId);
  const evidence = load.evidence ?? [];
  const existingSummary = load.kind === 'ok' ? (load.existingSummary ?? null) : null;

  const result = runExportParityAutomationFromEvidence({ input, evidence, existingSummary, now });

  if (load.kind === 'error') {
    result.blockers = uniq([...result.blockers, 'backend_contract_error']);
    result.notes = uniq([...result.notes, `evidence_load_error: ${load.message}`]);
  }

  if (input.persist === true && result.summary) {
    const save = await saveExportParitySummary(importId, result.summary);
    if (save.kind === 'ok') {
      result.persisted = true;
      result.summary = {
        ...result.summary,
        artifactPaths: { ...result.summary.artifactPaths, summaryPath: save.summaryPath },
      };
    } else {
      result.persisted = false;
      result.persistenceError = save.message;
      result.blockers = uniq([...result.blockers, 'persistence_failed']);
      result.status = 'failed';
    }
  }

  return result;
}
