/**
 * How an uploaded document reads to the customer.
 *
 * Presentation only, and deliberately pure: every function here takes the
 * portal-safe fields `list_documents` already returns and produces a string.
 * Nothing fetches, nothing decides whether a document is acceptable, and
 * nothing here can widen what the client sees — the projection is chosen
 * server-side (`aml-client-portal`), and this module cannot reach a field it
 * was not given.
 *
 * It exists as its own module because the formatting is where the small,
 * embarrassing bugs live — a 0-byte file reported as "NaN MB", a document
 * uploaded a minute ago dated "Invalid Date" — and those are worth testing
 * without rendering a page.
 */

import type { AmlPortalDocument } from '@/lib/aml/amlPortalApi';

/**
 * Human file size.
 *
 * Base 1024 with the units people recognise. `null`/`undefined` is a real
 * case: `size_bytes` is nullable on the row, and a document uploaded before
 * the portal recorded it has none. It returns `null` rather than "0 B" so the
 * caller omits the field instead of asserting the file is empty.
 */
export function formatDocumentSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes === 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  // One decimal below 10 (1.8 MB reads better than 2 MB), none above it.
  return `${value < 10 && exponent > 0 ? value.toFixed(1) : Math.round(value)} ${units[exponent]}`;
}

/** Extensions worth naming, keyed by the MIME type the browser reported. */
const MIME_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'image/png': 'PNG',
  'image/heic': 'HEIC',
  'image/webp': 'WebP',
  'image/tiff': 'TIFF',
};

/**
 * A short, readable file type.
 *
 * MIME first because it is what the server stored, then the filename
 * extension, then a generic word. Never `application/octet-stream` on the
 * page: that is what a browser sends when it does not recognise the file, and
 * showing it to a customer tells them their document is broken when it is not.
 */
export function formatDocumentType(
  mime: string | null | undefined, filename: string | null | undefined,
): string {
  const key = String(mime ?? '').toLowerCase().split(';')[0].trim();
  if (MIME_LABEL[key]) return MIME_LABEL[key];

  const extension = String(filename ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (extension && extension !== String(filename ?? '').toLowerCase() && extension.length <= 5) {
    return extension.toUpperCase();
  }
  if (key.startsWith('image/')) return 'Image';
  return 'Document';
}

/**
 * When it was uploaded, in the customer's own timezone.
 *
 * "Just now" for the first minute, because the moment this matters most is the
 * second after an upload — a date stamp there reads as though the file has
 * been sitting around, and the customer is looking for confirmation that the
 * thing they just did worked.
 *
 * `now` is injectable so the boundary is testable without freezing the clock.
 */
export function formatUploadedDate(
  timestamp: string | null | undefined, now: Date = new Date(),
): string | null {
  if (!timestamp) return null;
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return null;

  const elapsedMs = now.getTime() - at.getTime();
  // Only backwards. A clock skew that puts the upload in the future must not
  // produce "in 3 minutes" on a compliance record.
  if (elapsedMs >= 0 && elapsedMs < 60_000) return 'Uploaded just now';
  if (elapsedMs >= 60_000 && elapsedMs < 3_600_000) {
    const minutes = Math.floor(elapsedMs / 60_000);
    return `Uploaded ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  return `Uploaded ${at.toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  })}`;
}

export interface DocumentStatusPresentation {
  /** What the customer reads. Never the raw enum. */
  label: string;
  /** Semantic token class. Paired with words everywhere — never colour alone. */
  tone: string;
  /** Whether this is a "you are done" state, for the tick. */
  settled: boolean;
  /** Whether the customer has something to do. */
  needsAttention: boolean;
}

/**
 * Document status in client language.
 *
 * The stored vocabulary is `uploaded | accepted | rejected | superseded |
 * deleted` (`deleted` is filtered out server-side and never arrives). None of
 * those words is right for a customer: "uploaded" describes what they did, not
 * where it now is, and "rejected" is an accusation where the truthful message
 * is that we need another copy.
 */
export const DOCUMENT_STATUS: Record<string, DocumentStatusPresentation> = {
  uploaded:   { label: 'Received',        tone: 'text-success',           settled: true,  needsAttention: false },
  accepted:   { label: 'Accepted',        tone: 'text-success',           settled: true,  needsAttention: false },
  rejected:   { label: 'Needs attention', tone: 'text-warning',           settled: false, needsAttention: true },
  superseded: { label: 'Replaced',        tone: 'text-muted-foreground',  settled: false, needsAttention: false },
};

/** Falls back rather than showing a raw enum a future migration might add. */
export function documentStatus(status: string | null | undefined): DocumentStatusPresentation {
  return DOCUMENT_STATUS[String(status ?? '')]
    ?? { label: 'Received', tone: 'text-muted-foreground', settled: true, needsAttention: false };
}

/**
 * The one metadata line under a filename: `PDF · 1.8 MB · Uploaded 11 Aug 2026`.
 *
 * Parts that are genuinely unknown are dropped rather than rendered as a
 * placeholder, so a document with no recorded size reads `PDF · Uploaded
 * 11 Aug 2026` instead of `PDF · — · Uploaded 11 Aug 2026`.
 */
export function documentMetaLine(doc: AmlPortalDocument, now?: Date): string {
  return [
    formatDocumentType(doc.mime_type, doc.filename),
    formatDocumentSize(doc.size_bytes),
    formatUploadedDate(doc.uploaded_at, now),
  ].filter(Boolean).join(' · ');
}

/**
 * Split the canonical list into what each part of the screen renders.
 *
 * `byRequirement` holds every document for a requirement, newest first —
 * `list_documents` already orders by `uploaded_at` descending, and that order
 * is preserved rather than re-derived. `additional` is everything with no
 * requirement: those are the uploads that had nowhere to appear at all, which
 * is why a customer could upload a passport and watch it vanish.
 *
 * A document naming a requirement this case does not have would otherwise fall
 * out of the UI entirely, so `knownRequirementIds` sweeps it into `additional`
 * rather than dropping it. Better an odd grouping than a disappeared file.
 */
export function groupDocuments(
  documents: AmlPortalDocument[], knownRequirementIds: readonly string[] = [],
): { byRequirement: Map<string, AmlPortalDocument[]>; additional: AmlPortalDocument[] } {
  const known = new Set(knownRequirementIds);
  const byRequirement = new Map<string, AmlPortalDocument[]>();
  const additional: AmlPortalDocument[] = [];

  for (const doc of documents) {
    const requirementId = doc.requirement_id;
    if (requirementId && known.has(requirementId)) {
      const bucket = byRequirement.get(requirementId);
      if (bucket) bucket.push(doc);
      else byRequirement.set(requirementId, [doc]);
    } else {
      additional.push(doc);
    }
  }
  return { byRequirement, additional };
}
