/**
 * exportParityScore — Phase 9D deterministic score helpers.
 *
 * Small, pure numeric helpers for the export parity runner. No DOM/canvas/browser
 * APIs — these only reason about already-computed similarity scores (0..1).
 */
import type {
  ExportParityComparisonPair,
  ExportParityPageComparison,
} from './exportParityRunnerTypes';

export const EXPORT_PARITY_PASS_THRESHOLD = 0.9;
export const EXPORT_PARITY_WARNING_THRESHOLD = 0.8;

/** Coerce a value to a 0..1 score, clamping in-range numbers; null when invalid. */
export function clampExportParityScore(score: unknown): number | null {
  if (score === null || score === undefined || score === '') return null;
  const n = typeof score === 'number' ? score : Number(score);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Average the valid (0..1) scores; null when none are valid. */
export function averageExportParityScores(
  scores: Array<number | null | undefined>,
): number | null {
  const valid: number[] = [];
  for (const raw of Array.isArray(scores) ? scores : []) {
    const s = clampExportParityScore(raw);
    if (s !== null) valid.push(s);
  }
  if (valid.length === 0) return null;
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  return clampExportParityScore(avg);
}

export type ExportParityPairStatus = 'pass' | 'warning' | 'fail' | 'missing' | 'manual_required';

/** Resolve a pass/warning/fail (or missing/manual_required) status for a score. */
export function resolveExportParityPairStatus(options: {
  score: number | null;
  passThreshold?: number;
  warningThreshold?: number;
  missingIsManual?: boolean;
}): ExportParityPairStatus {
  const pass = options.passThreshold ?? EXPORT_PARITY_PASS_THRESHOLD;
  const warn = options.warningThreshold ?? EXPORT_PARITY_WARNING_THRESHOLD;
  const score = clampExportParityScore(options.score);

  if (score === null) return options.missingIsManual ? 'manual_required' : 'missing';
  if (score >= pass) return 'pass';
  if (score >= warn) return 'warning';
  return 'fail';
}

const PAIR_LABEL: Record<ExportParityComparisonPair, string> = {
  source_vs_editor: 'source vs editor',
  source_vs_export: 'source vs export',
  editor_vs_export: 'editor vs export',
};

function defaultPairMessage(
  pair: ExportParityComparisonPair,
  status: ExportParityPairStatus,
  score: number | null,
): string {
  const label = PAIR_LABEL[pair];
  const pct = score === null ? 'n/a' : `${Math.round(score * 100)}%`;
  switch (status) {
    case 'pass': return `${label} parity acceptable (${pct}).`;
    case 'warning': return `${label} parity marginal (${pct}).`;
    case 'fail': return `${label} parity below threshold (${pct}).`;
    case 'manual_required': return `${label} requires manual export parity (no automated score).`;
    default: return `${label} score unavailable.`;
  }
}

/** Build one page-level comparison entry, resolving status + a default message. */
export function buildExportParityPageComparison(options: {
  pageNumber: number;
  pair: ExportParityComparisonPair;
  score: number | null;
  message?: string;
  passThreshold?: number;
  warningThreshold?: number;
  missingIsManual?: boolean;
  left?: ExportParityPageComparison['evidence']['left'];
  right?: ExportParityPageComparison['evidence']['right'];
}): ExportParityPageComparison {
  const score = clampExportParityScore(options.score);
  const status = resolveExportParityPairStatus({
    score,
    passThreshold: options.passThreshold,
    warningThreshold: options.warningThreshold,
    missingIsManual: options.missingIsManual,
  });
  return {
    pageNumber: options.pageNumber,
    pair: options.pair,
    score,
    status,
    message: options.message ?? defaultPairMessage(options.pair, status, score),
    evidence: {
      left: options.left ?? null,
      right: options.right ?? null,
    },
  };
}

/** Average per-pair scores across comparisons and derive an overall score. */
export function summarizeExportParityPairScores(
  comparisons: ExportParityPageComparison[],
): {
  exportVsSourceScore: number | null;
  editorVsSourceScore: number | null;
  exportVsEditorScore: number | null;
  overallScore: number | null;
} {
  const byPair = (pair: ExportParityComparisonPair): number | null =>
    averageExportParityScores(
      (Array.isArray(comparisons) ? comparisons : [])
        .filter((c) => c.pair === pair)
        .map((c) => c.score),
    );

  const editorVsSourceScore = byPair('source_vs_editor');
  const exportVsSourceScore = byPair('source_vs_export');
  const exportVsEditorScore = byPair('editor_vs_export');
  const overallScore = averageExportParityScores([
    editorVsSourceScore,
    exportVsSourceScore,
    exportVsEditorScore,
  ]);

  return { exportVsSourceScore, editorVsSourceScore, exportVsEditorScore, overallScore };
}
