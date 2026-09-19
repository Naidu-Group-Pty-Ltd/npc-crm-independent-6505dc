/**
 * pdfImportRetentionPersistence — Phase 11E client-side invokers.
 *
 * Thin wrappers around the secure `pdf-import-retention` Edge Function. There is
 * NO delete operation. All authorization is enforced server-side; the browser
 * never queries the retention table directly.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  type ListPdfImportRetentionEventsOptions,
  type PdfImportRetentionAction,
  type PdfImportRetentionActionResult,
  type PdfImportRetentionEvaluationResult,
  type PdfImportRetentionEventRecord,
} from './pdfImportRetentionTypes';

export const PDF_IMPORT_RETENTION_FUNCTION = 'pdf-import-retention';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function errorMessage(error: unknown): string {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  const maybe = error as { message?: unknown };
  return String(maybe?.message ?? error);
}

const ACTION_TO_OPERATION: Record<PdfImportRetentionAction, string> = {
  review: 'review_event',
  approve_for_future_cleanup: 'approve_for_future_cleanup',
  reject: 'reject_event',
  block: 'block_event',
  supersede: 'supersede_event',
};

export async function runPdfImportRetentionScan(): Promise<
  { kind: 'ok'; result: PdfImportRetentionEvaluationResult; persistedCount: number } | { kind: 'error'; message: string }
> {
  try {
    const { data, error } = await invokeSecureFunction<any>(PDF_IMPORT_RETENTION_FUNCTION, {
      body: { operation: 'run_scan' },
    } as any);
    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true) {
      return { kind: 'error', message: String(data?.error ?? 'run_scan did not return ok') };
    }
    return {
      kind: 'ok',
      result: data.result as PdfImportRetentionEvaluationResult,
      persistedCount: Number(data.persistedCount ?? 0) || 0,
    };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

export async function listPdfImportRetentionEvents(
  options?: ListPdfImportRetentionEventsOptions,
): Promise<{ kind: 'ok'; events: PdfImportRetentionEventRecord[] } | { kind: 'error'; message: string }> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(options?.limit) || DEFAULT_LIMIT));
  try {
    const { data, error } = await invokeSecureFunction<any>(PDF_IMPORT_RETENTION_FUNCTION, {
      body: {
        operation: 'list_events',
        status: options?.status ?? 'active',
        decision: options?.decision ?? 'all',
        domain: options?.domain ?? 'all',
        limit,
      },
    } as any);
    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true) {
      return { kind: 'error', message: String(data?.error ?? 'list_events did not return ok') };
    }
    const events = Array.isArray(data.events) ? (data.events as PdfImportRetentionEventRecord[]) : [];
    return { kind: 'ok', events };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

export async function updatePdfImportRetentionEventStatus(input: {
  eventId: string;
  action: PdfImportRetentionAction;
  note?: string | null;
}): Promise<PdfImportRetentionActionResult> {
  if (!input.eventId) return { kind: 'error', message: 'eventId is required' };
  const operation = ACTION_TO_OPERATION[input.action];
  if (!operation) return { kind: 'error', message: `unknown action: ${input.action}` };
  try {
    const { data, error } = await invokeSecureFunction<any>(PDF_IMPORT_RETENTION_FUNCTION, {
      body: { operation, event_id: input.eventId, note: input.note ?? null },
    } as any);
    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true) {
      return { kind: 'error', message: String(data?.error ?? `${operation} did not return ok`) };
    }
    return { kind: 'ok', message: 'ok', event: (data.event as PdfImportRetentionEventRecord) ?? null };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}
