/**
 * Client helpers for loading persisted import-review artifacts.
 *
 * The edge function keeps CDIR/fidelity JSON in a private storage bucket. This
 * module gives the editor a small, injectable client that restores an
 * `ImportReviewDraft` from an import id without exposing private bucket paths.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { parseCdirDocument, type CdirDocument } from './cdir';
import { buildImportReviewDraft, type ImportReviewArtifact, type ImportReviewDecision, type ImportReviewDraft } from './review';
import type { CdirFidelityReport } from './fidelity';
import type { ReportTemplate } from '../templateSchema';
import { importAssetToReviewArtifacts, type ImportAsset, type RawImportManifest } from './reconciliation';
import {
  buildPdfPageContextConsumerGuardrail,
  getPreferredPdfPageContextSource,
  shouldBlockPdfPageContextImport,
  type PageContextEntrypoint,
  type PdfPageContext,
  type PdfPageContextSummary,
  type PdfPageContextSource,
  type PdfPageContextValidation,
  type PdfPageContextConsumerGuardrail,
} from './pageContexts';
import {
  buildPageContextRenderArtifactManifest,
  pageContextRenderManifestToReviewArtifacts,
  type PageContextRenderArtifactManifest,
} from './visualQuality';

export interface PersistedImportRecord {
  id: string;
  user_id: string | null;
  status: string;
  created_template_id: string | null;
  page_count: number | null;
  source_filename: string | null;
  meta: Record<string, unknown> | null;
}

export interface ImportArtifactsPayload {
  record: PersistedImportRecord;
  cdir: unknown;
  cdirFidelity: CdirFidelityReport | null;
  importAsset?: ImportAsset | null;
  importManifests?: RawImportManifest[] | null;
  pdfPageManifest?: unknown | null;
  pdfPageManifestSummary?: unknown | null;
  pdfPageContexts?: unknown[] | null;
  pdfPageContextSummary?: PdfPageContextSummary | null;
  pdfDiagnosticsSignedByPath?: Record<string, string> | null;
  pdfPageArtifactSignedUrls?: Record<string, string> | null;
  pdfDiagnosticsSignedUrlTtlSeconds?: number | null;
  pageContextEntrypoint?: PageContextEntrypoint | null;
  artifactPaths?: {
    cdir?: string | null;
    cdirFidelity?: string | null;
    importAsset?: string | null;
    importManifests?: string | null;
    pdfPageManifest?: string | null;
  };
}

export type ImportArtifactInvoke = (
  functionName: 'template-import-pdf',
  args: { body: { operation: 'get_artifacts'; import_id: string } },
) => Promise<{ data: ImportArtifactsPayload | null; error: { message: string } | null }>;

export interface ImportReviewDecisionRecord {
  decision: ImportReviewDecision;
  note: string | null;
  decided_at: string;
  decided_by: string;
}

export interface SaveImportReviewDecisionResult {
  record: { id: string; meta: Record<string, unknown> | null };
  decision: ImportReviewDecisionRecord;
}

export type ImportReviewDecisionInvoke = (
  functionName: 'template-import-pdf',
  args: { body: { operation: 'record_review_decision'; import_id: string; decision: ImportReviewDecision; note?: string } },
) => Promise<{ data: SaveImportReviewDecisionResult | null; error: { message: string } | null }>;

export interface LoadImportReviewDraftOptions {
  importId: string;
  template?: ReportTemplate;
  artifacts?: ImportReviewArtifact[];
  invoke?: ImportArtifactInvoke;
}

export interface LoadImportReviewDraftResult {
  record: PersistedImportRecord;
  draft: ImportReviewDraft;
  importAsset: ImportAsset | null;
  importManifests: RawImportManifest[] | null;
  pageContextSource: PdfPageContextSource;
  pageContexts: PdfPageContext[];
  pageContextSummary: PdfPageContextSummary | null;
  pageContextEntrypoint: PageContextEntrypoint | null;
  pageContextValidation: PdfPageContextValidation;
  pageContextGuardrail: PdfPageContextConsumerGuardrail;
  renderArtifactManifest: PageContextRenderArtifactManifest;
  artifactPaths: {
    cdir?: string | null;
    cdirFidelity?: string | null;
    importAsset?: string | null;
    importManifests?: string | null;
    pdfPageManifest?: string | null;
  };
}

// Default transport: invokeSecureFunction (attaches the custom-auth session
// token the secured edge function verifies); keeps the supabase-style
// `(name, { body })` signature so injected test doubles stay unchanged.
const defaultInvoke: ImportArtifactInvoke = (functionName, args) =>
  invokeSecureFunction(functionName, args.body) as any;

export function readImportReviewDecision(meta: Record<string, unknown> | null | undefined): ImportReviewDecisionRecord | null {
  const raw = meta?.import_review_decision;
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<ImportReviewDecisionRecord>;
  if (!item.decision || !['accept', 'accept_with_trace', 'retry', 'manual_edit'].includes(item.decision)) return null;
  return {
    decision: item.decision,
    note: typeof item.note === 'string' ? item.note : null,
    decided_at: typeof item.decided_at === 'string' ? item.decided_at : '',
    decided_by: typeof item.decided_by === 'string' ? item.decided_by : '',
  };
}


export async function loadImportReviewDraft(options: LoadImportReviewDraftOptions): Promise<LoadImportReviewDraftResult> {
  const invoke = options.invoke ?? defaultInvoke;
  const { data, error } = await invoke('template-import-pdf', {
    body: { operation: 'get_artifacts', import_id: options.importId },
  });
  if (error) throw new Error(error.message || 'Could not load import artifacts.');
  if (!data?.record) throw new Error('Import artifact response did not include an import record.');
  if (!data.cdir) throw new Error('This import does not have a persisted CDIR artifact yet.');

  const cdir: CdirDocument = parseCdirDocument(data.cdir);
  const pageContextSelection = getPreferredPdfPageContextSource({
    pageContextEntrypoint: data.pageContextEntrypoint ?? null,
    pageContexts: data.pdfPageContexts ?? [],
    pageContextSummary: data.pdfPageContextSummary ?? null,
  });

  const pageContextGuardrail = buildPdfPageContextConsumerGuardrail(pageContextSelection);
  const renderArtifactManifest = buildPageContextRenderArtifactManifest({
    importId: data.record.id,
    pageContexts: pageContextSelection.pageContexts,
    guardrail: pageContextGuardrail,
    signedUrls: data.pdfPageArtifactSignedUrls ?? {},
  });
  const pageContextReviewArtifacts = pageContextRenderManifestToReviewArtifacts(renderArtifactManifest);

  if (shouldBlockPdfPageContextImport(pageContextSelection)) {
    throw new Error(
      `PDF page context validation failed: ${pageContextSelection.pageContextValidation.problems.slice(0, 8).join('; ')}`
    );
  }

  const draft = buildImportReviewDraft({
    id: `review_${data.record.id}`,
    cdir,
    template: options.template,
    fidelity: data.cdirFidelity ?? undefined,
    artifacts: [
      ...importAssetToReviewArtifacts(data.importAsset),
      ...pageContextReviewArtifacts,
      ...(options.artifacts ?? []),
    ],
  });

  return {
    record: data.record,
    draft,
    importAsset: data.importAsset ?? null,
    importManifests: data.importManifests ?? null,
    pageContextSource: pageContextSelection.source,
    pageContexts: pageContextSelection.pageContexts,
    pageContextSummary: pageContextSelection.pageContextSummary,
    pageContextEntrypoint: pageContextSelection.pageContextEntrypoint,
    pageContextValidation: pageContextSelection.pageContextValidation,
    pageContextGuardrail,
    renderArtifactManifest,
    artifactPaths: data.artifactPaths ?? {},
  };
}

export async function saveImportReviewDecision(options: {
  importId: string;
  decision: ImportReviewDecision;
  note?: string;
  invoke?: ImportReviewDecisionInvoke;
}): Promise<SaveImportReviewDecisionResult> {
  const invoke = options.invoke ?? ((functionName, args) => invokeSecureFunction(functionName, args.body) as any);
  const { data, error } = await invoke('template-import-pdf', {
    body: {
      operation: 'record_review_decision',
      import_id: options.importId,
      decision: options.decision,
      ...(options.note ? { note: options.note } : {}),
    },
  });
  if (error) throw new Error(error.message || 'Could not save import review decision.');
  if (!data?.decision) throw new Error('Review decision response did not include a decision.');
  return data;
}
