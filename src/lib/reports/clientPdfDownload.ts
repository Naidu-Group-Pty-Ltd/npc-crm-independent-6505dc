import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logReportRenderEvent } from '@/lib/reports/renderEvent';
import { investmentReportFileName } from '@/lib/reports/investment/reportFileName.pure';

export interface ClientPdfReport {
  id: string;
  property_address: string;
  current_version?: number | null;
  report_tier?: string | null;
  report_variant?: string | null;
  pdf_url?: string | null;
}

const STORAGE_BUCKET = 'investment-reports';

function storagePath(value: string): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '');
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const index = value.indexOf(marker);
  return index >= 0 ? decodeURIComponent(value.slice(index + marker.length).split('?')[0]) : null;
}

/** One naming rule for the Investment family — see `reportFileName.pure.ts`. The version rides as the suffix. */
export function clientPdfFilename(report: ClientPdfReport): string {
  return investmentReportFileName({
    tier: report.report_variant || report.report_tier,
    address: report.property_address,
    at: new Date(),
    suffix: `v${report.current_version || 1}`,
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * The sole standard client-PDF retrieval flow. It re-fetches the selected
 * report through the authenticated edge function, then downloads only its
 * persisted standard PDF. Callers may provide a renderer for a missing PDF.
 */
export async function downloadClientPdf(
  reportId: string,
  options: { report?: ClientPdfReport; renderMissingPdf?: () => Promise<boolean> } = {},
): Promise<'downloaded' | 'rendered'> {
  if (!reportId) throw new Error('A report is required to download a client PDF.');

  const resolve = async () => {
    if (options.report?.id === reportId && options.report.pdf_url) return options.report;
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      reportId,
      listOptions: { select: 'id, property_address, current_version, report_tier, report_variant, pdf_url, status' },
    });
    if (error || !data?.report) throw new Error('This report is unavailable or you no longer have access to it.');
    return data.report as ClientPdfReport;
  };

  let report = await resolve();
  let path = storagePath(report.pdf_url || '');
  if (!path && options.renderMissingPdf) {
    const rendered = await options.renderMissingPdf();
    if (!rendered) throw new Error('Client PDF could not be prepared. Please try again.');
    report = await resolve();
    path = storagePath(report.pdf_url || '');
    if (!path) throw new Error('Client PDF could not be prepared. Please try again.');
  }
  if (!path) throw new Error('Client PDF is not ready yet. Open the report and try again.');

  const { data, error } = await invokeSecureFunction('secure-storage', {
    operation: 'download', bucket: STORAGE_BUCKET, path,
  });
  if (error || !data?.success || !data?.data?.content) {
    throw new Error('Client PDF could not be retrieved. Please try again.');
  }
  const contentType = data.data.contentType || 'application/pdf';
  if (contentType !== 'application/pdf') throw new Error('The saved client document is not a PDF.');
  const binary = atob(data.data.content);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (!bytes.length) throw new Error('The saved client PDF is empty.');
  triggerDownload(new Blob([bytes], { type: contentType }), clientPdfFilename(report));
  logReportRenderEvent({
    format: 'investment', engine: 'stored', source: 'client_pdf_stored',
    reportId, entityName: report.property_address ?? undefined,
  });
  return options.renderMissingPdf ? 'rendered' : 'downloaded';
}
