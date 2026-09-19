/**
 * What was imported into an assessment, one row per document.
 *
 * The assessment payload's `provenance` array records where every *field* came
 * from — hundreds of entries, one per value, each naming the document it was
 * read out of. A client's Commercial / Industrial tab wants the other shape:
 * one line per document, saying how much of the assessment it filled and when.
 *
 * Folded on the server for two reasons. The raw array is the larger half of
 * the payload and has no business crossing the wire to render four table rows;
 * and the fold has rules (manual typing is not an upload, a derived figure is
 * not an upload) that deserve a test rather than a comment.
 *
 * Nothing here reads a file. The intake pack is parsed in the browser and the
 * documents themselves are never uploaded — this is the record that they were
 * read, which is the honest thing the tab can show.
 */

export interface ProvenanceEntry {
  source?: unknown;
  sourceRef?: unknown;
  capturedAt?: unknown;
}

export interface UploadSummary {
  assessmentId: string;
  /** The file the values were read from, as the importer recorded it. */
  name: string;
  source: string;
  /** How many of the assessment's fields this document filled. */
  fields: number;
  /** The most recent read, ISO. Null where the importer recorded no time. */
  capturedAt: string | null;
}

/** Ways a value arrives that are not a document being read. */
const NOT_AN_UPLOAD = new Set(['manual', 'calculated']);

const MAX_NAME_LENGTH = 200;

/**
 * Summarise one assessment's provenance.
 *
 * Order is stable — first appearance in the provenance array — so a tab does
 * not reshuffle between loads.
 */
export function summariseUploads(assessmentId: string, provenance: unknown): UploadSummary[] {
  if (!Array.isArray(provenance)) return [];

  const byDocument = new Map<string, UploadSummary>();
  for (const raw of provenance) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as ProvenanceEntry;

    const source = typeof entry.source === 'string' && entry.source ? entry.source : 'manual';
    if (NOT_AN_UPLOAD.has(source)) continue;

    const name = typeof entry.sourceRef === 'string' && entry.sourceRef.trim()
      ? entry.sourceRef.trim().slice(0, MAX_NAME_LENGTH)
      // A document import that recorded no file name still happened; naming it
      // generically beats dropping the row and under-reporting the import.
      : 'Imported document';
    const capturedAt = typeof entry.capturedAt === 'string' && entry.capturedAt ? entry.capturedAt : null;

    // Keyed by source *and* name: the same file read twice by different
    // importers is two different claims about where a value came from.
    const key = `${source}::${name}`;
    const seen = byDocument.get(key);
    if (!seen) {
      byDocument.set(key, { assessmentId, name, source, fields: 1, capturedAt });
      continue;
    }
    seen.fields += 1;
    // The latest read is the one that matters: a document re-imported after a
    // correction was read then, not when it was first opened.
    if (capturedAt && (!seen.capturedAt || capturedAt > seen.capturedAt)) seen.capturedAt = capturedAt;
  }

  return Array.from(byDocument.values());
}
