/**
 * exportParityRunnerTypes — Phase 9D automated export parity runner model.
 *
 * The runner attempts to build an export parity evaluation from whatever render
 * evidence is available (existing Visual QA source/editor rasters, an existing
 * export parity summary, and/or operator-supplied manual scores) and, when
 * possible, persist it through the existing Phase 7F export parity metadata.
 *
 * It is automation-first, fallback-safe: it completes when evidence exists,
 * returns `manual_required`/`partial` when exported-PDF rasterization is not
 * available, and fails safely with clear blockers. Runner-specific metadata
 * (automation level, blockers, warnings, overall score) lives on the runner
 * result — the persisted `ExportParitySummary` keeps its strict Phase 7F shape.
 */
import type {
  ExportParitySummary,
} from './exportParityTypes';

export const EXPORT_PARITY_RUNNER_VERSION = 'export-parity-runner-v1';

export type ExportParityRunnerMode =
  | 'auto'
  | 'source_editor_only'
  | 'source_export_only'
  | 'editor_export_only'
  | 'full';

export type ExportParityRunnerStatus =
  | 'completed'
  | 'partial'
  | 'manual_required'
  | 'failed'
  | 'not_ready';

export type ExportParityAutomationLevel =
  | 'level_1_manual_compatible'
  | 'level_2_source_editor'
  | 'level_3_source_editor_export';

export type ExportParityEvidenceKind =
  | 'source_raster'
  | 'editor_raster'
  | 'export_raster'
  | 'visual_quality_summary'
  | 'existing_export_parity_summary'
  | 'manual_metrics';

export type ExportParityComparisonPair =
  | 'source_vs_editor'
  | 'source_vs_export'
  | 'editor_vs_export';

export interface ExportParityEvidenceRef {
  kind: ExportParityEvidenceKind;
  pageNumber: number | null;
  path: string | null;
  url?: string | null;
  width?: number | null;
  height?: number | null;
  score?: number | null;
  available: boolean;
  reason?: string | null;
}

export interface ExportParityPageComparison {
  pageNumber: number;
  pair: ExportParityComparisonPair;
  score: number | null;
  status: 'pass' | 'warning' | 'fail' | 'missing' | 'manual_required';
  message: string;
  evidence: {
    left: ExportParityEvidenceRef | null;
    right: ExportParityEvidenceRef | null;
  };
}

export interface ExportParityRunnerInput {
  importId: string;
  templateId?: string | null;
  mode?: ExportParityRunnerMode;
  persist?: boolean;
  sourceFilename?: string | null;

  manualScores?: {
    exportVsSourceScore?: number | null;
    editorVsSourceScore?: number | null;
    exportVsEditorScore?: number | null;
  };

  notes?: string[];
}

export interface ExportParityRunnerOptions {
  input: ExportParityRunnerInput;
  now?: () => Date;
}

export interface ExportParityRunnerScores {
  exportVsSourceScore: number | null;
  editorVsSourceScore: number | null;
  exportVsEditorScore: number | null;
  overallScore: number | null;
}

export interface ExportParityRunnerResult {
  version: typeof EXPORT_PARITY_RUNNER_VERSION;
  importId: string | null;
  templateId: string | null;
  mode: ExportParityRunnerMode;
  status: ExportParityRunnerStatus;
  automationLevel: ExportParityAutomationLevel;

  summary: ExportParitySummary | null;

  pageComparisons: ExportParityPageComparison[];

  evidence: ExportParityEvidenceRef[];

  scores: ExportParityRunnerScores;

  blockers: string[];
  warnings: string[];
  notes: string[];

  persisted: boolean;
  persistenceError: string | null;

  generatedAt: string;
}

export type ExportParityRunnerLoadResult =
  | {
      kind: 'ok';
      evidence: ExportParityEvidenceRef[];
      existingSummary?: ExportParitySummary | null;
      raw?: unknown;
    }
  | {
      kind: 'missing';
      message: string;
      evidence: ExportParityEvidenceRef[];
      raw?: unknown;
    }
  | {
      kind: 'error';
      message: string;
      evidence: ExportParityEvidenceRef[];
      raw?: unknown;
    };
