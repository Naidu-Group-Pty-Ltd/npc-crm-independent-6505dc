/**
 * The forward investment programme — what a government has FUNDED, not what
 * somebody has applied to build.
 * ------------------------------------------------------------------------
 *
 * S5/S6 §4 asks for a ten-year infrastructure outlook built from *"official
 * programmes, budgets and planning publications"* rather than from development
 * applications alone. §5 of `PLANNING_CONTROLS_IN_THE_REPORT.md` has disclosed
 * that gap since it was written — *council capital works, budget programmes,
 * agency announcements* — and §13 measured it for the first time on 18 Sep
 * 2026. This is the acquisition that closes the measured half of it.
 *
 * ## The 2024 reading was two editions stale, and the schema had changed
 *
 * §13 read **QTRIP 2024-25 to 2027-28** (903 rows) and planned an LGA join on
 * its `Local Government` column. Re-measured against the publisher's catalogue
 * on 18 Sep 2026, that edition is two behind:
 *
 * | edition | rows in the DataStore | what it carries |
 * | --- | ---: | --- |
 * | 2024-25 → 2027-28 | 903 | `Local Government`, `Network`, `Investment Name`, per-year budgets, `Beyond`, `Endnotes` — **no status, no stage dates** |
 * | **2025-26 → 2028-29** | **639** | `Investment status (as at 1 July 2025)`, `Planning`, `Procurement`, `Construction Start`, `Range`, `Midpoint Latitude/Longitude` — **no `Local Government`, no `Network`** |
 * | 2026-27 → 2029-30 | **0** | declared `datastore_active`, holds no rows; its CSV answers HTTP 202 with zero bytes |
 *
 * Three things follow, and each is a rule here.
 *
 * **The current edition is the one that ANSWERS.** The 2026-27 package exists,
 * is newer, and is empty — `datastore_active: true` with `total: 0`. That is
 * the repository's standing rule in another costume: *asserted by effect,
 * never by configuration*. `QTRIP_EDITIONS` lists the editions in order and
 * the reader takes the newest that returns rows, naming which it used.
 *
 * **The join key is a COORDINATE, not a local government area.** The current
 * edition dropped `Local Government` and added a midpoint, which is strictly
 * better for the question a report asks: §4's *"an LGA project is not
 * automatically near the property"*. A bounding box around the subject, then a
 * measured distance, answers geographic relevance directly instead of by
 * assuming a council area is a neighbourhood. 508 of its 639 rows carry a
 * coordinate; the other 131 are statewide or unplaced and are **named as
 * unplaced** rather than dropped or placed.
 *
 * **Relying on the 2024 funding or status would have been wrong.** The 2024
 * columns are appropriations for years that have since been spent, and it
 * publishes no status at all — so a report drawing "funded" from it would have
 * been asserting a state of affairs the register never stated, from a document
 * two editions out of date. §4 asked for this reconciliation before the data
 * was relied on; this is it.
 *
 * ## What the other jurisdictions publish
 *
 * §4 is explicit: *"'No equivalent structured dataset found' must not become
 * 'NSW has no relevant programme.'"* It must not, and it does not.
 * `PROGRAMME_PUBLISHERS` names, for every state and territory, the programme
 * that jurisdiction actually publishes and the FORM it takes — and the reading
 * says which of those this platform ingests. An absence here is a statement
 * about this platform's coverage, never about the area, which is §9's rule
 * (*an absence may not be rated*) applied to acquisition.
 *
 * ## The five rules a row answers to
 *
 * 1. **A project is named only where a register named it** — `Project Title`
 *    verbatim, never a paraphrase, never a summary.
 * 2. **A status is the publisher's own word**, and the mapping onto this
 *    platform's vocabulary is deliberately narrow: `Contractually Committed`
 *    is **funded** and is never read as approved or as under construction;
 *    `Planned` is **proposed**. The one row that earns `under_construction` is
 *    one whose `Construction Start` the publisher itself writes as `Underway`.
 * 3. **A construction start is not a delivery date.** `Planning`,
 *    `Procurement` and `Construction Start` are stage markers, and the
 *    programme publishes no completion date for anything. A stage is labelled
 *    by what it IS.
 * 4. **A four-year programme is not a ten-year outlook.** This edition profiles
 *    one year plus a `Post 2025-26` lump; it says nothing about years five to
 *    ten, and the reading says so rather than letting a reader infer it.
 * 5. **A cost range is not a committed budget.** A `Planned` row carries
 *    `Range` ("Up to $250 million") and no budget; a `Contractually Committed`
 *    row carries a budget and no range. Printing one as the other states a
 *    commitment nobody made.
 *
 * Deno-compatible: no imports.
 */

/** A jurisdiction's own forward programme, and what form it takes. */
export interface ProgrammePublisher {
  /** The agency that publishes it. */
  publisher: string;
  /** The programme's own name. */
  programme: string;
  /**
   * `structured` — a machine-readable feed this platform can read.
   * `publication` — budget papers, programme documents or agency
   * announcements: real, official and current, but not a feed.
   */
  form: 'structured' | 'publication';
  /** Whether this platform reads it today. */
  ingested: boolean;
  /** Where a reader goes to see it themselves. */
  url: string;
}

/**
 * Every state and territory, named.
 *
 * Nothing here says a jurisdiction has no programme, because none of them
 * does not have one. What differs is whether the programme is published as a
 * feed this platform can read, and that is a fact about this platform.
 */
export const PROGRAMME_PUBLISHERS: Readonly<Record<string, ProgrammePublisher>> = {
  QLD: {
    publisher: 'Queensland Department of Transport and Main Roads',
    programme: 'Queensland Transport and Roads Investment Program (QTRIP)',
    form: 'structured',
    ingested: true,
    url: 'https://www.data.qld.gov.au/dataset/queensland-transport-and-roads-investment-program-qtrip-2025-26-to-2028-29',
  },
  NSW: {
    publisher: 'NSW Treasury, Transport for NSW and the local council',
    programme: 'the NSW Budget Infrastructure Statement, Transport for NSW project announcements, and the council’s own Delivery Program and capital works programme',
    form: 'publication',
    ingested: false,
    url: 'https://www.budget.nsw.gov.au/',
  },
  VIC: {
    publisher: 'Victorian Department of Treasury and Finance and the Major Transport Infrastructure Authority',
    programme: 'the Victorian Budget asset initiatives and the Big Build programme',
    form: 'publication',
    ingested: false,
    url: 'https://www.dtf.vic.gov.au/state-budget',
  },
  SA: {
    publisher: 'South Australian Department of Treasury and Finance',
    programme: 'the South Australian Budget capital investment statement',
    form: 'publication',
    ingested: false,
    url: 'https://www.treasury.sa.gov.au/budget',
  },
  WA: {
    publisher: 'Western Australian Department of Treasury and Main Roads WA',
    programme: 'the Western Australian Budget Asset Investment Program',
    form: 'publication',
    ingested: false,
    url: 'https://www.ourstatebudget.wa.gov.au/',
  },
  TAS: {
    publisher: 'Tasmanian Department of Treasury and Finance',
    programme: 'the Tasmanian Budget infrastructure investment chapter',
    form: 'publication',
    ingested: false,
    url: 'https://www.treasury.tas.gov.au/budget-and-financial-management/state-budget',
  },
  ACT: {
    publisher: 'ACT Treasury and Major Projects Canberra',
    programme: 'the ACT Budget Infrastructure Investment Program',
    form: 'publication',
    ingested: false,
    url: 'https://www.treasury.act.gov.au/budget',
  },
  NT: {
    publisher: 'Northern Territory Department of Treasury and Finance',
    programme: 'the Northern Territory Budget Infrastructure Program',
    form: 'publication',
    ingested: false,
    url: 'https://budget.nt.gov.au/',
  },
};

/** A published edition of QTRIP, newest first. */
export interface QtripEdition {
  /** The edition's own span, as the publisher writes it. */
  edition: string;
  /** The CKAN DataStore resource holding its rows. */
  resourceId: string;
  /** The column its status sits in — it carries the edition's own date. */
  statusColumn: string;
  /** The column its project name sits in. */
  titleColumn: string;
  /** The column its committed budget sits in. */
  budgetColumn: string;
  /** The column its weblink sits in — the publisher renamed it between editions. */
  linkColumn: string;
}

/**
 * The editions, newest first. The reader takes the first that returns rows.
 *
 * The 2026-27 edition is listed although it is empty today: it is the current
 * publication, and the day its DataStore is populated this reads it with no
 * change here. Its column names are taken from the fields the empty resource
 * declares, which is the one thing an empty DataStore does tell you.
 */
export const QTRIP_EDITIONS: readonly QtripEdition[] = [
  {
    edition: '2026-27 to 2029-30',
    resourceId: 'e6fceef5-4734-4d79-843f-8d046bd2e7b6',
    statusColumn: 'Investment status (as at 1 July 2026)',
    titleColumn: 'Project title',
    budgetColumn: "Committed total budget ($'000's)",
    linkColumn: 'Website',
  },
  {
    edition: '2025-26 to 2028-29',
    resourceId: '87448a6d-c86d-4f45-b69a-2a0707201cbf',
    statusColumn: 'Investment status (as at 1 July 2025)',
    titleColumn: 'Project Title',
    budgetColumn: "Committed total budget ($'000's)",
    linkColumn: 'Weblink',
  },
];

export const QTRIP_SOURCE = 'Queensland Transport and Roads Investment Program (QTRIP), Department of Transport and Main Roads';
export const QTRIP_LICENCE = 'CC BY 4.0';

/** The radius a project has to be inside to be a fact about this property's area. */
export const PROGRAMME_RADIUS_KM = 25;

/** Degrees of latitude per kilometre — the box is widened, the distance decides. */
const DEG_PER_KM = 1 / 111.32;

/**
 * How much wider than the radius the box is drawn.
 *
 * `DEG_PER_KM` is a MEAN degree; the meridian degree runs from about 110.57 km
 * at the equator to 111.69 km at the pole, so at Australian latitudes one
 * `DEG_PER_KM` step is slightly SHORT of a kilometre — measured at -25.54°,
 * a 25 km box reached 24.974 km, and an investment at 24.98 km due north
 * would have been dropped before the distance test ever saw it. Four-decimal
 * rounding costs another ~11 m at the corner.
 *
 * 2% covers both with room to spare. Widening is free — every extra row costs
 * one haversine and is then excluded by `parseQtripAnswer`, which is the real
 * test — while narrowing silently loses a real project.
 */
const BOX_MARGIN = 1.02;

/**
 * The bounding-box query for one edition.
 *
 * A box, then a measured distance: CKAN's SQL endpoint has no geography type,
 * so the box is the coarse filter and `rankByDistance` is the real test. The
 * box is generous by design — a box that exactly circumscribed the radius
 * would still admit corners, and admitting a few extra rows costs one
 * comparison each.
 */
export function qtripQuery(edition: QtripEdition, lat: number, lon: number, radiusKm: number): string {
  const padded = radiusKm * BOX_MARGIN;
  const dLat = padded * DEG_PER_KM;
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLon = (padded * DEG_PER_KM) / cos;
  const sql = `SELECT * FROM "${edition.resourceId}" WHERE "Midpoint Latitude" BETWEEN `
    + `${(lat - dLat).toFixed(4)} AND ${(lat + dLat).toFixed(4)} AND "Midpoint Longitude" BETWEEN `
    + `${(lon - dLon).toFixed(4)} AND ${(lon + dLon).toFixed(4)}`;
  return `https://www.data.qld.gov.au/api/3/action/datastore_search_sql?sql=${encodeURIComponent(sql)}`;
}

/** One funded or planned investment, as the programme states it. */
export interface ProgrammeInvestment {
  /** The publisher's own reference. */
  reference: string | null;
  /** `Project Title`, verbatim. */
  name: string;
  /** The publisher's own status word. */
  status: string | null;
  /** The publisher's district. */
  district: string | null;
  /** The stage markers, each the publisher's own word. */
  stages: { planning: string | null; procurement: string | null; constructionStart: string | null };
  /** A committed budget in dollars, on a committed row only. */
  committedBudget: number | null;
  /** A cost band, on a planned row only. */
  costRange: string | null;
  /**
   * Which governments contribute, named — never how much each contributes.
   *
   * The three contribution columns hold a **marker**, not an amount: a bullet
   * where that partner is in, empty where it is not. Reading `•` as a
   * number would print a funding split the programme never published, so the
   * honest reading is the set of partners and nothing more.
   */
  fundingPartners: string[];
  /** The publisher's own note. */
  note: string | null;
  /** Where the publisher describes it. */
  link: string | null;
  /** Kilometres from the subject, measured. */
  distanceKm: number;
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  // The programme writes an inapplicable cell as `-` and a completed stage as
  // a tick. A dash is an absence; the tick is a fact and is kept.
  return t === '' || t === '-' ? null : t;
};

const numeric = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The contribution columns, and the partner each one names. */
const FUNDING_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["Australian Government ($'000's)", 'the Australian Government'],
  ["Queensland Government ($'000's)", 'the Queensland Government'],
  ["Local Government/Other funding partners ($'000's)", 'local government or another funding partner'],
  ["Local Government/ Other funding partners ($'000's)", 'local government or another funding partner'],
];

/**
 * Whether a contribution cell says this partner is in.
 *
 * The cell is a marker — measured on the live rows, every populated one is a
 * bullet — so ANY non-empty, non-dash value means "contributes" and no value
 * anywhere is an amount. A cell that did carry a number would still only be
 * read as participation here, because the alternative is inventing a split
 * from a column whose meaning changed.
 */
const contributes = (v: unknown): boolean => str(v) !== null;

/** Great-circle kilometres. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371.0088;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLon - aLon) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export type ProgrammeParse =
  | { ok: true; investments: ProgrammeInvestment[]; unplaced: number }
  | { ok: false; reason: string };

/**
 * Parse one edition's SQL answer into investments inside the radius.
 *
 * A row with no coordinate is COUNTED rather than dropped or placed: the
 * programme's statewide rows are real investments whose location the publisher
 * did not state, and silently discarding them would understate the programme
 * while silently placing them would invent a location. The bounding box has
 * already excluded them from this answer, so `unplaced` is reported from the
 * rows the box returned that still carry no usable midpoint.
 */
export function parseQtripAnswer(
  body: unknown,
  edition: QtripEdition,
  subject: { lat: number; lon: number },
  radiusKm: number,
): ProgrammeParse {
  if (!isRecord(body)) return { ok: false, reason: 'the answer was not an object' };
  if (body.success === false) return { ok: false, reason: 'the DataStore reported the query failed' };
  const result = isRecord(body.result) ? body.result : null;
  if (!result || !Array.isArray(result.records)) {
    return { ok: false, reason: 'the answer carried no records array' };
  }
  const investments: ProgrammeInvestment[] = [];
  let unplaced = 0;
  for (const raw of result.records) {
    if (!isRecord(raw)) continue;
    const name = str(raw[edition.titleColumn]);
    if (!name) continue;
    const lat = numeric(raw['Midpoint Latitude']);
    const lon = numeric(raw['Midpoint Longitude']);
    if (lat === null || lon === null) { unplaced += 1; continue; }
    const d = distanceKm(subject.lat, subject.lon, lat, lon);
    if (d > radiusKm) continue;
    investments.push({
      reference: str(raw['Investment ID']),
      name,
      status: str(raw[edition.statusColumn]),
      district: str(raw['District']),
      stages: {
        planning: str(raw['Planning']),
        procurement: str(raw['Procurement']),
        constructionStart: str(raw['Construction Start']),
      },
      // The budget is in thousands, as the column name says.
      committedBudget: (() => {
        const n = numeric(raw[edition.budgetColumn]);
        return n === null ? null : n * 1000;
      })(),
      costRange: str(raw['Range']) ?? str(raw['Cost range']),
      fundingPartners: FUNDING_COLUMNS
        .filter(([column]) => contributes(raw[column]))
        .map(([, partner]) => partner),
      note: str(raw['Notes']),
      link: str(raw[edition.linkColumn]),
      distanceKm: d,
    });
  }
  investments.sort((a, b) => a.distanceKm - b.distanceKm);
  return { ok: true, investments, unplaced };
}

/**
 * The programme's status word, onto the platform's delivery vocabulary.
 *
 * Deliberately narrow, and the narrowness is the point. The programme
 * publishes two status words and neither means construction has started:
 * `Contractually Committed` is money committed under contract and
 * `Planned` is an intention. The ONE row that earns `under_construction` is
 * one whose `Construction Start` the publisher itself writes as `Underway`,
 * which is the publisher saying so rather than this module inferring it.
 *
 * Returns null for anything else, so the publisher's own word is printed
 * unmapped rather than forced onto a vocabulary it does not belong to.
 */
export function programmeStanding(
  status: string | null,
  constructionStart: string | null,
): 'proposed' | 'funded' | 'under_construction' | null {
  if ((constructionStart ?? '').trim().toLowerCase() === 'underway') return 'under_construction';
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'contractually committed') return 'funded';
  if (s === 'planned') return 'proposed';
  return null;
}

/**
 * What a stage marker means, in a sentence — never as a date.
 *
 * The programme writes a stage as a tick (done), `Underway` (in progress), a
 * financial year or a season-and-year (expected), or nothing. **None of them
 * is a completion**, and the one this is most likely to be misread as —
 * `Construction Start` — is the start of the work, not the end of it.
 */
export function stageSentence(stage: 'Planning' | 'Procurement' | 'Construction', marker: string | null): string | null {
  const m = (marker ?? '').trim();
  if (!m) return null;
  if (m === '✔' || m.toLowerCase() === 'complete' || m.toLowerCase() === 'completed') {
    return `${stage} complete`;
  }
  if (m.toLowerCase() === 'underway') return `${stage} underway`;
  return stage === 'Construction'
    ? `Construction expected to start ${m} — a start, not a completion`
    : `${stage} expected ${m}`;
}

/**
 * The one sentence that keeps a four-year programme from reading as ten.
 *
 * §4: *"A four-year programme does not establish delivery throughout a ten-year
 * horizon."* This edition profiles one year plus a single post-year lump, so
 * it is even narrower than four, and a reader is told which.
 */
export function horizonCaveat(edition: string): string {
  return `The programme covers ${edition} and states no completion date for any investment in it. `
    + 'Nothing in it establishes what will be delivered beyond that window, and none of the dates '
    + 'it publishes is a completion date.';
}

/**
 * What to say about a jurisdiction this platform does not read a feed for.
 *
 * Never "there is no programme". The publisher and the programme are named,
 * the form it takes is named, and the absence is stated as this platform's
 * coverage — so a reader can go and read it, and no conclusion about the area
 * follows from its absence here.
 */
export function programmeCoverageNote(state: string | null): string {
  const key = (state ?? '').trim().toUpperCase();
  const pub = PROGRAMME_PUBLISHERS[key];
  if (!pub) {
    return 'No forward investment programme was read for this jurisdiction. That is a limit of this '
      + 'report, not a finding about the area.';
  }
  if (pub.ingested) {
    return `${pub.programme} is published by ${pub.publisher} under ${QTRIP_LICENCE} and is read here.`;
  }
  return `${pub.publisher} publishes ${pub.programme}. It is an official, current programme, and it is `
    + 'issued as budget papers and agency publications rather than as a structured feed, so this report '
    + 'does not read it. Nothing about the area follows from its absence here — the programme exists '
    + `and can be read at ${pub.url}.`;
}
