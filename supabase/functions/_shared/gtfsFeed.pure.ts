/**
 * GTFS feeds, and reading one member out of a very large published archive.
 *
 * Audit §24 named `public-transport-service` as the last fabricator: eight
 * per-state "fetchers" that ignored the coordinate and returned a hard-coded
 * landmark, so every NSW property was 450m from Central Station. It has
 * answered `sourceUnavailable` since; this module is the real source.
 *
 * ## Why this reads a zip by range instead of downloading it
 *
 * Measured 2026-09-07, from the publishers themselves: NSW's bundle is
 * 292,247,414 bytes and VIC's 319,320,298. Inside NSW's, the members are
 *
 *     946.61 MB unc / 225.77 MB comp   shapes.txt      (route geometry)
 *     399.06 MB unc /  46.88 MB comp   stop_times.txt
 *      26.44 MB unc /   1.61 MB comp   trips.txt
 *      16.21 MB unc /   4.09 MB comp   stops.txt   <- the one that answers
 *       1.18 MB unc /   0.17 MB comp   routes.txt
 *
 * so `shapes.txt` alone is 77% of the download and is of no use to "what is
 * near this property". Every publisher measured honours HTTP range requests,
 * and a zip's central directory sits at the END — so the archive can be
 * addressed rather than downloaded: read the tail, find the member, fetch
 * only its compressed bytes. That is 4.26 MB instead of 278.7 MB for NSW, and
 * it is the difference between this fitting in an Edge Function and not.
 *
 * `crimeIngest.pure.ts`'s `zipSingleDeflateSpan` is deliberately NOT reused:
 * it refuses any archive with more than one entry (BOCSAR's holds exactly
 * one, and that refusal is a guarantee worth keeping) and it takes the whole
 * archive in memory, which is the thing that cannot happen here.
 *
 * ## The rules
 *
 * **A range request that is not honoured is refused, never silently
 * downloaded.** A server answering 200 to `Range:` is sending the whole
 * 279 MB, and accepting that would blow the function's memory rather than
 * report a source that changed its behaviour.
 *
 * **Mode is established by the feed or left null.** A stop's mode lives in
 * routes.txt and is reachable only through stop_times.txt, which is the
 * 399 MB member. Where a feed's own structure carries it, it is recorded;
 * otherwise the column stays NULL and the reading omits mode. Guessing a mode
 * from a stop's name is exactly the class this replaces.
 */

export interface GtfsFeed {
  /** Stable key. Also the `feed` column, so it must never be re-spelled. */
  readonly key: string;
  readonly label: string;
  readonly url: string;
  /** Attribution, carried onto every row as `source_label`. */
  readonly sourceLabel: string;
  /** Licence as published, recorded so a re-check has something to compare. */
  readonly licence: string;
  /**
   * A zip whose members are themselves DEFLATED zips (VIC publishes one per
   * mode). Reading a member of one means inflating the whole inner archive,
   * which for VIC's two largest is 139 MB and 77 MB -- so a nested feed is
   * declared and NOT loaded, with `loadable: false` naming the reason.
   */
  readonly nested: boolean;
  /**
   * Whether this loader can address the feed at all. A feed that cannot be
   * loaded stays declared rather than deleted, so the reading can say which
   * networks it does not hold instead of an empty answer reading as "no
   * public transport here".
   */
  readonly loadable: boolean;
  /** Why, when `loadable` is false. Rendered, never inferred. */
  readonly unloadableReason?: string;
  /**
   * Measured stop count floor. A truncated download decompresses and parses
   * cleanly; the count is the only thing that gives it away.
   */
  readonly minStops: number;
}

/**
 * Feeds this platform loads. Reachability was probed from BOTH this repo's
 * sandbox and the Supabase egress before any was declared — the SALM lesson:
 * a parser cannot be written against a file nobody can reach.
 */
export const GTFS_FEEDS: readonly GtfsFeed[] = [
  {
    key: 'nsw_sydney',
    label: 'Greater Sydney and regional NSW (Transport for NSW)',
    url: 'https://opendata.transport.nsw.gov.au/data/dataset/d1f68d4f-b778-44df-9823-cf2fa922e47f/resource/67974f14-01bf-47b7-bfa5-c7f2f8a950ca/download/full_greater_sydney_gtfs_static_0.zip',
    sourceLabel: 'Transport for NSW Open Data (CC BY 4.0)',
    licence: 'Creative Commons Attribution',
    nested: false,
    loadable: true,
    // 171,061 usable of 171,064 measured 2026-09-07.
    minStops: 50_000,
  },
  {
    key: 'qld_seq',
    label: 'South East Queensland (TransLink)',
    url: 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip',
    sourceLabel: 'TransLink South East Queensland GTFS',
    licence: 'Creative Commons Attribution',
    nested: false,
    loadable: true,
    // 13,119 rows measured 2026-09-07.
    minStops: 4_000,
  },
  {
    key: 'nt_darwin',
    label: 'Darwin (NT Department of Infrastructure, Planning and Logistics)',
    url: 'https://dli.nt.gov.au/data-feeds/bus-gtfs/google-transit-darwin.zip?v=0.34.1',
    sourceLabel: 'NT DIPL public bus GTFS (CC BY)',
    licence: 'Creative Commons Attribution',
    nested: false,
    loadable: true,
    // 898 measured 2026-09-07.
    minStops: 300,
  },
  {
    key: 'nt_alice',
    label: 'Alice Springs (NT Department of Infrastructure, Planning and Logistics)',
    url: 'https://dipl.nt.gov.au/data-feeds/bus-gtfs/gtfs-alice-new.zip',
    sourceLabel: 'NT DIPL public bus GTFS (CC BY)',
    licence: 'Creative Commons Attribution',
    nested: false,
    loadable: true,
    // 99 measured 2026-09-07.
    minStops: 40,
  },
  {
    key: 'vic_ptv',
    label: 'Victoria (Public Transport Victoria)',
    url: 'https://data.ptv.vic.gov.au/downloads/gtfs.zip',
    sourceLabel: 'Public Transport Victoria GTFS',
    licence: 'to be confirmed against the publisher',
    nested: true,
    loadable: false,
    unloadableReason:
      'PTV publishes eight per-mode archives nested inside one zip, each DEFLATED rather than stored, '
      + 'so a member cannot be range-addressed without inflating its whole inner archive -- 139 MB and '
      + '77 MB for the two largest. Declared so the reading can say Victoria is not held rather than '
      + 'answer as though it found nothing.',
    minStops: 0,
  },
];

/** Feeds this loader can actually address. */
export const LOADABLE_FEEDS: readonly GtfsFeed[] = GTFS_FEEDS.filter((f) => f.loadable);

export function feedByKey(key: string): GtfsFeed | null {
  return GTFS_FEEDS.find((f) => f.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// Zip central directory, read from a range-fetched tail
// ---------------------------------------------------------------------------

export interface ZipMember {
  readonly name: string;
  /** 0 = stored, 8 = deflate. Anything else is refused by the caller. */
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  /** Offset of the LOCAL header, which is not where the data starts. */
  readonly localHeaderOffset: number;
}

/** The tail this needs: the EOCD plus the largest comment it may carry. */
export const ZIP_TAIL_BYTES = 66_000;

/**
 * Parse the central directory out of the last `ZIP_TAIL_BYTES` of an archive.
 *
 * `tail` must be the final bytes of the file and `totalSize` its full length,
 * because every offset in the directory is absolute and the tail's own
 * position has to be subtracted back out.
 */
export function readZipDirectoryFromTail(tail: Uint8Array, totalSize: number): ZipMember[] {
  const tailStart = totalSize - tail.length;
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('zip has no end-of-central-directory record in its tail');

  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const entryCount = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);

  // Zip64 marks these fields saturated. Refused rather than mis-read: a
  // truncated offset addresses the wrong bytes and would parse as garbage.
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entryCount === 0xffff) {
    throw new Error('zip64 archive — central directory offsets are saturated, refused');
  }
  if (cdOffset < tailStart) {
    throw new Error(
      `central directory at ${cdOffset} is before the fetched tail (${tailStart}); refetch a longer tail`,
    );
  }

  let p = cdOffset - tailStart;
  const members: ZipMember[] = [];
  for (let n = 0; n < entryCount; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) {
      throw new Error(`central directory entry ${n} has no signature`);
    }
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(tail.subarray(p + 46, p + 46 + nameLen));
    members.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return members;
}

/**
 * Where a member's compressed bytes actually begin.
 *
 * The local header repeats the name and extra fields at its OWN lengths,
 * which routinely differ from the central directory's — reading the central
 * directory's lengths here is a real and silent off-by-n that decompresses to
 * rubbish. So the caller fetches the 30-byte fixed local header and passes it
 * in, and this returns the true data offset.
 */
export function memberDataStart(localHeader: Uint8Array, localHeaderOffset: number): number {
  const dv = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('local file header signature missing');
  const nameLen = dv.getUint16(26, true);
  const extraLen = dv.getUint16(28, true);
  return localHeaderOffset + 30 + nameLen + extraLen;
}

/** The members this loader ever reads. Everything else is left in the archive. */
export const WANTED_MEMBERS: readonly string[] = ['stops.txt', 'routes.txt'];

export function findMember(members: readonly ZipMember[], name: string): ZipMember | null {
  const lower = name.toLowerCase();
  return members.find((m) => m.name.toLowerCase() === lower)
    ?? members.find((m) => m.name.toLowerCase().endsWith('/' + lower))
    ?? null;
}

// ---------------------------------------------------------------------------
// The CSV inside, and what a usable stop is
// ---------------------------------------------------------------------------

/**
 * Split GTFS CSV into header-keyed records.
 *
 * Mapping is by header NAME and never by position, because the feeds disagree
 * about order and about which columns exist at all. Measured 2026-09-07:
 *
 *   NSW   stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,...
 *   NT    stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,...
 *
 * `stop_lat` is the 4th field in one and the 5th in the other, and Alice
 * Springs carries a `parent_station` that Darwin does not -- two feeds from
 * the same publisher. A positional reader silently loads stop_desc as a
 * latitude.
 *
 * Values are trimmed: NT publishes unquoted with a leading space on every
 * coordinate (` -12.369522`).
 */
export function parseGtfsCsv(text: string): Array<Record<string, string>> {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else { field += c; }
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < rows.length; r++) {
    // A row of a different width is a shape defect, not a value: counted by
    // the caller rather than padded, because padding invents a column.
    if (rows[r].length !== header.length) { out.push({ __malformed: String(rows[r].length) }); continue; }
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) rec[header[c]] = rows[r][c].trim();
    out.push(rec);
  }
  return out;
}

/**
 * The continental bounding box, used to reject a coordinate that cannot be a
 * stop rather than to decide where a stop belongs.
 *
 * Deliberately generous: the NSW feed's real extent runs lon 138.5884 to
 * 153.6213 and lat -37.8183 to -27.4643, because "Greater Sydney" includes
 * NSW TrainLink coach terminals in Adelaide and Melbourne. Those are real
 * stops and are kept.
 */
export const AUSTRALIA_BBOX = { minLat: -44.0, maxLat: -9.0, minLon: 112.0, maxLon: 154.0 } as const;

/**
 * Share of rows whose coordinate is impossible, past which the file is
 * refused rather than loaded.
 *
 * Measured across the three feeds: 3 of NSW's 171,064 (0.0018%) and none at
 * all in either NT feed. The three are real streets with broken positions --
 * `G2583258` at lat 30.51656633 / lon -30.51657273 (the sign flipped and the
 * longitude a copy of the latitude), `G2663247` "83 Pitt St" at lon
 * -179.99891116, and `G268012` at exactly (0,0). A stop whose position is
 * wrong cannot answer "how far is this from the property", so it is excluded
 * AND COUNTED -- the SAPOL interstate-postcode rule.
 *
 * 0.1% is ~55x the measured worst case: generous enough that a normal release
 * never trips it, tight enough that a feed which has changed its coordinate
 * format refuses instead of loading nonsense.
 */
export const IMPOSSIBLE_COORD_TOLERANCE = 0.001;

/** Below this many rows a share means nothing, so the ratio is not applied. */
export const COORD_RATIO_FLOOR_ROWS = 500;

export interface StopRow {
  readonly stopId: string;
  readonly stopName: string;
  readonly lat: number;
  readonly lon: number;
  readonly locationType: number | null;
  readonly parentStation: string | null;
}

export interface StopParseAudit {
  readonly rows: number;
  readonly usable: number;
  /** Wrong field count for the header -- a shape defect. */
  readonly malformed: number;
  /** Missing id, name or either coordinate. */
  readonly incomplete: number;
  /** Parsed, but not a position on Earth this feed could serve. */
  readonly impossibleCoord: number;
  readonly duplicateIds: number;
}

export interface StopParseResult {
  readonly stops: StopRow[];
  readonly audit: StopParseAudit;
}

function intOrNull(v: string | undefined): number | null {
  const s = (v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}

/**
 * Project parsed CSV records onto stops, refusing a file whose coordinates
 * have stopped making sense.
 *
 * A duplicate `stop_id` keeps the FIRST occurrence: the key is (feed,
 * stop_id) and a later row with the same id is the same object, so
 * overwriting would make the load order decide the answer. None of the three
 * feeds measured carries one.
 */
export function projectStops(records: ReadonlyArray<Record<string, string>>): StopParseResult {
  const stops: StopRow[] = [];
  const seen = new Set<string>();
  let malformed = 0, incomplete = 0, impossible = 0, duplicates = 0;

  for (const rec of records) {
    if (rec.__malformed !== undefined) { malformed++; continue; }
    const stopId = (rec.stop_id ?? '').trim();
    const stopName = (rec.stop_name ?? '').trim();
    const latText = (rec.stop_lat ?? '').trim();
    const lonText = (rec.stop_lon ?? '').trim();
    if (stopId === '' || stopName === '' || latText === '' || lonText === '') { incomplete++; continue; }

    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { incomplete++; continue; }
    if (
      lat < AUSTRALIA_BBOX.minLat || lat > AUSTRALIA_BBOX.maxLat ||
      lon < AUSTRALIA_BBOX.minLon || lon > AUSTRALIA_BBOX.maxLon
    ) { impossible++; continue; }

    if (seen.has(stopId)) { duplicates++; continue; }
    seen.add(stopId);

    stops.push({
      stopId,
      stopName,
      lat,
      lon,
      locationType: intOrNull(rec.location_type),
      parentStation: ((rec.parent_station ?? '').trim() || null),
    });
  }

  const rows = records.length;
  if (rows >= COORD_RATIO_FLOOR_ROWS && impossible / rows > IMPOSSIBLE_COORD_TOLERANCE) {
    throw new Error(
      `${impossible} of ${rows} stops carry an impossible coordinate, past the measured `
      + `${(IMPOSSIBLE_COORD_TOLERANCE * 100).toFixed(1)}% tolerance -- refusing rather than loading a feed `
      + 'whose coordinate format has changed',
    );
  }
  if (rows >= COORD_RATIO_FLOOR_ROWS && malformed / rows > IMPOSSIBLE_COORD_TOLERANCE) {
    throw new Error(`${malformed} of ${rows} rows do not match the header width -- refusing`);
  }

  return {
    stops,
    audit: { rows, usable: stops.length, malformed, incomplete, impossibleCoord: impossible, duplicateIds: duplicates },
  };
}

/**
 * Refuse a load that is far smaller than the feed has been measured to be.
 *
 * A truncated download decompresses cleanly and parses cleanly; the only
 * thing that gives it away is the count. Floors are set well under the
 * measured sizes (NSW 171,064 stops, Darwin 898, Alice Springs 99) so a
 * genuine timetable change never trips them.
 */
export function assertNotTruncated(usable: number, floor: number, feedKey: string): void {
  if (usable < floor) {
    throw new Error(
      `${feedKey} yielded ${usable} usable stops, below the measured floor of ${floor} -- `
      + 'treating this as a truncated or partial download rather than a shrunken network',
    );
  }
}

// ---------------------------------------------------------------------------
// Candidates: feeds not yet admitted to the register
// ---------------------------------------------------------------------------

/**
 * Networks this platform does NOT hold, and the published address each would
 * be loaded from.
 *
 * These exist because of a claim that was overstated when the first four feeds
 * shipped: SA, TAS and ACT were described as refusing "this project's
 * vantages" when they had only ever been tried from a developer sandbox. That
 * is the very distinction the loader's own `probe` stage was built around —
 * reaching a host from a sandbox says nothing about the Edge Function that
 * runs the load — so the claim asserted more than had been measured.
 *
 * A candidate is probed from the real egress and is NEVER loaded from this
 * list. Admitting one means moving it into `GTFS_FEEDS` with a measured stop
 * floor, which cannot happen until a real parse has produced that number.
 *
 * The list is FIXED. A probe that took a URL from the request body would be a
 * server-side request forgery in a function holding service-role credentials,
 * which is a far worse thing than an unprobed feed.
 */
export interface GtfsCandidate {
  readonly key: string;
  readonly label: string;
  readonly url: string;
  /**
   * `archive` — the published zip itself.
   * `page` — the publisher's download page, because no catalogue this project
   * can reach names the archive's address. The probe reports any `.zip` link
   * it finds there; it never follows one.
   */
  readonly kind: 'archive' | 'page';
  /** What was already measured about it, so a re-probe has a baseline. */
  readonly sandboxResult: string;
}

export const GTFS_CANDIDATES: readonly GtfsCandidate[] = [
  {
    key: 'sa_adelaide',
    label: 'Adelaide Metro (South Australia)',
    url: 'https://gtfs.adelaidemetro.com.au/v1/static/latest.zip',
    kind: 'archive',
    sandboxResult: 'HTTP 403 with an XML body from this repo sandbox, 2026-09-07',
  },
  {
    key: 'act_canberra',
    label: 'Transport Canberra (ACT)',
    url: 'https://www.transport.act.gov.au/googletransit/google_transit.zip',
    kind: 'archive',
    sandboxResult: 'HTTP 403 with an HTML body from this repo sandbox, 2026-09-07',
  },
  {
    key: 'tas_metro',
    label: 'Metro Tasmania',
    url: 'https://www.transport.tas.gov.au/public_transport/gtfs-data',
    kind: 'page',
    sandboxResult: 'HTTP 403 from this repo sandbox; data.gov.au returns no Tasmanian GTFS package',
  },
  {
    key: 'wa_transperth',
    label: 'Transperth (Western Australia)',
    url: 'https://www.transperth.wa.gov.au/timetables/general-transit-feed-specification',
    kind: 'page',
    sandboxResult: 'page reachable from this repo sandbox but names no archive; data.gov.au returns no Transperth GTFS package',
  },
];

/**
 * `.zip` addresses named by a publisher's download page.
 *
 * Bounded and de-duplicated: this reports what a page advertises so a real
 * archive URL can be transcribed into the register by hand. Nothing here
 * fetches what it finds — a link discovered on a page is a lead, not a feed.
 */
export function zipLinksIn(html: string, limit = 12): string[] {
  const found = new Set<string>();
  const re = /(?:href|src)\s*=\s*["']([^"']+\.zip(?:\?[^"']*)?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && found.size < limit) found.add(m[1]);
  return [...found];
}
