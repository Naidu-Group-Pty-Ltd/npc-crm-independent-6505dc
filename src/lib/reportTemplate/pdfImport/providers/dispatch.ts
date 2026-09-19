/**
 * PDF provider dispatcher.
 *
 * Higher-level entry point that runs the Phase 7 PDF fallback chain and persists the resulting
 * `ProviderAttempt[]` audit trail to `template_imports.meta.provider_attempts`
 * so the Phase 8 diagnostics dashboard can render the cross-service trace.
 *
 * The dispatcher is additive — existing callers of `extractPdfViaDocling` keep
 * working unchanged. Non-PDF sources use the reference import orchestrator,
 * whose output contract is a reconstructed schema rather than `ImportResult`.
 */
import type { ImportOptions, ImportResult } from '../types';
import {
  runImportWithFallback,
  type ProviderAttempt,
  type ImportProvider,
  doclingProvider,
  pixelFallbackProvider,
} from './index';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface DispatchResult {
  result: ImportResult;
  attempts: ProviderAttempt[];
  usedFallback: boolean;
}

export interface DispatchOptions extends ImportOptions {
  /** Skip the provider-attempts persistence step (useful in tests). */
  skipAuditPersist?: boolean;
  /** @deprecated `render-source` has no persisted `ImportResult` backend contract. */
  forcePrimary?: 'docling' | 'render-source';
  onAttempt?: (attempt: ProviderAttempt) => void;
}

/** Choose the best primary provider for the given file. */
function pickPrimary(file: File, opts: DispatchOptions): { primary: ImportProvider; fallbacks: ImportProvider[] } {
  if (opts.forcePrimary === 'render-source') {
    throw new Error('render-source cannot be used as a PDF import provider; use the reference import orchestrator for code and document sources.');
  }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '');
  if (!isPdf) {
    throw new Error('dispatchImport only supports PDF files; use the reference import orchestrator for code and document sources.');
  }
  // PDFs → Docling primary, pixel as fallback.
  return {
    primary: doclingProvider,
    fallbacks: [pixelFallbackProvider],
  };
}

/**
 * Best-effort persistence — never throws. The orchestrator's result is the
 * source of truth; this just records the audit trail for the dashboard.
 */
async function persistAttempts(importId: string | undefined, attempts: ProviderAttempt[]): Promise<void> {
  if (!importId || attempts.length === 0) return;
  try {
    await invokeSecureFunction(
      'template-import-pdf',
      {
        operation: 'append_meta',
        import_id: importId,
        meta_patch: { provider_attempts: attempts },
      },
      { timeoutMs: 30_000 },
    );
  } catch {
    /* swallow — diagnostic-only */
  }
}

export async function dispatchImport(file: File, opts: DispatchOptions): Promise<DispatchResult> {
  const providers = pickPrimary(file, opts);
  const run = await runImportWithFallback(file, {
    ...opts,
    providers,
    onAttempt: opts.onAttempt,
  });
  if (!opts.skipAuditPersist) {
    await persistAttempts(run.result.importId, run.attempts);
  }
  return run;
}
