/**
 * The Premium PDF design panel's option contract.
 *
 * These types now live in the report design system
 * (`supabase/functions/_shared/reportDesign/options.pure.ts`) because the
 * stylesheet builder that consumes them is edge-side and cannot import from
 * `src/`. There were two definitions of these five enums; there is now one, and
 * this file is the aliasing layer that keeps the existing UI imports working.
 *
 * The aliases are exact — `PdfDesignOptions` *is* `ReportDesignOptions`.
 */
export type {
  ReportChapterStyle as PdfChapterStyle,
  ReportCoverStyle as PdfCoverStyle,
  ReportDensity as PdfDensity,
  ReportDesignOptions as PdfDesignOptions,
  ReportTableStyle as PdfTableStyle,
} from '@/lib/reportDesign/options.pure';
export type { ReportPreset as PdfDesignPreset } from '@/lib/reportDesign/brandResolve.pure';

export {
  DEFAULT_REPORT_DESIGN_OPTIONS as DEFAULT_PDF_DESIGN_OPTIONS,
  normalizeReportDesignOptions,
} from '@/lib/reportDesign/options.pure';
