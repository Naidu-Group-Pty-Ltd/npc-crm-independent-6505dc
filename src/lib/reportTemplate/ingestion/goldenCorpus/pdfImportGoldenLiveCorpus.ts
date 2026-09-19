/**
 * Tier 3 live-corpus manifest loader (Path-to-100 v2 · C10).
 *
 * The live tier runs real imports against a corpus of client PDFs. Those PDFs
 * are NEVER committed — they live in a local, git-excluded directory named by
 * `PDF_IMPORT_GOLDEN_CORPUS_DIR`, described by a `manifest.json` that references
 * files by relative name only. This module parses + validates that manifest.
 *
 * Pure: it parses a manifest object (the gated runner reads the file). The
 * validation refuses any entry that embeds inline PDF bytes, so committed /
 * inline client data can never sneak into the corpus.
 */

export const GOLDEN_LIVE_CORPUS_VERSION = 'golden-live-corpus-v1';

export interface GoldenLiveCorpusEntry {
  id: string;
  category: string;
  /** Relative file name inside the corpus directory — never inline bytes. */
  file: string;
  expectedPageCount: number | null;
  note?: string;
}

export interface GoldenLiveCorpusManifest {
  version: typeof GOLDEN_LIVE_CORPUS_VERSION;
  dir: string;
  entries: GoldenLiveCorpusEntry[];
  problems: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** A file reference must be a relative name, not a data URL / absolute path / traversal. */
function fileProblem(file: unknown): string | null {
  if (typeof file !== 'string' || file.length === 0) return 'missing file name';
  if (/^data:/i.test(file)) return 'inline PDF bytes are not allowed in the corpus manifest';
  if (file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file)) return 'file must be a relative name, not an absolute path';
  if (file.includes('..')) return 'file name must not traverse outside the corpus directory';
  if (!/\.pdf$/i.test(file)) return 'file must be a .pdf';
  return null;
}

/**
 * Parse + validate a live-corpus manifest. Invalid entries are dropped and
 * reported in `problems`; the loader never throws so the gated runner can decide
 * whether to proceed or abort.
 */
export function parseGoldenLiveCorpusManifest(raw: unknown, dir: string): GoldenLiveCorpusManifest {
  const problems: string[] = [];
  const entries: GoldenLiveCorpusEntry[] = [];

  const rawEntries = isPlainObject(raw) && Array.isArray((raw as { entries?: unknown }).entries)
    ? ((raw as { entries: unknown[] }).entries)
    : null;

  if (!rawEntries) {
    return { version: GOLDEN_LIVE_CORPUS_VERSION, dir, entries, problems: ['manifest has no `entries` array'] };
  }

  const seenIds = new Set<string>();
  rawEntries.forEach((item, index) => {
    if (!isPlainObject(item)) { problems.push(`entry[${index}] is not an object`); return; }
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id) { problems.push(`entry[${index}] is missing an id`); return; }
    if (seenIds.has(id)) { problems.push(`entry[${index}] duplicate id ${id}`); return; }
    const fileErr = fileProblem(item.file);
    if (fileErr) { problems.push(`entry ${id}: ${fileErr}`); return; }
    seenIds.add(id);
    const expected = item.expectedPageCount;
    entries.push({
      id,
      category: typeof item.category === 'string' ? item.category : 'uncategorized',
      file: item.file as string,
      expectedPageCount: typeof expected === 'number' && Number.isFinite(expected) ? expected : null,
      note: typeof item.note === 'string' ? item.note : undefined,
    });
  });

  return { version: GOLDEN_LIVE_CORPUS_VERSION, dir, entries, problems };
}
