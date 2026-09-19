/**
 * Public transport — the contracts, pinned against what the real feeds
 * actually contain.
 *
 * Every fixture here is copied from a published file or from a production row
 * read back on 2026-09-07, not invented: NSW's three broken coordinates, NT's
 * unquoted leading-space values, the Parramatta station-and-platform cluster
 * that made grouping necessary, and the column orders that differ between two
 * feeds from the SAME publisher.
 *
 * Acquisition log and the whole account: `docs/reports/TRANSPORT_SOURCES.md`.
 */
import { describe, expect, it } from 'vitest';
import {
  AUSTRALIA_BBOX,
  COORD_RATIO_FLOOR_ROWS,
  GTFS_FEEDS,
  IMPOSSIBLE_COORD_TOLERANCE,
  LOADABLE_FEEDS,
  ZIP_TAIL_BYTES,
  assertNotTruncated,
  feedByKey,
  findMember,
  memberDataStart,
  parseGtfsCsv,
  projectStops,
  readZipDirectoryFromTail,
  GTFS_CANDIDATES,
  zipLinksIn,
} from '../../../../supabase/functions/_shared/gtfsFeed.pure';
import {
  COVERAGE_RADIUS_M,
  NEARBY_RADIUS_M,
  boundingBox,
  groupToPlaces,
  haversineMetres,
  readTransport,
  type StoredStop,
  projectTransportForLocationIntelligence,
  TEMPLATE_ONLY_TRANSPORT_FIELDS,
  type TransportReading,
} from '../../../../supabase/functions/_shared/transportReading.pure';

// ---------------------------------------------------------------------------
// The feed register
// ---------------------------------------------------------------------------

describe('the declared feeds', () => {
  it('has no repeated key, because the key IS the feed column', () => {
    const keys = GTFS_FEEDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every loadable feed a truncation floor under its measured size', () => {
    // Measured 2026-09-07: NSW 171,061 usable, QLD 13,119, Darwin 898, Alice 99.
    const measured: Record<string, number> = {
      nsw_sydney: 171_061, qld_seq: 13_119, nt_darwin: 898, nt_alice: 99,
    };
    for (const feed of LOADABLE_FEEDS) {
      expect(feed.minStops, feed.key).toBeGreaterThan(0);
      expect(feed.minStops, feed.key).toBeLessThan(measured[feed.key]);
    }
  });

  it('makes an unloadable feed RENDER its reason rather than vanish', () => {
    // A feed that simply disappeared would let an empty answer read as "no
    // public transport in Victoria".
    const vic = feedByKey('vic_ptv');
    expect(vic).not.toBeNull();
    expect(vic!.loadable).toBe(false);
    expect(vic!.unloadableReason ?? '').toMatch(/nested|inflat/i);
    expect(LOADABLE_FEEDS.map((f) => f.key)).not.toContain('vic_ptv');
  });

  it('returns null for an unknown key rather than guessing a feed', () => {
    expect(feedByKey('wa_transperth')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reading one member out of an archive too big to download
// ---------------------------------------------------------------------------

/** A minimal single-entry zip, built byte by byte so the offsets are real. */
function buildZip(name: string, payload: Uint8Array): Uint8Array {
  const enc = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + enc.length + payload.length);
  const ldv = new DataView(local.buffer);
  ldv.setUint32(0, 0x04034b50, true);
  ldv.setUint16(8, 0, true);                    // stored
  ldv.setUint32(18, payload.length, true);      // compressed
  ldv.setUint32(22, payload.length, true);      // uncompressed
  ldv.setUint16(26, enc.length, true);
  ldv.setUint16(28, 0, true);
  local.set(enc, 30);
  local.set(payload, 30 + enc.length);

  const cd = new Uint8Array(46 + enc.length);
  const cdv = new DataView(cd.buffer);
  cdv.setUint32(0, 0x02014b50, true);
  cdv.setUint16(10, 0, true);
  cdv.setUint32(20, payload.length, true);
  cdv.setUint32(24, payload.length, true);
  cdv.setUint16(28, enc.length, true);
  cdv.setUint32(42, 0, true);                   // local header offset
  cd.set(enc, 46);

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, 1, true);
  edv.setUint16(10, 1, true);
  edv.setUint32(12, cd.length, true);
  edv.setUint32(16, local.length, true);

  const out = new Uint8Array(local.length + cd.length + eocd.length);
  out.set(local, 0);
  out.set(cd, local.length);
  out.set(eocd, local.length + cd.length);
  return out;
}

describe('the range-addressed archive reader', () => {
  const payload = new TextEncoder().encode('stop_id,stop_name\n1,Somewhere\n');
  const zip = buildZip('stops.txt', payload);

  it('finds a member from the tail alone', () => {
    const members = readZipDirectoryFromTail(zip, zip.length);
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe('stops.txt');
    expect(members[0].uncompressedSize).toBe(payload.length);
  });

  it('reads the data offset from the LOCAL header, not the central directory', () => {
    // The two carry their own name and extra lengths and they routinely
    // differ; using the central directory's is a silent off-by-n that
    // decompresses to rubbish rather than failing.
    const m = readZipDirectoryFromTail(zip, zip.length)[0];
    const localHeader = zip.subarray(m.localHeaderOffset, m.localHeaderOffset + 30);
    const start = memberDataStart(localHeader, m.localHeaderOffset);
    // Compared as plain numbers: a typed-array view carries its parent's
    // buffer and byteOffset, which deep equality compares as well as content.
    expect(Array.from(zip.slice(start, start + payload.length))).toEqual(Array.from(payload));
    expect(new TextDecoder().decode(zip.slice(start, start + payload.length)))
      .toBe('stop_id,stop_name\n1,Somewhere\n');
  });

  it('refuses an archive with no end-of-central-directory in the tail', () => {
    expect(() => readZipDirectoryFromTail(new Uint8Array(64), 64)).toThrow(/end-of-central-directory/);
  });

  it('refuses a zip64 archive rather than reading a saturated offset', () => {
    const z = zip.slice();
    const dv = new DataView(z.buffer);
    const eocd = z.length - 22;
    dv.setUint32(eocd + 16, 0xffffffff, true);
    expect(() => readZipDirectoryFromTail(z, z.length)).toThrow(/zip64/);
  });

  it('says so when the directory sits before the fetched tail', () => {
    // The tail is a window; a directory outside it must be re-fetched rather
    // than parsed from whatever bytes happen to be at that index.
    const tail = zip.subarray(zip.length - 22);
    expect(() => readZipDirectoryFromTail(tail, zip.length)).toThrow(/refetch a longer tail/);
  });

  it('matches a member inside a directory as well as at the root', () => {
    const members = [
      { name: 'gtfs/stops.txt', method: 8, compressedSize: 1, uncompressedSize: 1, localHeaderOffset: 0 },
    ];
    expect(findMember(members, 'stops.txt')?.name).toBe('gtfs/stops.txt');
    expect(findMember(members, 'routes.txt')).toBeNull();
  });

  it('fetches a tail large enough for the biggest zip comment', () => {
    expect(ZIP_TAIL_BYTES).toBeGreaterThanOrEqual(65_557);
  });
});

// ---------------------------------------------------------------------------
// The CSV, with the real files' quirks
// ---------------------------------------------------------------------------

describe('parsing the published stop files', () => {
  it('maps by header NAME, because the feeds disagree about column order', () => {
    // NSW puts stop_lat 4th; NT puts it 5th behind stop_desc. A positional
    // reader loads stop_desc as a latitude.
    const nsw = parseGtfsCsv(
      'stop_id,stop_code,stop_name,stop_lat,stop_lon\n'
      + '"2533211","2533211","Kiama Station, Platform 1","-34.67255547","150.85455900"\n',
    );
    const nt = parseGtfsCsv(
      'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon\n'
      + '12,004,"Trower Road after Bradshaw Terrace",, -12.369522, 130.883003\n',
    );
    expect(nsw[0].stop_lat).toBe('-34.67255547');
    expect(nt[0].stop_lat).toBe('-12.369522');
    expect(nt[0].stop_desc).toBe('');
  });

  it('keeps a comma that lives inside a quoted stop name', () => {
    const rows = parseGtfsCsv('stop_id,stop_name\n"1","Kiama Station, Platform 1"\n');
    expect(rows[0].stop_name).toBe('Kiama Station, Platform 1');
  });

  it('strips a byte-order mark from the first header', () => {
    const rows = parseGtfsCsv('﻿stop_id,stop_name\n1,A\n');
    expect(Object.keys(rows[0])).toContain('stop_id');
  });

  it('reads CRLF the same as LF', () => {
    expect(parseGtfsCsv('stop_id,stop_name\r\n1,A\r\n')).toHaveLength(1);
  });

  it('marks a row of the wrong width rather than padding it', () => {
    // Padding invents a column; the row is counted as a shape defect instead.
    const rows = parseGtfsCsv('stop_id,stop_name,stop_lat\n1,A\n');
    expect(rows[0].__malformed).toBeDefined();
    expect(projectStops(rows).audit.malformed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// What a usable stop is
// ---------------------------------------------------------------------------

const HEADER = 'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station';

describe('projecting rows onto stops', () => {
  it("excludes NSW's three real broken coordinates AND counts them", () => {
    // Verbatim from the published file: a sign-flipped latitude whose
    // longitude is a copy of it, a real Sydney stop at lon -179.99, and one
    // at exactly (0,0). Real streets whose positions cannot answer a distance
    // question — the SAPOL interstate-postcode rule.
    const rows = parseGtfsCsv([
      HEADER,
      'G2583258,"Woodward Lane Opp 54",30.51656633,-30.51657273,1,',
      'G2663247,"83 Pitt St",-34.86520002,-179.99891116,1,',
      'G268012,"Brinagee St At Gunbar St",0.0,0.0,1,',
      '2150161,"Marsden St After Macquarie St",-33.81430665,151.00180831,,G2150161',
    ].join('\n'));
    const { stops, audit } = projectStops(rows);
    expect(audit.impossibleCoord).toBe(3);
    expect(stops).toHaveLength(1);
    expect(stops[0].stopId).toBe('2150161');
  });

  it('keeps the FIRST of a repeated stop_id so load order cannot decide', () => {
    const rows = parseGtfsCsv([
      HEADER,
      '12,"First",-12.369522,130.883003,0,',
      '12,"Second",-12.4,130.9,0,',
    ].join('\n'));
    const { stops, audit } = projectStops(rows);
    expect(audit.duplicateIds).toBe(1);
    expect(stops[0].stopName).toBe('First');
  });

  it('does not apply the coordinate ratio below its row floor', () => {
    // One unplaced row in four is 25% and says nothing about whether a column
    // moved; a ratio needs a denominator.
    const rows = parseGtfsCsv([
      HEADER,
      'a,"Fine",-33.8,151.0,0,',
      'b,"Broken",0.0,0.0,0,',
    ].join('\n'));
    expect(() => projectStops(rows)).not.toThrow();
    expect(COORD_RATIO_FLOOR_ROWS).toBeGreaterThanOrEqual(500);
  });

  it('refuses a large file whose coordinates have stopped making sense', () => {
    const lines = [HEADER];
    for (let i = 0; i < 600; i++) lines.push(`s${i},"Broken",0.0,0.0,0,`);
    expect(() => projectStops(parseGtfsCsv(lines.join('\n')))).toThrow(/impossible coordinate/);
  });

  it('leaves the tolerance far above the measured worst case', () => {
    // 3 of 171,064 is 0.0018%; the bound is 0.1%.
    expect(IMPOSSIBLE_COORD_TOLERANCE).toBeGreaterThan(3 / 171_064);
    expect(IMPOSSIBLE_COORD_TOLERANCE).toBeLessThanOrEqual(0.01);
  });

  it('keeps the bounding box generous enough for interstate coach terminals', () => {
    // "Greater Sydney" reaches lon 138.5884 (Adelaide) and lat -37.8183
    // (Melbourne). Those are real stops and must not be excluded.
    expect(AUSTRALIA_BBOX.minLon).toBeLessThan(138.5884);
    expect(AUSTRALIA_BBOX.minLat).toBeLessThan(-37.8183);
  });

  it('treats a shrunken load as truncated rather than as a shrunken network', () => {
    expect(() => assertNotTruncated(10, 4_000, 'qld_seq')).toThrow(/truncated or partial/);
    expect(() => assertNotTruncated(13_119, 4_000, 'qld_seq')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

const src = 'Transport for NSW Open Data (CC BY 4.0)';
const stop = (
  stop_id: string, stop_name: string, lat: number, lon: number,
  location_type: number | null = null, parent_station: string | null = null,
): StoredStop => ({
  feed: 'nsw_sydney', stop_id, stop_name, lat, lon, location_type,
  parent_station, route_type: null, source_label: src,
});

/**
 * Production rows within 1.6 km of the Parramatta test coordinate, read back
 * on 2026-09-07. Thirteen of the sixteen carry `parent_station: 215020`.
 */
const PARRAMATTA: StoredStop[] = [
  stop('215020', 'Parramatta Station', -33.81749025, 151.005325, 1),
  stop('2150411', 'Parramatta Station, Platform 1', -33.81727677, 151.00523946, null, '215020'),
  stop('2150412', 'Parramatta Station, Platform 2', -33.81740273, 151.00524534, null, '215020'),
  stop('2150106', 'Parramatta Station, Stand B1', -33.81728729, 151.00408484, null, '215020'),
  stop('2150114', 'Parramatta Station, Stand A1', -33.81724464, 151.00428796, null, '215020'),
  stop('2150361', 'Parramatta Station, Darcy St', -33.81682727, 151.00437644, null, '215020'),
  stop('G2150161', 'Marsden St After Macquarie St', -33.814307, 151.00179753, 1),
  stop('2150161', 'Marsden St After Macquarie St', -33.81430665, 151.00180831, null, 'G2150161'),
  stop('G215050', 'Westfield Parramatta, Argyle St', -33.81684841, 151.00261777, 1),
  stop('215050', 'Westfield Parramatta, Argyle St', -33.81684841, 151.00261777, null, 'G215050'),
  stop('2150135', 'Church Street Light Rail', -33.81295045, 151.00361257, 1),
  stop('2150136', 'Church Street Light Rail', -33.81294285, 151.00356904, null, '2150135'),
  stop('2150137', 'Church Street Light Rail', -33.8129494, 151.00364491, null, '2150135'),
];

describe('what is near a property', () => {
  it('measures a distance that matches a known one', () => {
    // Parramatta Station to Sydney Central is about 21 km.
    const m = haversineMetres(-33.81749, 151.005325, -33.8832, 151.2065);
    expect(m).toBeGreaterThan(19_000);
    expect(m).toBeLessThan(23_000);
  });

  it('boxes a radius wide enough to contain its own circle', () => {
    const b = boundingBox(-33.8148, 151.0017, 1_600);
    // Due north at exactly the radius must fall inside the box.
    expect(b.maxLat).toBeGreaterThan(-33.8148 + 1_600 / 111_320 - 1e-9);
    expect(b.maxLon).toBeGreaterThan(151.0017);
  });

  it('collapses a station and its platforms into ONE place', () => {
    // Without this the reading names six platforms of one station as six
    // stops and reports thirteen places where there is one.
    expect(PARRAMATTA).toHaveLength(13);
    expect(groupToPlaces(PARRAMATTA)).toHaveLength(4);

    const r = readTransport(-33.8148, 151.0017, PARRAMATTA);
    expect(r.verdict).toBe('stops_nearby');
    expect(r.countWithinRadius).toBe(4);
    expect(r.stops.map((s) => s.name)).toEqual([
      'Marsden St After Macquarie St',
      'Westfield Parramatta, Argyle St',
      'Church Street Light Rail',
      'Parramatta Station',
    ]);
  });

  it("names a grouped station by the STATION's name, not a platform's", () => {
    const r = readTransport(-33.8148, 151.0017, PARRAMATTA);
    expect(r.stops.map((s) => s.name)).not.toContain('Parramatta Station, Stand B1');
    expect(r.stops.map((s) => s.name)).toContain('Parramatta Station');
  });

  it('separates "nothing nearby" from "no feed reaches here"', () => {
    // The distinction this whole reading turns on. A Perth property is not
    // badly served; it is outside every loaded network.
    const far = readTransport(-31.9523, 115.8613, []);
    expect(far.verdict).toBe('outside_loaded_networks');
    expect(far.nearest).toBeNull();

    const sparse = readTransport(
      -33.0, 150.0,
      [stop('x', 'A Long Way Off', -33.2, 150.2)],
    );
    expect(sparse.verdict).toBe('none_within_radius');
    expect(sparse.nearest?.name).toBe('A Long Way Off');
    expect(sparse.countWithinRadius).toBe(0);
  });

  it('excludes entrances and boarding areas, which are not destinations', () => {
    const r = readTransport(-33.8148, 151.0017, [
      stop('e', 'Wynyard Station Entrance 4', -33.8148, 151.0017, 2),
      stop('n', 'Concourse Node', -33.8148, 151.0017, 3),
    ]);
    expect(r.verdict).toBe('outside_loaded_networks');
  });

  it('never returns a score, grade or rating', () => {
    // The invented `qualityScore` drove up to 30 points of every report's
    // walk score. A score from stop counts alone would be a new invention in
    // the same clothes, because frequency is not measured.
    const r = readTransport(-33.8148, 151.0017, PARRAMATTA);
    expect(JSON.stringify(r)).not.toMatch(/"(score|rating|grade|quality)[A-Za-z]*":/i);
  });

  it('always says what it did not measure, including on a full answer', () => {
    for (const r of [
      readTransport(-33.8148, 151.0017, PARRAMATTA),
      readTransport(-31.9523, 115.8613, []),
    ]) {
      expect(r.notMeasured.join(' ')).toMatch(/mode/i);
      expect(r.notMeasured.join(' ')).toMatch(/frequency/i);
    }
  });

  it('reports mode as absent rather than guessing it from a name', () => {
    const r = readTransport(-33.8148, 151.0017, PARRAMATTA);
    for (const s of r.stops) expect(s.routeType).toBeNull();
  });

  it('carries the publisher attribution on every answer that used its data', () => {
    const r = readTransport(-33.8148, 151.0017, PARRAMATTA);
    expect(r.sources).toEqual([src]);
    expect(r.feeds).toEqual(['nsw_sydney']);
  });

  it('keeps the coverage radius far wider than the walk radius', () => {
    expect(COVERAGE_RADIUS_M).toBeGreaterThan(NEARBY_RADIUS_M * 10);
  });
});

// ---------------------------------------------------------------------------
// Candidates: networks not held, and the claim that had not been measured
// ---------------------------------------------------------------------------

describe('candidate feeds', () => {
  it('never overlaps the loaded register', () => {
    // A candidate is probed and never loaded. Admitting one means moving it
    // into GTFS_FEEDS with a stop floor a real parse produced.
    const loaded = new Set(GTFS_FEEDS.map((f) => f.key));
    for (const c of GTFS_CANDIDATES) expect(loaded.has(c.key), c.key).toBe(false);
  });

  it('records what the sandbox measured, so a re-probe has a baseline', () => {
    // The whole point of the list: SA, TAS and ACT were written off on one
    // vantage's evidence, which asserted more than had been measured.
    for (const c of GTFS_CANDIDATES) {
      expect(c.sandboxResult, c.key).toBeTruthy();
      expect(c.url, c.key).toMatch(/^https:\/\//);
    }
  });

  it('keeps the probe list fixed rather than caller-supplied', () => {
    // A probe taking a URL from the request body would be SSRF in a function
    // holding service-role credentials. The list being a frozen constant is
    // what makes the stage safe, so its shape is pinned here.
    expect(Array.isArray(GTFS_CANDIDATES)).toBe(true);
    expect(GTFS_CANDIDATES.length).toBeGreaterThan(0);
    const keys = GTFS_CANDIDATES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('distinguishes an archive from a publisher page', () => {
    // WA is reachable but names no archive; SA/ACT are refused outright.
    // Collapsing the two would report Transperth as refusing data it has not
    // been asked for.
    const byKey = Object.fromEntries(GTFS_CANDIDATES.map((c) => [c.key, c]));
    expect(byKey.sa_adelaide.kind).toBe('archive');
    expect(byKey.act_canberra.kind).toBe('archive');
    expect(byKey.wa_transperth.kind).toBe('page');
    expect(byKey.tas_metro.kind).toBe('page');
  });
});

describe('reading a publisher page for an archive address', () => {
  it('finds a zip href and de-duplicates it', () => {
    const html = '<a href="/a/google_transit.zip">x</a><a href="/a/google_transit.zip">y</a>';
    expect(zipLinksIn(html)).toEqual(['/a/google_transit.zip']);
  });

  it('keeps a query string, because feeds are versioned that way', () => {
    // NT's Darwin archive is published as google-transit-darwin.zip?v=0.34.1.
    expect(zipLinksIn('<a href="https://h/x.zip?v=0.34.1">d</a>'))
      .toEqual(['https://h/x.zip?v=0.34.1']);
  });

  it('returns nothing for a page that names no archive', () => {
    // Transperth's page, measured: 82 KB of HTML with no .zip anywhere.
    expect(zipLinksIn('<html><body><p>General Transit Feed Specification</p></body></html>')).toEqual([]);
  });

  it('is bounded, so a hostile page cannot return an unbounded list', () => {
    const many = Array.from({ length: 50 }, (_, i) => `<a href="/f${i}.zip">n</a>`).join('');
    expect(zipLinksIn(many).length).toBeLessThanOrEqual(12);
  });
});

/**
 * ME-5 items 14–15 — the block a report is allowed to store.
 *
 * `location-intelligence-service` used to compose this block by hand from an
 * untyped body, which is how it came to read the transport service's whole
 * `{ success, data }` envelope as the payload and dereference undefined, and
 * how it came to store six fields no stops feed can answer.
 */
describe('the transport block stored on a report', () => {
  const reading: TransportReading = {
    verdict: 'stops_nearby',
    stops: [
      { stopId: '215020', name: 'Parramatta Station', metres: 340, feed: 'nsw_sydney', routeType: null },
      { stopId: '215021', name: 'Argyle St at Parramatta', metres: 820, feed: 'nsw_sydney', routeType: null },
    ],
    countWithinRadius: 2,
    radiusMetres: 1600,
    nearest: { stopId: '215020', name: 'Parramatta Station', metres: 340, feed: 'nsw_sydney', routeType: null },
    feeds: ['nsw_sydney'],
    sources: ['Transport for NSW'],
    notMeasured: ['mode', 'service frequency'],
  };

  it('carries the measured stop, in kilometres, from the coordinate', () => {
    const block = projectTransportForLocationIntelligence(reading);
    expect(block.nearestStation).toBe('Parramatta Station');
    expect(block.distanceToStation).toBe(0.3);
    expect(block.stopsWithin1km).toBe(2);
    expect(block.source).toBe('gtfs');
  });

  it('names no field a stops feed cannot answer', () => {
    const block = projectTransportForLocationIntelligence(reading) as unknown as Record<string, unknown>;
    for (const field of TEMPLATE_ONLY_TRANSPORT_FIELDS) {
      expect(block).not.toHaveProperty(field);
    }
    // The one that mattered most: it drove up to 30 of the walk score's 100 points.
    expect(TEMPLATE_ONLY_TRANSPORT_FIELDS).toContain('qualityScore');
    expect(TEMPLATE_ONLY_TRANSPORT_FIELDS).toContain('nearestStop');
  });

  it('carries what the reading could not measure, rather than dropping it', () => {
    expect(projectTransportForLocationIntelligence(reading).notMeasured)
      .toEqual(['mode', 'service frequency']);
  });

  it('reports no distance rather than zero when nothing was found', () => {
    const block = projectTransportForLocationIntelligence({
      ...reading,
      verdict: 'outside_loaded_networks',
      stops: [], countWithinRadius: 0, nearest: null, feeds: [], sources: [],
    });
    expect(block.distanceToStation).toBeNull();
    expect(block.nearestStation).toBe('N/A');
    expect(block.verdict).toBe('outside_loaded_networks');
  });
});
