/**
 * Where each state and territory publishes its OWN population projection,
 * in what form, and at what grain — asked of the publishers, not assumed.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `FORWARD_DEMAND_EVIDENCE.md` measured the national floor on 22 Sep 2026:
 * the ABS projects to capital city or rest of state and no finer, so forward
 * demand at a property's own area is a PER-JURISDICTION register. Every state
 * and territory publishes one, and `FORWARD_DEMAND_PUBLISHERS` names all
 * eight with `ingested: false` — truthfully, because nothing here had ever
 * reached them to see what they publish, and that module declines to state a
 * grain it cannot check.
 *
 * This is the step that checks. It asks each jurisdiction's own open-data
 * catalogue, the Commonwealth harvest, and the publisher's own product page,
 * and judges what comes back on the publisher's own words. The loader that
 * follows is built against what this measures, never against a fixture typed
 * from memory — the ABS projection probe's first run found a series premise,
 * a grain premise and an assumption premise all wrong in one sitting.
 *
 * ── Two routes, because they fail differently ────────────────────────────
 *
 * A catalogue lists datasets with formats and licences, which is what a
 * loader needs, and some jurisdictions put nothing there. A product page is
 * where every publisher actually puts the workbooks, and it is HTML. So both
 * are asked, and each finding says which route found it.
 *
 * ── Nothing here writes, and nothing here scores ─────────────────────────
 *
 * No `EvidencePoint`, no row shape, no table name. A projection is not a
 * measurement (`A_PROJECTION_IS_NOT_A_MEASUREMENT`) and never reaches the
 * scorer, whatever is later loaded.
 *
 * Deno-compatible: explicit `.ts` extensions, no `@/` aliases.
 */
import {
  parseSocrataCatalogue,
  parseVolumeCatalogue,
  socrataInventoryUrl,
  socrataSearchUrl,
  volumeInventoryUrl,
  volumeSearchUrl,
  type VolumeCatalogueParse,
  type VolumeDataset,
  type VolumeResource,
} from './salesVolumePublishers.pure.ts';
import type { ProjectionGrain } from './absPopulationProjections.pure.ts';

export type ProjectionState = 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT';

export const PROJECTION_STATES: readonly ProjectionState[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'];

/**
 * Each jurisdiction's own catalogue, where one is known.
 *
 * WA, NT and the ACT are the three this repository has MEASURED answering
 * from CI (`sales-volume-liveness`, 22 Sep 2026). The other four are the
 * roots those jurisdictions document for their CKAN portals, typed here and
 * therefore printed with whatever they answer — a root that is wrong is a gap
 * in this repository, never a statement about the jurisdiction. Tasmania has
 * none: its typed root does not resolve, and `sales-volume-liveness`
 * discovers where it publishes from the harvest instead of guessing again.
 */
export interface ProjectionCatalogue {
  state: ProjectionState;
  dialect: 'ckan' | 'socrata';
  /** CKAN 3 API root, or the Socrata domain. */
  root: string;
  publisher: string;
  /** Measured answering from CI, or typed and so far unmeasured. */
  measured: boolean;
}

export const PROJECTION_CATALOGUES: readonly ProjectionCatalogue[] = [
  { state: 'NSW', dialect: 'ckan', root: 'https://data.nsw.gov.au/data/api/3', publisher: 'NSW Government (Data.NSW)', measured: false },
  { state: 'VIC', dialect: 'ckan', root: 'https://discover.data.vic.gov.au/api/3', publisher: 'Victorian Government (DataVic)', measured: false },
  { state: 'QLD', dialect: 'ckan', root: 'https://www.data.qld.gov.au/api/3', publisher: 'Queensland Government open data', measured: false },
  { state: 'SA', dialect: 'ckan', root: 'https://data.sa.gov.au/data/api/3', publisher: 'Government of South Australia (Data.SA)', measured: false },
  { state: 'WA', dialect: 'ckan', root: 'https://catalogue.data.wa.gov.au/api/3', publisher: 'Government of Western Australia', measured: true },
  { state: 'NT', dialect: 'ckan', root: 'https://data.nt.gov.au/api/3', publisher: 'Northern Territory Government', measured: true },
  { state: 'ACT', dialect: 'socrata', root: 'www.data.act.gov.au', publisher: 'ACT Government (data.act.gov.au)', measured: true },
];

/** The Commonwealth harvest, measured answering from CI. */
export const PROJECTION_HARVEST_ROOT = 'https://data.gov.au/data/api/3';

/**
 * The queries. Candidate-finding only — W3.2's rule: a relevance query finds
 * candidates and never proves an absence.
 */
export const PROJECTION_QUERIES: readonly string[] = [
  'population projections',
  'projected population',
  'population forecast',
];

export function projectionSearchUrl(c: ProjectionCatalogue, query: string, rows = 50): string {
  return c.dialect === 'socrata' ? socrataSearchUrl(c.root, query, rows) : volumeSearchUrl(c.root, query, rows);
}

export function projectionInventoryUrl(c: ProjectionCatalogue): string {
  return c.dialect === 'socrata' ? socrataInventoryUrl(c.root) : volumeInventoryUrl(c.root);
}

export function parseProjectionCatalogue(c: Pick<ProjectionCatalogue, 'dialect'>, text: string): VolumeCatalogueParse {
  return c.dialect === 'socrata' ? parseSocrataCatalogue(text) : parseVolumeCatalogue(text);
}

// ---------------------------------------------------------------------------
// Judging a dataset on the publisher's own words
// ---------------------------------------------------------------------------

/** The publisher says it is a projection or a forecast. */
export const PROJECTION_PATTERN = /\bprojections?\b|\bprojected\b|\bforecasts?\b/i;

/**
 * A MEASURED estimate is not a projection, and the worst available failure is
 * printing one under a forward heading — this platform already holds 61,335
 * rows of ABS resident population. So a dataset whose words name an estimate
 * of resident population, and no projection, is refused by name.
 */
export const ESTIMATE_PATTERN = /\bestimated\s+resident\s+population\b|\bERP\b/i;

/**
 * The grain words a publisher uses, finest first, mapped onto the grains
 * `absPopulationProjections.pure.ts` already prices. `suburb` and `district`
 * are carried as WORDS and not mapped: a suburb is not an SA2 however often
 * the two coincide, and which one a publisher means is a question for the
 * file, not the title.
 */
export const GRAIN_WORDS: ReadonlyArray<readonly [ProjectionGrain | 'suburb' | 'district', RegExp]> = [
  ['sa2', /\bSA2s?\b|statistical areas?\s*(?:\(\s*)?level 2\b/i],
  ['suburb', /\bsuburbs?\b|\blocalit(?:y|ies)\b/i],
  ['sa3', /\bSA3s?\b|statistical areas?\s*(?:\(\s*)?level 3\b/i],
  ['district', /\bdistricts?\b/i],
  ['lga', /\bLGAs?\b|local government areas?\b/i],
  ['sa4', /\bSA4s?\b|statistical areas?\s*(?:\(\s*)?level 4\b/i],
  ['gccsa', /\bGCCSA\b|greater capital city/i],
];

export const MACHINE_READABLE = ['CSV', 'XLSX', 'XLS', 'JSON', 'ZIP'];

export interface ProjectionJudgement {
  dataset: VolumeDataset;
  projection: boolean;
  estimateOnly: boolean;
  /** The grain words the publisher's own text uses, finest first. */
  grainWords: string[];
  machineReadable: VolumeResource | null;
  formats: string[];
}

export function judgeProjectionDataset(dataset: VolumeDataset): ProjectionJudgement {
  const words = [dataset.title, dataset.notes, ...dataset.resources.map((r) => r.name)]
    .filter((w): w is string => typeof w === 'string' && w !== '')
    .join(' · ');
  const projection = PROJECTION_PATTERN.test(words);
  const formats = [...new Set(dataset.resources.map((r) => r.format).filter((f) => f !== ''))];
  const machine = dataset.resources
    .filter((r) => MACHINE_READABLE.includes(r.format))
    .sort((a, b) => Number(b.datastoreActive) - Number(a.datastoreActive))[0] ?? null;
  return {
    dataset,
    projection,
    estimateOnly: !projection && ESTIMATE_PATTERN.test(words),
    grainWords: GRAIN_WORDS.filter(([, re]) => re.test(words)).map(([g]) => g),
    machineReadable: machine,
    formats,
  };
}

const grainRank = (j: ProjectionJudgement): number => {
  const order = GRAIN_WORDS.map(([g]) => g);
  const ranks = j.grainWords.map((g) => order.indexOf(g as typeof order[number])).filter((i) => i >= 0);
  return ranks.length > 0 ? Math.min(...ranks) : order.length;
};

/** Projections only, finest named grain first, then a machine-readable file, then the most recent. */
export function rankProjectionCandidates(datasets: readonly VolumeDataset[]): ProjectionJudgement[] {
  return datasets
    .map(judgeProjectionDataset)
    .filter((j) => j.projection)
    .sort((a, b) =>
      grainRank(a) - grainRank(b)
      || Number(b.machineReadable !== null) - Number(a.machineReadable !== null)
      || (b.dataset.metadataModified ?? '').localeCompare(a.dataset.metadataModified ?? ''));
}

// ---------------------------------------------------------------------------
// Attribution: a harvest hit is a statement about the harvest
// ---------------------------------------------------------------------------

/**
 * The full names a jurisdiction's own publishers use.
 *
 * Full names only (`sales-volume-liveness`' rule: `ACT` is inside "Climate
 * Action"), and a LOCAL government is never the jurisdiction's publisher —
 * "Town of Victoria Park" is a Western Australian council, and a council's
 * own forecast is not the state's projection.
 */
export const STATE_NAMES: Readonly<Record<ProjectionState, readonly string[]>> = {
  NSW: ['new south wales', 'nsw government'],
  VIC: ['victorian', 'state of victoria', '(victoria)', 'victoria state government'],
  QLD: ['queensland'],
  SA: ['south australia'],
  WA: ['western australia'],
  TAS: ['tasmania', 'tasmanian'],
  ACT: ['australian capital territory', 'act government'],
  NT: ['northern territory'],
};

const LOCAL_GOVERNMENT = /\b(?:city|town|shire|municipality|municipal|council|borough|regional council)\b/i;

export function projectionAttributable(dataset: VolumeDataset, state: ProjectionState): boolean {
  const org = (dataset.organisation ?? '').toLowerCase();
  if (org === '' || LOCAL_GOVERNMENT.test(org)) return false;
  return STATE_NAMES[state].some((n) => org.includes(n));
}

// ---------------------------------------------------------------------------
// The product page: every publisher puts its workbooks on one
// ---------------------------------------------------------------------------

export interface ProjectionLink {
  url: string;
  /** The link's own words, or the file name where it has none. */
  text: string;
  format: string;
  grainWords: string[];
  /** The link's words or file name say projection. */
  projection: boolean;
}

const FILE_EXT = /\.(xlsx|xls|csv|zip)(?:$|[?#])/i;

/**
 * Every downloadable file a product page links to, resolved against the page.
 *
 * `href` values only — a page's prose is not a list of files. Relative links
 * are resolved, duplicates dropped, anything that is not http(s) refused.
 */
export function projectionFileLinks(html: string, pageUrl: string): ProjectionLink[] {
  const out: ProjectionLink[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchor)) {
    const href = (m[1] ?? m[2] ?? '').trim();
    if (!FILE_EXT.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href.replace(/&amp;/g, '&'), pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const inner = m[3].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const file = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const words = `${inner} ${file.replace(/[-_]+/g, ' ')}`;
    out.push({
      url: key,
      text: inner || file,
      format: (FILE_EXT.exec(url.pathname)?.[1] ?? '').toUpperCase(),
      grainWords: GRAIN_WORDS.filter(([, re]) => re.test(words)).map(([g]) => g),
      projection: PROJECTION_PATTERN.test(words),
    });
  }
  return out;
}

/** Finest named grain first; a link that says projection above one that does not. */
export function rankProjectionLinks(links: readonly ProjectionLink[]): ProjectionLink[] {
  const order = GRAIN_WORDS.map(([g]) => g);
  const rank = (l: ProjectionLink) => {
    const r = l.grainWords.map((g) => order.indexOf(g as typeof order[number])).filter((i) => i >= 0);
    return r.length > 0 ? Math.min(...r) : order.length;
  };
  return [...links].sort((a, b) =>
    rank(a) - rank(b)
    || Number(b.projection) - Number(a.projection)
    || Number(b.format === 'XLSX' || b.format === 'CSV') - Number(a.format === 'XLSX' || a.format === 'CSV'));
}

/**
 * The size past which the probe does not download a file to describe it.
 *
 * A description needs the first rows of each sheet, not the file; forty
 * megabytes clears every projection workbook this programme expects while
 * refusing a whole-state microdata archive nobody asked for.
 */
export const DESCRIBE_MAX_BYTES = 40_000_000;

// ---------------------------------------------------------------------------
// Second pass, 23 Sep 2026: what the first run got wrong about its own reads
// ---------------------------------------------------------------------------

/*
 * The first CI run (23 Sep 2026) found the right files and described the
 * wrong ones, for three reasons its output shows:
 *
 *  - **`PROJECTION_PATTERN` matched a map projection and a budget forecast.**
 *    *"Habitat Models for the Northern Comprehensive Regional Assessment"*
 *    was ranked for New South Wales and *"State Budget 2016-17 — Growth in
 *    Consumer Price Index"* for Victoria, because both use the word. A
 *    candidate is now named for a POPULATION projection in its own title.
 *  - **An own catalogue is not only its own jurisdiction's.** South
 *    Australia's catalogue returned *"2022 NSW Population Projections"* first
 *    and the probe described New South Wales' file for South Australia. A
 *    dataset whose title or publisher names another jurisdiction is that
 *    jurisdiction's, whichever catalogue listed it.
 *  - **A dataset is not a file.** The first machine-readable resource was
 *    described, which for New South Wales was the whole-state workbook
 *    beside the SA2 and LGA ones. Resources are ranked by the grain their
 *    own names state.
 */

/** A population projection, named as one in the publisher's own title. */
export const POPULATION_PROJECTION_TITLE =
  /\bpopulation\b[^.]{0,40}\b(?:projections?|projected|forecasts?)\b|\bprojected\b[^.]{0,30}\bpopulation\b|\bvictoria in future\b|\bVIF\s?20\d\d\b|\bNTPOP\b|\bWA Tomorrow\b/i;

/**
 * How each jurisdiction is named in a title: its full name, case-blind, and
 * its abbreviation as a whole word, case-SENSITIVE — `ACT` is an abbreviation
 * and "act" is a word (a *Planning Act*), `SA` is not inside `SA2` because a
 * digit is a word character, and `WA` must not match "wa" in "water".
 */
const JURISDICTION_IN_TITLE: Readonly<Record<ProjectionState, { full: RegExp; abbreviation: RegExp }>> = {
  NSW: { full: /\bnew south wales\b/i, abbreviation: /\bNSW\b/ },
  VIC: { full: /\bvictoria(?:n)?\b/i, abbreviation: /\bVIC\b/ },
  QLD: { full: /\bqueensland(?:er)?\b/i, abbreviation: /\bQLD\b|\bQld\b/ },
  SA: { full: /\bsouth australia(?:n)?\b/i, abbreviation: /\bSA\b/ },
  WA: { full: /\bwestern australia(?:n)?\b/i, abbreviation: /\bWA\b/ },
  TAS: { full: /\btasmania(?:n)?\b/i, abbreviation: /\bTAS\b|\bTas\b/ },
  ACT: { full: /\baustralian capital territory\b/i, abbreviation: /\bACT\b/ },
  NT: { full: /\bnorthern territory\b/i, abbreviation: /\bNT\b/ },
};

/** The jurisdictions a title names, by full name or whole-word abbreviation. */
export function jurisdictionsNamedIn(text: string): ProjectionState[] {
  return PROJECTION_STATES.filter((s) => {
    const { full, abbreviation } = JURISDICTION_IN_TITLE[s];
    // "Victoria Park" is a Western Australian town and a Perth suburb, not the state.
    const scrubbed = s === 'VIC' ? text.replace(/\bvictoria park\b/gi, ' ') : text;
    return full.test(scrubbed) || abbreviation.test(scrubbed);
  });
}

/**
 * Is a dataset from a jurisdiction's OWN catalogue that jurisdiction's?
 *
 * An own catalogue needs no attribution for its own publishers — that is what
 * makes it the authority — but it can list another jurisdiction's dataset,
 * measured: South Australia's listed New South Wales' 2022 projections first.
 * So the question is asked in the negative: refused where the title names
 * ANOTHER jurisdiction and not this one, or where the publisher is another
 * jurisdiction's by its full name.
 */
export function ownCatalogueDataset(dataset: VolumeDataset, state: ProjectionState): boolean {
  const named = jurisdictionsNamedIn(dataset.title);
  if (named.length > 0 && !named.includes(state)) return false;
  const org = (dataset.organisation ?? '').toLowerCase();
  // A council's own forecast is not the jurisdiction's projection, in any catalogue.
  if (LOCAL_GOVERNMENT.test(org)) return false;
  const others = PROJECTION_STATES.filter((s) => s !== state);
  if (others.some((s) => STATE_NAMES[s].some((n) => org.includes(n))) && !STATE_NAMES[state].some((n) => org.includes(n))) {
    return false;
  }
  // "Transport for NSW" names its jurisdiction by abbreviation — measured,
  // listed second in South Australia's catalogue.
  const orgNamed = jurisdictionsNamedIn(dataset.organisation ?? '');
  if (orgNamed.length > 0 && !orgNamed.includes(state)) return false;
  return true;
}

/** A population projection by its own title, and this jurisdiction's. */
export function isOwnPopulationProjection(dataset: VolumeDataset, state: ProjectionState, route: 'own' | 'harvest'): boolean {
  if (!POPULATION_PROJECTION_TITLE.test(dataset.title)) return false;
  if (ESTIMATE_PATTERN.test(dataset.title) && !/projection|projected|forecast/i.test(dataset.title)) return false;
  // A projection of ENROLLED voters is an electoral commission's, and not a population.
  if (/\benrol(?:l?ed|ment)\b/i.test(dataset.title)) return false;
  return route === 'own' ? ownCatalogueDataset(dataset, state) : projectionAttributable(dataset, state);
}

/**
 * A publisher's name without the words that say whose it is — "the
 * Victorian Department of Transport and Planning" and a catalogue's
 * "Department of Transport and Planning" are one publisher.
 */
export function normalisePublisher(name: string): string {
  return name.toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\b(?:the|new south wales|nsw|victorian|victoria|queensland|south australian|western australian|tasmanian|australian capital territory|act|northern territory|government of)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The jurisdiction's own projections, the publisher `FORWARD_DEMAND_PUBLISHERS`
 * names first — a transport agency's travel-zone projection is a real
 * projection and a different product from the planning department's — then
 * the finest grain a title or file names, then the most recently maintained.
 */
export function rankOwnProjections(
  datasets: readonly VolumeDataset[],
  preferredPublisher: string | null,
): ProjectionJudgement[] {
  const preferred = normalisePublisher(preferredPublisher ?? '');
  const byPublisher = (j: ProjectionJudgement) => {
    const org = normalisePublisher(j.dataset.organisation ?? '');
    if (preferred === '' || org.length < 12) return 1;
    return org.includes(preferred) || preferred.includes(org) ? 0 : 1;
  };
  const seen = new Set<string>();
  return datasets
    .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
    .map(judgeProjectionDataset)
    .sort((a, b) =>
      byPublisher(a) - byPublisher(b)
      || grainRank(a) - grainRank(b)
      || Number(b.machineReadable !== null) - Number(a.machineReadable !== null)
      || (b.dataset.metadataModified ?? '').localeCompare(a.dataset.metadataModified ?? ''));
}

const RESOURCE_FORMAT_RANK: Readonly<Record<string, number>> = { XLSX: 0, CSV: 0, XLS: 1, ZIP: 2, JSON: 3 };

/** The grain a resource's OWN name or file name states, finest first; `null` where it states none. */
export function resourceGrain(resource: Pick<VolumeResource, 'name' | 'url'>): string | null {
  const file = decodeURIComponent((resource.url.split(/[?#]/)[0] ?? '').split('/').pop() ?? '');
  const words = `${resource.name} ${file.replace(/[-_.]+/g, ' ')}`;
  for (const [g, re] of GRAIN_WORDS) if (re.test(words)) return g;
  if (/\bregions?\b/i.test(words)) return 'region';
  if (/\bstate\b|_nsw\b|\bnsw\b/i.test(words)) return 'state';
  return null;
}

/**
 * A dataset's files, finest stated grain first, then the formats a loader
 * reads most directly. A resource that is not machine-readable is not
 * offered — a PDF is a document, and "published, but not as a feed" is a
 * different sentence from "published".
 */
export function rankProjectionResources(dataset: VolumeDataset): Array<{ resource: VolumeResource; grain: string | null }> {
  const order = [...GRAIN_WORDS.map(([g]) => g as string), 'region', 'state'];
  const grainRank = (g: string | null) => (g === null ? order.length : order.indexOf(g));
  return dataset.resources
    .filter((r) => r.format in RESOURCE_FORMAT_RANK)
    .map((resource) => ({ resource, grain: resourceGrain(resource) }))
    .sort((a, b) =>
      grainRank(a.grain) - grainRank(b.grain)
      || (RESOURCE_FORMAT_RANK[a.resource.format] ?? 9) - (RESOURCE_FORMAT_RANK[b.resource.format] ?? 9));
}

/**
 * Links on a product page worth following one level down: same host, and
 * named for projections or population in their own words or path. Bounded by
 * the caller; this only chooses.
 */
export function projectionSubPages(html: string, pageUrl: string, max = 8): string[] {
  let base: URL;
  try { base = new URL(pageUrl); } catch { return []; }
  const out: string[] = [];
  const seen = new Set<string>([base.toString()]);
  const anchor = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchor)) {
    const href = (m[1] ?? m[2] ?? '').trim();
    if (href === '' || href.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(href)) continue;
    let url: URL;
    try { url = new URL(href.replace(/&amp;/g, '&'), base); } catch { continue; }
    if (url.host !== base.host || (url.protocol !== 'https:' && url.protocol !== 'http:')) continue;
    if (/\.(?:pdf|docx?|xlsx?|csv|zip|jpe?g|png|gif|svg)(?:$|[?#])/i.test(url.pathname)) continue;
    url.hash = '';
    const key = url.toString();
    if (seen.has(key)) continue;
    const inner = m[3].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (!/projection|projected|forecast|population|demograph|victoria in future|\bvif\b/i.test(`${inner} ${url.pathname}`)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= max) break;
  }
  return out;
}
