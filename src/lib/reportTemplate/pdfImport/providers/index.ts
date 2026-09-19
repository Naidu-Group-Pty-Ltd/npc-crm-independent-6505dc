/**
 * Phase 7 — Provider fallback hooks.
 *
 * The PDF import pipeline historically had exactly one provider: the Cloud
 * Run Docling sidecar via `extractPdfViaDocling`. Phase 7 introduces a thin
 * provider registry so the orchestrator can try a primary engine, observe
 * failure, and transparently retry with a fallback (e.g. a pixel-only
 * rasteriser, the WeasyPrint-side `pdf-parse-service`, or a future hosted
 * provider) without any call-site changes.
 *
 * Design notes:
 *   - Providers are pure objects implementing `ImportProvider` — no class
 *     hierarchy, easy to mock in tests.
 *   - The registry is module-level + freezable so tests can snapshot/restore
 *     it via `withProviders`.
 *   - Fallback policy is data-driven: each provider declares which failure
 *     modes it can recover from via `recoverableFailures`, so we never blindly
 *     retry on (e.g.) auth errors that would just fail again.
 *   - The orchestrator returns a `ProviderAttempt[]` audit trail so the
 *     diagnostics dashboard (Phase 8) can render "Docling failed → Pixel
 *     fallback succeeded in 8.4s" without re-deriving it.
 *
 * This file does NOT change `extractPdfViaDocling`; it wraps it. Existing
 * callers continue to work; new callers can opt in via
 * `runImportWithFallback`.
 */
import type { ImportOptions, ImportResult, PdfImportEngine } from '../types';
import { extractPdfViaDocling } from '../extractPdfViaDocling';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderFailureKind =
  | 'timeout'
  | 'auth'
  | 'rate_limited'
  | 'parser_error'
  | 'network'
  | 'invalid_pdf'
  | 'unsupported'
  | 'unknown';

export interface ProviderError {
  kind: ProviderFailureKind;
  message: string;
  /** Underlying error for diagnostics — never surfaced to end users verbatim. */
  cause?: unknown;
}

export interface ImportProvider {
  /** Stable id used in audit trails. */
  id: string;
  /** Human-readable label for the diagnostics UI. */
  label: string;
  /** Engine tag stamped onto the returned `ImportResult`. */
  engine: PdfImportEngine | string;
  /**
   * Failure kinds this provider can recover from when invoked as a fallback.
   * Defaults to `['timeout', 'parser_error', 'network', 'rate_limited']`.
   * `'auth'` and `'invalid_pdf'` are NEVER auto-recovered — they would just
   * fail again on a different backend.
   */
  recoverableFailures?: ProviderFailureKind[];
  /** Returns `false` to be skipped for this particular file/options combo. */
  supports?: (file: File, opts: ImportOptions) => boolean;
  run: (file: File, opts: ImportOptions) => Promise<ImportResult>;
}

export interface ProviderAttempt {
  providerId: string;
  engine: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: 'success' | 'failure' | 'skipped';
  error?: ProviderError;
}

export interface ProviderRunResult {
  result: ImportResult;
  attempts: ProviderAttempt[];
  /** True when the winning provider was not the primary. */
  usedFallback: boolean;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

const DEFAULT_RECOVERABLE: ProviderFailureKind[] = [
  'timeout',
  'parser_error',
  'network',
  'rate_limited',
];

export function classifyProviderError(err: unknown): ProviderError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  let kind: ProviderFailureKind = 'unknown';
  if (/timeout|timed out|deadline/.test(lower)) kind = 'timeout';
  else if (/unauthor|forbidden|401|403|auth/.test(lower)) kind = 'auth';
  else if (/rate.?limit|429|too many/.test(lower)) kind = 'rate_limited';
  else if (/network|fetch|econn|enotfound|socket/.test(lower)) kind = 'network';
  else if (/invalid pdf|corrupt|not a pdf|encrypted/.test(lower)) kind = 'invalid_pdf';
  else if (/unsupported|not implemented/.test(lower)) kind = 'unsupported';
  else if (/parse|extract|docling|sidecar|render/.test(lower)) kind = 'parser_error';
  return { kind, message: msg, cause: err };
}

function isRecoverable(provider: ImportProvider, err: ProviderError): boolean {
  const set = provider.recoverableFailures ?? DEFAULT_RECOVERABLE;
  return set.includes(err.kind);
}

// ---------------------------------------------------------------------------
// Built-in providers
// ---------------------------------------------------------------------------

/** Primary provider — wraps the existing Docling pipeline. */
export const doclingProvider: ImportProvider = {
  id: 'docling',
  label: 'Docling (Cloud Run sidecar)',
  engine: 'docling',
  recoverableFailures: ['timeout', 'parser_error', 'network', 'rate_limited'],
  run: (file, opts) => extractPdfViaDocling(file, opts),
};

/**
 * Pixel-perfect fallback — re-invokes Docling with mode forced to `'pixel'`.
 * This is intentionally minimal: when the semantic/hybrid path keeps failing
 * (e.g. on a heavily redacted PDF), the pixel render almost always succeeds
 * because it skips the structured-text extraction entirely. The repair loop
 * (Phase 6) then has rasters to score against.
 */
export const pixelFallbackProvider: ImportProvider = {
  id: 'pixel-fallback',
  label: 'Pixel-only fallback',
  engine: 'docling',
  recoverableFailures: ['timeout', 'parser_error', 'network', 'rate_limited', 'unsupported'],
  // Only useful when the caller didn't already ask for pixel mode.
  supports: (_file, opts) => opts.mode !== 'pixel',
  run: (file, opts) => extractPdfViaDocling(file, { ...opts, mode: 'pixel' }),
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

interface RegistryShape {
  primary: ImportProvider;
  fallbacks: ImportProvider[];
}

let registry: RegistryShape = {
  primary: doclingProvider,
  fallbacks: [pixelFallbackProvider],
};

export function getImportProviders(): RegistryShape {
  return { primary: registry.primary, fallbacks: [...registry.fallbacks] };
}

export function setImportProviders(next: Partial<RegistryShape>): void {
  registry = {
    primary: next.primary ?? registry.primary,
    fallbacks: next.fallbacks ?? registry.fallbacks,
  };
}

export function registerFallbackProvider(provider: ImportProvider): void {
  if (registry.fallbacks.some((p) => p.id === provider.id)) return;
  registry.fallbacks = [...registry.fallbacks, provider];
}

/** Test helper — swap the registry for the duration of `fn`, then restore. */
export async function withProviders<T>(
  next: Partial<RegistryShape>,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = registry;
  registry = {
    primary: next.primary ?? prev.primary,
    fallbacks: next.fallbacks ?? prev.fallbacks,
  };
  try {
    return await fn();
  } finally {
    registry = prev;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface RunImportWithFallbackOptions extends ImportOptions {
  /** Override the registry for a single call (does not mutate global state). */
  providers?: Partial<RegistryShape>;
  /** Observability hook — fires after every attempt, before the next is tried. */
  onAttempt?: (attempt: ProviderAttempt) => void;
}

/**
 * Run the primary import provider; on a recoverable failure, fall through to
 * each registered fallback in order. Throws the LAST error encountered if
 * every provider fails.
 */
export async function runImportWithFallback(
  file: File,
  opts: RunImportWithFallbackOptions,
): Promise<ProviderRunResult> {
  const active = opts.providers
    ? { primary: opts.providers.primary ?? registry.primary, fallbacks: opts.providers.fallbacks ?? registry.fallbacks }
    : registry;
  const queue: ImportProvider[] = [active.primary, ...active.fallbacks];
  const attempts: ProviderAttempt[] = [];
  let lastError: ProviderError | null = null;

  for (let i = 0; i < queue.length; i += 1) {
    const provider = queue[i];
    const startedAt = new Date();
    if (provider.supports && !provider.supports(file, opts)) {
      const finishedAt = new Date();
      const attempt: ProviderAttempt = {
        providerId: provider.id,
        engine: provider.engine,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: 0,
        outcome: 'skipped',
      };
      attempts.push(attempt);
      opts.onAttempt?.(attempt);
      continue;
    }
    try {
      const result = await provider.run(file, opts);
      const finishedAt = new Date();
      const attempt: ProviderAttempt = {
        providerId: provider.id,
        engine: provider.engine,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        outcome: 'success',
      };
      attempts.push(attempt);
      opts.onAttempt?.(attempt);
      return { result, attempts, usedFallback: i > 0 };
    } catch (err) {
      const error = classifyProviderError(err);
      const finishedAt = new Date();
      const attempt: ProviderAttempt = {
        providerId: provider.id,
        engine: provider.engine,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        outcome: 'failure',
        error,
      };
      attempts.push(attempt);
      opts.onAttempt?.(attempt);
      lastError = error;
      // If this provider's failure is not recoverable, don't try fallbacks
      // for *the same* failure kind — but a later provider may still declare
      // it recoverable, so we check the NEXT provider's policy.
      const next = queue[i + 1];
      if (!next) break;
      if (!isRecoverable(next, error)) break;
    }
  }

  const message = lastError?.message ?? 'All import providers failed';
  const final = new Error(message);
  (final as any).attempts = attempts;
  (final as any).providerError = lastError;
  throw final;
}
