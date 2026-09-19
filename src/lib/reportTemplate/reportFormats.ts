/**
 * The report formats a template can be tied to, and what to call them.
 *
 * Derived from the adapter registry rather than listed again: an adapter is
 * what makes a format renderable through the design system at all, so
 * "formats you can choose a template for" and "formats that have an adapter"
 * are the same set by construction. A format added to the registry appears
 * here the same day, and one that is preview-only says so rather than being
 * silently absent.
 *
 * The label comes from the adapter too. `Templates.tsx` keeps its own
 * `REPORT_TYPE_LABELS` for a different table (`report_structure_templates`,
 * which drives generation prompts, not page design) — the two are separate
 * catalogues and this is not a place to merge them.
 */
import { listAdapters, normaliseReportType } from '@/lib/reportTemplate/adapters';

export interface ReportFormatDescriptor {
  /** The normalised format key, as a selection stores it. */
  reportType: string;
  label: string;
  /**
   * Whether a chosen template can actually render this format's documents.
   *
   * False means the format has no production adapter — a template may still be
   * designed against it, but nothing generated will route through one, and any
   * surface offering a choice has to say so instead of implying otherwise.
   */
  supportsProduction: boolean;
  /** Why not, when it is preview-only. Written for a person to read. */
  previewOnlyReason?: string | null;
}

export function listReportFormats(): ReportFormatDescriptor[] {
  return listAdapters()
    .map((adapter) => ({
      reportType: adapter.reportType,
      label: adapter.label,
      supportsProduction: adapter.supportsProduction,
      previewOnlyReason: adapter.supportsProduction
        ? null
        : adapter.legacyFallback?.reason ?? null,
    }))
    .sort((a, b) => {
      // Formats a choice actually changes come first.
      if (a.supportsProduction !== b.supportsProduction) return a.supportsProduction ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}

export function findReportFormat(reportType?: string | null): ReportFormatDescriptor | null {
  const key = normaliseReportType(reportType);
  if (!key) return null;
  return listReportFormats().find((format) => format.reportType === key) ?? null;
}

/** What to call a format when it is not in the registry — never a raw key. */
export function reportFormatLabel(reportType?: string | null): string {
  const found = findReportFormat(reportType);
  if (found) return found.label;
  const key = normaliseReportType(reportType);
  if (!key) return 'Report';
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The Investment report, named once.
 *
 * `PremiumPdfButton` and the export panel both need it, and it is the format
 * whose spelling varies most across the codebase (`compass`,
 * `investment_compass`, `investment_report`, `property_investment` all mean
 * this one). Referring to the descriptor keeps those two surfaces from picking
 * different spellings and therefore different selections.
 */
export const INVESTMENT_REPORT_FORMAT: ReportFormatDescriptor = {
  reportType: 'investment',
  label: 'Investment report',
  supportsProduction: true,
  previewOnlyReason: null,
};
