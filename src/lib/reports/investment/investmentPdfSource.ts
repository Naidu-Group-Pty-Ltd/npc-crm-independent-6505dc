/**
 * The stored row a browser-drawn Investment PDF is built from.
 *
 * `investment_reports` and the generator speak different vocabularies —
 * `property_address` vs `address`, `report_content` vs `content`, four separate
 * jsonb columns vs one `enhanced_data` object — and something has to translate.
 * That translation lived inside `ClientPDFGenerator`, which was fine while a
 * React component was the only way to reach the generator.
 *
 * It is not fine now. `deliverInvestmentPdf` draws the same document without
 * mounting anything, and a second copy of this transform would be a second
 * opinion about **money**: the projection is where stored financials are healed
 * (`reconcileStoredFinancials`) and where an historic row's overrides are
 * overlaid (`overlayOverridesForHistoricRow`). Two copies drifting apart means
 * two documents for one report, differing in the numbers.
 *
 * So there is one transform, here, and both callers use it.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { reconcileStoredFinancials } from '@/lib/reports/investment/financialEngine.pure';
import { overlayOverridesForHistoricRow } from '@/lib/reports/investment/overrides.pure';
import { presentStoredMarkdown } from '@/lib/reports/investment/derivedHygiene.pure';
import { normalizeReportType } from '@/lib/reports/reportVariants';
import type {
  InvestmentReportData,
  ReportTier,
} from '@/lib/reports/investment/investmentPdfDocument';

/** The `investment_reports` columns the document is drawn from. */
export interface StoredInvestmentReportRow {
  id: string;
  property_address?: string | null;
  report_content?: string | null;
  demographics_data?: unknown;
  economic_data?: unknown;
  financial_calculations?: unknown;
  investment_score?: unknown;
  location_intelligence?: unknown;
  manual_overrides?: unknown;
  report_tier?: string | null;
  report_variant?: string | null;
  pdf_url?: string | null;
  created_at?: string | null;
  /**
   * The record's version, in the two forms the row carries it: the server
   * stamps `updated_at` on every edit, and `current_version` moves when the
   * report is regenerated. A finalisation is remembered against both.
   */
  updated_at?: string | null;
  current_version?: number | null;
}

export interface ProjectedInvestmentReport {
  report: InvestmentReportData;
  reportTier: ReportTier;
}

/**
 * Row → what the generator draws.
 *
 * Moved verbatim from `ClientPDFGenerator` so the document does not change.
 * The address fallback is load-bearing: the drawing calls `.trim()` on it.
 */
export function projectRowForPdf(row: StoredInvestmentReportRow): ProjectedInvestmentReport {
  // Heal the stored projections, then overlay the overrides the way a legacy
  // renderer needs them for rows that predate recompute-on-update. Both rules
  // live with the engine — nothing here decides anything about money.
  const mergedFinancialData = overlayOverridesForHistoricRow(
    reconcileStoredFinancials((row.financial_calculations as Record<string, unknown>) || {}).fin || {},
    row.manual_overrides,
  );

  return {
    report: {
      id: row.id,
      address: row.property_address || 'Property Report',
      // The stored content through the read-path placeholder scrub every
      // renderer applies — see `presentStoredMarkdown`. A derived report
      // stored before the write-path hygiene carries its "N/A" cells verbatim,
      // and this projection is where both presentations read the prose.
      content: presentStoredMarkdown(row.report_content),
      created_at: row.created_at || new Date().toISOString(),
      pdf_url: row.pdf_url,
      enhanced_data: {
        domainData: null,
        absData: row.demographics_data,
        rbaData: row.economic_data,
        financialData: mergedFinancialData,
        locationData: row.location_intelligence,
        investmentScore: row.investment_score,
      },
    },
    // Resolved through the canonical alias map rather than cast: `strategic`,
    // `due_diligence` and `pldd` are one tier, and an unvalidated cast is how
    // the strategic tier reached a four-branch title map and came out titled
    // "Snapshot Report" (QA-32).
    reportTier: (normalizeReportType(row.report_variant || row.report_tier) ?? 'compass') as ReportTier,
  };
}

/**
 * Fetch the row through the broker every client read already uses.
 *
 * Throws rather than returning null: a caller asking to draw a document for a
 * report it cannot read has nothing to draw, and a blank PDF is worse than an
 * error somebody sees.
 */
export async function loadInvestmentReportForPdf(
  reportId: string,
): Promise<StoredInvestmentReportRow> {
  const { data, error } = await invokeSecureFunction<{ report?: StoredInvestmentReportRow }>(
    'get-investment-reports',
    { reportId },
  );
  if (error) throw new Error(error.message || 'The report could not be read.');
  const row = data?.report;
  if (!row?.id) throw new Error('The report could not be read.');
  return row;
}
