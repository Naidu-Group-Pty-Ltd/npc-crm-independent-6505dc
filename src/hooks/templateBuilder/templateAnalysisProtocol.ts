/**
 * templateAnalysisProtocol — wire protocol between useTemplateAnalysis and the
 * background analysis worker (rehaul Phase 3).
 *
 * Instead of structured-cloning the full template on every debounce, the main
 * thread sends:
 * - the template meta (everything except pages — small),
 * - per-page entries: a full payload only for pages whose content key changed
 *   since the last request this worker received, otherwise a tiny stub,
 * - sample data only when it changed.
 *
 * The worker keeps the previously-received pages and reassembles the document.
 * If it is asked to reuse a page it doesn't have (e.g. it was restarted), it
 * answers `needsFullPayload` and the main thread resends everything.
 *
 * All functions are pure/synchronous so the protocol is unit-testable without
 * spawning a Worker.
 */
import type { Page, ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import type { TemplateIssue } from '@/lib/reportTemplate/bindingValidation';
import type { LintIssue } from '@/lib/reportTemplate/lintTemplate';
import { stableJson } from '@/lib/reportTemplate/previewCache';

// ── Messages ──────────────────────────────────────────────────────────────────

export interface AnalysisPageEntry {
  id: string;
  /** Content key (identity-memoized serialization on the main thread). */
  key: string;
  /** Present only when the worker is not known to have this page version. */
  page?: Page;
}

export interface AnalysisRequest {
  requestId: number;
  /** Template with `pages` stripped — reassembled worker-side. */
  meta: Record<string, unknown>;
  pages: AnalysisPageEntry[];
  /** Present only when changed since the last request this worker received. */
  sampleData?: Record<string, any>;
  sampleDataKey: string;
}

export interface AnalysisSuccess {
  requestId: number;
  ok: true;
  bindingIssues: TemplateIssue[];
  lintIssues: LintIssue[];
}

export interface AnalysisFailure {
  requestId: number;
  ok: false;
  error: string;
  /** The worker lacks referenced pages/data — resend with full payloads. */
  needsFullPayload?: boolean;
}

export type AnalysisResponse = AnalysisSuccess | AnalysisFailure;

// ── Main-thread side ──────────────────────────────────────────────────────────

export interface WorkerKnownState {
  pages: Map<string, string>;
  sampleDataKey: string | null;
}

export function createWorkerKnownState(): WorkerKnownState {
  return { pages: new Map(), sampleDataKey: null };
}

/** Content key for a page; cheap because serialization is identity-memoized. */
export function pageContentKey(page: Page): string {
  return stableJson(page);
}

export function buildAnalysisRequest(
  requestId: number,
  template: ReportTemplate,
  sampleData: Record<string, any>,
  known: WorkerKnownState,
): AnalysisRequest {
  const meta: Record<string, unknown> = { ...template };
  delete meta.pages;
  const pages: AnalysisPageEntry[] = template.pages.map((page) => {
    const key = pageContentKey(page);
    return known.pages.get(page.id) === key ? { id: page.id, key } : { id: page.id, key, page };
  });
  const sampleDataKey = stableJson(sampleData);
  const request: AnalysisRequest = { requestId, meta, pages, sampleDataKey };
  if (known.sampleDataKey !== sampleDataKey) request.sampleData = sampleData;
  return request;
}

/** Record what the worker will hold after processing `request`. */
export function rememberAnalysisRequest(request: AnalysisRequest, known: WorkerKnownState): void {
  known.pages = new Map(request.pages.map((entry) => [entry.id, entry.key]));
  known.sampleDataKey = request.sampleDataKey;
}

// ── Worker side ───────────────────────────────────────────────────────────────

export interface AnalysisWorkerState {
  pages: Map<string, { key: string; page: Page }>;
  sampleData: Record<string, any> | null;
  sampleDataKey: string | null;
}

export function createAnalysisWorkerState(): AnalysisWorkerState {
  return { pages: new Map(), sampleData: null, sampleDataKey: null };
}

/**
 * Apply a request to the worker state and reassemble the analysis input.
 * Returns null when a stub references a page version (or sample data) this
 * worker doesn't have — the caller must answer `needsFullPayload`.
 */
export function assembleAnalysisInput(
  state: AnalysisWorkerState,
  request: AnalysisRequest,
): { template: ReportTemplate; sampleData: Record<string, any> } | null {
  const pages: Page[] = [];
  for (const entry of request.pages) {
    if (entry.page !== undefined) {
      state.pages.set(entry.id, { key: entry.key, page: entry.page });
      pages.push(entry.page);
    } else {
      const held = state.pages.get(entry.id);
      if (!held || held.key !== entry.key) return null;
      pages.push(held.page);
    }
  }

  // Drop pages that no longer exist so worker memory tracks the document.
  const liveIds = new Set(request.pages.map((entry) => entry.id));
  for (const id of Array.from(state.pages.keys())) {
    if (!liveIds.has(id)) state.pages.delete(id);
  }

  if (request.sampleData !== undefined) {
    state.sampleData = request.sampleData;
    state.sampleDataKey = request.sampleDataKey;
  } else if (state.sampleDataKey !== request.sampleDataKey) {
    return null;
  }

  return {
    template: { ...(request.meta as object), pages } as ReportTemplate,
    sampleData: state.sampleData ?? {},
  };
}
