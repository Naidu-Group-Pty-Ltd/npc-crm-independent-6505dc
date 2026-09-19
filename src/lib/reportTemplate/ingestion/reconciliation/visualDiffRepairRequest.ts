/**
 * Operator-triggered single-page AI visual repair (Path-to-100 v2 · C9).
 *
 * Orchestrates ONE page's AI repair: fetch model-authored patches (operator
 * action only — the fetcher is injected, never invoked automatically), validate
 * + apply them via the dedicated page-scoped `applyVisualDiffRepairPatch`, and
 * build the audit. Fail-open: a fetch/validation failure returns the ORIGINAL
 * template unchanged with an error, never a partial mutation.
 *
 * Pure orchestration over an injected fetcher, so it is fully unit-testable
 * without a live AI provider.
 */
import type { ReportTemplate } from '../../templateSchema';
import {
  applyVisualDiffRepairPatch,
  buildVisualDiffRepairAudit,
  DEFAULT_MAX_REPAIR_OPERATIONS,
  type VisualDiffRepairAudit,
  type VisualDiffRepairRejection,
} from './visualDiffRepairPatch';

export interface VisualDiffRepairRequestContext {
  templateId?: string | null;
  pageId: string;
  diffReport?: unknown;
  plan?: unknown;
  maxOperations?: number;
}

/**
 * Fetches raw model-authored patches for a single page. Supplied by the caller
 * (backed by the AI client in production, a stub in tests) so the request is
 * always an explicit, operator-initiated call.
 */
export type VisualDiffRepairPatchFetcher = (context: VisualDiffRepairRequestContext) => Promise<unknown>;

export interface VisualDiffRepairRequestResult {
  template: ReportTemplate;
  pageId: string;
  applied: number;
  rejected: VisualDiffRepairRejection[];
  changed: boolean;
  audit: VisualDiffRepairAudit;
  requestedOperations: number;
  error?: string;
}

export async function runVisualDiffRepairRequest(input: {
  template: ReportTemplate;
  context: VisualDiffRepairRequestContext;
  fetchPatches: VisualDiffRepairPatchFetcher;
  now?: () => Date;
}): Promise<VisualDiffRepairRequestResult> {
  const { template, context } = input;
  const maxOperations = context.maxOperations ?? DEFAULT_MAX_REPAIR_OPERATIONS;

  let raw: unknown = [];
  let error: string | undefined;
  try {
    raw = await input.fetchPatches(context);
  } catch (err) {
    error = (err as Error)?.message ?? 'AI repair request failed.';
    raw = [];
  }

  const requestedOperations = Array.isArray(raw) ? raw.length : 0;
  const result = applyVisualDiffRepairPatch(template, context.pageId, raw, { maxOperations });
  const audit = buildVisualDiffRepairAudit(result, {
    requestedOperations,
    decidedAt: (input.now?.() ?? new Date()).toISOString(),
  });

  return {
    template: result.template,
    pageId: result.pageId,
    applied: result.applied,
    rejected: result.rejected,
    changed: result.changed,
    audit,
    requestedOperations,
    error,
  };
}
