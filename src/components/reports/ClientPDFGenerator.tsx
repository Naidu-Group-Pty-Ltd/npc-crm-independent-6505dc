import { forwardRef } from 'react';
import { PixelPerfectPDFGenerator, type PixelPerfectPDFGeneratorHandle } from './PixelPerfectPDFGenerator';
import {
  projectRowForPdf,
  type StoredInvestmentReportRow,
} from '@/lib/reports/investment/investmentPdfSource';

interface ClientPDFGeneratorProps {
  report: StoredInvestmentReportRow;
  includeSources?: boolean;
  includeScoring?: boolean;
  /** 'legacy' renders the quiet "Download (legacy layout)" presentation. */
  appearance?: 'primary' | 'legacy';
}

/**
 * The row → document transform, including the financial healing, moved to
 * `investmentPdfSource` so `deliverInvestmentPdf` draws from the same one.
 * Two copies would be two opinions about the numbers.
 */
export const ClientPDFGenerator = forwardRef<PixelPerfectPDFGeneratorHandle, ClientPDFGeneratorProps>(({ report, includeSources = true, includeScoring = true, appearance = 'primary' }, ref) => {
  const { report: transformedReport, reportTier } = projectRowForPdf(report);

  return <PixelPerfectPDFGenerator ref={ref} report={transformedReport} includeSources={includeSources} includeScoring={includeScoring} reportTier={reportTier} appearance={appearance} />;
});
