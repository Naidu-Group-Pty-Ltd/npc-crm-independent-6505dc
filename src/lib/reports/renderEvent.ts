/**
 * One vocabulary for "a report became a document", from every pathway.
 *
 * `docs/reports/COVERAGE.md` measured the design system carrying 0.14% of
 * production documents — and the reason the number took months to exist is
 * that the browser generators recorded nothing at all, so the denominator was
 * a proxy. This module is the fix's write side: every pathway that hands a
 * person a PDF (or a print view of one) logs exactly one event through the
 * platform's existing activity machinery, tagged with which ENGINE produced
 * the bytes. The read side is the `report_render_coverage` view, which unions
 * these events with the server routes' own `*_renders` ledgers and
 * `template_render_jobs`.
 *
 * Transport is `logActivityDirect` → the `log-activity` edge function —
 * deliberately: direct browser inserts into `activity_logs` are revoked at
 * the table grant (security phase 7), and this is the one broker that
 * verifies the session and stamps ip/user-agent server-side. The call never
 * throws and never blocks a download; a failed log is a console line, exactly
 * as every existing call site behaves.
 *
 * `entity_type` is a database enum with no per-format values for some formats
 * (no `market_intelligence`, no `borrowing_capacity`); those log as `system`
 * and carry the truth in `metadata.format` — extending a shared enum for a
 * telemetry row is a heavier change than the reporting programme should ride
 * on. The format string in metadata is therefore the authoritative one.
 */
import { logActivityDirect } from '@/hooks/useActivityLogger';

/** Which machinery produced the bytes the person received. */
export type ReportRenderEngine =
  /** A chosen/ranked `report_templates` row through `render-template-pdf`. */
  | 'template'
  /** A format's own design-system composer route (`render-<format>-pdf`). */
  | 'design_composer'
  /** `render-investment-report-pdf` — WeasyPrint, pre-design-system document. */
  | 'legacy_server'
  /** jsPDF / pdf-lib / html2canvas in the browser. */
  | 'browser'
  /** A `window.print()` view. */
  | 'print_view'
  /** `flattenPdf` rasterising a neighbour's output client-side. */
  | 'flatten'
  /** A previously saved artefact re-served (its original producer unknown). */
  | 'stored';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Formats with a first-class `activity_logs` entity enum value. */
const ENTITY_FOR_FORMAT: Record<string, string> = {
  investment: 'investment_report',
  comparison: 'property_comparison',
  cashflow: 'cash_flow_analysis',
  qa: 'qa_conversation',
  portfolio: 'portfolio_report',
  client_details: 'client',
};

export interface ReportRenderEvent {
  /** Normalised format key — the adapters' vocabulary (`investment`, `cashflow`, …). */
  format: string;
  engine: ReportRenderEngine;
  /** The pathway label analytics group by, e.g. `pixel_perfect_generator`. */
  source: string;
  /** The subject row's id, when the pathway knows one. */
  reportId?: string | null;
  /** A human-readable subject (an address, a client name). */
  entityName?: string | null;
  /** Anything else worth keeping (`{ uploaded: true }`, `{ cached: true }`). */
  extra?: Record<string, unknown>;
}

/**
 * Fire-and-forget. Must never affect the download it accompanies — that is
 * the same contract every existing `report_pdf_downloaded` call site keeps.
 */
export function logReportRenderEvent(event: ReportRenderEvent): void {
  try {
    const entityType = ENTITY_FOR_FORMAT[event.format] ?? 'system';
    const entityId = event.reportId && UUID_RE.test(event.reportId) ? event.reportId : undefined;
    void logActivityDirect({
      actionType: 'report_pdf_downloaded',
      entityType: entityType as never,
      entityId,
      entityName: event.entityName ?? undefined,
      metadata: {
        source: event.source,
        engine: event.engine,
        format: event.format,
        ...(event.reportId && !entityId ? { report_ref: event.reportId } : {}),
        ...(event.extra ?? {}),
      },
    });
  } catch {
    // Logging must never take a download down with it.
  }
}
