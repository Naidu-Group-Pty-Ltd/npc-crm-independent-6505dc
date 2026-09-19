/**
 * selfHealingPersistence — Phase 10E.
 *
 * Save/load the Self-Healing Retry Audit via the existing secure
 * `template-import-pdf` operations (`append_meta` / `get_status`). Metadata only;
 * no new edge operation or table.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  SELF_HEALING_RETRY_AUDIT_VERSION,
  type LoadSelfHealingRetryAuditResult,
  type SaveSelfHealingRetryAuditResult,
  type SelfHealingRetryAudit,
} from './selfHealingTypes';

export const SELF_HEALING_RETRY_AUDIT_META_KEY = 'self_healing_retry_audit';

export function withSelfHealingPersistedAt(
  audit: SelfHealingRetryAudit,
  persistedAt: string,
): SelfHealingRetryAudit {
  return { ...audit, persistedAt };
}

export async function saveSelfHealingRetryAudit(
  importId: string,
  audit: SelfHealingRetryAudit,
): Promise<SaveSelfHealingRetryAuditResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!audit) return { kind: 'error', message: 'audit is required' };

  const persisted = withSelfHealingPersistedAt(audit, new Date().toISOString());

  try {
    const { data, error } = await invokeSecureFunction<{ ok?: boolean; error?: string }>(
      'template-import-pdf',
      {
        body: {
          operation: 'append_meta',
          import_id: importId,
          meta_patch: {
            [SELF_HEALING_RETRY_AUDIT_META_KEY]: persisted,
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

export async function loadSelfHealingRetryAudit(
  importId: string,
): Promise<LoadSelfHealingRetryAuditResult> {
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
    const audit = meta?.[SELF_HEALING_RETRY_AUDIT_META_KEY] as SelfHealingRetryAudit | undefined;

    if (!audit) return { kind: 'missing' };
    if (audit.version !== SELF_HEALING_RETRY_AUDIT_VERSION) {
      return { kind: 'error', message: 'Invalid self-healing retry audit version' };
    }
    return { kind: 'ok', audit };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}
