/**
 * exportParityTypes — the Phase 7F export-parity data model.
 *
 * Export parity answers "does the final exported/generated PDF still match the
 * original source PDF and the Template Builder editor preview?" It is related to,
 * but deliberately separate from, the Visual QA / Repair (`visualQuality`) work:
 * Visual QA compares the *editor* render to the source; export parity extends the
 * comparison to the *exported* PDF.
 */

export const EXPORT_PARITY_SUMMARY_VERSION = 'export-parity-summary-v1';

export type ExportParityStatus =
  | 'not_run'
  | 'completed'
  | 'manual_required'
  | 'failed';

export type ExportParityMode =
  | 'manual'
  | 'automated'
  | 'hybrid';

export interface ExportParityArtifactPaths {
  sourceRasterFolder?: string | null;
  editorRasterFolder?: string | null;
  exportedPdfPath?: string | null;
  exportedRasterFolder?: string | null;
  diffRasterFolder?: string | null;
  summaryPath?: string | null;
}

export interface ExportParityScoreSet {
  editorVsSourceScore: number | null;
  exportVsSourceScore: number | null;
  exportVsEditorScore: number | null;
}

export interface ExportParityPageSummary {
  pageNumber: number;
  editorVsSourceScore: number | null;
  exportVsSourceScore: number | null;
  exportVsEditorScore: number | null;
  manualReviewRequired: boolean;
  problems: string[];
}

export interface ExportParitySummary {
  version: typeof EXPORT_PARITY_SUMMARY_VERSION;
  importId: string;
  templateId: string | null;
  mode: ExportParityMode;
  status: ExportParityStatus;
  sourcePageCount: number | null;
  editorPageCount: number | null;
  exportedPageCount: number | null;
  editorVsSourceScore: number | null;
  exportVsSourceScore: number | null;
  exportVsEditorScore: number | null;
  manualReviewRequired: boolean;
  pages: ExportParityPageSummary[];
  problems: string[];
  artifactPaths: ExportParityArtifactPaths;
  generatedAt: string;
}

const EXPORT_PARITY_STATUSES: readonly ExportParityStatus[] = ['not_run', 'completed', 'manual_required', 'failed'];
const EXPORT_PARITY_MODES: readonly ExportParityMode[] = ['manual', 'automated', 'hybrid'];

export function isValidExportParityStatus(value: unknown): value is ExportParityStatus {
  return typeof value === 'string' && (EXPORT_PARITY_STATUSES as readonly string[]).includes(value);
}

export function isValidExportParityMode(value: unknown): value is ExportParityMode {
  return typeof value === 'string' && (EXPORT_PARITY_MODES as readonly string[]).includes(value);
}
