/**
 * Does ACT, NT, TAS or WA publish a COUNT of residential sales, by an area
 * finer than the state, over enough periods to score Demand?
 *
 * ── The gap, stated precisely ────────────────────────────────────────────
 *
 * `scoreTransactionVolume` is the only PRIMARY demand measure this
 * deployment is entitled to — the other three (rental tightness, sale
 * urgency, absorption) come from vendor feeds nobody here holds, which is
 * what a Domain 403 leaves behind. It needs `VOLUME_BASELINE_PERIODS + 1`
 * = **four** periods carrying a count before it will believe a baseline.
 *
 * Where the register stands (measured from the loaders, 22 Sep 2026):
 *
 *   NSW  postcode + LGA + state, a count with EVERY period       ✅
 *   QLD  LGA, a count with every period                          ✅
 *   SA   LGA, a count with every period                           ✅
 *   VIC  suburb, ONE count per workbook — closed by
 *        `vicVolumeBackfill.pure.ts`, four archived quarters      ✅
 *   WA   `absResDwell` only: state grain, `salesCount: null`      ✗
 *   TAS  as WA                                                    ✗
 *   NT   as WA                                                    ✗
 *   ACT  as WA                                                    ✗
 *
 * So all four have a GROWTH reading and none has a DEMAND one, and the
 * missing thing is specific: not a median, not a price, not an area — a
 * **count**, over four periods, somewhere finer than the state.
 *
 * ── A median series is not a count series, and that is the whole trap ────
 *
 * Every one of these jurisdictions publishes something called "property
 * sales". Reading one and concluding the gap is closed is the failure this
 * module exists to prevent, because `absResDwell` already hands all four a
 * price at state grain: a second price series would change nothing and
 * would look, from a dashboard, exactly like a fix.
 *
 * `datasetCarriesCount` is therefore asked of the publisher's own words —
 * a dataset carries a count where it SAYS it does — and a median-only
 * dataset is recorded as `medians_only`, a distinct reading with its own
 * sentence, rather than as a find.
 *
 * ── Nothing here writes, and nothing here scores ─────────────────────────
 *
 * This is a reader and a policy in one file because both are small, but the
 * split is the same one `forwardDemand.pure.ts` makes: the parse functions
 * answer *what the catalogue said*, and `assessVolumeCoverage` answers
 * *what this deployment may state*. No `EvidencePoint` is constructed, no
 * row shape is emitted, and no table is named — loading is a separate step
 * that needs a register write, and this probe is what decides whether one is
 * worth asking for.
 *
 * Deno-compatible: one type-only import.
 */

import type { SalesRegisterState } from './salesRegister.pure.ts';

/** The four this module exists for. `AU` and the five scored states are out of scope. */
export type VolumeGapState = 'ACT' | 'NT' | 'TAS' | 'WA';

export const VOLUME_GAP_STATES: readonly VolumeGapState[] = ['ACT', 'NT', 'TAS', 'WA'];

/**
 * The states that already score, and why naming them here matters.
 *
 * A probe that only knows about the four it is looking at cannot tell you it
 * is looking at the right four. This list is asserted against the loaders by
 * spec, so a jurisdiction that silently loses its counts — the fault
 * `market-sales-ingest` committed when it wrote `sales_count: null` into
 * `ON CONFLICT DO UPDATE SET` on every daily run — shows up as a
 * contradiction rather than as a quiet regression.
 */
export const VOLUME_SCORED_STATES: readonly SalesRegisterState[] = ['NSW', 'QLD', 'SA', 'VIC'];

/**
 * The fewest counted periods a demand reading needs.
 *
 * Imported rather than retyped would be better, and is not possible: this
 * module must parse under Deno with no dependency on the scoring engine, and
 * `demandScoring.pure.ts` pulls in the whole evidence vocabulary. So the
 * number is stated once here and a spec asserts it equals
 * `VOLUME_BASELINE_PERIODS + 1` — the `AML_COMMAND_REFRESH_EVENT` rule: a
 * literal at each end is how two ends drift, so where one literal cannot be
 * avoided, a test holds the pair together.
 */
export const VOLUME_PERIODS_REQUIRED = 4;

// ---------------------------------------------------------------------------
// Where to ask
// ---------------------------------------------------------------------------

/**
 * A catalogue worth asking, per jurisdiction.
 *
 * Two per state, deliberately, and they fail differently — W3.4's rule paid
 * again. The jurisdiction's OWN catalogue is the authority on what it
 * publishes; `data.gov.au` HARVESTS the state catalogues and is the one this
 * repository has already measured working from CI
 * (`national-pipeline-liveness`). An absence needs both to answer AND to
 * agree, because a single truncated or unreachable question reads exactly
 * like an empty world — which this programme has now demonstrated twice.
 *
 * Every entry is a CKAN **API root**, never a dataset id and never a
 * resource id. What gets read is the publisher's own index.
 */
export interface VolumeCatalogue {
  state: VolumeGapState | 'AU';
  /** The publisher of the CATALOGUE, in a reader's words. */
  publisher: string;
  /** CKAN 3 API root, no trailing slash. */
  api: string;
  /**
   * `own` — the jurisdiction's own catalogue.
   * `harvest` — a catalogue that indexes other publishers' datasets.
   *
   * The distinction decides what an absence MEANS: nothing in a harvest is
   * a statement about the jurisdiction, only about the harvest.
   */
  kind: 'own' | 'harvest';
}

/*
 * ── What the first live run measured, 22 Sep 2026, from CI ───────────────
 *
 *   WA   catalogue.data.wa.gov.au   200 · 434 declared for "property sales",
 *                                   201 datasets examined, **0 carrying a
 *                                   count**
 *   NT   data.nt.gov.au             200 · **0 declared for all five
 *                                   queries** — an answer that is
 *                                   indistinguishable from a wrong endpoint
 *   TAS  data.tas.gov.au            DNS does not resolve
 *   ACT  www.data.act.gov.au/api/3  404 `{"code":"not_found","message":"No
 *                                   service found for this URL."}` — the ACT
 *                                   portal is Socrata, not CKAN 3
 *
 * The ACT and TAS roots are kept, wrong, and PRINTED as ours rather than
 * silently replaced with another guess. That is W3.4's rule: a candidate's
 * failure is the output this probe exists to produce, and the ACT's 404 body
 * is the specific evidence that its portal speaks a different API — which is
 * what the next increment needs in order to reach it.
 */
export const VOLUME_CATALOGUES: readonly VolumeCatalogue[] = [
  { state: 'WA', publisher: 'Government of Western Australia', api: 'https://catalogue.data.wa.gov.au/api/3', kind: 'own' },
  { state: 'NT', publisher: 'Northern Territory Government', api: 'https://data.nt.gov.au/api/3', kind: 'own' },
  { state: 'TAS', publisher: 'Tasmanian Government', api: 'https://data.tas.gov.au/api/3', kind: 'own' },
  { state: 'ACT', publisher: 'ACT Government', api: 'https://www.data.act.gov.au/api/3', kind: 'own' },
  // The one this repository has already measured answering from CI.
  { state: 'AU', publisher: 'Australian Government (data.gov.au)', api: 'https://data.gov.au/data/api/3', kind: 'harvest' },
];

/** Search a catalogue. `rows` bounded; `start` pages. */
export function volumeSearchUrl(api: string, query: string, rows = 50, start = 0): string {
  const p = new URLSearchParams({
    q: query,
    rows: String(Math.max(1, Math.min(200, rows))),
    start: String(Math.max(0, start)),
  });
  return `${api.replace(/\/+$/, '')}/action/package_search?${p}`;
}

/**
 * The queries, and why free text is used here where W3.2 refused it.
 *
 * W3.2's lesson is that a relevance query is not a FILTER — reading "no
 * match" off a ranked list establishes nothing. That lesson applies to
 * proving an ABSENCE, and this probe's absence is handled the same way:
 * corroborated across two catalogues that fail differently, and never read
 * from one ranked page.
 *
 * What free text is legitimate for is the opposite direction — finding a
 * CANDIDATE. There is no organisation slug to filter on here, because the
 * publisher of a sales series is a valuer-general or a revenue office whose
 * slug nobody here can verify, and typing one would fail exactly like an
 * absent one. So these queries look for candidates and every survivor is
 * then judged on the publisher's own words.
 */
export const VOLUME_QUERIES: readonly string[] = [
  'property sales',
  'residential sales',
  'median house price sales',
  'property transfers',
  'land sales',
];

// ---------------------------------------------------------------------------
// What the catalogue said
// ---------------------------------------------------------------------------

export interface VolumeResource {
  id: string;
  name: string;
  /** The publisher's own format word, upper-cased. Never inferred from the URL. */
  format: string;
  url: string;
  datastoreActive: boolean;
  size: number | null;
}

export interface VolumeDataset {
  id: string;
  name: string;
  title: string;
  /** What the publisher wrote about it. Judged, never re-worded. */
  notes: string | null;
  organisation: string | null;
  licence: string | null;
  metadataModified: string | null;
  resources: VolumeResource[];
}

export type VolumeCatalogueParse =
  | { kind: 'catalogue'; total: number; datasets: VolumeDataset[] }
  | { kind: 'refused'; reason: string };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Read a CKAN `package_search` answer.
 *
 * A refusal carries the byte count and the first 220 bytes verbatim, which
 * is load-bearing rather than decorative: the ABS structure parser read no
 * dimension out of 3,193,984 real bytes and reported it as an empty
 * document, because it had been handed XML under an unexpected namespace
 * prefix. **A parser that cannot say what it received cannot be debugged
 * from a CI log.**
 */
export function parseVolumeCatalogue(text: string): VolumeCatalogueParse {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (err) {
    return {
      kind: 'refused',
      reason: `not JSON (${text.length} bytes, ${String(err)}): ${JSON.stringify(text.slice(0, 220))}`,
    };
  }
  const envelope = body as { success?: unknown; result?: unknown; error?: unknown };
  if (envelope.success === false) {
    return { kind: 'refused', reason: `the catalogue refused: ${JSON.stringify(envelope.error ?? null)}` };
  }
  const result = envelope.result as { count?: unknown; results?: unknown } | undefined;
  if (!result || !Array.isArray(result.results)) {
    return {
      kind: 'refused',
      reason: `no result.results array (${text.length} bytes): ${JSON.stringify(text.slice(0, 220))}`,
    };
  }
  const datasets: VolumeDataset[] = [];
  for (const raw of result.results as unknown[]) {
    const d = raw as Record<string, unknown>;
    const id = str(d.id);
    const name = str(d.name);
    if (!id || !name) continue;
    const org = d.organization as Record<string, unknown> | undefined;
    const resources: VolumeResource[] = [];
    for (const rawRes of Array.isArray(d.resources) ? (d.resources as unknown[]) : []) {
      const r = rawRes as Record<string, unknown>;
      const rid = str(r.id);
      const url = str(r.url);
      if (!rid || !url) continue;
      resources.push({
        id: rid,
        name: str(r.name) ?? rid,
        format: (str(r.format) ?? '').toUpperCase(),
        url,
        datastoreActive: r.datastore_active === true,
        size: num(r.size),
      });
    }
    datasets.push({
      id,
      name,
      title: str(d.title) ?? name,
      notes: str(d.notes),
      organisation: str(org?.title) ?? str(org?.name),
      licence: str(d.license_title) ?? str(d.license_id),
      metadataModified: str(d.metadata_modified),
      resources,
    });
  }
  return { kind: 'catalogue', total: num(result.count) ?? datasets.length, datasets };
}

// ---------------------------------------------------------------------------
// Judging a candidate: the count, the grain, the format
// ---------------------------------------------------------------------------

/**
 * A count of transactions, named by the publisher.
 *
 * Deliberately narrow, and the narrowness is the point. `medianPrice` is
 * already held for all four states, so a dataset that mentions "sales" and
 * publishes only prices closes nothing — and would look like a fix.
 *
 * `number of sales`, `sales volume`, `transaction count`, `sales count`,
 * `no. of sales`, `dwellings sold`, `properties sold`, `transfers` with a
 * count word. Not `median`, not `price`, not `value`.
 */
export const COUNT_PATTERN =
  /\b(?:number\s+of\s+(?:sales|transactions|transfers|properties|dwellings)|no\.?\s+of\s+sales|sales?\s+(?:volume|count|numbers?)|transaction\s+(?:count|volume|numbers?)|(?:properties|dwellings|houses|units)\s+sold|volume\s+of\s+(?:sales|transfers))\b/i;

/** A median or a price, which these states already have. */
export const MEDIAN_PATTERN = /\b(?:median|mean|average)\s+(?:sale\s+)?(?:price|value)|\bprice\s+(?:index|quartiles?)\b/i;

/**
 * An area finer than the state, named by the publisher.
 *
 * `absResDwell` already answers the state, so a state-only series adds
 * nothing to what these four already hold — which is exactly why
 * `state_grain_only` is a distinct reading rather than a find.
 */
export const SUB_STATE_PATTERN =
  /\b(?:suburb|locality|localities|postcode|post\s?code|local\s+government|LGA|SA2|SA3|statistical\s+area|region(?:al|s)?|district|council)\b/i;

export const MACHINE_READABLE_FORMATS: readonly string[] = ['CSV', 'XLSX', 'XLS', 'JSON', 'GEOJSON'];
export const DOCUMENT_FORMATS: readonly string[] = ['PDF', 'DOC', 'DOCX', 'HTML', 'ZIP'];

/** What a candidate dataset is, on the publisher's own words. */
export interface VolumeCandidate {
  dataset: VolumeDataset;
  /** Does the publisher say it carries a COUNT? */
  count: boolean;
  /** Does it name an area finer than the state? */
  subState: boolean;
  /** Does it name a median or price? (Held already — not a find on its own.) */
  median: boolean;
  /** The best machine-readable resource, where there is one. */
  machineReadable: VolumeResource | null;
  /** Formats offered, so "published, but not as a feed" is a sayable sentence. */
  formats: string[];
}

/**
 * Judge one dataset by what its publisher wrote.
 *
 * Title AND notes, because a title alone is a headline: WA's
 * "Property Sales" tells you nothing about whether a count is inside it,
 * and the notes are where a publisher lists its columns.
 */
export function judgeVolumeDataset(dataset: VolumeDataset): VolumeCandidate {
  const words = [dataset.title, dataset.notes, ...dataset.resources.map((r) => r.name)]
    .filter((w): w is string => typeof w === 'string' && w !== '')
    .join(' · ');
  const formats = [...new Set(dataset.resources.map((r) => r.format).filter((f) => f !== ''))];
  const machine = dataset.resources
    .filter((r) => MACHINE_READABLE_FORMATS.includes(r.format))
    // A queryable resource outranks a download — `nationalPipeline`'s rule.
    .sort((a, b) => Number(b.datastoreActive) - Number(a.datastoreActive))[0] ?? null;
  return {
    dataset,
    count: COUNT_PATTERN.test(words),
    subState: SUB_STATE_PATTERN.test(words),
    median: MEDIAN_PATTERN.test(words),
    machineReadable: machine,
    formats,
  };
}

/**
 * Rank the candidates that could close the gap.
 *
 * A candidate qualifies only on a COUNT. Sorting puts sub-state grain and a
 * machine-readable resource above their absences, so the probe's first line
 * is the best thing the publisher has rather than the first thing it listed.
 */
export function rankVolumeCandidates(datasets: readonly VolumeDataset[]): VolumeCandidate[] {
  return datasets
    .map(judgeVolumeDataset)
    .filter((c) => c.count)
    .sort((a, b) =>
      Number(b.subState) - Number(a.subState)
      || Number(b.machineReadable !== null) - Number(a.machineReadable !== null)
      || Number(b.machineReadable?.datastoreActive ?? false) - Number(a.machineReadable?.datastoreActive ?? false));
}

/**
 * Who published a dataset, and whether that is this jurisdiction.
 *
 * ── The defect this exists to close, measured on its own first run ───────
 *
 * The first live run read **`countable` for the Northern Territory over
 * "datasets examined 0"**, and the sentence it composed named *"Guide to
 * Property Values, from **Department of Energy, Environment and Climate
 * Action**"* — which is a VICTORIAN department. Western Australia read
 * `countable` the same way over 201 datasets of which 0 carried a count, and
 * named the same Victorian dataset.
 *
 * The cause: `mergeVolumeReads` folded the HARVEST catalogue's datasets into
 * the jurisdiction's own and the assessment then ranked whatever it found.
 * A harvest indexes every publisher in the country, so a hit inside it is a
 * statement about the harvest and not about the jurisdiction — which this
 * module's own header said in those words while the code did the opposite.
 *
 * The log is what made it visible, and only because it prints both numbers:
 * the counts came from the jurisdiction's own read and the verdict came from
 * the merged one, so the output contradicted itself on the same screen.
 * *A load is judged by its effect* — the fourth time in this programme.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * **A candidate must be attributable to the jurisdiction it is offered for.**
 * Discarding the harvest entirely would be wrong the other way: `data.gov.au`
 * genuinely harvests the states, and for ACT and TAS — whose own API roots
 * this repository does not have right — it is the only route that answers.
 * What makes a harvest hit usable is that the dataset names its publisher,
 * so attribution is checkable rather than assumed.
 *
 * Judged on the ORGANISATION alone, never on the title or the notes. A
 * dataset called "Property sales, Northern Territory" published by a
 * Victorian department is a Victorian dataset about the Territory at best,
 * and the conservative reading of an unattributable dataset is that it is
 * not this jurisdiction's.
 */
const JURISDICTION_NAMES: Readonly<Record<VolumeGapState, readonly string[]>> = {
  ACT: ['australian capital territory', 'act government', 'act revenue', 'canberra'],
  NT: ['northern territory', 'nt government'],
  TAS: ['tasmania', 'tasmanian'],
  WA: ['western australia', 'westralia'],
};

/**
 * Is this dataset attributable to this jurisdiction?
 *
 * An `own` catalogue needs no attribution — everything in it is that
 * jurisdiction's by construction, which is what makes it the authority.
 * A harvest hit needs its publisher to name the jurisdiction.
 */
export function attributableTo(
  dataset: VolumeDataset,
  state: VolumeGapState,
  source: VolumeCatalogue['kind'],
): boolean {
  if (source === 'own') return true;
  const org = (dataset.organisation ?? '').toLowerCase();
  if (org === '') return false;
  /*
   * The bare abbreviation is deliberately NOT accepted from a harvest. "ACT"
   * appears inside "Climate Action", which is the very organisation name that
   * produced this defect, and "WA" inside dozens of ordinary words. A
   * jurisdiction that cannot be named in full by its own publisher is one
   * this reader declines to attribute.
   */
  return JURISDICTION_NAMES[state].some((n) => org.includes(n));
}

/**
 * How many datasets a catalogue holds AT ALL.
 *
 * A search with no `q` and `rows=0` — CKAN answers its whole index's count
 * and no rows, which is the cheapest question it takes.
 */
export function volumeInventoryUrl(api: string): string {
  return `${api.replace(/\/+$/, '')}/action/package_search?rows=0`;
}

/**
 * Has a catalogue actually answered the question, or is it the wrong endpoint?
 *
 * ── The two cases `200 · 0 declared` conflates ───────────────────────────
 *
 * Measured on the first run, `data.nt.gov.au/api/3` answered `200 · 0
 * declared` to all five queries. Read as an absence that says the Territory
 * publishes no sales count; read as a fault it says nothing at all. Both are
 * possible and the QUERIES cannot tell them apart:
 *
 *   · a real, populated catalogue that holds nothing matching, or
 *   · an endpoint that is not this jurisdiction's index.
 *
 * The first version refused to choose and called both `catalogue_unavailable`
 * — the conservative side, and a reading that answers nothing. The
 * distinction is one question away, and it is the rule this programme has
 * already paid for twice: **corroborate from a second endpoint that fails
 * differently.** Here the second endpoint is the SAME catalogue asked how
 * big it is. A catalogue that says it holds 3,000 datasets and matches none
 * of five sales phrasings has answered; one that says it holds none, or
 * cannot say, has not.
 *
 * `inventory` is the whole-index count where the catalogue stated one.
 */
export interface CatalogueReach {
  /** Datasets the catalogue says it holds in total, or null where it did not say. */
  inventory: number | null;
  /** Datasets matched by the sales queries. */
  matched: number;
}

export type CatalogueVerdict =
  /** It answered: it is populated, and the matches are a real measurement. */
  | { kind: 'answered'; inventory: number; matched: number }
  /** It is populated and matched nothing. Still an answer — a real absence. */
  | { kind: 'answered_empty_handed'; inventory: number }
  /** It could not say how big it is, or says it is empty. Not this index. */
  | { kind: 'not_this_index'; detail: string };

export function judgeCatalogueReach(parse: VolumeCatalogueParse, reach: CatalogueReach): CatalogueVerdict {
  if (parse.kind === 'refused') return { kind: 'not_this_index', detail: parse.reason };
  if (reach.inventory === null) {
    return { kind: 'not_this_index', detail: 'the catalogue did not state how many datasets it holds' };
  }
  if (reach.inventory <= 0) {
    return { kind: 'not_this_index', detail: 'the catalogue states it holds no datasets at all' };
  }
  return reach.matched > 0
    ? { kind: 'answered', inventory: reach.inventory, matched: reach.matched }
    : { kind: 'answered_empty_handed', inventory: reach.inventory };
}

/**
 * Did this catalogue answer, either way?
 *
 * Both `answered` and `answered_empty_handed` count — an absence from a
 * populated index IS an answer, and treating it as a failure is what made
 * the first version silent about the one jurisdiction it had actually
 * measured.
 */
export function catalogueAnswered(verdict: CatalogueVerdict): boolean {
  return verdict.kind !== 'not_this_index';
}

/** Merge several catalogue reads. A refusal anywhere is carried, never smoothed. */
export function mergeVolumeReads(parses: readonly VolumeCatalogueParse[]): VolumeCatalogueParse {
  const refusals = parses.filter((p): p is Extract<VolumeCatalogueParse, { kind: 'refused' }> => p.kind === 'refused');
  const ok = parses.filter((p): p is Extract<VolumeCatalogueParse, { kind: 'catalogue' }> => p.kind === 'catalogue');
  if (ok.length === 0) {
    return { kind: 'refused', reason: refusals.map((r) => r.reason).join(' | ') || 'nothing was asked' };
  }
  const seen = new Set<string>();
  const datasets: VolumeDataset[] = [];
  for (const p of ok) {
    for (const d of p.datasets) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      datasets.push(d);
    }
  }
  return { kind: 'catalogue', total: Math.max(...ok.map((p) => p.total)), datasets };
}

// ---------------------------------------------------------------------------
// What this deployment may state
// ---------------------------------------------------------------------------

/**
 * Five readings, five sentences.
 *
 * `medians_only` and `state_grain_only` exist because they are the two ways
 * this probe could be read as a success when it is not: these four
 * jurisdictions ALREADY hold a state-grain price from `absResDwell`, so a
 * find that is either of those closes nothing and must not be filed as a
 * candidate. `SUPPLY_EVIDENCE.md`'s rule — four absences are four different
 * sentences — with the two near-misses named rather than collapsed.
 */
export type VolumeCoverage =
  /** A count series, sub-state, machine-readable. The gap can be closed. */
  | { kind: 'countable'; title: string; publisher: string; resourceId: string; format: string; licence: string | null }
  /** A count series, but only at state grain — which is already held. */
  | { kind: 'state_grain_only'; title: string; publisher: string }
  /** A count series published as documents rather than as a feed. */
  | { kind: 'published_as_documents'; title: string; publisher: string; formats: string[] }
  /**
   * Sales data exists and carries no count. Not a find.
   *
   * `searched` is how many datasets MATCHED a sales query and `inventory` is
   * how big the index is. Both, because the first version carried only the
   * count that survived attribution and the Northern Territory's sentence
   * then read *"0 datasets examined"* — which describes a five-query search
   * of a populated catalogue as looking at nothing. An absence is only
   * believable beside the size of the question that found it, which is the
   * rule the sanctions register and the PEP index both answer to.
   */
  | { kind: 'medians_only'; searched: number; inventory: number | null; route?: VolumeRoute }
  /** The catalogues answered and hold no count series. */
  | { kind: 'no_count_published'; searched: number; inventory: number | null; route?: VolumeRoute }
  /** A catalogue could not be read. Says nothing about the jurisdiction. */
  | { kind: 'catalogue_unavailable'; reason: string };

/**
 * How an absence was established, where it matters to the sentence.
 *
 * `harvest_enumeration` is the route a jurisdiction with no catalogue of its
 * own is read by: every dataset its own publishers list in the Commonwealth
 * catalogue, enumerated publisher by publisher and read in full, beside the
 * relevance search of the same index — two questions that fail differently.
 * Absent, the route is the ordinary one (its own catalogue and the harvest),
 * and the sentence is unchanged.
 */
export type VolumeRoute = 'harvest_enumeration';

/**
 * Decide, from corroborated reads.
 *
 * `corroborated` is the caller's job to establish and this function's job to
 * require: an absence (`no_count_published` / `medians_only`) is returned
 * only where it is true, because a single catalogue's silence is a statement
 * about that catalogue. An unreadable catalogue therefore outranks every
 * absence below it.
 */
export function assessVolumeCoverage(
  parse: VolumeCatalogueParse,
  corroborated: boolean,
  /**
   * How big the jurisdiction's own index is, where it said. Carried into an
   * absence so the sentence can state the size of the question rather than
   * only what survived it.
   */
  inventory: number | null = null,
  /** How the reads were taken, where it is not the ordinary route. */
  route?: VolumeRoute,
): VolumeCoverage {
  /*
   * ── Corroboration gates an ABSENCE, not a FIND ──────────────────────────
   *
   * The first version required corroboration before it would rank anything,
   * and Tasmania then read `catalogue_unavailable` while the Commonwealth
   * catalogue held **one** dataset attributed to Tasmania — a dataset that
   * had answered, from an index that had answered, discarded because a
   * SECOND index had not.
   *
   * The two directions are not symmetric, and conflating them is a different
   * error each way:
   *
   *  - **An absence needs two endpoints that agree.** One catalogue's
   *    silence is a statement about that catalogue — W3.2's fault, paid for
   *    twice there.
   *  - **A find needs one endpoint that answered.** A dataset that exists,
   *    is attributed to this jurisdiction and says it carries a count is a
   *    find whatever a second index says; requiring a second witness to a
   *    thing you are holding is not conservatism, it is discarding evidence.
   *
   * So the ranking happens first and the corroboration requirement applies
   * only where it produced nothing.
   */
  if (parse.kind === 'refused') return { kind: 'catalogue_unavailable', reason: parse.reason };
  /*
   * Every dataset reaching here is already attributed to this jurisdiction by
   * the caller (`attributableTo`). That filtering is deliberately NOT done
   * inside this function: it needs to know WHICH catalogue each dataset came
   * from, and a parse does not carry that — so passing an unattributed parse
   * would silently reintroduce the Victorian-department defect. The spec
   * asserts the call site filters.
   */
  const ranked = rankVolumeCandidates(parse.datasets);
  if (!corroborated && ranked.length === 0) {
    return {
      kind: 'catalogue_unavailable',
      reason: 'only one catalogue answered, and one catalogue’s silence is a statement about that catalogue',
    };
  }
  const best = ranked[0];
  if (best && best.subState && best.machineReadable) {
    return {
      kind: 'countable',
      title: best.dataset.title,
      publisher: best.dataset.organisation ?? 'the catalogue states no publisher',
      resourceId: best.machineReadable.id,
      format: best.machineReadable.format,
      licence: best.dataset.licence,
    };
  }
  if (best && best.subState) {
    return {
      kind: 'published_as_documents',
      title: best.dataset.title,
      publisher: best.dataset.organisation ?? 'the catalogue states no publisher',
      formats: best.formats.length > 0 ? best.formats : ['the catalogue states no format'],
    };
  }
  if (best) {
    return {
      kind: 'state_grain_only',
      title: best.dataset.title,
      publisher: best.dataset.organisation ?? 'the catalogue states no publisher',
    };
  }
  const anyMedian = parse.datasets.some((d) => judgeVolumeDataset(d).median);
  const kind = anyMedian ? 'medians_only' as const : 'no_count_published' as const;
  return route ? { kind, searched: parse.total, inventory, route } : { kind, searched: parse.total, inventory };
}

/**
 * What a report may say about a jurisdiction whose demand cannot be scored.
 *
 * Every sentence is about the REGISTER and never about the market — the rule
 * §9 of `PLANNING_CONTROLS_IN_THE_REPORT.md` states and this programme has
 * now paid for four times. None of them rates anything, and none of them
 * says an area has few sales: a count nobody publishes is not a count of
 * zero, which is `rentalEvidence`'s *absent is never zero* applied to a
 * register rather than to a field.
 */
/** `state` for a state, `territory` for a territory. Printing one as the other reads as carelessness. */
function grainWord(state: VolumeGapState): string {
  return state === 'ACT' || state === 'NT' ? 'territory' : 'state';
}

/**
 * The size of the question, in a reader's words.
 *
 * Never a bare "0 datasets examined". Where the catalogue stated its own
 * size, both numbers are given — an absence found by searching 434 of 2,911
 * datasets means something a bare zero does not.
 */
function searchScale(searched: number, inventory: number | null): string {
  const matched = `${searched.toLocaleString('en-AU')} dataset${searched === 1 ? '' : 's'} `
    + 'matched a sales query';
  return inventory === null || inventory <= 0
    ? matched
    : `${matched} out of a published index of ${inventory.toLocaleString('en-AU')}`;
}

/** The size of an enumerated question: every dataset a jurisdiction's own publishers list. */
function enumerationScale(saleNaming: number, inventory: number | null): string {
  const named = `${saleNaming.toLocaleString('en-AU')} name${saleNaming === 1 ? 's' : ''} a sale`;
  return inventory === null || inventory <= 0
    ? `${named} among the datasets its own publishers list in the Commonwealth catalogue`
    : `of the ${inventory.toLocaleString('en-AU')} datasets its own publishers list in the `
      + `Commonwealth catalogue, read in full, ${named}`;
}

/** Why the Commonwealth catalogue is the index for this jurisdiction. */
function noOwnCatalogue(state: VolumeGapState): string {
  return `${state} runs no open-data catalogue of its own, so that list is where its published `
    + 'data is indexed.';
}

export function volumeCoverageNote(coverage: VolumeCoverage, state: VolumeGapState): string {
  switch (coverage.kind) {
    case 'countable':
      return `${state} publishes a count of residential sales below state level — `
        + `${coverage.title}, from ${coverage.publisher}, as ${coverage.format}`
        + `${coverage.licence ? ` under ${coverage.licence}` : ''}. It is not loaded into this `
        + 'deployment yet, so no transaction-volume reading is available here; that is outstanding '
        + 'work rather than a limitation of the source.';
    case 'state_grain_only':
      return `${state}'s published count of residential sales (${coverage.title}, `
        + `${coverage.publisher}) describes the whole ${state === 'ACT' || state === 'NT' ? 'territory' : 'state'} `
        + 'and no smaller area, so it cannot describe this property’s market. No transaction-volume '
        + 'reading is available here.';
    case 'published_as_documents':
      return `${state}'s count of residential sales is published as `
        + `${coverage.formats.join(', ')} rather than as a data feed (${coverage.title}, `
        + `${coverage.publisher}), so nothing from it is read here. That is a statement about the `
        + 'form it is published in, not about the market.';
    case 'medians_only':
      if (coverage.route === 'harvest_enumeration') {
        return `${state}'s published sales data states prices and not counts — `
          + `${enumerationScale(coverage.searched, coverage.inventory)}, and none carries a number `
          + `of sales. ${noOwnCatalogue(state)} This report therefore states no transaction-volume `
          + 'reading for this area, which is a limit of what is published rather than a measurement.';
      }
      return `${state}'s published sales data states prices and not counts — `
        + `${searchScale(coverage.searched, coverage.inventory)} and none carries a number of `
        + 'sales. This report therefore states no transaction-volume reading for this area, which '
        + 'is a limit of what is published rather than a measurement.';
    case 'no_count_published':
      if (coverage.route === 'harvest_enumeration') {
        return `No count of residential sales below ${grainWord(state)} level was found published `
          + `for ${state} — ${enumerationScale(coverage.searched, coverage.inventory)}, and none `
          + `carries a number of sales. ${noOwnCatalogue(state)} This report states no `
          + 'transaction-volume reading for this area.';
      }
      return `No count of residential sales below ${grainWord(state)} level was found published `
        + `for ${state} — ${searchScale(coverage.searched, coverage.inventory)} across its own `
        + 'catalogue and the Commonwealth catalogue, and none carries a number of sales. This '
        + 'report states no transaction-volume reading for this area.';
    case 'catalogue_unavailable':
      return `Whether ${state} publishes a count of residential sales could not be established for `
        + 'this report, so no transaction-volume reading is stated. That is a statement about the '
        + 'retrieval rather than about the market.';
  }
}

// ---------------------------------------------------------------------------
// How each jurisdiction's counts arrive — and what a remedy may therefore say
// ---------------------------------------------------------------------------

/**
 * How a transaction count reaches the register, per jurisdiction.
 *
 * Read from the loaders on 22 Sep 2026 rather than remembered, and asserted
 * against them by spec, because the demand remedy a client's report prints
 * was already wrong about two of them. It said *"NSW and QLD carry one on
 * every row, VIC and SA one per load"*, and:
 *
 *  - **South Australia's sheet names exactly TWO periods** — the quarter and
 *    its year-earlier comparison — and `parseSaLsgStats` looks its count
 *    column up PER PERIOD, so one load yields two counted periods rather
 *    than one. (Checked by reading it: the `salesCol` lookup is inside the
 *    period loop, so the two periods do not share a figure. A shared figure
 *    would have been worse than a null — four identical counts make
 *    `scoreTransactionVolume`'s ratio exactly 1.0 and print *"in line with
 *    the 3-period average"* off one quarter's data.)
 *  - **Victoria's four counted periods are recovered**, from the archived
 *    per-quarter workbooks, by `vicVolumeBackfill.pure.ts` — so describing
 *    it as one-per-load names a gap that was closed on 21 Sep.
 *
 * The distinction the remedy could not draw at all is the one that matters
 * most to a reader in the other four: `accumulates` is a register that will
 * answer once enough loads have run, and `unwired` is one with no count
 * publisher reaching this deployment in any form. Telling an operator to run
 * more loads where no loader exists is a remedy that cannot discharge its
 * reason — `refreshRemedy`'s rule.
 */
export type CountArrival =
  /** Every published period carries its own count. Scores on one load. */
  | 'every_period'
  /** A load carries some periods' counts; enough loads reach four. */
  | 'accumulates'
  /** The counts exist and are recovered from an archive by a backfill. */
  | 'backfilled'
  /** No count publisher reaches this deployment. Only a price, at state grain. */
  | 'unwired';

export const VOLUME_COUNT_SOURCE: Readonly<Record<SalesRegisterState, CountArrival>> = {
  NSW: 'every_period',
  QLD: 'every_period',
  SA: 'accumulates',
  VIC: 'backfilled',
  WA: 'unwired',
  TAS: 'unwired',
  NT: 'unwired',
  ACT: 'unwired',
  // The national series is the ABS mean price and carries no count at all.
  AU: 'unwired',
};

/**
 * The demand remedy's jurisdiction clause.
 *
 * Composed rather than typed, so the sentence a client's report prints cannot
 * disagree with `VOLUME_COUNT_SOURCE` — and that record cannot disagree with
 * the loaders, because a spec reads them. Two copies of "which states carry a
 * count" is how the first version came to understate two of them.
 *
 * `null` where the state is unknown: a remedy that names a jurisdiction it
 * cannot establish is worse than a general one, and the generic sentence
 * beside this already says what a primary measure is.
 */
export function volumeRemedyClause(state: string | null | undefined): string | null {
  if (typeof state !== 'string') return null;
  const key = state.trim().toUpperCase() as SalesRegisterState;
  const arrival = VOLUME_COUNT_SOURCE[key];
  if (!arrival || key === 'AU') return null;
  switch (arrival) {
    case 'every_period':
      return `${key}'s open sales register carries a count with every period it publishes, so a `
        + 'completed load of it measures this dimension.';
    case 'accumulates':
      return `${key}'s open sales register publishes two counted quarters per release, so four `
        + 'periods accumulate over successive loads rather than arriving in one.';
    case 'backfilled':
      return `${key}'s register publishes one counted quarter per workbook and the earlier `
        + 'quarters are recovered from the archived releases, so the four periods come from a '
        + 'completed backfill rather than from the latest file.';
    case 'unwired':
      return `No transaction-count publisher is wired for ${key} — its only sales reading here is `
        + 'a price at whole-of-jurisdiction grain, which cannot measure this. More loads of what '
        + 'is already wired cannot close it; a register has to be identified and read first.';
  }
}


// ---------------------------------------------------------------------------
// What the publishers answered — measured, and read by the report
// ---------------------------------------------------------------------------

/**
 * The readings, measured from CI — WA, the NT and the ACT on 22 September
 * 2026, Tasmania on 23 September, when the same run re-measured the other
 * three and every one of their readings held.
 *
 * A constant and not a live lookup, for `amenity_register`'s reason and
 * `nationalPipeline`'s: a per-report round trip would spend a request to
 * learn a fact that changes on the scale of months, and the probe in
 * `scripts/market/sales-volume-liveness.ts` is the instrument that flips it.
 *
 *   WA   `medians_only`          index of **2,911**, 203 matched a sales
 *                                query, and **none carries a count of
 *                                sales** — corroborated
 *   NT   `no_count_published`    index of **1,075**, none of the five
 *                                phrasings matched — corroborated
 *   ACT  `no_count_published`    index of **378** read through SOCRATA,
 *                                none of the five matched — corroborated
 *   TAS  `no_count_published`    no catalogue of its own: **982** datasets,
 *                                every one its 14 government publishers list
 *                                in the Commonwealth catalogue, read in full;
 *                                5 name a sale and none carries a count —
 *                                corroborated by the search of the same index
 *
 * All four are therefore a real limit of what is published. That took two
 * instruments, and the distinction they kept is the point: a reader is told
 * *"no count is published"* only where that was established, and *"this
 * could not be established"* where the failure is ours — which is what
 * Tasmania read, correctly, until the probe could find where it publishes.
 *
 * ── The ACT's reading changed when the instrument did ────────────────────
 *
 * It read `catalogue_unavailable` for one revision, and that was correct for
 * the probe as it stood: its CKAN root 404'd. Adding the **Socrata** reader
 * — which that 404's own body is what bought — moved it to
 * `no_count_published` over an index of 378. Tasmania was re-measured by the
 * same run and did not move, because its host still does not resolve.
 *
 * ── Tasmania's reading changed when the instrument did, too ─────────────
 *
 * `data.tas.gov.au` answers ENOTFOUND. The fix was never a second typed
 * host: the harvest's own records name Tasmania's publishers and the hosts
 * their files are served from, and none of those eight hosts answers as a
 * searchable catalogue (two are map-layer directories, and neither names a
 * sales layer). So the Commonwealth catalogue IS Tasmania's index, and the
 * reading is taken from everything its government lists there rather than
 * from a relevance search — `harvest_enumeration`, whose sentence says so.
 *
 * That is why `VOLUME_READING_IS_CURRENT` exists: a reading stored against
 * an instrument that has since been replaced is the *asserted by
 * configuration rather than by effect* trap the retention purge and the
 * verification self-test both answer to, and it is the kind of staleness
 * nobody notices because the constant still reads plausibly. All four
 * entries are current as of the 23 Sep run; the flag is kept so the next
 * instrument change has somewhere to be declared.
 *
 * 23 Sep's first WA count was 204 against 22 Sep's 203, and it was first
 * written up here as a relevance search drifting by a dataset. It was not.
 * The corrected instrument (`attributedRead`) printed *"203 distinct — 1
 * found only by harvest search, 1 it also returned from WA's own list"*: the
 * 204th was ONE dataset counted twice, once from each route, which is the
 * same fault Tasmania's six-against-five exposed. The count is 203, the
 * reading did not move, and a re-measurement confirmed it by effect rather
 * than by the explanation first offered for it.
 */
export const MEASURED_VOLUME_COVERAGE: Readonly<Record<VolumeGapState, VolumeCoverage>> = {
  /*
   * `searched` is what the probe REPORTS as matched-and-attributed, not one
   * query's declared total. The first version recorded 434 — the count
   * `property sales` alone declared — while the probe's own sentence said
   * 203. A constant recording a measurement must record the number the
   * instrument printed.
   */
  WA: { kind: 'medians_only', searched: 203, inventory: 2911 },
  NT: { kind: 'no_count_published', searched: 0, inventory: 1075 },
  ACT: { kind: 'no_count_published', searched: 0, inventory: 378 },
  /*
   * `searched` is the ENUMERATED list's own count — the probe's line
   * `datasets naming a sale  5 of 982`. The run's sentence first said 6,
   * folding in the search's one attributed find; `attributedRead` is why it
   * no longer can.
   */
  TAS: { kind: 'no_count_published', searched: 5, inventory: 982, route: 'harvest_enumeration' },
};

/**
 * The client-facing sentence for a jurisdiction whose demand cannot be scored.
 *
 * `null` for the five jurisdictions this does not describe, so the existing
 * `NOT_ASSESSED_REASON.demand` stands everywhere it already did. A reading
 * that narrows a sentence must never widen the set of pages it appears on.
 */
export function measuredVolumeNote(state: string | null | undefined): string | null {
  if (typeof state !== 'string') return null;
  const key = state.trim().toUpperCase();
  if (!(VOLUME_GAP_STATES as readonly string[]).includes(key)) return null;
  const s = key as VolumeGapState;
  return volumeCoverageNote(MEASURED_VOLUME_COVERAGE[s], s);
}

// ---------------------------------------------------------------------------
// Socrata — because the ACT portal is not CKAN
// ---------------------------------------------------------------------------

/**
 * A second catalogue dialect, added because the measurement named it.
 *
 * The ACT portal answered a CKAN 3 path with
 * `404 {"code":"not_found","error":true,"message":"No service found for this
 * URL."}`. That body is the evidence: it is a JSON API that exists and does
 * not speak CKAN. `www.data.act.gov.au` runs **Socrata**, whose discovery
 * API is a different shape — and the reason the wrong root was kept and
 * printed rather than swapped for another guess is that this is what its
 * 404 bought.
 *
 * Socrata's catalog API is **domain-scoped**, which is a genuine advantage
 * here: `?domains=www.data.act.gov.au` cannot return another jurisdiction's
 * dataset, so the Victorian-department defect cannot recur through this
 * route by construction rather than by a name test. `attributableTo` is
 * still applied, because a guarantee that holds by construction is one worth
 * asserting rather than assuming.
 */
export const SOCRATA_CATALOG = 'https://api.us.socrata.com/api/catalog/v1';

/** One Socrata domain worth asking, per jurisdiction. */
export interface SocrataPortal {
  state: VolumeGapState;
  publisher: string;
  domain: string;
}

export const SOCRATA_PORTALS: readonly SocrataPortal[] = [
  { state: 'ACT', publisher: 'ACT Government (data.act.gov.au)', domain: 'www.data.act.gov.au' },
];

export function socrataSearchUrl(domain: string, query: string, limit = 50): string {
  const p = new URLSearchParams({
    domains: domain,
    q: query,
    limit: String(Math.max(1, Math.min(100, limit))),
    only: 'dataset',
  });
  return `${SOCRATA_CATALOG}?${p}`;
}

/** The domain's whole index size — the same second question CKAN is asked. */
export function socrataInventoryUrl(domain: string): string {
  const p = new URLSearchParams({ domains: domain, limit: '0', only: 'dataset' });
  return `${SOCRATA_CATALOG}?${p}`;
}

/**
 * Read a Socrata catalog answer into the SAME `VolumeDataset` shape.
 *
 * One projection, so `judgeVolumeDataset`, `rankVolumeCandidates`,
 * `attributableTo` and `assessVolumeCoverage` are written once and cannot
 * disagree between dialects. Two readers and one judgement, never two
 * judgements — the rule `buildCasePassportView` exists for.
 *
 * Socrata's envelope is `{resultSetSize, results: [{resource, classification,
 * metadata, permalink}]}`. A resource carries `id`, `name`, `description` and
 * `columns_name`; the publisher is `metadata.domain` or the organisation in
 * `classification.domain_metadata`. There is no per-resource format — a
 * Socrata dataset IS queryable, which is why `datastoreActive` is true and
 * the format is `JSON`: that is the API it serves, not a guess.
 */
export function parseSocrataCatalogue(text: string): VolumeCatalogueParse {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (err) {
    return {
      kind: 'refused',
      reason: `not JSON (${text.length} bytes, ${String(err)}): ${JSON.stringify(text.slice(0, 220))}`,
    };
  }
  if (!body || typeof body !== 'object') {
    return { kind: 'refused', reason: `JSON but not an object (${text.length} bytes)` };
  }
  const env = body as { resultSetSize?: unknown; results?: unknown; error?: unknown; message?: unknown };
  if (env.error !== undefined || (env.message !== undefined && env.results === undefined)) {
    return { kind: 'refused', reason: `the catalogue refused: ${JSON.stringify(env.message ?? env.error)}` };
  }
  if (!Array.isArray(env.results)) {
    return {
      kind: 'refused',
      reason: `no results array (${text.length} bytes): ${JSON.stringify(text.slice(0, 220))}`,
    };
  }
  const datasets: VolumeDataset[] = [];
  for (const raw of env.results as unknown[]) {
    const r = raw as Record<string, unknown>;
    const res = r.resource as Record<string, unknown> | undefined;
    const id = str(res?.id);
    const name = str(res?.name);
    if (!id || !name) continue;
    /*
     * `columns_name` is Socrata's own list of the dataset's COLUMNS, which is
     * exactly what `COUNT_PATTERN` needs to read and what a CKAN `notes`
     * field only sometimes carries. Folded into `notes` so one judgement
     * serves both dialects.
     */
    const columns = Array.isArray(res?.columns_name)
      ? (res.columns_name as unknown[]).map((c) => str(c)).filter((c): c is string => c !== null)
      : [];
    const described = [str(res?.description), columns.join(', ')]
      .filter((d): d is string => d !== null && d !== '')
      .join(' · ');
    const classification = r.classification as Record<string, unknown> | undefined;
    const domainMeta = Array.isArray(classification?.domain_metadata)
      ? (classification.domain_metadata as Array<Record<string, unknown>>)
      : [];
    const org = domainMeta.find((m) => /publisher|agency|organisation|organization/i.test(str(m.key) ?? ''));
    const meta = r.metadata as Record<string, unknown> | undefined;
    const licence = str((r.resource as Record<string, unknown> | undefined)?.license)
      ?? str(classification?.license);
    datasets.push({
      id,
      name,
      title: name,
      notes: described === '' ? null : described,
      organisation: str(org?.value) ?? str(meta?.domain),
      licence,
      metadataModified: str(res?.updatedAt) ?? str(res?.createdAt),
      /*
       * A Socrata dataset is queryable by construction — that is the API it
       * serves. So the resource is the dataset itself, JSON and
       * `datastoreActive`, which is a fact about Socrata rather than an
       * assumption about this row.
       */
      resources: [{
        id,
        name,
        format: 'JSON',
        url: str(r.permalink) ?? `https://${str(meta?.domain) ?? 'socrata'}/d/${id}`,
        datastoreActive: true,
        size: null,
      }],
    });
  }
  const total = num(env.resultSetSize);
  return { kind: 'catalogue', total: total ?? datasets.length, datasets };
}

/**
 * Which measured readings were taken with the CURRENT instrument.
 *
 * All four, as of 23 Sep 2026: the run that added harvest discovery and the
 * enumeration route re-measured every jurisdiction. Tasmania moved from
 * `catalogue_unavailable` to `no_count_published` as a result — the second
 * reading to move when the instrument did, after the ACT's on 22 Sep — and
 * the other three held.
 *
 * Kept although nothing is `false` today, because the point is to have
 * somewhere for the NEXT instrument change to be declared. A reading stored
 * against a replaced instrument is the *asserted by configuration rather
 * than by effect* trap, and it is invisible precisely because the constant
 * still reads plausibly — so the flag is the ratchet, and the spec over it
 * is a ratchet too rather than a live measurement of anything.
 */
export const VOLUME_READING_IS_CURRENT: Readonly<Record<VolumeGapState, boolean>> = {
  WA: true,
  NT: true,
  ACT: true,
  TAS: true,
};

// ---------------------------------------------------------------------------
// Where a jurisdiction actually publishes — read off the harvest, not typed
// ---------------------------------------------------------------------------

/*
 * ── Why Tasmania needs discovery rather than a second guess ──────────────
 *
 * Tasmania's typed root, `data.tas.gov.au`, does not resolve (measured from
 * CI, 22 Sep 2026), so its reading is `catalogue_unavailable` and that is
 * ours. The obvious next step is to type another host, and that is the
 * mistake this module keeps declining: a typed host that is wrong fails
 * exactly like a jurisdiction that publishes nothing, and the ACT's first
 * root proved it.
 *
 * The harvest already knows. `data.gov.au` indexes Tasmanian publishers, and
 * every harvested dataset carries resource URLs pointing at wherever its
 * publisher actually serves it. So the question is asked of the harvest's
 * OWN records, in three steps, and nothing in it is an identifier anybody
 * typed:
 *
 *   1. the harvest's organisation facet names the jurisdiction's publishers
 *      (judged on the publisher's own full name — `attributableTo`'s rule);
 *   2. their datasets' resource URLs name the hosts they are served from,
 *      counted, so the tally says where the jurisdiction really publishes;
 *   3. each of the jurisdiction's own hosts is asked, in each catalogue
 *      dialect this module reads, whether it is a catalogue at all.
 *
 * A host that answers as a populated catalogue is then searched like any
 * `own` catalogue. One that does not is printed with what it did answer,
 * because that is what the next increment needs.
 */

/** The domain a jurisdiction's own government hosts sit under. */
export const JURISDICTION_DOMAINS: Readonly<Record<VolumeGapState, string>> = {
  ACT: 'act.gov.au',
  NT: 'nt.gov.au',
  TAS: 'tas.gov.au',
  WA: 'wa.gov.au',
};

/** Is this host the jurisdiction's own — the domain itself or under it? */
export function isJurisdictionHost(host: string, state: VolumeGapState): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  const domain = JURISDICTION_DOMAINS[state];
  return h === domain || h.endsWith(`.${domain}`);
}

/**
 * The harvest's publishers, from its own organisation facet.
 *
 * A facet rather than `organization_list`, because the Commonwealth
 * catalogue answered `organization_list` with CKAN's default page of 25 and
 * ignored `limit=1000` — a page read as a list is the W3.2 fault. A facet
 * counts what the index holds for the query it was asked.
 */
export function harvestOrgFacetUrl(api: string, query: string): string {
  const p = new URLSearchParams({
    q: query,
    rows: '0',
    'facet.field': '["organization"]',
    'facet.limit': '-1',
  });
  return `${api.replace(/\/+$/, '')}/action/package_search?${p}`;
}

export interface HarvestOrganisation {
  /** The slug the index filters on — read from the index, never typed. */
  name: string;
  /** The publisher's own name, which is what attribution is judged on. */
  title: string;
  count: number;
}

export type OrgFacetParse =
  | { kind: 'facet'; organisations: HarvestOrganisation[] }
  | { kind: 'refused'; reason: string };

export function parseOrgFacet(text: string): OrgFacetParse {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (err) {
    return { kind: 'refused', reason: `not JSON (${text.length} bytes, ${String(err)}): ${JSON.stringify(text.slice(0, 220))}` };
  }
  const result = (body as { result?: { search_facets?: { organization?: { items?: unknown } } } }).result;
  const items = result?.search_facets?.organization?.items;
  if (!Array.isArray(items)) {
    return { kind: 'refused', reason: `no result.search_facets.organization.items (${text.length} bytes): ${JSON.stringify(text.slice(0, 220))}` };
  }
  const organisations: HarvestOrganisation[] = [];
  for (const raw of items as unknown[]) {
    const it = raw as Record<string, unknown>;
    const name = str(it.name);
    const count = num(it.count);
    if (!name || count === null) continue;
    organisations.push({ name, title: str(it.display_name) ?? name, count });
  }
  return { kind: 'facet', organisations: organisations.sort((a, b) => b.count - a.count) };
}

/** The organisations in a facet that are this jurisdiction's, by their own full name. */
export function jurisdictionOrganisations(
  organisations: readonly HarvestOrganisation[],
  state: VolumeGapState,
): HarvestOrganisation[] {
  return organisations.filter((o) => {
    const title = o.title.toLowerCase();
    return JURISDICTION_NAMES[state].some((n) => title.includes(n));
  });
}

/** One organisation's datasets, by the slug the facet returned. */
export function orgDatasetsUrl(api: string, slug: string, rows = 200, start = 0): string {
  const p = new URLSearchParams({
    fq: `organization:"${slug.replace(/"/g, '')}"`,
    rows: String(Math.max(1, Math.min(1000, rows))),
    start: String(Math.max(0, start)),
  });
  return `${api.replace(/\/+$/, '')}/action/package_search?${p}`;
}

export interface HostTally {
  host: string;
  /** Datasets with at least one resource served from this host. */
  datasets: number;
  resources: number;
  /** The commonest leading path segments, so a directory of downloads is visible. */
  paths: string[];
}

/**
 * Where a set of datasets is actually served from, most-used host first.
 *
 * Read off resource URLs, because that is where a harvested dataset's bytes
 * live. A URL that does not parse is skipped rather than guessed at.
 */
export function publicationHostsOf(datasets: readonly VolumeDataset[]): HostTally[] {
  const tally = new Map<string, { datasets: Set<string>; resources: number; paths: Map<string, number> }>();
  for (const d of datasets) {
    for (const r of d.resources) {
      let url: URL;
      try {
        url = new URL(r.url);
      } catch {
        continue;
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      const host = url.hostname.toLowerCase();
      const entry = tally.get(host) ?? { datasets: new Set<string>(), resources: 0, paths: new Map<string, number>() };
      entry.datasets.add(d.id);
      entry.resources += 1;
      const lead = url.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
      const path = `/${lead}${lead ? '/' : ''}`;
      entry.paths.set(path, (entry.paths.get(path) ?? 0) + 1);
      tally.set(host, entry);
    }
  }
  return [...tally.entries()]
    .map(([host, e]) => ({
      host,
      datasets: e.datasets.size,
      resources: e.resources,
      paths: [...e.paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p),
    }))
    .sort((a, b) => b.datasets - a.datasets || b.resources - a.resources || a.host.localeCompare(b.host));
}

/**
 * The catalogue dialects a host is asked in, cheapest question each.
 *
 * `ckan` and `ckan_data` are the same API at the two roots state portals use
 * (`/api/3` and `/data/api/3` — `data.gov.au` itself is the second). `dcat`
 * is the `data.json` feed an ArcGIS Hub or DKAN portal publishes: the whole
 * inventory in one document. `arcgis` is a map-service directory, which is
 * a catalogue of LAYERS rather than of datasets and is reported but never
 * searched for a sales series.
 */
export type CatalogueDialect = 'ckan' | 'ckan_data' | 'socrata' | 'dcat' | 'arcgis';

export function catalogueProbesFor(host: string): { dialect: CatalogueDialect; url: string }[] {
  const h = host.trim().toLowerCase();
  return [
    { dialect: 'ckan', url: volumeInventoryUrl(`https://${h}/api/3`) },
    { dialect: 'ckan_data', url: volumeInventoryUrl(`https://${h}/data/api/3`) },
    { dialect: 'socrata', url: socrataInventoryUrl(h) },
    { dialect: 'dcat', url: `https://${h}/data.json` },
    { dialect: 'arcgis', url: `https://${h}/arcgis/rest/services?f=json` },
  ];
}

/** The CKAN root a dialect answered at, for searching it afterwards. */
export function ckanRootFor(host: string, dialect: 'ckan' | 'ckan_data'): string {
  return dialect === 'ckan' ? `https://${host}/api/3` : `https://${host}/data/api/3`;
}

export interface DialectAnswer {
  /** Did the host answer AS this dialect — the shape, not the digit. */
  answered: boolean;
  /** How big it says its index is, where it said. */
  inventory: number | null;
  detail: string;
}

/**
 * Did a host answer in this dialect?
 *
 * Judged on the SHAPE of the body, never the status alone: a portal that is
 * not CKAN answers `/api/3` with a 200 HTML page as often as with a 404, and
 * the ACT's Socrata portal answered CKAN's path with a JSON 404. So a 200
 * that is not the dialect's own envelope is "not this dialect", and says
 * what it was.
 */
export function readCatalogueDialect(dialect: CatalogueDialect, status: number, body: string): DialectAnswer {
  const head = JSON.stringify(body.slice(0, 120));
  if (status !== 200) return { answered: false, inventory: null, detail: `HTTP ${status} ${head}` };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { answered: false, inventory: null, detail: `200 but not JSON ${head}` };
  }
  switch (dialect) {
    case 'ckan':
    case 'ckan_data': {
      const parse = parseVolumeCatalogue(body);
      if (parse.kind === 'refused') return { answered: false, inventory: null, detail: parse.reason };
      return { answered: parse.total > 0, inventory: parse.total, detail: `CKAN index of ${parse.total}` };
    }
    case 'socrata': {
      const parse = parseSocrataCatalogue(body);
      if (parse.kind === 'refused') return { answered: false, inventory: null, detail: parse.reason };
      return { answered: parse.total > 0, inventory: parse.total, detail: `Socrata catalog of ${parse.total}` };
    }
    case 'dcat': {
      const ds = (json as { dataset?: unknown }).dataset;
      if (!Array.isArray(ds)) return { answered: false, inventory: null, detail: `JSON without a dataset array ${head}` };
      return { answered: ds.length > 0, inventory: ds.length, detail: `DCAT feed of ${ds.length}` };
    }
    case 'arcgis': {
      const dir = json as { folders?: unknown; services?: unknown };
      if (!Array.isArray(dir.folders) && !Array.isArray(dir.services)) {
        return { answered: false, inventory: null, detail: `JSON without folders or services ${head}` };
      }
      const services = Array.isArray(dir.services) ? dir.services.length : 0;
      const folders = Array.isArray(dir.folders) ? dir.folders.length : 0;
      return {
        answered: services + folders > 0,
        inventory: null,
        detail: `ArcGIS directory: ${services} services, ${folders} folders — a catalogue of layers, not of datasets`,
      };
    }
  }
}

/**
 * Read a DCAT `data.json` into the SAME `VolumeDataset` shape.
 *
 * The feed is the whole inventory, so it is judged in full rather than
 * searched: `matched` is the datasets whose own words name a sale, which is
 * the question the CKAN and Socrata queries ask of their indexes.
 */
export function parseDcatCatalogue(text: string, publisher: string): VolumeCatalogueParse {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (err) {
    return { kind: 'refused', reason: `not JSON (${text.length} bytes, ${String(err)}): ${JSON.stringify(text.slice(0, 220))}` };
  }
  const ds = (body as { dataset?: unknown }).dataset;
  if (!Array.isArray(ds)) {
    return { kind: 'refused', reason: `no dataset array (${text.length} bytes): ${JSON.stringify(text.slice(0, 220))}` };
  }
  const datasets: VolumeDataset[] = [];
  for (const raw of ds as unknown[]) {
    const d = raw as Record<string, unknown>;
    const id = str(d.identifier) ?? str(d['@id']);
    const title = str(d.title);
    if (!id || !title) continue;
    const resources: VolumeResource[] = [];
    const dist = Array.isArray(d.distribution) ? (d.distribution as unknown[]) : [];
    dist.forEach((rawDist, i) => {
      const r = rawDist as Record<string, unknown>;
      const url = str(r.downloadURL) ?? str(r.accessURL);
      if (!url) return;
      const format = (str(r.format) ?? str(r.mediaType)?.split('/').pop() ?? '').toUpperCase();
      resources.push({ id: `${id}#${i}`, name: str(r.title) ?? format, format, url, datastoreActive: false, size: null });
    });
    const pub = d.publisher as Record<string, unknown> | undefined;
    datasets.push({
      id,
      name: id,
      title,
      notes: str(d.description),
      organisation: str(pub?.name) ?? publisher,
      licence: str(d.license),
      metadataModified: str(d.modified),
      resources,
    });
  }
  return { kind: 'catalogue', total: datasets.length, datasets };
}

/** The datasets in a whole-inventory feed whose own words name a sale. */
export const SALE_WORDS = /\b(?:sales?|sold|transfers?|transactions?)\b/i;

export function datasetsNamingASale(datasets: readonly VolumeDataset[]): VolumeDataset[] {
  return datasets.filter((d) => SALE_WORDS.test([d.title, d.notes].filter(Boolean).join(' ')));
}

/**
 * A body named for the jurisdiction that is not its government.
 *
 * The harvest's facet for "tasmania" named the University of Tasmania's
 * schools and institutes beside the state's departments — attributable by
 * name, and not the jurisdiction's own publishers. An absence stated about
 * what a jurisdiction publishes has to be about the jurisdiction.
 */
export const ACADEMIC_PUBLISHER = /\buniversit(?:y|ies)\b|\binstitute\b|\bschool of\b|\bresearch\b/i;

export function governmentPublishers(
  organisations: readonly HarvestOrganisation[],
  state: VolumeGapState,
): HarvestOrganisation[] {
  return jurisdictionOrganisations(organisations, state).filter((o) => !ACADEMIC_PUBLISHER.test(o.title));
}

/** One publisher's list, as the enumeration read it. */
export interface EnumeratedPublisher {
  name: string;
  title: string;
  /** How many datasets the index says the publisher holds. */
  declared: number;
  /** How many were read. */
  read: number;
}

/**
 * Was every publisher's every dataset read?
 *
 * An absence found by reading part of a list is a truncated download by
 * another route — `organization_list` answered a page of 25 once and was read
 * as the list. So complete means complete: no publishers is not complete, and
 * one publisher read short makes the whole enumeration short.
 */
export function enumerationComplete(publishers: readonly EnumeratedPublisher[]): boolean {
  return publishers.length > 0 && publishers.every((p) => p.declared > 0 && p.read >= p.declared);
}

/**
 * The read an assessment is handed: every attributed dataset once, and the
 * number its absence sentence states.
 *
 * Two faults, both visible in the 23 Sep 2026 run's own output for Tasmania:
 *
 *  - **A dataset both routes returned was counted twice.** The attributed
 *    list was the jurisdiction's datasets CONCATENATED with the harvest's,
 *    and its length was the count. Where the jurisdiction's list is itself
 *    read from the harvest — the enumeration route — the relevance search
 *    and the enumeration ask the SAME index, so one dataset can arrive by
 *    both, under one id.
 *  - **The enumeration's sentence counted what the enumeration did not
 *    find.** It reads *"of the 982 datasets its own publishers list …, read
 *    in full, N name a sale"* — a statement about that list — and the run
 *    printed N = 6 beside its own line `datasets naming a sale  5 of 982`,
 *    because the search's one attributed find was folded into the number.
 *    The search is the CORROBORATING question on that route (it is what
 *    "and the search of the same index" names), not part of the list.
 *
 * So every attributed dataset still reaches the ranking — a find needs one
 * endpoint that answered — and the number is the one its sentence describes:
 * the enumeration's on the enumeration route, every distinct dataset
 * otherwise.
 */
export interface AttributedRead {
  parse: Extract<VolumeCatalogueParse, { kind: 'catalogue' }>;
  /** Attributed harvest datasets the jurisdiction's own list did not already hold. */
  harvestOnly: VolumeDataset[];
  /** Attributed harvest datasets that WERE already in the jurisdiction's own list. */
  overlap: number;
}

export function attributedRead(args: {
  /** The jurisdiction's own list, already attributed. */
  own: readonly VolumeDataset[];
  /** The harvest search's finds, already attributed. */
  harvest: readonly VolumeDataset[];
  route?: VolumeRoute;
}): AttributedRead {
  const ownIds = new Set<string>();
  const ownDistinct: VolumeDataset[] = [];
  for (const d of args.own) {
    if (ownIds.has(d.id)) continue;
    ownIds.add(d.id);
    ownDistinct.push(d);
  }
  const harvestIds = new Set<string>();
  const harvestOnly: VolumeDataset[] = [];
  let overlap = 0;
  for (const d of args.harvest) {
    if (harvestIds.has(d.id)) continue;
    harvestIds.add(d.id);
    if (ownIds.has(d.id)) overlap += 1;
    else harvestOnly.push(d);
  }
  const datasets = [...ownDistinct, ...harvestOnly];
  const total = args.route === 'harvest_enumeration' ? ownDistinct.length : datasets.length;
  return { parse: { kind: 'catalogue', total, datasets }, harvestOnly, overlap };
}
