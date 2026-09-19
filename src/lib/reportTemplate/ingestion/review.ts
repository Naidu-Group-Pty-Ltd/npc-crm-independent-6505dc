/**
 * Import review draft model.
 *
 * The UI can use this shape to present source → CDIR → editable template →
 * fidelity warnings before mutating the live editor schema.
 */
import type { CdirDocument } from './cdir/schema';
import { cdirToReportTemplate } from './cdir/mapper';
import type { ReportTemplate } from '../templateSchema';
import { buildCdirFidelityReport, type CdirFidelityOptions, type CdirFidelityReport } from './fidelity';

export type ImportReviewDecision = 'accept' | 'accept_with_trace' | 'retry' | 'manual_edit';

export interface ImportReviewArtifact {
  id: string;
  kind: 'source-raster' | 'reconstructed-raster' | 'diff-raster' | 'source-file' | 'cdir-json';
  pageId?: string;
  url?: string;
  dataUrl?: string;
  meta?: Record<string, unknown>;
}

export interface ImportReviewDraft {
  id: string;
  sourceKind: CdirDocument['source']['kind'];
  sourceFilename?: string;
  cdir: CdirDocument;
  template: ReportTemplate;
  fidelity: CdirFidelityReport;
  artifacts: ImportReviewArtifact[];
  createdAt: string;
  recommendedDecision: ImportReviewDecision;
}

export interface BuildImportReviewDraftOptions {
  id?: string;
  cdir: CdirDocument;
  template?: ReportTemplate;
  artifacts?: ImportReviewArtifact[];
  fidelity?: CdirFidelityReport;
  fidelityOptions?: CdirFidelityOptions;
  now?: () => Date;
}

export function recommendImportDecision(fidelity: CdirFidelityReport): ImportReviewDecision {
  if (fidelity.warnings.some((warning) => warning.severity === 'error')) return 'retry';
  if (fidelity.overallScore >= 0.92 && fidelity.rasterFallbackCoverage <= 0.1) return 'accept';
  if (fidelity.overallScore >= 0.8 && fidelity.rasterFallbackCoverage <= 0.25) return 'accept_with_trace';
  return 'manual_edit';
}

export function buildImportReviewDraft(options: BuildImportReviewDraftOptions): ImportReviewDraft {
  const template = options.template ?? cdirToReportTemplate(options.cdir);
  const fidelity = options.fidelity ?? buildCdirFidelityReport(options.cdir, options.fidelityOptions);
  return {
    id: options.id ?? `review_${options.cdir.source.checksum.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    sourceKind: options.cdir.source.kind,
    sourceFilename: options.cdir.source.filename,
    cdir: options.cdir,
    template,
    fidelity,
    artifacts: options.artifacts ?? [],
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    recommendedDecision: recommendImportDecision(fidelity),
  };
}
