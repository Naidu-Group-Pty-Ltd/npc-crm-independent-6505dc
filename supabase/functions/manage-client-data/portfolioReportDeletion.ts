export interface PortfolioReportDeletionTarget {
  id: string;
  client_id: string | null;
  pdf_file_path: string | null;
}

/**
 * Produces the server-authoritative scope for a portfolio report deletion.
 * Client ownership is derived from the loaded report, never browser input.
 */
export function resolvePortfolioReportDeletionTarget(
  requestedReportId: string,
  report: PortfolioReportDeletionTarget | null,
) {
  if (!requestedReportId || !report || report.id !== requestedReportId) return null;

  return {
    reportId: report.id,
    clientId: report.client_id || null,
    pdfFilePath: report.pdf_file_path || null,
  };
}
