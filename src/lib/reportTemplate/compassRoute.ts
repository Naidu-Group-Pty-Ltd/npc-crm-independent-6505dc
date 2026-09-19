import {
  routeReportThroughTemplate,
  type TemplateBuilderRouteResult,
  type TemplateRenderer,
  type TemplateRouteRefusal,
} from './routeReportThroughTemplate';
import { getAdapter, normaliseReportType } from './adapters';

const COMPASS_REPORT_TYPES = ['investment_compass'] as const;

/**
 * Back-compatible Compass pilot entry point.
 *
 * Keep this boundary narrow: PremiumPdfButton calls it for every investment
 * report, while only Compass reports are approved for Template Builder PDF
 * rendering. Other report types must fall through to their legacy renderer.
 */
export function tryRouteThroughTemplateBuilder(
  reportId: string,
  /**
   * The template the person chose for this format, when they have chosen one.
   *
   * Optional, and every existing caller omits it — a report generated without a
   * choice resolves by ranking exactly as it always did.
   */
  templateId?: string | null,
): Promise<TemplateBuilderRouteResult | null> {
  return routeReportThroughTemplate(reportId, {
    reportType: 'investment_compass',
    allowedReportTypes: COMPASS_REPORT_TYPES,
    templateId: templateId ?? null,
  });
}

/**
 * The general entry point — any production format, one call.
 *
 * The Compass function above was the pilot, and for a year it was also the
 * only door: every other format's fifty masters were seeded, adapter and all,
 * with no way for a product surface to route a report through them. This is
 * that door, and it is deliberately **inert until somebody activates a
 * template**: `resolveReportTemplate` matches only *active* `report_templates`
 * rows, so calling this for a deployment with nothing activated returns null
 * and costs one lookup. Activation is the switch — exactly what every
 * adapter's `legacyFallback` text promises ("…remains the default until a
 * template is activated for this report type").
 *
 * What this does **not** do is intercept the formats' flowing render routes.
 * `requestBorrowingCapacitySnapshot`, `requestCapacityReport`,
 * `requestReportQaPdf` and `requestMarketIntelligencePdf` carry documented
 * contracts of their own — ledgers, audit events, the `pdf_storage_path` a
 * scheduled email reads, "no legacy fallback, on purpose" — and a template
 * render silently replacing them would skip those side effects the day a
 * template went active. A surface that wants templated output calls this
 * first and falls back to its own path on null, the way `PremiumPdfButton`
 * already does for Compass.
 *
 * Returns null — never throws — for a preview-only or unknown report type, a
 * report the adapter refuses, or a deployment with no active template, so a
 * caller's fallback chain stays one `??` long.
 */
export function tryRouteThroughTemplateBuilderFor(
  reportType: string,
  reportId: string,
  opts?: {
    variant?: string | null; brand?: unknown; templateId?: string | null;
    payload?: Record<string, unknown> | null;
    onRefusal?: (refusal: TemplateRouteRefusal, detail?: string) => void;
    /** Which engine draws it — see `routeReportThroughTemplate`. */
    renderer?: TemplateRenderer;
  },
): Promise<TemplateBuilderRouteResult | null> {
  const adapter = getAdapter(reportType);
  if (!adapter?.supportsProduction) {
    opts?.onRefusal?.('no_adapter');
    return Promise.resolve(null);
  }
  return routeReportThroughTemplate(reportId, {
    reportType: normaliseReportType(reportType),
    variant: opts?.variant ?? null,
    brand: opts?.brand,
    // The template the person chose for this format. Forwarded rather than
    // resolved here: the route re-reads it server-side and falls back to the
    // ranking when the choice no longer applies. Omitting it is what made a
    // stored choice inert on every format but the Compass one.
    templateId: opts?.templateId ?? null,
    // The caller's reviewed data, for the adapter that documents support for
    // it. See `payload` on `ReportTemplateAdapter`.
    payload: opts?.payload ?? null,
    onRefusal: opts?.onRefusal,
    renderer: opts?.renderer,
  });
}

export type { TemplateBuilderRouteResult, TemplateRenderer, TemplateRouteRefusal };
