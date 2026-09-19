export interface TemplateBindingContext {
  data: Record<string, any>;
  meta: { reportId: string; reportType: string; variant: string | null; tier: string | null };
}

export interface BrandContext {
  tokens?: Record<string, any>;
  logoUrl?: string | null;
}

export interface RoutingContext {
  reportId: string;
  reportType: string;
  variant: string | null;
  tier: string | null;
  title?: string | null;
  fileLabel?: string | null;
  /**
   * The complete download name, when the format names its own document
   * (the Investment family: tier word, whole address, date). Absent, the
   * route composes `<reportType>-<fileLabel>-<id8>.pdf` as before.
   */
  fileName?: string | null;
  sourceTable?: string;
  legacyFallback?: LegacyFallbackDescriptor;
}

export interface LegacyFallbackDescriptor {
  label: string;
  route?: string;
  reason?: string;
}

/**
 * One row in the "preview with a real report" picker: enough to choose by,
 * nothing more. The `label` is the most specific identifying string the
 * format's table stores — an address, a client's name, a conversation title —
 * falling back to the format's own name, and `savedAt` lets the picker
 * distinguish two entries that share one (the same client assessed twice).
 */
export interface ReportListing {
  id: string;
  label: string;
  savedAt?: string | null;
}

export interface ReportTemplateAdapter {
  reportType: string;
  label: string;
  supportsProduction: boolean;
  samplePresetIds?: string[];
  legacyFallback?: LegacyFallbackDescriptor;
  /**
   * `variant` is what the caller asked for rather than what the row says — the
   * Cash Flow adapter reads it to pick one of three stored scenarios, and the
   * others derive their own from the record and ignore it. Optional, because
   * every existing caller omits it and the adapters that use it have a default.
   */
  /**
   * `payload` is the caller's own reviewed data, for the one format whose
   * contract puts the arithmetic in the browser (the 10 Year Cash Flow — see
   * `docs/reports/CASH_FLOW.md`). An adapter that supports it renders the
   * supplied series instead of the stored one, after validating it exactly as
   * it validates a stored row; adapters that read stored records ignore it.
   * Without this, a stored template choice applied only when the screen
   * happened to match the store — which for that format is the exception.
   */
  resolveRoutingContext(input: { reportId: string; variant?: string | null; payload?: Record<string, unknown> | null }): Promise<RoutingContext | null>;
  buildBindingContext(input: { reportId: string; variant?: string | null; brand?: BrandContext | null; payload?: Record<string, unknown> | null }): Promise<TemplateBindingContext | null>;
  /**
   * Recent stored reports this adapter could render, for the template
   * preview's real-data picker. Each adapter knows its own table — which is
   * the whole point: the picker was hard-wired to `investment_reports` for as
   * long as this method did not exist, so eight formats' templates could only
   * ever be previewed against sample data. Optional because a preview-only
   * adapter has nothing to list; errors return `[]`, never throw — an empty
   * picker is the degraded mode, exactly as a null binding context is.
   */
  listRecentReports?(input?: { limit?: number }): Promise<ReportListing[]>;
}
