/**
 * Controlled vocabularies for the Template Library.
 *
 * These are the FILTER OPTIONS, not the data. Every value an entry actually
 * carries lives in the database; this module exists so the filter chips render
 * without a network round-trip and so the labels stay consistent between the
 * browse grid, the preview and the admin editor.
 *
 * Categories deliberately mirror the existing report format groups in
 * `src/pages/Templates.tsx` so a user who knows the Formats tab already knows
 * how the library is organised.
 */
import type {
  TemplateLibraryAccessTier,
  TemplateLibraryCategory,
  TemplateLibraryOrientation,
  TemplateLibraryStatus,
  TemplateLibraryStyle,
} from './types';

export interface TaxonomyOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export const CATEGORY_OPTIONS: TaxonomyOption<TemplateLibraryCategory>[] = [
  { value: 'investment', label: 'Investment', description: 'Individual property investment analysis' },
  { value: 'suburb', label: 'Suburb', description: 'Suburb-wide market and investment analysis' },
  { value: 'postcode', label: 'Postcode', description: 'Postcode-zone market analysis' },
  { value: 'statewide', label: 'Statewide', description: 'State-level macro market analysis' },
  { value: 'comparison', label: 'Comparison', description: 'Multiple properties side by side' },
  { value: 'cash_flow', label: 'Cash flow', description: 'Detailed cash flow projections' },
  { value: 'client_form', label: 'Client form', description: 'Client-facing forms and fact finds' },
  { value: 'compliance', label: 'Compliance', description: 'Compliance, audit and governance' },
  { value: 'finance', label: 'Finance', description: 'Borrowing capacity and serviceability' },
  { value: 'portfolio', label: 'Portfolio', description: 'Portfolio performance and holdings review' },
];

export const STYLE_OPTIONS: TaxonomyOption<TemplateLibraryStyle>[] = [
  { value: 'corporate', label: 'Corporate', description: 'Structured, conservative, board-ready' },
  { value: 'editorial', label: 'Editorial', description: 'Generous white space, strong typography' },
  { value: 'minimal', label: 'Minimal', description: 'Restrained, content-first' },
  { value: 'luxury', label: 'Luxury', description: 'Premium presentation, image-led' },
  { value: 'technical', label: 'Technical', description: 'Dense data, tables and charts' },
];

export const ORIENTATION_OPTIONS: TaxonomyOption<TemplateLibraryOrientation>[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

export const INDUSTRY_OPTIONS: TaxonomyOption<string>[] = [
  { value: 'property', label: 'Property' },
  { value: 'finance', label: 'Finance' },
  { value: 'legal', label: 'Legal' },
  { value: 'general', label: 'General' },
];

export const ACCESS_TIER_OPTIONS: TaxonomyOption<TemplateLibraryAccessTier>[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'premium', label: 'Premium' },
  { value: 'enterprise', label: 'Enterprise' },
];

export const STATUS_OPTIONS: TaxonomyOption<TemplateLibraryStatus>[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In review' },
  { value: 'published', label: 'Published' },
  { value: 'deprecated', label: 'Deprecated' },
  { value: 'archived', label: 'Archived' },
];

/**
 * Report-type labels, matching `REPORT_TYPE_LABELS` in `src/pages/Templates.tsx`
 * so the same key reads the same way in the Builder tab and the library.
 */
export const REPORT_TYPE_LABELS: Record<string, string> = {
  investment: 'Investment Report',
  cashflow: 'Cash Flow',
  qa: 'Q&A Export',
  borrowing_capacity: 'Borrowing Capacity',
  portfolio: 'Portfolio Analysis',
  suburb: 'Suburb Analysis',
  postcode: 'Postcode Analysis',
  statewide: 'Statewide Analysis',
  comparison: 'Comparison Report',
  formara: 'Formara / Client Form',
  // The migrated formats. These keys were never added, so the library's
  // Report-type row printed them raw — `cash_flow_comparison`,
  // `client_details`, `commercial_capacity`, `investment_compass`,
  // `market_intelligence` — five underscore-cased column values in a filter an
  // operator reads. That is most of what the 19 Sep 2026 clone audit called
  // "too messy and looks unprofessional".
  cash_flow_comparison: 'Cash Flow Comparison',
  client_details: 'Client Details Form',
  commercial_capacity: 'Commercial & Industrial Capacity',
  investment_compass: 'Investment Compass',
  market_intelligence: 'Market Intelligence',
};

/**
 * A readable name for a key this map has not heard of.
 *
 * Returning the key was the old behaviour and it is how database vocabulary
 * reached the page. A key still has to be shown — an unlabelled filter chip is
 * worse than an ugly one — so it is title-cased rather than printed raw, and a
 * new format that nobody has labelled reads as words instead of an identifier.
 */
function humaniseReportType(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function categoryLabel(value: string): string {
  return CATEGORY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function styleLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return STYLE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function reportTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return REPORT_TYPE_LABELS[value] ?? humaniseReportType(value);
}
