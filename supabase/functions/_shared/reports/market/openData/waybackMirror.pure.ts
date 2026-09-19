/**
 * The Internet Archive's Wayback Machine as a delivery route for an open
 * government file whose own host refuses this project's egress.
 *
 * ## Why
 *
 * The two best growth series in the country are walled to scripted clients:
 * land.vic.gov.au answers every non-browser with a Cloudflare challenge
 * (measured on three networks, `zeroCostSources.pure.ts`), and
 * data.sa.gov.au answers this project's egress with a plain 403 while its
 * catalogue is open. Both publish under Creative Commons Attribution, which
 * permits redistribution, and both have been crawled by the Internet
 * Archive for years — the Victorian Valuer-General's houses-by-suburb time
 * series was captured on 3 Aug 2026, three weeks after it was published,
 * and web.archive.org answers the production egress (pg_net 245236/245237,
 * 16 Sep 2026). So the file travels through the archive: the CDX index
 * names every capture, and the `id_` flag returns the ORIGINAL bytes rather
 * than the archive's rewritten page.
 *
 * ## Three rules
 *
 * **The newest capture of the newest file, chosen by the publisher's own
 * naming.** A capture's timestamp says when the archive looked; the file
 * name (`houses-by-suburb-2015-2025.xlsx`, `lsg_stats_2024_q4.xlsx`) says
 * what period it describes. `newestByRank` ranks files by what they
 * describe and only then takes the latest capture of the winner.
 *
 * **The capture date travels with the rows.** A mirror's currency is
 * bounded by when it was taken; `capturedAt` is written on every row
 * loaded this way so a reader can see that a Victorian figure is as the
 * archive held it on a stated day, not as the publisher holds it today.
 *
 * **Discovery is a fact about the archive, never a guess.** A file the CDX
 * index does not list is not fetched by pattern, and a capture that is not
 * a 200 is not offered.
 *
 * Pure: no network. The loader fetches; this module builds the URLs and
 * reads the answers.
 */

export const WAYBACK_HOST = 'https://web.archive.org';

export interface WaybackCapture {
  /** The archive's own timestamp, `YYYYMMDDhhmmss`. */
  timestamp: string;
  /** The URL the archive captured, as it stored it. */
  original: string;
  mimetype: string;
  statusCode: number;
  /** Bytes as the index recorded them, or null where it did not. */
  length: number | null;
}

export interface CdxQuery {
  /** The archive's `url` parameter — a URL or a prefix pattern with `*`. */
  urlPattern: string;
  /** Only captures from this year onward, `YYYY`. Optional. */
  from?: string;
  /** Extra `filter=` clauses, e.g. `mimetype:application/.*`. Optional. */
  filters?: string[];
  limit?: number;
}

/** The CDX index URL for a query: JSON, the five fields the loader reads, 200s only. */
export function cdxUrl(query: CdxQuery): string {
  const params = new URLSearchParams();
  params.set('url', query.urlPattern);
  params.set('output', 'json');
  params.set('fl', 'timestamp,original,mimetype,statuscode,length');
  params.append('filter', 'statuscode:200');
  for (const f of query.filters ?? []) params.append('filter', f);
  if (query.from) params.set('from', query.from);
  params.set('limit', String(query.limit ?? 2000));
  return `${WAYBACK_HOST}/cdx/search/cdx?${params.toString()}`;
}

/**
 * Parse the CDX JSON answer: an array whose first row is the field names.
 * An empty index answers `[]` or an empty body; both are no captures.
 * Throws on a body that is not the index's shape, so a challenge page or an
 * error page is never read as "nothing archived".
 */
export function parseCdxJson(text: string): WaybackCapture[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`the Wayback CDX index answered something that is not JSON (${trimmed.slice(0, 60)}…) — refused`);
  }
  if (!Array.isArray(parsed)) throw new Error('the Wayback CDX index answered JSON that is not a list — refused');
  if (parsed.length === 0) return [];
  const header = parsed[0];
  if (!Array.isArray(header) || header[0] !== 'timestamp') {
    throw new Error('the Wayback CDX index answered without its field header — refused');
  }
  const idx = (name: string) => (header as unknown[]).indexOf(name);
  const iTs = idx('timestamp'), iOrig = idx('original'), iMime = idx('mimetype'), iStatus = idx('statuscode'), iLen = idx('length');
  const out: WaybackCapture[] = [];
  for (const row of parsed.slice(1)) {
    if (!Array.isArray(row)) continue;
    const timestamp = String(row[iTs] ?? '');
    const original = String(row[iOrig] ?? '');
    if (!/^\d{14}$/.test(timestamp) || !/^https?:\/\//.test(original)) continue;
    const status = Number(row[iStatus]);
    const len = row[iLen] === undefined || row[iLen] === null || row[iLen] === '' ? null : Number(row[iLen]);
    out.push({
      timestamp,
      original,
      mimetype: String(row[iMime] ?? ''),
      statusCode: Number.isFinite(status) ? status : 0,
      length: len !== null && Number.isFinite(len) ? len : null,
    });
  }
  return out;
}

/** `20260803040929` → `2026-08-03T04:09:29Z`. */
export function capturedAtIso(timestamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(timestamp);
  if (!m) throw new Error(`not a Wayback timestamp: ${timestamp}`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

/** The URL that returns the capture's original bytes, not the archive's rewritten page. */
export function originalBytesUrl(capture: Pick<WaybackCapture, 'timestamp' | 'original'>): string {
  return `${WAYBACK_HOST}/web/${capture.timestamp}id_/${capture.original}`;
}

/** The archive's own page for a capture — what a person opens to see it. */
export function archivePageUrl(capture: Pick<WaybackCapture, 'timestamp' | 'original'>): string {
  return `${WAYBACK_HOST}/web/${capture.timestamp}/${capture.original}`;
}

/** The newest capture of every distinct original URL. */
export function newestCapturePerOriginal(captures: ReadonlyArray<WaybackCapture>): Map<string, WaybackCapture> {
  const best = new Map<string, WaybackCapture>();
  for (const c of captures) {
    if (c.statusCode !== 200) continue;
    const prev = best.get(c.original);
    if (!prev || c.timestamp > prev.timestamp) best.set(c.original, c);
  }
  return best;
}

export interface RankedCapture<R> {
  capture: WaybackCapture;
  /** What the file name says it describes, as the caller's ranker read it. */
  rank: R;
}

/**
 * Among captures whose file name matches `pattern`, the newest capture of
 * the file the ranker places highest. `rank` reads the match and answers a
 * comparable number (a year, a quarter index) or null to exclude the file.
 * Ties on rank go to the later capture.
 */
export function newestByRank<R extends number>(
  captures: ReadonlyArray<WaybackCapture>,
  pattern: RegExp,
  rank: (match: RegExpExecArray, capture: WaybackCapture) => R | null,
): RankedCapture<R> | null {
  let best: RankedCapture<R> | null = null;
  for (const capture of newestCapturePerOriginal(captures).values()) {
    const name = capture.original.slice(capture.original.lastIndexOf('/') + 1);
    const m = pattern.exec(name);
    if (!m) continue;
    const r = rank(m, capture);
    if (r === null) continue;
    if (!best || r > best.rank || (r === best.rank && capture.timestamp > best.capture.timestamp)) {
      best = { capture, rank: r };
    }
  }
  return best;
}

/** Every matched file, one capture each (the newest), ordered by rank descending. */
export function rankedCaptures<R extends number>(
  captures: ReadonlyArray<WaybackCapture>,
  pattern: RegExp,
  rank: (match: RegExpExecArray, capture: WaybackCapture) => R | null,
): RankedCapture<R>[] {
  const out: RankedCapture<R>[] = [];
  for (const capture of newestCapturePerOriginal(captures).values()) {
    const name = capture.original.slice(capture.original.lastIndexOf('/') + 1);
    const m = pattern.exec(name);
    if (!m) continue;
    const r = rank(m, capture);
    if (r === null) continue;
    out.push({ capture, rank: r });
  }
  return out.sort((a, b) => b.rank - a.rank || (a.capture.timestamp < b.capture.timestamp ? 1 : -1));
}

export interface RankedFile<R> {
  original: string;
  /** What the file name says it describes, as the caller's ranker read it. */
  rank: R;
  /** Every 200 capture of the file, newest first. */
  captures: WaybackCapture[];
}

/**
 * Every matched file with ALL of its 200 captures, newest first, ranked by
 * what the name says. `rankedCaptures` keeps one capture per file, and the
 * first production load (16 Sep 2026) found why that is not enough: the
 * index listed the newest South Australian workbook's only capture, and the
 * archive answered 404 for its bytes — a capture the index knows and the
 * store cannot serve. A caller that holds every capture can fall back to an
 * older copy of the same file, and to the next file only when none serves.
 */
export function rankedFiles<R extends number>(
  captures: ReadonlyArray<WaybackCapture>,
  pattern: RegExp,
  rank: (match: RegExpExecArray, capture: WaybackCapture) => R | null,
): RankedFile<R>[] {
  const byOriginal = new Map<string, WaybackCapture[]>();
  for (const c of captures) {
    if (c.statusCode !== 200) continue;
    const list = byOriginal.get(c.original) ?? [];
    list.push(c);
    byOriginal.set(c.original, list);
  }
  const out: RankedFile<R>[] = [];
  for (const [original, list] of byOriginal) {
    list.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
    const name = original.slice(original.lastIndexOf('/') + 1);
    const m = pattern.exec(name);
    if (!m) continue;
    const r = rank(m, list[0]);
    if (r === null) continue;
    out.push({ original, rank: r, captures: list });
  }
  return out.sort((a, b) => b.rank - a.rank || (a.captures[0].timestamp < b.captures[0].timestamp ? 1 : -1));
}
