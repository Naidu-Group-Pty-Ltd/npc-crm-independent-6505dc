import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolvePortfolioReportDeletionTarget } from './portfolioReportDeletion.ts';

Deno.test('resolves client ownership from the selected report ID, not browser input', () => {
  const result = resolvePortfolioReportDeletionTarget('report-a', {
    id: 'report-a',
    client_id: 'client-a',
    pdf_file_path: 'portfolio-reports/client-a/a.pdf',
  });
  assertEquals(result, {
    reportId: 'report-a',
    clientId: 'client-a',
    pdfFilePath: 'portfolio-reports/client-a/a.pdf',
  });
});

Deno.test('supports a legacy report with no client ID without guessing an owner', () => {
  const result = resolvePortfolioReportDeletionTarget('legacy-report', {
    id: 'legacy-report',
    client_id: null,
    pdf_file_path: null,
  });
  assertEquals(result, { reportId: 'legacy-report', clientId: null, pdfFilePath: null });
});

Deno.test('does not permit a mismatched report record to become a delete target', () => {
  assertEquals(resolvePortfolioReportDeletionTarget('report-a', {
    id: 'report-b', client_id: 'client-a', pdf_file_path: null,
  }), null);
});
