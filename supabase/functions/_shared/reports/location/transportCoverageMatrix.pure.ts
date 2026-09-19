/**
 * ME-5.1 items 11 and 12 — what transport evidence exists nationally, and why
 * it must not be scored as though it were complete.
 *
 * ## The four loaded feeds, and their real extent
 *
 * | feed | jurisdiction | stops | licence / source | loaded |
 * | --- | --- | ---: | --- | --- |
 * | `nsw_sydney` | NSW | 171,061 | Transport for NSW Open Data (CC BY 4.0) | 2026-09-07 |
 * | `qld_seq` | QLD | 13,119 | TransLink South East Queensland GTFS | 2026-09-07 |
 * | `nt_darwin` | NT | 898 | NT DIPL public bus GTFS (CC BY) | 2026-09-07 |
 * | `nt_alice` | NT | 99 | NT DIPL public bus GTFS (CC BY) | 2026-09-07 |
 *
 * **`nsw_sydney` is misnamed.** Its bounding box runs lat −37.82 to −27.46 and
 * lon 138.59 to 153.62 — it reaches Melbourne, Adelaide and Brisbane, because
 * it is Transport for NSW's WHOLE bundle including the interstate rail and
 * coach network. A Docklands property finds Southern Cross Station 225 m away
 * from this feed. That is a real stop and it is not Melbourne's network.
 *
 * **No feed establishes mode.** `route_type` is NULL on all 185,177 stops, so
 * mode and service frequency are not measured anywhere and must be declared
 * unmeasured rather than inferred.
 *
 * ## Coverage against the corpus that actually exists
 *
 * Measured over the 867 trusted geography records:
 *
 * | state | settlement | reports | own-feed stop within 1.6 km | interstate only | none |
 * | --- | --- | ---: | ---: | ---: | ---: |
 * | QLD | metro | 226 | 200 | 0 | 26 |
 * | **WA** | **metro** | **164** | **0** | 0 | **164** |
 * | **VIC** | **metro** | **145** | **0** | 3 | **142** |
 * | QLD | inner regional | 149 | 44 | 0 | 105 |
 * | VIC | inner regional | 50 | 0 | 3 | 47 |
 * | NSW | metro | 47 | 47 | 0 | 0 |
 * | QLD | outer regional | 29 | 0 | 0 | 29 |
 * | NSW | inner regional | 11 | 11 | 0 | 0 |
 * | SA | metro | 7 | 0 | 1 | 6 |
 * | ACT | metro | 4 | 0 | 4 | 0 |
 *
 * **The two largest metropolitan cohorts after south-east Queensland — Perth
 * (164) and Melbourne (145) — have no transport evidence at all.** Both are
 * cities with extensive rail and bus networks. Their absence is a fact about
 * which state governments' feeds this deployment has loaded, not about the
 * properties.
 *
 * ## The rule (item 12)
 *
 * **Scoring transport on this coverage would rank a Brisbane property above an
 * identical Perth one because Queensland publishes a feed and Western Australia
 * has not been ingested.** So where no in-jurisdiction feed reaches a property,
 * transport is `unavailable` — never a neutral or default score — and Location
 * must remain assessable from its other components.
 *
 * Completing national coverage is worth doing and is NOT a prerequisite for the
 * rest of the programme. Transport is one Location component among several.
 */

export interface LoadedFeed {
  feed: string;
  jurisdiction: string;
  stops: number;
  sourceLabel: string;
  /** True where the feed's extent goes beyond its own jurisdiction. */
  carriesInterstateNetwork: boolean;
  /** GTFS fields the loaded rows do NOT establish. */
  notEstablished: readonly string[];
}

export const LOADED_FEEDS: readonly LoadedFeed[] = [
  {
    feed: 'nsw_sydney', jurisdiction: 'NSW', stops: 171_061,
    sourceLabel: 'Transport for NSW Open Data (CC BY 4.0)',
    carriesInterstateNetwork: true,
    notEstablished: ['route_type / mode', 'service frequency'],
  },
  {
    feed: 'qld_seq', jurisdiction: 'QLD', stops: 13_119,
    sourceLabel: 'TransLink South East Queensland GTFS',
    carriesInterstateNetwork: false,
    notEstablished: ['route_type / mode', 'service frequency'],
  },
  {
    feed: 'nt_darwin', jurisdiction: 'NT', stops: 898,
    sourceLabel: 'NT DIPL public bus GTFS (CC BY)',
    carriesInterstateNetwork: false,
    notEstablished: ['route_type / mode', 'service frequency'],
  },
  {
    feed: 'nt_alice', jurisdiction: 'NT', stops: 99,
    sourceLabel: 'NT DIPL public bus GTFS (CC BY)',
    carriesInterstateNetwork: false,
    notEstablished: ['route_type / mode', 'service frequency'],
  },
];

/** Jurisdictions with no loaded feed, and what would be needed. */
export interface CoverageGap {
  jurisdiction: string;
  corpusReports: number;
  metroReports: number;
  candidateSource: string;
  licence: string;
}

/**
 * The gaps, ordered by how much of the corpus they cost.
 *
 * Sources named are the official open-data publishers. Nothing here is a
 * journey-planner scrape, and none is ingested by this change — item 12 is
 * explicit that building a national transit platform is not this stage's job.
 */
export const COVERAGE_GAPS: readonly CoverageGap[] = [
  {
    jurisdiction: 'WA', corpusReports: 179, metroReports: 164,
    candidateSource: 'Transperth / PTA WA GTFS (data.wa.gov.au)',
    licence: 'to be confirmed before ingest',
  },
  {
    jurisdiction: 'VIC', corpusReports: 201, metroReports: 145,
    candidateSource: 'PTV GTFS (data.vic.gov.au) — nests per-mode archives inside one zip',
    licence: 'to be confirmed before ingest',
  },
  {
    jurisdiction: 'SA', corpusReports: 11, metroReports: 7,
    candidateSource: 'Adelaide Metro GTFS (data.sa.gov.au)',
    licence: 'to be confirmed before ingest',
  },
  {
    jurisdiction: 'TAS', corpusReports: 7, metroReports: 0,
    candidateSource: 'Metro Tasmania GTFS',
    licence: 'to be confirmed before ingest',
  },
  {
    jurisdiction: 'ACT', corpusReports: 4, metroReports: 4,
    candidateSource: 'Transport Canberra GTFS (data.act.gov.au)',
    licence: 'to be confirmed before ingest',
  },
  {
    jurisdiction: 'QLD (outside SEQ)', corpusReports: 178, metroReports: 0,
    candidateSource: 'regional QLD operators — no single statewide feed',
    licence: 'to be confirmed before ingest',
  },
];

/** Does a loaded feed cover this jurisdiction at all? */
export function jurisdictionIsCovered(state: string | null | undefined): boolean {
  if (!state) return false;
  const st = state.trim().toUpperCase();
  return LOADED_FEEDS.some((f) => f.jurisdiction === st);
}

/**
 * How a transport reading must be reported for a property in this state.
 *
 * Never returns a score. `unavailable` is a distinct answer from `no stops
 * nearby`, and conflating them is what would penalise Perth for Western
 * Australia's feed not being loaded.
 */
export function transportAvailability(state: string | null | undefined): {
  available: boolean; statement: string;
} {
  if (jurisdictionIsCovered(state)) {
    return {
      available: true,
      statement: 'A public transport feed for this jurisdiction is loaded, so stop distance is '
        + 'measured from the property’s coordinate. Mode and service frequency are not '
        + 'established by any loaded feed.',
    };
  }
  return {
    available: false,
    statement: `No public transport feed is loaded for ${state ?? 'this jurisdiction'}, so `
      + 'transport access is not measured for this property. This is a limit of the data held '
      + 'and not a finding about the area — the 164 Perth and 145 Melbourne properties in the '
      + 'corpus sit in cities with extensive networks.',
  };
}
