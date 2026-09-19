/**
 * The shape of a render request and what comes back.
 *
 * Everything testable about the route lives here: what a caller may send, what
 * the file is called, and where it lands. The edge function around it does auth,
 * three reads, a render, an upload and three writes, none of which a unit test
 * can reach.
 *
 * The request is one report id. Every word this document prints is already one
 * jsonb column on one row, so there is nothing for the browser to send and
 * nothing for it to get wrong — the difference between this format and the
 * legacy path, which regenerates the whole PDF in the browser from a payload it
 * casts without validating (`MarketIntelligenceHistoryModal.tsx:70`).
 */

/** Only this is accepted from the caller; everything else is read server-side. */
export interface MarketIntelligenceRenderRequest {
  /** The `marketing_intelligence_reports` row to typeset. */
  reportId: string;
  /**
   * Write the PDF into the `marketing-reports` bucket and set
   * `pdf_storage_path` on the row.
   *
   * On by default, and that default is the point. The column, the bucket and a
   * reader all already exist — `dispatch-marketing-reports:323` pulls the file
   * from that path to attach it to a scheduled marketing email — and **nothing
   * has ever written it**. Zero rows carry a path and the bucket holds zero
   * objects, so the first time that dispatch runs it attaches nothing.
   */
  persist: boolean;
  /** `VOL. 2026 · ED. 08`. Cosmetic; the caller may supply it. */
  edition: string | null;
  /**
   * Issue the report as a different audience edition than the row says.
   *
   * The one payload field a caller may override, and it is safe to because it
   * selects between blocks of copy this repo owns rather than supplying any. The
   * audience decides the closing panels on the suburb layer and the cover's
   * edition line; every word of model output is identical. So a homebuyer
   * edition of a stored investor report is a re-render rather than a second
   * eight-layer generation, which is what the legacy required.
   *
   * Constrained to the three the format knows. An unrecognised value is not an
   * error — it falls back to the row, because a stale bookmark should still
   * produce the report it names.
   */
  audience: string | null;
}

/** The editions the document knows how to set. */
export const AUDIENCE_SEGMENTS = ['general', 'investor', 'homebuyer'] as const;

export type RequestParse =
  | { ok: true; request: MarketIntelligenceRenderRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read a request body.
 *
 * The report's period, type, audience and eight layers of prose are deliberately
 * **not** inputs. They are read from the row, because a payload the caller
 * supplies is a payload the caller can edit — and the legacy path does exactly
 * that, casting `report.report_data` straight to its interface with no
 * validation and typesetting whatever arrives.
 */
export function parseRenderRequest(body: unknown): RequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;

  const reportId = typeof b.reportId === 'string' ? b.reportId.trim() : '';
  if (!UUID.test(reportId)) return { ok: false, error: 'reportId must be a uuid' };

  const edition = typeof b.edition === 'string' ? b.edition.trim().slice(0, 40) : '';

  const asked = typeof b.audience === 'string' ? b.audience.trim().toLowerCase() : '';
  const audience = (AUDIENCE_SEGMENTS as readonly string[]).includes(asked) ? asked : null;

  return {
    ok: true,
    request: { reportId, persist: b.persist !== false, edition: edition || null, audience },
  };
}

/**
 * The filename.
 *
 * The legacy's own shape, kept —
 * `Market_Intelligence_Report_${reportPeriod.replace(/\s+/g, '_')}.pdf`
 * (`MarketIntelligenceExportButton.tsx:95`) — because unlike the Q&A and Client
 * Details generators this one already names the file after what it is. The only
 * change is that the period is sanitised rather than only space-replaced: the
 * period comes from `toLocaleDateString('en-AU', …)` server-side, which is
 * `April 2026` today but is a locale call, and a locale that returns `4/2026`
 * would put a slash in a filename.
 */
export function marketIntelligenceFileName(reportPeriod: string, audience: string): string {
  const period = (reportPeriod || 'Report').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60);
  const edition = audience && audience !== 'general'
    ? `_${audience.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)}`
    : '';
  return `Market_Intelligence_Report_${period}${edition}.pdf`;
}

/** The first eight characters of the report id, uppercased, for the cover foot. */
export function marketIntelligenceReference(reportId: string): string {
  return reportId.slice(0, 8).toUpperCase();
}

/**
 * Where the file lands.
 *
 * `marketing-reports` is the private bucket the DDL created alongside the table
 * (`20260406030539_…sql:36`) and that `dispatch-marketing-reports` already reads
 * from. It has been empty since the day it was made.
 *
 * The path is stable per report — no random segment, unlike the other formats —
 * because `pdf_storage_path` is a single column holding one location and the
 * dispatch reads whatever is there. A re-render replaces the file, which is the
 * behaviour a "the current PDF for this report" column implies.
 */
export function marketIntelligenceStoragePath(reportId: string, fileName: string): string {
  return `market-intelligence/${reportId}/${fileName}`;
}

/** The bucket. Private, and the one the email dispatch already reads. */
export const STORAGE_BUCKET = 'marketing-reports';

/** How long a returned link lives. Long enough to email, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface MarketIntelligenceRenderResponse {
  url: string;
  fileName: string;
  bytes: number;
  pageCount: number | null;
  renderId: string | null;
  brandSnapshotId: string | null;
  /** What the brand snapshot was missing, so the UI can say so before sending. */
  brandGaps: string[];
  /** Section titles in printed order. */
  sections: string[];
  /** Sections the document budget dropped. Named on the page too. */
  dropped: string[];
  /** Layers asked for that came back empty. Named on the page too. */
  emptyLayers: string[];
  reportPeriod: string;
  audienceSegment: string;
  /** True when the file was written to the bucket and the row updated. */
  persisted: boolean;
  storagePath: string | null;
  durationMs: number;
}
