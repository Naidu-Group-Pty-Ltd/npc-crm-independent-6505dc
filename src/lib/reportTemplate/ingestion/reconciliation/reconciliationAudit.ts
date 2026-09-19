/**
 * reconciliationAudit — build + persist a compact AI-reconciliation audit summary
 * into `template_imports.meta.ai_reconciliation_summary`.
 *
 * Phase 7E. Persistence reuses the existing `append_meta` operation on the
 * `template-import-pdf` edge function (secure: import_id + meta_patch, ownership
 * enforced) — no new Supabase operation is introduced.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { ReconciliationRecommendation } from './reconciliationPolicy';

export const AI_RECONCILIATION_AUDIT_VERSION = 'ai-reconciliation-summary-v1';

export interface AiReconciliationAuditSummary {
  version: typeof AI_RECONCILIATION_AUDIT_VERSION;
  status: 'not_run' | 'completed' | 'failed';
  recommendation: ReconciliationRecommendation;
  reason: string;
  startedAt: string;
  completedAt: string | null;
  failedAt?: string | null;
  errorMessage?: string | null;
  visualQaScoreBefore: number | null;
  repairFinalScoreBefore: number | null;
  visualQaScoreAfter: number | null;
  editableElementsCreated: number | null;
  layoutChanges: number | null;
  warnings: string[];
}

export function buildAiReconciliationAuditSummary(input: {
  status: 'completed' | 'failed';
  recommendation: ReconciliationRecommendation;
  reason: string;
  startedAt: string;
  completedAt?: string | null;
  failedAt?: string | null;
  errorMessage?: string | null;
  visualQaScoreBefore?: number | null;
  repairFinalScoreBefore?: number | null;
  visualQaScoreAfter?: number | null;
  editableElementsCreated?: number | null;
  layoutChanges?: number | null;
  warnings?: string[];
}): AiReconciliationAuditSummary {
  return {
    version: AI_RECONCILIATION_AUDIT_VERSION,
    status: input.status,
    recommendation: input.recommendation,
    reason: input.reason,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? null,
    failedAt: input.failedAt ?? null,
    errorMessage: input.errorMessage ?? null,
    visualQaScoreBefore: input.visualQaScoreBefore ?? null,
    repairFinalScoreBefore: input.repairFinalScoreBefore ?? null,
    visualQaScoreAfter: input.visualQaScoreAfter ?? null,
    editableElementsCreated: input.editableElementsCreated ?? null,
    layoutChanges: input.layoutChanges ?? null,
    warnings: input.warnings ?? [],
  };
}

export type SaveAiReconciliationAuditResult =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export async function saveAiReconciliationAuditSummary(
  importId: string,
  summary: AiReconciliationAuditSummary,
): Promise<SaveAiReconciliationAuditResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!summary) return { kind: 'error', message: 'summary is required' };

  try {
    const { data, error } = await invokeSecureFunction<{ ok?: boolean; error?: string }>(
      'template-import-pdf',
      {
        body: {
          operation: 'append_meta',
          import_id: importId,
          meta_patch: {
            ai_reconciliation_summary: summary,
          },
        },
      } as any,
    );

    if (error) return { kind: 'error', message: String(error?.message ?? error) };
    if (!data || data.error) return { kind: 'error', message: String(data?.error ?? 'unknown error') };

    return { kind: 'ok' };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}
