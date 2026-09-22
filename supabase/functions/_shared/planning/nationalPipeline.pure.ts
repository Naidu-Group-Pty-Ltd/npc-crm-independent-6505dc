/**
 * The national pipeline register — Infrastructure Australia's Priority List.
 *
 * ── What this closes ─────────────────────────────────────────────────────
 *
 * `infrastructureEvidence.pure.ts` has carried
 *
 *     'the Infrastructure Australia Priority List and other national pipeline
 *      registers'
 *
 * in `INFRASTRUCTURE_COVERAGE_LIMITS` since it was written, and its own
 * comment says that entry *"stands on its own and is never removed"* by a
 * state programme reading, because a state forward-works programme is not a
 * national pipeline. `investmentProgramme.pure.ts` names what each of the
 * eight jurisdictions publishes and reads one of them. Neither reaches the
 * national list, so a report's infrastructure section is today a Queensland
 * reading plus a statement that the national register was not asked.
 *
 * W3.2's acceptance is deliberately two-branched: *named, dated, sourced
 * entries, **or** a coverage statement that names the register asked*. The
 * statement shipped first, because the guarantee is worth having before the
 * evidence exists. What was never done is the part that decides which branch
 * is honest — **asking the publisher**.
 *
 * ── Why the catalogue and not the list's own page ─────────────────────────
 *
 * Infrastructure Australia publishes the Priority List as a web publication.
 * A page is not a register: `PLANNING_CONTROLS_IN_THE_REPORT.md`'s rule is
 * that *a web search is not a retrieval* — a listing site, a news page, a
 * budget page or an agency media release is not an entry in the table — and
 * `publishedProjectRegister.pure.ts` exists precisely so that a project read
 * off a page travels LABELLED as *recorded from an official publication*
 * rather than *retrieved from a register*.
 *
 * So this module asks **data.gov.au**, which is the Commonwealth's own open
 * data catalogue: CKAN, keyless, open licence, and the same shape
 * `investmentProgramme.pure.ts` already reads Queensland's QTRIP through. If
 * the Priority List is published there as a machine-readable resource, it can
 * be a register. If it is not, that is a measured fact about the publisher and
 * the coverage statement stands — with the form the register IS published in
 * named, which it never was.
 *
 * ── An absence is only an absence if the question could have found it ────
 *
 * The first version of this module asked the catalogue two free-text queries
 * and read "no match" as "not published". Run against the real catalogue from
 * CI on 22 Sep 2026 it returned **53 packages and 0 survivors** — NESP marine
 * park projects, Geoscience Australia shoreline modelling, and the *Rail
 * Infrastructure Corporation Annual Report 2003-04* — and reported
 * `not_in_catalogue`.
 *
 * That reading was worthless. CKAN's `q=` is relevance-ranked full text: a
 * quoted phrase is a hint rather than a filter, `Infrastructure Australia
 * priority` matches anything carrying the word *infrastructure*, and a
 * ranked list of 50 noisy hits establishes that the QUERY was loose, never
 * that the register is absent. It is the `layers=all` defect exactly —
 * *"an empty answer to a question nobody asked, which reads as a property
 * with no bushfire and no flood"* — one publisher along.
 *
 * So the authority for an absence is an **exhaustive, filtered enumeration**,
 * and a relevance search is only ever a supplement to it:
 *
 * 1. `organization_list` names every publishing organisation on the
 *    catalogue. Whether Infrastructure Australia publishes there at all is a
 *    yes-or-no question, and it is asked as one.
 * 2. `package_search?fq=owner_org:<id>` is a FILTER, not a ranking: it
 *    returns that publisher's packages and nothing else. Walked to its own
 *    declared `count`, it is the complete set.
 * 3. The register's name rule is then applied to a complete set rather than
 *    to a relevance ranking.
 *
 * And the walk is judged by whether it accounts for every package the
 * catalogue declared — the urban-centre register's rule (*a load is judged by
 * its effect*, and a short walk is a truncated download by another route). An
 * incomplete walk REFUSES rather than reporting a smaller register, because a
 * package missing because the walk stopped is indistinguishable from one that
 * does not exist.
 *
 * ── And the enumeration was truncated too, by the same class of fault ────
 *
 * The rewritten probe then reported **`publisher_absent` over 25
 * organisations enumerated, 1 page read** — while its own supplementary
 * search, in the same run, declared **1,769 packages** matching and named
 * four publishers (Australian Ocean Data Network, Geoscience Australia Data,
 * NSW Government, BITRE). Twenty-five is CKAN's default page size:
 * `organization_list?all_fields=true&limit=1000` was answered with 25, the
 * `limit` silently ignored, and the walk read a short page as the end of the
 * list. The same defect, one endpoint along, inside the commit that fixed it.
 *
 * So `all_fields=true` may not be the enumeration, and the enumeration is
 * **corroborated from two endpoints that fail differently**:
 *
 * - `organization_list` with no `all_fields` answers plain slugs and is not
 *   paged, so it is the authority for *which organisations exist*.
 * - `package_search?rows=0&facet.field=["organization"]&facet.limit=-1`
 *   answers the organisation FACET, which is the set actually publishing
 *   packages, computed by the search index rather than by the list endpoint.
 *
 * An absence requires BOTH to answer and requires the facet to name nothing
 * the slug list does not. Either failing refuses, because the whole reason
 * this file exists is that a truncated question reads exactly like an empty
 * world. A slug the pattern matches is then resolved through
 * `organization_show`, whose id comes from the catalogue's own answer and
 * never from this file.
 *
 * One consequence for the pattern: a slug is `infrastructure-australia` and a
 * title is `Infrastructure Australia`, so the publisher rule matches across
 * `-`, `_` and whitespace. Written as `\s+` it matched the title and could
 * never have matched the slug — which is a rule that only ever half worked.
 *
 * That distinction adds a fourth absence, and it is the one that matters
 * most operationally: **`publisher_absent`** says the catalogue has no such
 * publisher, which sends a person to Infrastructure Australia's own site.
 * `not_in_catalogue` says the publisher is there and holds no such package,
 * which sends them to look under another name. The two remedies are
 * different, so the two sentences are different.
 *
 * ── Nothing here is an identifier somebody typed ──────────────────────────
 *
 * `absBuildingApprovals.pure.ts` pays for this rule already: *an identifier
 * nobody here could verify is the mistyped Airtable column again, and an
 * absent flow fails exactly like an empty one.* There is therefore no
 * organisation slug, no package id and no resource id in this file. The
 * catalogue is searched, the answers are filtered by the publisher's own
 * ORGANISATION TITLE and the register's own NAME, and every candidate is
 * ranked and reported. A resource id is something this module OUTPUTS.
 *
 * ── The four rules a candidate answers to ────────────────────────────────
 *
 * 1. **A document is not a register.** A PDF, a Word file or a web page is
 *    refused for this purpose — not ignored: the formats that WERE offered
 *    are carried back, because "published, but not as a feed" is a different
 *    sentence from "not published", and the two send a reader to different
 *    conclusions. `publishedProjectRegister` is where a document's contents
 *    may travel, under its own label.
 * 2. **The edition is the one that ANSWERS**, never the one that is newest.
 *    QTRIP's 2026-27 package is declared `datastore_active` and holds zero
 *    rows; ranking by date alone would have chosen it and read an empty
 *    programme as a jurisdiction with no works. Candidates are RANKED and the
 *    caller walks them.
 * 3. **A queryable resource outranks a download.** A DataStore-active
 *    resource can be asked a bounded question; a CSV must be fetched whole,
 *    and an edge invocation has a byte ceiling. Preference is a declared
 *    order, not a guess.
 * 4. **A refusal names the size and the first bytes.** Every parser in this
 *    programme that failed silently failed because it was handed something it
 *    did not recognise and said "empty". `parseCkanSearch` refuses with what
 *    it actually received.
 *
 * Deno-compatible: no imports.
 */

/** The publisher this module asks about. */
export const NATIONAL_PIPELINE_PUBLISHER = 'Infrastructure Australia';

/** The register this module asks for, by its formal name. */
export const NATIONAL_PIPELINE_REGISTER = 'Infrastructure Priority List';

/**
 * How the register is named in a sentence a client reads.
 *
 * Not `${PUBLISHER} ${REGISTER}`, which composes to *"Infrastructure
 * Australia Infrastructure Priority List"*. The publisher's own usage drops
 * the second word, and a sentence has to read as English.
 *
 * It lives here because `INFRASTRUCTURE_COVERAGE_LIMITS` spelled it as a
 * literal of its own, so the page said *"Infrastructure Australia Priority
 * List"* while this module said *"Infrastructure Priority List"* — two
 * spellings of one register, which is how `AML_COMMAND_REFRESH_EVENT` came to
 * be named once. Found by asserting the coverage statement on the rendered
 * PAGE rather than on the array behind it.
 */
export const NATIONAL_PIPELINE_COVERAGE_PHRASE =
  'the Infrastructure Australia Priority List and other national pipeline registers';

/**
 * The Commonwealth's own catalogue.
 *
 * CKAN, no key, open licence. Named once here so no call site can spell it
 * differently — the `AIRTABLE_TOKEN` rule applied to a host.
 */
export const CKAN_BASE = 'https://data.gov.au/data/api/3';

/**
 * The searches this module runs, in order, and why there is more than one.
 *
 * A single query is one guess about how the publisher titles its own work. The
 * register's name is the strongest signal and the publisher's name is the
 * broadest, so both are asked and the answers are merged: a package the first
 * query misses because it is titled *"Infrastructure Pipeline"* is caught by
 * the second, and a package the second misses because its organisation is a
 * department rather than the agency is caught by the first.
 *
 * Every candidate either query returns is reported. Nothing is silently
 * dropped for failing to match the query that found it.
 */
export const NATIONAL_PIPELINE_QUERIES: readonly string[] = [
  '"infrastructure priority list"',
  'Infrastructure Australia priority',
];

/** A CKAN `package_search` URL. */
export function ckanSearchUrl(query: string, rows = 50, start = 0): string {
  const q = encodeURIComponent(query);
  return `${CKAN_BASE}/action/package_search?q=${q}&rows=${rows}&start=${start}`;
}

/**
 * The declared fields of a DataStore resource, and nothing else.
 *
 * `limit=0` returns the column declarations and `total` without a single row
 * of data. It is how this programme learns a schema without paying for it —
 * the same move `absDataStructure.pure.ts` makes against the ABS's data
 * structure endpoint, and the reason an empty DataStore can still say what
 * shape it would have had.
 */
export function ckanFieldsUrl(resourceId: string): string {
  return `${CKAN_BASE}/action/datastore_search?resource_id=${encodeURIComponent(resourceId)}&limit=0`;
}

/** A bounded sample of a DataStore resource's rows. */
export function ckanSampleUrl(resourceId: string, limit = 5): string {
  return `${CKAN_BASE}/action/datastore_search?resource_id=${encodeURIComponent(resourceId)}&limit=${limit}`;
}

/**
 * One publisher's packages, filtered rather than ranked.
 *
 * `fq` is Solr's filter query: it constrains the result set instead of
 * scoring it, so this returns that organisation's packages and nothing else.
 * That is the whole difference between this and the free-text search, and it
 * is why only this may be read as an absence.
 */
export function ckanOrganisationPackagesUrl(orgId: string, rows = 100, start = 0): string {
  return `${CKAN_BASE}/action/package_search?fq=owner_org:${encodeURIComponent(`"${orgId}"`)}&rows=${rows}&start=${start}`;
}

/** A publishing organisation, as the catalogue describes itself. */
export interface CkanOrganisation {
  id: string;
  /** The URL slug. */
  name: string;
  /** The organisation's own title. The publisher rule is written against this. */
  title: string;
  /** How many packages the catalogue says it holds. */
  packageCount: number | null;
}

export type OrganisationParse =
  | { kind: 'organisations'; organisations: CkanOrganisation[] }
  | { kind: 'refused'; reason: string };

/**
 * Every organisation the catalogue holds, as plain slugs.
 *
 * No `all_fields`, and that omission is the point: with it, data.gov.au
 * answered 25 and ignored a `limit` of 1000 — a page read as a list. Without
 * it CKAN answers the whole set, which is what an absence has to be judged
 * against.
 */
export function ckanOrganisationSlugsUrl(): string {
  return `${CKAN_BASE}/action/organization_list`;
}

/**
 * The organisation FACET of the whole package index.
 *
 * A second, independent question: which organisations actually publish
 * packages, answered by the search index rather than by the list endpoint.
 * `facet.limit=-1` asks for every bucket and `rows=0` asks for no packages,
 * so this costs a facet computation and no payload.
 */
export function ckanOrganisationFacetUrl(): string {
  return `${CKAN_BASE}/action/package_search?rows=0&facet.field=${encodeURIComponent('["organization"]')}&facet.limit=-1`;
}

/** One organisation, by the slug the catalogue itself gave. */
export function ckanOrganisationShowUrl(slug: string): string {
  return `${CKAN_BASE}/action/organization_show?id=${encodeURIComponent(slug)}&include_datasets=false`;
}

export type SlugParse =
  | { kind: 'slugs'; slugs: string[] }
  | { kind: 'refused'; reason: string };

/** Read an `organization_list` answer. */
export function parseOrganisationSlugs(text: string): SlugParse {
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
  if (!Array.isArray(envelope.result)) {
    return { kind: 'refused', reason: `no result array (${text.length} bytes): ${JSON.stringify(text.slice(0, 220))}` };
  }
  const slugs: string[] = [];
  for (const raw of envelope.result as unknown[]) {
    /*
     * Objects here mean `all_fields` was applied when it was not asked for —
     * the shape that was capped at 25 — so this refuses rather than reading a
     * page as a list. `ckanOrganisationListUrl` and its reader are DELETED
     * rather than left unused, because a reader for the endpoint that lied is
     * one import away from lying again.
     */
    if (typeof raw !== 'string') {
      return { kind: 'refused', reason: 'the catalogue answered organisation objects, not slugs: this endpoint is paged and cannot be read as a list' };
    }
    if (raw.trim() !== '') slugs.push(raw.trim());
  }
  return { kind: 'slugs', slugs };
}

/** Read the organisation facet of a `package_search` answer. */
export function parseOrganisationFacet(text: string): SlugParse {
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
  const facets = (envelope.result as { search_facets?: Record<string, unknown> } | undefined)?.search_facets;
  const organisation = facets?.organization as { items?: unknown } | undefined;
  if (!organisation || !Array.isArray(organisation.items)) {
    return {
      kind: 'refused',
      reason: `no organisation facet (${text.length} bytes): ${JSON.stringify(text.slice(0, 220))}`,
    };
  }
  const slugs: string[] = [];
  for (const raw of organisation.items as unknown[]) {
    const name = str((raw as Record<string, unknown>).name);
    if (name) slugs.push(name);
  }
  return { kind: 'slugs', slugs };
}

/** Read an `organization_show` answer. */
export function parseOrganisationShow(text: string): OrganisationParse {
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
  const o = envelope.result as Record<string, unknown> | undefined;
  const id = str(o?.id);
  const name = str(o?.name);
  if (!o || !id || !name) {
    return { kind: 'refused', reason: `no organisation in the answer: ${JSON.stringify(text.slice(0, 220))}` };
  }
  return {
    kind: 'organisations',
    organisations: [{ id, name, title: str(o.title) ?? name, packageCount: num(o.package_count) }],
  };
}

/**
 * The corroborated enumeration: which slugs could be the publisher.
 *
 * Both readings must answer, and the facet may name nothing the slug list
 * does not. A facet bucket outside the list means the list is incomplete, and
 * a list that is incomplete cannot establish that anything is absent from it
 * — which is this module's whole subject, paid for twice.
 */
export type EnumerationReading =
  | { kind: 'enumerated'; slugs: string[]; matches: string[] }
  | { kind: 'refused'; reason: string };

export function corroborateOrganisations(list: SlugParse, facet: SlugParse): EnumerationReading {
  if (list.kind === 'refused') return { kind: 'refused', reason: `organisation list: ${list.reason}` };
  if (facet.kind === 'refused') return { kind: 'refused', reason: `organisation facet: ${facet.reason}` };
  const known = new Set(list.slugs);
  const unlisted = facet.slugs.filter((s) => !known.has(s));
  if (unlisted.length > 0) {
    return {
      kind: 'refused',
      reason: `the facet names ${unlisted.length} organisation(s) the list does not `
        + `(${unlisted.slice(0, 5).join(', ')}) — the list is incomplete and cannot establish an absence`,
    };
  }
  const slugs = [...new Set([...list.slugs, ...facet.slugs])].sort();
  return { kind: 'enumerated', slugs, matches: slugs.filter((s) => NATIONAL_PIPELINE_ORG_PATTERN.test(s)) };
}

export type PublisherLookup =
  /** The catalogue names this publisher. */
  | { kind: 'publisher'; organisation: CkanOrganisation }
  /** The catalogue was enumerated and names no such publisher. */
  | { kind: 'publisher_absent'; organisationsSeen: number }
  | { kind: 'refused'; reason: string };

/**
 * Find the publisher among the catalogue's own organisations.
 *
 * Matched on the TITLE first and the slug second, because a title is what the
 * catalogue prints; the slug is accepted as well only so a rename of one
 * cannot hide the publisher behind the other. Where more than one matches,
 * the one holding the most packages wins — a publisher's live organisation
 * outranks a historical or empty duplicate, and choosing by list order would
 * be choosing by nothing.
 */
export function findPipelinePublisher(parse: OrganisationParse): PublisherLookup {
  if (parse.kind === 'refused') return { kind: 'refused', reason: parse.reason };
  const matches = parse.organisations.filter(
    (o) => NATIONAL_PIPELINE_ORG_PATTERN.test(o.title) || NATIONAL_PIPELINE_ORG_PATTERN.test(o.name),
  );
  if (matches.length === 0) {
    return { kind: 'publisher_absent', organisationsSeen: parse.organisations.length };
  }
  const best = [...matches].sort((a, b) => (b.packageCount ?? 0) - (a.packageCount ?? 0))[0];
  return { kind: 'publisher', organisation: best };
}

/**
 * The publisher, decided from the corroborated enumeration.
 *
 * The enumeration answers *could* there be such an organisation;
 * `organization_show` answers *what is it called and how much does it hold*.
 * Splitting them is what keeps a typed identifier out of this file: a slug
 * only ever arrives from the catalogue's own list.
 *
 * `findPipelinePublisher` makes the choice among the resolved organisations,
 * so there is exactly ONE implementation of "which of these is the
 * publisher" whichever route reached them.
 */
export function publisherFromEnumeration(
  enumeration: EnumerationReading,
  resolved: OrganisationParse,
): PublisherLookup {
  if (enumeration.kind === 'refused') return { kind: 'refused', reason: enumeration.reason };
  if (enumeration.matches.length === 0) {
    return { kind: 'publisher_absent', organisationsSeen: enumeration.slugs.length };
  }
  /*
   * The enumeration matched and the organisation could not be read. That is a
   * retrieval failure, never an absence: reporting it as one would be the
   * truncation defect a third time, with the truncation one endpoint further
   * along again.
   */
  if (resolved.kind === 'refused') {
    return { kind: 'refused', reason: `the enumeration matched ${enumeration.matches.join(', ')} and none could be read: ${resolved.reason}` };
  }
  const chosen = findPipelinePublisher(resolved);
  if (chosen.kind === 'publisher_absent') {
    return {
      kind: 'refused',
      reason: `the enumeration matched ${enumeration.matches.join(', ')} and the resolved organisations do not`,
    };
  }
  return chosen;
}

/** One distributed file or endpoint of a catalogue package. */
export interface CkanResource {
  id: string;
  name: string;
  /** The publisher's own format word, upper-cased. Never inferred from the URL. */
  format: string;
  url: string;
  /** Whether CKAN will answer bounded queries against it. */
  datastoreActive: boolean;
  /** Bytes, where the catalogue states them. */
  size: number | null;
  lastModified: string | null;
}

/** One catalogue entry. */
export interface CkanPackage {
  id: string;
  /** The URL slug. */
  name: string;
  /** The human title, as published. */
  title: string;
  /** The publishing organisation's own title, never its slug. */
  organisation: string | null;
  licence: string | null;
  /** The catalogue's own last-modified stamp. */
  metadataModified: string | null;
  resources: CkanResource[];
}

export type CkanParse =
  | { kind: 'catalogue'; total: number; packages: CkanPackage[] }
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
 * A refusal carries the byte count and the first 220 bytes verbatim. That
 * sentence is load-bearing: the ABS structure parser read no dimension from
 * 3,193,984 real bytes and reported it as an empty document, because it had
 * been handed XML under a namespace prefix it did not expect. A parser that
 * cannot say what it received cannot be debugged from a CI log.
 */
export function parseCkanSearch(text: string): CkanParse {
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
  const packages: CkanPackage[] = [];
  for (const raw of result.results as unknown[]) {
    const p = raw as Record<string, unknown>;
    const id = str(p.id);
    const name = str(p.name);
    if (!id || !name) continue;
    const org = p.organization as Record<string, unknown> | undefined;
    const resources: CkanResource[] = [];
    for (const rawRes of Array.isArray(p.resources) ? (p.resources as unknown[]) : []) {
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
        lastModified: str(r.last_modified) ?? str(r.created),
      });
    }
    packages.push({
      id,
      name,
      title: str(p.title) ?? name,
      organisation: str(org?.title) ?? str(org?.name),
      licence: str(p.license_title) ?? str(p.license_id),
      metadataModified: str(p.metadata_modified),
      resources,
    });
  }
  return { kind: 'catalogue', total: num(result.count) ?? packages.length, packages };
}

/**
 * The publisher, by its own organisation title.
 *
 * Deliberately not an organisation slug. A slug is an identifier nobody here
 * can verify and it fails exactly like an absent one; a title is what the
 * catalogue prints and what a person checking this can read.
 */
export const NATIONAL_PIPELINE_ORG_PATTERN = /infrastructure[-_\s]+australia/i;

/**
 * The register, by its own name.
 *
 * Wider than the one string, because the publisher has renamed this list more
 * than once and a reader of a future edition should not have to find this file.
 * Narrow enough that a state's own priority list does not match it — the
 * organisation test is the other half.
 */
export const PRIORITY_LIST_PATTERN =
  /\b(?:infrastructure\s+priority\s+list|priority\s+list|infrastructure\s+pipeline|priority\s+(?:projects?|initiatives?))\b/i;

/**
 * Candidates: the publisher's own packages whose name reads as the list.
 *
 * Both tests, because either alone is wrong. The organisation alone admits
 * every audit, report and reform paper Infrastructure Australia publishes;
 * the name alone admits a state's own priority list, which is a different
 * register with a different coverage claim.
 */
export function surveyPipelinePackages(packages: readonly CkanPackage[]): CkanPackage[] {
  const seen = new Set<string>();
  const out: CkanPackage[] = [];
  for (const p of packages) {
    if (seen.has(p.id)) continue;
    const orgMatches = p.organisation !== null && NATIONAL_PIPELINE_ORG_PATTERN.test(p.organisation);
    const nameMatches = PRIORITY_LIST_PATTERN.test(p.title) || PRIORITY_LIST_PATTERN.test(p.name);
    if (!orgMatches || !nameMatches) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * The formats a register may be read from, best first.
 *
 * A DataStore-active resource is not a format at all — it is a queryable
 * endpoint, and it outranks everything, because a bounded question costs
 * kilobytes where a download costs megabytes and an edge invocation has a
 * ceiling. Among downloads, CSV outranks XLSX because a workbook needs a
 * decoder and the two archive readers in this repository both exist to work
 * around one.
 */
export const MACHINE_READABLE_FORMATS: readonly string[] = ['CSV', 'XLSX', 'XLS', 'JSON', 'GEOJSON'];

/**
 * Formats that are a publication rather than a register.
 *
 * Named rather than left to fall off the end of the allow-list, because the
 * coverage statement has to be able to say WHICH of these the list is
 * published as. "Published as a PDF" and "not published" are not the same
 * sentence.
 */
export const DOCUMENT_FORMATS: readonly string[] = ['PDF', 'DOC', 'DOCX', 'HTML', 'ZIP'];

/** One resource this module would try, with its reason for ranking where it does. */
export interface PipelineCandidate {
  packageId: string;
  packageTitle: string;
  organisation: string | null;
  licence: string | null;
  metadataModified: string | null;
  resource: CkanResource;
  /** `queryable` — CKAN answers bounded questions. `download` — a whole file. */
  access: 'queryable' | 'download';
}

/**
 * Every machine-readable resource of every candidate package, best first.
 *
 * Ranked, never chosen: rule 2. The caller walks this list and stops at the
 * first that ANSWERS, because a resource the catalogue declares active can
 * still hold zero rows — measured on QTRIP's own current edition — and
 * choosing by declaration would read an empty register as an empty country.
 *
 * Order: queryable before download, then newest catalogue stamp, then the
 * declared format order. Date before format, because a stale CSV is a worse
 * answer than a current workbook.
 */
export function rankPipelineResources(packages: readonly CkanPackage[]): PipelineCandidate[] {
  const out: PipelineCandidate[] = [];
  for (const p of surveyPipelinePackages(packages)) {
    for (const r of p.resources) {
      if (!r.datastoreActive && !MACHINE_READABLE_FORMATS.includes(r.format)) continue;
      out.push({
        packageId: p.id,
        packageTitle: p.title,
        organisation: p.organisation,
        licence: p.licence,
        metadataModified: p.metadataModified,
        resource: r,
        access: r.datastoreActive ? 'queryable' : 'download',
      });
    }
  }
  const formatRank = (f: string): number => {
    const i = MACHINE_READABLE_FORMATS.indexOf(f);
    return i < 0 ? MACHINE_READABLE_FORMATS.length : i;
  };
  return out.sort((a, b) => {
    if (a.access !== b.access) return a.access === 'queryable' ? -1 : 1;
    const ad = a.metadataModified ?? '';
    const bd = b.metadataModified ?? '';
    if (ad !== bd) return ad < bd ? 1 : -1;
    return formatRank(a.resource.format) - formatRank(b.resource.format);
  });
}

/**
 * What the catalogue says about this register, whether or not it can be read.
 *
 * This is the type the coverage statement is built from, and it is the point
 * of the whole module: the acceptance criterion's second branch asks for *a
 * coverage statement that names the register asked*, and until now that
 * statement named the register from a literal in a list. It can now name what
 * the publisher's own catalogue said when it was asked.
 */
export type PipelineAvailability =
  | { kind: 'readable'; candidates: PipelineCandidate[] }
  /** The publisher's packages were found and none is a feed. */
  | { kind: 'published_as_documents'; packages: CkanPackage[]; formats: string[] }
  /** The publisher publishes here and holds no package under this name. */
  | { kind: 'not_in_catalogue'; searched: number }
  /** The catalogue names no such publisher at all. A different remedy. */
  | { kind: 'publisher_absent'; organisationsSeen: number }
  /** The catalogue itself could not be read. Ours, or theirs — never the area's. */
  | { kind: 'catalogue_unavailable'; reason: string };

/**
 * Did the walk account for every package the catalogue declared?
 *
 * A short walk is a truncated download by another route, and a register read
 * from part of itself is `SUPPLY_EVIDENCE.md`'s floor rather than the
 * register. Anything reading an absence must check this first, because a
 * package missing because the walk stopped is indistinguishable from one that
 * does not exist.
 */
export function catalogueWalkIsComplete(parse: CkanParse): boolean {
  if (parse.kind !== 'catalogue') return false;
  return parse.packages.length >= parse.total;
}

/**
 * Judge the catalogue's answer.
 *
 * The three absences are three different sentences, which is
 * `SUPPLY_EVIDENCE.md`'s rule (*the four absences are four different
 * sentences*) applied one register along. `published_as_documents` is a fact
 * about the PUBLISHER, `not_in_catalogue` is a fact about the CATALOGUE, and
 * `catalogue_unavailable` is a fact about this retrieval. Collapsing them
 * would let "we could not reach data.gov.au today" render as "Infrastructure
 * Australia publishes no pipeline", which is the class of error this whole
 * programme keeps paying for.
 */
export function assessPipelineAvailability(
  publisher: PublisherLookup,
  parse: CkanParse,
): PipelineAvailability {
  if (publisher.kind === 'refused') return { kind: 'catalogue_unavailable', reason: publisher.reason };
  if (publisher.kind === 'publisher_absent') {
    return { kind: 'publisher_absent', organisationsSeen: publisher.organisationsSeen };
  }
  if (parse.kind === 'refused') return { kind: 'catalogue_unavailable', reason: parse.reason };
  /*
   * An incomplete walk is never read as a smaller register. It is reported as
   * a retrieval this deployment could not finish, which is what it is.
   */
  if (!catalogueWalkIsComplete(parse)) {
    return {
      kind: 'catalogue_unavailable',
      reason: `the walk read ${parse.packages.length} of ${parse.total} declared packages`,
    };
  }
  const candidates = rankPipelineResources(parse.packages);
  if (candidates.length > 0) return { kind: 'readable', candidates };
  const packages = surveyPipelinePackages(parse.packages);
  if (packages.length > 0) {
    const formats = [
      ...new Set(
        packages
          .flatMap((p) => p.resources.map((r) => r.format))
          .filter((f) => f !== ''),
      ),
    ].sort();
    return { kind: 'published_as_documents', packages, formats };
  }
  return { kind: 'not_in_catalogue', searched: parse.packages.length };
}

/**
 * Merge the answers of several searches into one catalogue reading.
 *
 * A refusal anywhere is the whole reading's refusal: a partial catalogue read
 * as a complete one is how `SUPPLY_EVIDENCE.md`'s floor rule came to be
 * written, and a package missing because one query 500'd is indistinguishable
 * from a package that does not exist.
 */
export function mergeCatalogueReads(parses: readonly CkanParse[]): CkanParse {
  if (parses.length === 0) return { kind: 'refused', reason: 'no search was run' };
  const refused = parses.find((p) => p.kind === 'refused');
  if (refused) return refused;
  const seen = new Set<string>();
  const packages: CkanPackage[] = [];
  let total = 0;
  for (const p of parses) {
    if (p.kind !== 'catalogue') continue;
    total = Math.max(total, p.total);
    for (const pkg of p.packages) {
      if (seen.has(pkg.id)) continue;
      seen.add(pkg.id);
      packages.push(pkg);
    }
  }
  return { kind: 'catalogue', total, packages };
}

/**
 * The sentence a report carries about the national pipeline.
 *
 * One implementation, so the section, the coverage list and the register's own
 * reading cannot state different things — `riskRegisterInstruction()`'s lesson
 * (three verbatim copies of one declaration, already diverged by four
 * paragraphs) paid in advance.
 *
 * Every branch is a statement about the RETRIEVAL. None is a statement about
 * the property, the area or the amount of infrastructure planned near it,
 * which is §9's rule: an absence may not be rated.
 */
export function pipelineCoverageNote(availability: PipelineAvailability): string {
  const reg = `${NATIONAL_PIPELINE_PUBLISHER}'s ${NATIONAL_PIPELINE_REGISTER}`;
  switch (availability.kind) {
    case 'readable':
      return `${reg} was read from the Commonwealth's open data catalogue (data.gov.au).`;
    case 'published_as_documents': {
      const forms = availability.formats.length > 0
        ? availability.formats.join(', ')
        : 'a publication with no machine-readable distribution';
      return `${reg} is published, but not as a machine-readable register — the `
        + `Commonwealth's open data catalogue distributes it as ${forms}. Nothing from `
        + `it is cited here, because citing an entry would mean reading a document `
        + `rather than retrieving a register.`;
    }
    case 'not_in_catalogue':
      return `${reg} was asked for in the Commonwealth's open data catalogue `
        + `(data.gov.au): the publisher's own catalogue entries were enumerated in `
        + `full and none of them is this register. That is a statement about the `
        + `catalogue, not about the national pipeline.`;
    case 'publisher_absent':
      return `${reg} was asked for in the Commonwealth's open data catalogue `
        + `(data.gov.au), which does not list ${NATIONAL_PIPELINE_PUBLISHER} among its `
        + `publishing organisations — so the register is not distributed there and is `
        + `read from the publisher's own site instead. That is a statement about where `
        + `the register is published, not about the national pipeline.`;
    case 'catalogue_unavailable':
      return `${reg} could not be asked for: the Commonwealth's open data catalogue `
        + `did not answer. This deployment holds no reading of the national pipeline `
        + `for this report, which is a statement about the retrieval.`;
  }
}
