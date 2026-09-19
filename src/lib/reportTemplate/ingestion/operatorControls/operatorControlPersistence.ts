/**
 * operatorControlPersistence — Phase 10G.
 *
 * Save/load the production operator control audit via the existing secure
 * `template-import-pdf` operations (`append_meta` / `get_status`). Metadata only;
 * no new edge operation or table.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  PRODUCTION_OPERATOR_CONTROL_AUDIT_VERSION,
  type LoadOperatorControlAuditResult,
  type ProductionOperatorControlAudit,
  type SaveOperatorControlAuditResult,
} from './operatorControlTypes';

export const PRODUCTION_OPERATOR_CONTROL_AUDIT_META_KEY = 'production_operator_control_audit';

export function withProductionOperatorControlAuditPersistedAt(
  audit: ProductionOperatorControlAudit,
  persistedAt: string,
): ProductionOperatorControlAudit {
  return { ...audit, persistedAt };
}

export async function saveProductionOperatorControlAudit(
  importId: string,
  audit: ProductionOperatorControlAudit,
): Promise<SaveOperatorControlAuditResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!audit) return { kind: 'error', message: 'audit is required' };

  const persisted = withProductionOperatorControlAuditPersistedAt(audit, new Date().toISOString());

  try {
    const { data, error } = await invokeSecureFunction<{ ok?: boolean; error?: string }>(
      'template-import-pdf',
      {
        body: {
          operation: 'append_meta',
          import_id: importId,
          meta_patch: {
            [PRODUCTION_OPERATOR_CONTROL_AUDIT_META_KEY]: persisted,
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

export async function loadProductionOperatorControlAudit(
  importId: string,
): Promise<LoadOperatorControlAuditResult> {
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
    const audit = meta?.[PRODUCTION_OPERATOR_CONTROL_AUDIT_META_KEY] as ProductionOperatorControlAudit | undefined;

    if (!audit) return { kind: 'missing' };
    if (audit.version !== PRODUCTION_OPERATOR_CONTROL_AUDIT_VERSION) {
      return { kind: 'error', message: 'Invalid production operator control audit version' };
    }
    return { kind: 'ok', audit };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}
