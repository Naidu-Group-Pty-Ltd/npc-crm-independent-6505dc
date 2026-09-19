/**
 * pdfImportClientReportPersistence — Phase 11G client-side invokers.
 *
 * Thin wrappers around the secure `pdf-import-client-report` Edge Function.
 * There is NO email/send operation and NO public-link operation. All
 * authorization is enforced server-side; the browser never queries the table
 * directly and never retrieves raw artifacts.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  type BuildPdfImportClientReportOptions,
  type ListPdfImportClientReportsOptions,
  type PdfImportClientReportAction,
  type PdfImportClientReportActionResult,
  type PdfImportClientReportExportFormat,
  type PdfImportClientReportPayload,
  type PdfImportClientReportRecord,
} from './pdfImportClientReportTypes';

export const PDF_IMPORT_CLIENT_REPORT_FUNCTION = 'pdf-import-client-report';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function errorMessage(error: unknown): string {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  const maybe = error as { message?: unknown };
  return String(maybe?.message ?? error);
}

const ACTION_TO_OPERATION: Record<PdfImportClientReportAction, string> = {
  review: 'review_report',
  approve: 'approve_report',
  reject: 'reject_report',
  mark_exported: 'mark_exported',
  supersede: 'supersede_report',
};

export async function generatePdfImportClientReportPreview(
  options: BuildPdfImportClientReportOptions,
): Promise<{ kind: 'ok'; report: PdfImportClientReportPayload } | { kind: 'error'; message: string }> {
  try {
    const { data, error } = await invokeSecureFunction<any>(PDF_IMPORT_CLIENT_REPORT_FUNCTION, {
      body: {
        operation: 'generate_preview',
        report_type: options.reportType,
        audience: options.audience ?? undefined,
        import_id: options.importId ?? undefined,
        template_id: options.templateId ?? undefined,
        operator_note: options.operatorNote ?? undefined,
      },
    } as any);
    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true || !data.report) {
      return { kind: 'error', message: String(data?.error ?? 'generate_preview did not return ok') };
    }
    return { kind: 'ok', report: data.report as PdfImportClientReportPayload };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

export async function savePdfImportClientReportDraft(
  payload: PdfImportClientReportPayload,
): Promise<{ kind: 'ok'; report: PdfImportClientReportRecord } | { kind: 'error'; message: string }> {
  try {
    const { data, error } = await invokeSecureFunction<any>(PDF_IMPORT_CLIENT_REPORT_FUNCTION, {
      body: { operation: 'save_draft', payload },
    } as any);
    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true || !data.report) {
      return { kind: 'error', message: String(data?.error ?? 'save_draft did not return ok') };
    }
    return { kind: 'ok', report: data.report as PdfImportClientReportRecord };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

export async function listPdfImportClientReports(
  options?: ListPdfImportClientReportsOptions,
): Promise<{ kind: 'ok'; reports: PdfImportClientReportRecord[] } | { kind: 'error'; message: string }> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(options?.limit) || DEFAULT_LIMIT));
  try {
    const { data, error } = await invokeSecureFunction<any>(PDF_IMPORT_CLIENT_REPORT_FUNCTION, {
      body: {
        operation: 'list_reports',
        import_id: options?.importId ?? undefined,
        template_id: options?.templateId ?? undefined,
        status: options?.status ?? 'all',
        audience: options?.audience ?? 'all',
        report_type: options?.reportType ?? 'all',
        limit,
      },
    } as any);
    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true) {
      return { kind: 'error', message: String(data?.error ?? 'list_reports did not return ok') };
    }
    const reports = Array.isArray(data.reports) ? (data.reports as PdfImportClientReportRecord[]) : [];
    return { kind: 'ok', reports };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

export async function updatePdfImportClientReportStatus(input: {
  reportId: string;
  action: PdfImportClientReportAction;
  note?: string | null;
  exportFormat?: PdfImportClientReportExportFormat | null;
}): Promise<PdfImportClientReportActionResult> {
  if (!input.reportId) return { kind: 'error', message: 'reportId is required' };
  const operation = ACTION_TO_OPERATION[input.action];
  if (!operation) return { kind: 'error', message: `unknown action: ${input.action}` };
  try {
    const { data, error } = await invokeSecureFunction<any>(PDF_IMPORT_CLIENT_REPORT_FUNCTION, {
      body: {
        operation,
        report_id: input.reportId,
        note: input.note ?? null,
        export_format: input.exportFormat ?? undefined,
      },
    } as any);
    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true) {
      return { kind: 'error', message: String(data?.error ?? `${operation} did not return ok`) };
    }
    return { kind: 'ok', message: 'ok', report: (data.report as PdfImportClientReportRecord) ?? null };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}
