/**
 * adaptiveReconciliationPersistence — Phase 10D.
 *
 * Save/load the Adaptive Reconciliation Policy via the existing secure
 * `template-import-pdf` operations (`append_meta` / `get_status`). Metadata only;
 * no new edge operation or table. Never calls AI, never applies reconciliation.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  ADAPTIVE_RECONCILIATION_POLICY_VERSION,
  type AdaptiveReconciliationPolicy,
  type LoadAdaptiveReconciliationPolicyResult,
  type SaveAdaptiveReconciliationPolicyResult,
} from './adaptiveReconciliationTypes';

export const ADAPTIVE_RECONCILIATION_POLICY_META_KEY = 'adaptive_reconciliation_policy';

export async function saveAdaptiveReconciliationPolicy(
  importId: string,
  policy: AdaptiveReconciliationPolicy,
): Promise<SaveAdaptiveReconciliationPolicyResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!policy) return { kind: 'error', message: 'policy is required' };

  try {
    const { data, error } = await invokeSecureFunction<{ ok?: boolean; error?: string }>(
      'template-import-pdf',
      {
        body: {
          operation: 'append_meta',
          import_id: importId,
          meta_patch: {
            [ADAPTIVE_RECONCILIATION_POLICY_META_KEY]: policy,
          },
        },
      } as any,
    );

    if (error) return { kind: 'error', message: String(error?.message ?? error) };
    if (!data || data.error || data.ok !== true) {
      return { kind: 'error', message: String(data?.error ?? 'append_meta did not return ok') };
    }
    return { kind: 'ok' };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}

export async function loadAdaptiveReconciliationPolicy(
  importId: string,
): Promise<LoadAdaptiveReconciliationPolicyResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };

  try {
    const { data, error } = await invokeSecureFunction<{
      record?: { meta?: Record<string, unknown> | null } | null;
      error?: string;
    }>(
      'template-import-pdf',
      {
        body: {
          operation: 'get_status',
          import_id: importId,
        },
      } as any,
    );

    if (error) {
      const message = String(error?.message ?? error);
      if (/not found|not_found|missing/i.test(message)) return { kind: 'missing' };
      return { kind: 'error', message };
    }
    if (!data || data.error) return { kind: 'error', message: String(data?.error ?? 'unknown error') };

    const meta = (data.record?.meta && typeof data.record.meta === 'object') ? data.record.meta : null;
    const policy = meta?.[ADAPTIVE_RECONCILIATION_POLICY_META_KEY] as AdaptiveReconciliationPolicy | undefined;

    if (!policy) return { kind: 'missing' };
    if (policy.version !== ADAPTIVE_RECONCILIATION_POLICY_VERSION) {
      return { kind: 'error', message: 'Invalid adaptive reconciliation policy version' };
    }
    return { kind: 'ok', policy };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}
