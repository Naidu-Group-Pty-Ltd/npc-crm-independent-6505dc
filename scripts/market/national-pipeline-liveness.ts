/**
 * Is Infrastructure Australia's Priority List a register, or a publication?
 *
 * ## Why this exists
 *
 * W3.2's acceptance is two-branched: page 22's sentence is replaced by *named,
 * dated, sourced entries*, **or** by *a coverage statement that names the
 * register asked*. The statement shipped first. Which branch is honest is not
 * a design decision — it is a question only the publisher can answer, and
 * nothing in this repository had ever asked it.
 *
 * The development egress cannot ask: the gateway answers **403 to CONNECT**
 * for `data.gov.au`, `www.infrastructureaustralia.gov.au`, `www.abs.gov.au`
 * and `data.api.abs.gov.au` alike — measured 22 Sep 2026, a policy denial in
 * the network allowlist rather than anything either publisher did. A GitHub
 * runner has open internet. So this asks from CI, before anything is merged,
 * deployed or scheduled, and it writes nothing anywhere: no database, no
 * Supabase, no credential.
 *
 * ## An absence is only an absence if the question could have found it
 *
 * The first run of this probe reported `not_in_catalogue` over **53 packages
 * and 0 survivors** — NESP marine park projects, Geoscience Australia
 * shoreline modelling, and the *Rail Infrastructure Corporation Annual Report
 * 2003-04*. That reading was worthless: CKAN's `q=` is relevance-ranked full
 * text, so a ranked list of noisy hits establishes that the QUERY was loose
 * and never that the register is absent. It is the `layers=all` defect one
 * publisher along.
 *
 * So the ENUMERATION is the authority and the free-text search is a
 * supplement. `fq=owner_org:<id>` is a filter rather than a ranking, walked
 * to its own declared count, and only then is the register's name rule
 * applied, to a complete set.
 *
 * ## The enumeration was truncated too, by the same class of fault
 *
 * The rewrite then reported `publisher_absent` over **25 organisations, 1
 * page read** — while its own supplementary search, in the same run, declared
 * 1,769 matching packages and named four publishers. Twenty-five is CKAN's
 * default page size: `organization_list?all_fields=true&limit=1000` was
 * answered with 25 and the `limit` was silently ignored. So the enumeration
 * is now CORROBORATED from two endpoints that fail differently — the plain
 * slug list and the package index's own organisation facet — and an absence
 * requires both to answer and to agree. Either failing refuses.
 *
 * ## The exit code is the whole design
 *
 * This is `abs-approvals-liveness.ts`'s rule, and it is the same rule for the
 * same reason. **The catalogue being unreachable is not our failure**, so a
 * refusal, a timeout or a 5xx reports and exits 0. What exits 1 is the case
 * that IS ours: the catalogue answered and our own discovery could not read
 * what it sent.
 *
 * And one case that is neither: the catalogue answers, is read correctly, and
 * holds no machine-readable edition of the list. That is not a defect in
 * anything — it is the measurement that settles which acceptance branch is
 * honest, and it exits 0 while saying so in as many words. A build that went
 * red because a publisher publishes a PDF would be a build asserting an
 * opinion about somebody else's distribution choices.
 */
import {
  CKAN_BASE,
  NATIONAL_PIPELINE_ORG_PATTERN,
  NATIONAL_PIPELINE_PUBLISHER,
  NATIONAL_PIPELINE_QUERIES,
  NATIONAL_PIPELINE_REGISTER,
  PRIORITY_LIST_PATTERN,
  assessPipelineAvailability,
  catalogueWalkIsComplete,
  ckanFieldsUrl,
  ckanOrganisationFacetUrl,
  ckanOrganisationPackagesUrl,
  ckanOrganisationShowUrl,
  ckanOrganisationSlugsUrl,
  ckanSampleUrl,
  ckanSearchUrl,
  corroborateOrganisations,
  mergeCatalogueReads,
  parseCkanSearch,
  parseOrganisationFacet,
  parseOrganisationShow,
  parseOrganisationSlugs,
  publisherFromEnumeration,
  pipelineCoverageNote,
  rankPipelineResources,
  surveyPipelinePackages,
  type CkanOrganisation,
  type CkanPackage,
  type CkanParse,
  type PipelineCandidate,
  type PublisherLookup,
} from '../../supabase/functions/_shared/planning/nationalPipeline.pure.ts';

const UA = 'npc-property-dashboard/1.0 (+https://github.com/Naidu-Group-Pty-Ltd)';
const FETCH_MS = 45_000;
const PKG_PAGE = 100;
const PKG_PAGES_MAX = 40;

/*
 * Everything prints on ONE stream. A heading on stdout and a verdict on
 * stderr are two buffers a log viewer interleaves as it pleases, which is how
 * the ABS probe's first failing run rendered its rule under the message
 * instead of under the heading. The exit code reports the failure; the text is
 * for a person, and a garbled verdict is harder to trust.
 */
const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(s.length)); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(26)} ${String(v)}`);

/**
 * Their side. Reported, never failed on.
 *
 * The refusing party's own words are printed, because this script cannot tell
 * the catalogue's refusal from an INTERMEDIARY'S — this egress answers 403 to
 * CONNECT and a throttled CKAN would answer 403 as well, and the two send an
 * operator to opposite remedies. A runner behind an allowlist would otherwise
 * make this gate a placebo that exits 0 having reached nothing.
 */
function theirs(what: string, detail: unknown, body?: string): never {
  h('THE CATALOGUE DID NOT ANSWER');
  kv('stage', what);
  kv('detail', detail);
  if (body !== undefined) kv('what refused, verbatim', JSON.stringify(body.slice(0, 300)));
  console.log('\n  This is a statement about the retrieval, not about the register.');
  console.log('  Read the line above before believing it was data.gov.au: a gateway on');
  console.log('  this egress refuses in the same digits, and that is a green build');
  console.log('  standing over a check that reached nothing.');
  console.log('  Exiting 0: a build must not be decided by another party’s uptime.');
  process.exit(0);
}

/** Our side. The only thing that fails this job. */
function ours(what: string, detail: unknown): never {
  h('OUR DISCOVERY REFUSED THE CATALOGUE’S OWN ANSWER');
  kv('stage', what);
  kv('detail', detail);
  console.log('\n  The catalogue answered and this repository could not read it.');
  console.log('  That is the one failure a synthetic fixture can never catch, and it is');
  console.log('  what this job exists for.');
  process.exit(1);
}

interface Fetched { status: number; body: string; bytes: number; ms: number }

async function get(url: string): Promise<Fetched> {
  const began = Date.now();
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  const body = await res.text();
  return { status: res.status, body, bytes: body.length, ms: Date.now() - began };
}

async function getOrTheirs(url: string, stage: string): Promise<Fetched> {
  let got: Fetched;
  try {
    got = await get(url);
  } catch (err) {
    theirs(stage, err instanceof Error ? err.message : String(err));
  }
  if (got.status !== 200) theirs(stage, `HTTP ${got.status}`, got.body);
  return got;
}

/** Stage 1 — is the publisher on the catalogue at all? */
async function findPublisher(): Promise<PublisherLookup> {
  h(`1 · Does the catalogue list ${NATIONAL_PIPELINE_PUBLISHER} as a publisher?`);
  kv('catalogue', CKAN_BASE);
  kv('publisher rule', String(NATIONAL_PIPELINE_ORG_PATTERN));

  /*
   * Two endpoints that fail differently. The list endpoint is the authority
   * for which organisations exist; the facet is the set actually publishing
   * packages, computed by the search index. An absence needs both, because a
   * single truncated question reads exactly like an empty world — which this
   * probe has now demonstrated twice.
   */
  const listGot = await getOrTheirs(ckanOrganisationSlugsUrl(), 'organisation list');
  const facetGot = await getOrTheirs(ckanOrganisationFacetUrl(), 'organisation facet');
  const list = parseOrganisationSlugs(listGot.body);
  const facet = parseOrganisationFacet(facetGot.body);
  const enumeration = corroborateOrganisations(list, facet);
  kv('list endpoint', list.kind === 'slugs' ? `${list.slugs.length} organisations` : `refused — ${list.reason}`);
  kv('index facet', facet.kind === 'slugs' ? `${facet.slugs.length} publishing organisations` : `refused — ${facet.reason}`);
  if (enumeration.kind === 'refused') {
    /*
     * A disagreement between the two is OURS to explain, not an absence and
     * not an outage: it means the question this probe asks cannot settle the
     * matter, and reporting it as either would be the defect again.
     */
    ours('corroborating the enumeration', enumeration.reason);
  }
  kv('corroborated', `${enumeration.slugs.length} organisations`);
  kv('slugs matching the rule', enumeration.matches.join(', ') || '(none)');

  const resolved: CkanOrganisation[] = [];
  let showRefusal = '';
  for (const slug of enumeration.matches) {
    const got = await getOrTheirs(ckanOrganisationShowUrl(slug), `organization_show ${slug}`);
    const parse = parseOrganisationShow(got.body);
    if (parse.kind === 'refused') { showRefusal = parse.reason; continue; }
    resolved.push(...parse.organisations);
  }
  const publisher = publisherFromEnumeration(
    enumeration,
    resolved.length > 0
      ? { kind: 'organisations', organisations: resolved }
      : { kind: 'refused', reason: showRefusal || 'no organisation was resolved' },
  );
  if (publisher.kind === 'publisher') {
    kv('publisher', `${publisher.organisation.title} (${publisher.organisation.name})`);
    kv('packages it holds', publisher.organisation.packageCount ?? '(unstated)');
  }
  /*
   * Every network failure above has already exited 0 through `theirs`, so a
   * refusal reaching here is this repository failing to read an answer it
   * received. Letting it fall through to `catalogue_unavailable` would file
   * our own parse failure as somebody else's outage — the placebo this
   * probe's header refuses.
   */
  if (publisher.kind === 'refused') ours('resolving the publisher', publisher.reason);
  return publisher;
}

/** Stage 2 — every package that publisher holds, walked to its declared count. */
async function walkPublisherPackages(orgId: string): Promise<CkanParse> {
  h('2 · That publisher’s packages, filtered rather than ranked');
  const pages: CkanParse[] = [];
  let declared: number | null = null;
  let read = 0;
  for (let page = 0; page < PKG_PAGES_MAX; page += 1) {
    const url = ckanOrganisationPackagesUrl(orgId, PKG_PAGE, page * PKG_PAGE);
    const got = await getOrTheirs(url, `package page ${page + 1}`);
    const parse = parseCkanSearch(got.body);
    if (parse.kind === 'refused') ours(`reading package page ${page + 1}`, parse.reason);
    declared ??= parse.total;
    read += parse.packages.length;
    pages.push(parse);
    if (parse.packages.length === 0 || read >= parse.total) break;
  }
  kv('packages declared', declared ?? '(unstated)');
  kv('packages read', read);
  const merged = mergeCatalogueReads(pages);
  if (merged.kind === 'refused') ours('merging the package walk', merged.reason);
  /*
   * The urban-centre register's rule: a load is judged by its effect, and the
   * walk must account for every declared entry. Reported here so a person
   * reading the log sees the arithmetic rather than trusting the verdict.
   */
  kv('walk complete', catalogueWalkIsComplete(merged) ? 'yes' : 'NO — an incomplete walk is not a smaller register');
  return merged;
}

/**
 * Stage 3 — the free-text searches, as a supplement and never as the authority.
 *
 * A package published under a department rather than the agency is invisible
 * to the enumeration, so the searches stay. What they may never do again is
 * decide an absence, which is why they are read after the enumeration and
 * reported as an addition to it.
 */
async function supplementarySearch(): Promise<CkanPackage[]> {
  h('3 · Free-text searches — a supplement, never the authority for an absence');
  const found: CkanPackage[] = [];
  for (const query of NATIONAL_PIPELINE_QUERIES) {
    const got = await getOrTheirs(ckanSearchUrl(query), `search ${JSON.stringify(query)}`);
    const parse = parseCkanSearch(got.body);
    if (parse.kind === 'refused') ours(`reading the answer to ${JSON.stringify(query)}`, parse.reason);
    const survivors = surveyPipelinePackages(parse.packages);
    console.log('');
    kv('query', query);
    kv('ranked hits', `${parse.packages.length} of ${parse.total} declared`);
    kv('survive both tests', survivors.length);
    for (const p of survivors) {
      console.log(`      ✔ ${p.title}  ·  org=${p.organisation ?? '(none)'}`);
    }
    found.push(...survivors);
  }
  return found;
}

async function main(): Promise<void> {
  const publisher = await findPublisher();

  let packages: CkanParse = { kind: 'catalogue', total: 0, packages: [] };
  if (publisher.kind === 'publisher') {
    packages = await walkPublisherPackages(publisher.organisation.id);
    const survivors = publisher.kind === 'publisher' && packages.kind === 'catalogue'
      ? surveyPipelinePackages(packages.packages)
      : [];
    console.log('');
    kv('register rule', String(PRIORITY_LIST_PATTERN));
    kv('packages that are the register', survivors.length);
    for (const p of survivors) {
      console.log(`      ✔ ${p.title}`);
      console.log(`        modified=${p.metadataModified ?? '(none)'} · licence=${p.licence ?? '(none)'}`);
      console.log(`        resources: ${p.resources.map((r) => `${r.format || '?'}${r.datastoreActive ? '/datastore' : ''}`).join(', ') || '(none)'}`);
    }
    if (survivors.length === 0 && packages.kind === 'catalogue') {
      /*
       * Print what the publisher DOES hold. "Enumerated in full and none of
       * them is this register" is a claim, and a claim a log cannot be checked
       * against is a claim nobody can audit.
       */
      console.log('\n      Everything this publisher holds, so the absence can be checked:');
      for (const p of packages.packages) {
        console.log(`      · ${p.title}  [${p.resources.map((r) => r.format || '?').join(', ') || 'no resource'}]`);
      }
    }
  }

  const supplementary = await supplementarySearch();
  if (supplementary.length > 0 && packages.kind === 'catalogue') {
    const seen = new Set(packages.packages.map((p) => p.id));
    const extra = supplementary.filter((p) => !seen.has(p.id));
    if (extra.length > 0) {
      console.log(`\n  The search found ${extra.length} the enumeration did not. Folding them in.`);
      packages = { kind: 'catalogue', total: packages.total + extra.length, packages: [...packages.packages, ...extra] };
    }
  }

  h('4 · The resources this repository would try, best first');
  const ranked = packages.kind === 'catalogue' ? rankPipelineResources(packages.packages) : [];
  if (ranked.length === 0) console.log('  (none)');
  ranked.forEach((c, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${c.access.padEnd(9)} ${c.resource.format.padEnd(7)} ${c.resource.name}`);
    console.log(`      package=${c.packageTitle}`);
    console.log(`      id=${c.resource.id} · size=${c.resource.size ?? '(unstated)'} · modified=${c.metadataModified ?? '(none)'}`);
    console.log(`      ${c.resource.url}`);
  });

  /*
   * The publisher lookup is re-stated as `publisher` for the assessment even
   * where the supplement found something, because a package the enumeration
   * missed is still that publisher's: what the supplement can change is the
   * PACKAGE set, never whether the publisher exists.
   */
  const availability = assessPipelineAvailability(publisher, packages);
  h('5 · The reading a report would carry');
  kv('availability', availability.kind);
  console.log(`\n  ${pipelineCoverageNote(availability)}`);

  if (availability.kind !== 'readable') {
    h('MEASURED: THE COVERAGE STATEMENT IS THE HONEST BRANCH');
    if (availability.kind === 'published_as_documents') {
      kv('formats offered', availability.formats.join(', ') || '(none stated)');
      console.log('\n  The register is published and is not a feed. A project read off a');
      console.log('  document travels through publishedProjectRegister.pure.ts, labelled');
      console.log('  “recorded from an official publication”, and never as a retrieval.');
    }
    if (availability.kind === 'not_in_catalogue') kv('packages enumerated', availability.searched);
    if (availability.kind === 'publisher_absent') {
      kv('organisations enumerated', availability.organisationsSeen);
      console.log('\n  The catalogue lists no such publishing organisation. The remedy is not');
      console.log('  another query here — it is the publisher’s own site, which is a');
      console.log('  publication and travels under publishedProjectRegister’s label.');
    }
    if (availability.kind === 'catalogue_unavailable') kv('reason', availability.reason);
    console.log('\n  Exiting 0. Nothing here is a defect: this is the measurement that');
    console.log('  settles which of W3.2’s two acceptance branches can be true, and a');
    console.log('  build must not go red over another party’s distribution choices.');
    process.exit(0);
  }

  h('6 · What the chosen resource DECLARES');
  let chosen: PipelineCandidate | null = null;
  for (const candidate of availability.candidates) {
    if (candidate.access !== 'queryable') {
      console.log(`\n  ${candidate.resource.name}: a download, not a queryable resource.`);
      console.log('  Its columns cannot be asked for without fetching it whole, so it is');
      console.log('  reported and not opened here. A later stage may measure the download.');
      continue;
    }
    let got: Fetched;
    try {
      got = await get(ckanFieldsUrl(candidate.resource.id));
    } catch (err) {
      console.log(`\n  ${candidate.resource.name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    console.log('');
    kv('resource', candidate.resource.name);
    kv('http', `${got.status} · ${got.bytes} bytes · ${got.ms} ms`);
    if (got.status !== 200) { kv('skipped', `HTTP ${got.status}`); continue; }
    let declared: { result?: { total?: number; fields?: { id: string; type: string }[] } };
    try {
      declared = JSON.parse(got.body);
    } catch (err) {
      ours('reading the declared fields', `${String(err)}: ${JSON.stringify(got.body.slice(0, 220))}`);
    }
    const total = declared.result?.total ?? null;
    const fields = declared.result?.fields ?? [];
    kv('rows the resource holds', total ?? '(unstated)');
    kv('columns declared', fields.length);
    for (const f of fields) console.log(`      ${f.id}  ·  ${f.type}`);
    /*
     * Rule 2, and the reason it is a rule: QTRIP's current edition is declared
     * `datastore_active` and holds zero rows. A resource chosen by declaration
     * rather than by effect reads an empty register as an empty country.
     */
    if (total === null || total === 0) {
      console.log('\n      Declared and empty. Walking on — the edition is the one that ANSWERS.');
      continue;
    }
    chosen = candidate;
    break;
  }

  if (!chosen) {
    h('EVERY MACHINE-READABLE EDITION IS EMPTY OR UNOPENABLE');
    console.log('  The catalogue lists the register as a feed and no edition of that feed');
    console.log('  returned a row. Asserted by effect, never by configuration: the');
    console.log('  coverage statement is still the honest branch today.');
    console.log('  Exiting 0 — this is a measurement, not a defect.');
    process.exit(0);
  }

  h('7 · A sample of the register’s own rows, verbatim');
  const sample = await getOrTheirs(ckanSampleUrl(chosen.resource.id, 5), 'sampling the chosen resource');
  kv('http', `${sample.status} · ${sample.bytes} bytes · ${sample.ms} ms`);
  let rows: { result?: { records?: Record<string, unknown>[] } };
  try {
    rows = JSON.parse(sample.body);
  } catch (err) {
    ours('reading the sample', `${String(err)}: ${JSON.stringify(sample.body.slice(0, 220))}`);
  }
  const records = rows.result?.records ?? [];
  kv('records', records.length);
  records.forEach((r, i) => {
    console.log(`\n  — record ${i + 1} —`);
    for (const [k, v] of Object.entries(r)) console.log(`      ${k.padEnd(34)} ${JSON.stringify(v)}`);
  });

  h('READ');
  kv('register', `${NATIONAL_PIPELINE_PUBLISHER} — ${NATIONAL_PIPELINE_REGISTER}`);
  kv('resource', chosen.resource.id);
  kv('licence', chosen.licence ?? '(the catalogue states none)');
  console.log('\n  The catalogue answered, the discovery read it, and the register holds');
  console.log('  rows. The columns above are what a row parser must be written against —');
  console.log('  measured, not assumed.');
}

main().catch((err) => {
  /*
   * An unexpected throw is OURS. A fetch failure is caught where it happens
   * and reported as theirs; anything reaching here is this script being wrong,
   * and reporting it as somebody else's outage is the placebo this file's
   * header refuses.
   */
  ours('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err));
});
