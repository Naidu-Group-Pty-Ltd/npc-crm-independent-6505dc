/**
 * pdfImportPerformancePersistence — Phase 10F.
 *
 * Save/load the Performance + Cost audit via the existing secure
 * `template-import-pdf` operations (`append_meta` / `get_status`). Metadata only;
 * no new edge operation or table. Never stores raw PDF/OCR text or rasters.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  PDF_IMPORT_PERFORMANCE_AUDIT_VERSION,
  type LoadPdfImportPerformanceAuditResult,
  type PdfImportPerformanceCostAudit,
  type SavePdfImportPerformanceAuditResult,
} from './pdfImportPerformanceTypes';

export const PDF_IMPORT_PERFORMANCE_AUDIT_META_KEY = 'performance_cost_audit';

export function withPdfImportPerformanceAuditPersistedAt(
  audit: PdfImportPerformanceCostAudit,
  persistedAt: string,
): PdfImportPerformanceCostAudit {
  return { ...audit, persistedAt };
}

export async function savePdfImportPerformanceAudit(
  importId: string,
  audit: PdfImportPerformanceCostAudit,
): Promise<SavePdfImportPerformanceAuditResult> {
  if (!importId) return { kind: 'error', message: 'importId is required' };
  if (!audit) return { kind: 'error', message: 'audit is required' };

  const persisted = withPdfImportPerformanceAuditPersistedAt(audit, new Date().toISOString());

  try {
    const { data, error } = await invokeSecureFunction<{ ok?: boolean; error?: string }>(
      'template-import-pdf',
      {
        body: {
          operation: 'append_meta',
          import_id: importId,
          meta_patch: {
            [PDF_IMPORT_PERFORMANCE_AUDIT_META_KEY]: persisted,
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

export async function loadPdfImportPerformanceAudit(
  importId: string,
): Promise<LoadPdfImportPerformanceAuditResult> {
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
    const audit = meta?.[PDF_IMPORT_PERFORMANCE_AUDIT_META_KEY] as PdfImportPerformanceCostAudit | undefined;

    if (!audit) return { kind: 'missing' };
    if (audit.version !== PDF_IMPORT_PERFORMANCE_AUDIT_VERSION) {
      return { kind: 'error', message: 'Invalid performance cost audit version' };
    }
    return { kind: 'ok', audit };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}
