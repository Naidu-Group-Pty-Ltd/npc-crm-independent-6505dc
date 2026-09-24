/**
 * Does ACT, NT, TAS or WA publish a COUNT of residential sales?
 *
 * ## Why this exists
 *
 * W3.5 asks for sales counts in those four jurisdictions so Demand can score
 * nationally rather than in four states. Loading one needs a register WRITE —
 * a migration and an ingest stage — and that is a boundary this programme does
 * not cross without asking. **Asking the publishers does not.**
 *
 * So this is the step that decides whether the migration is worth requesting,
 * and what it would be for. It writes nothing anywhere: no database, no
 * Supabase, no credential, no table, no row. It reads five public catalogue
 * indexes and prints what they say.
 *
 * ## The trap this probe exists to avoid
 *
 * All four jurisdictions already hold a price series — `absResDwell`, the ABS
 * mean price of residential dwellings, at state grain. Every one of them also
 * publishes something called "property sales". So the easy and wrong outcome
 * is to find a sales dataset, report the gap closed, and change nothing:
 * `scoreTransactionVolume` needs a **count**, over four periods, at an area
 * finer than the state, and a second price series satisfies none of that.
 *
 * `judgeVolumeDataset` therefore asks whether the PUBLISHER says a count is in
 * it, and `medians_only` / `state_grain_only` are recorded as distinct
 * readings rather than as finds.
 *
 * ## An absence is corroborated or it is not claimed
 *
 * W3.2's lesson, paid twice there: a ranked page of full-text hits establishes
 * nothing about an absence, and one catalogue's silence is a statement about
 * that catalogue. So each jurisdiction is asked of its OWN catalogue and of
 * `data.gov.au`, which harvests the states and which this repository has
 * already measured answering from CI — and an absence requires both to answer.
 *
 * ## The exit code
 *
 * `abs-register-liveness`' rule, the fourth time.
 *
 *  - A catalogue that does not answer, or 404s: **0**. A build must not be
 *    decided by another party's uptime, and a typed API root that resolves to
 *    nothing is a gap in this repository that this probe's own output is the
 *    remedy for.
 *  - A catalogue that answers and holds no count series: **0**. That is the
 *    measurement, and it is what decides whether to ask for the migration.
 *  - A catalogue that answers and this repository cannot read what it sent:
 *    **1**. The one failure a fixture can never catch.
 */
import { lookup } from 'node:dns/promises';
import {
  VOLUME_CATALOGUES,
  VOLUME_GAP_STATES,
  VOLUME_PERIODS_REQUIRED,
  VOLUME_QUERIES,
  VOLUME_SCORED_STATES,
  assessVolumeCoverage,
  attributableTo,
  attributedRead,
  catalogueAnswered,
  SOCRATA_PORTALS,
  judgeCatalogueReach,
  mergeVolumeReads,
  parseSocrataCatalogue,
  socrataInventoryUrl,
  socrataSearchUrl,
  parseVolumeCatalogue,
  rankVolumeCandidates,
  volumeCoverageNote,
  volumeInventoryUrl,
  volumeSearchUrl,
  catalogueProbesFor,
  ckanRootFor,
  datasetsNamingASale,
  enumerationComplete,
  governmentPublishers,
  type EnumeratedPublisher,
  type VolumeRoute,
  harvestOrgFacetUrl,
  isJurisdictionHost,
  jurisdictionOrganisations,
  orgDatasetsUrl,
  parseDcatCatalogue,
  parseOrgFacet,
  publicationHostsOf,
  readCatalogueDialect,
  type CatalogueDialect,
  type VolumeGapState,
  type CatalogueVerdict,
  type VolumeCatalogue,
  type VolumeCatalogueParse,
  type VolumeCoverage,
  type VolumeDataset,
} from '../../supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure.ts';

const FETCH_MS = 30_000;
const UA = 'npc-property-dashboard/sales-volume-liveness (+demand coverage probe)';

const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(s.length)); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(28)} ${String(v)}`);

/** Our side. The only thing that fails this job. */
function ours(what: string, detail: unknown): never {
  h('A CATALOGUE ANSWERED AND THIS REPOSITORY COULD NOT READ IT');
  kv('stage', what);
  kv('detail', detail);
  console.log('\n  The publisher answered and this reader refused its answer. That is the');
  console.log('  one failure a synthetic fixture can never catch, and it is what this');
  console.log('  job exists for.');
  process.exit(1);
}

interface Fetched { status: number; body: string; bytes: number; ms: number; networkError: string | null }

async function ask(url: string): Promise<Fetched> {
  const began = Date.now();
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
      redirect: 'follow',
    });
    const body = await res.text();
    return { status: res.status, body, bytes: body.length, ms: Date.now() - began, networkError: null };
  } catch (err) {
    return {
      status: 0, body: '', bytes: 0, ms: Date.now() - began,
      networkError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ask one catalogue every query, and merge.
 *
 * Several queries rather than one, because a publisher's own words for this
 * differ by jurisdiction ("property transfers", "land sales", "number of
 * sales") and a single phrase would measure our vocabulary rather than theirs.
 * The merge de-duplicates by dataset id, so a dataset five queries all find is
 * counted once.
 */
interface CatalogueRead {
  parse: VolumeCatalogueParse;
  verdict: CatalogueVerdict;
  /** What the index said about its own size, so an absence can state it. */
  inventory: number | null;
  /** How the read was taken, where it is not the ordinary route. */
  route?: VolumeRoute;
}

async function askCatalogue(c: VolumeCatalogue): Promise<CatalogueRead> {
  console.log(`\n  · ${c.state} — ${c.publisher} (${c.kind})`);
  kv('api', c.api);

  /*
   * How big is this index at all?
   *
   * The second endpoint that fails differently, and it is the same catalogue
   * asked its own size. `200 · 0 declared` to five sales phrasings is either
   * a populated catalogue matching nothing (an answer) or an endpoint that is
   * not this jurisdiction's index (not an answer) — and the queries cannot
   * tell them apart. This question can.
   */
  let inventory: number | null = null;
  const inv = await ask(volumeInventoryUrl(c.api));
  if (inv.networkError === null && inv.status === 200) {
    const p = parseVolumeCatalogue(inv.body);
    if (p.kind === 'catalogue') inventory = p.total;
  }
  kv('the index says it holds', inventory === null
    ? `(it did not say — ${inv.networkError ?? `HTTP ${inv.status}`})`
    : `${inventory.toLocaleString('en-AU')} datasets`);

  const parses: VolumeCatalogueParse[] = [];
  let answered = false;
  for (const q of VOLUME_QUERIES) {
    const url = volumeSearchUrl(c.api, q, 50);
    const got = await ask(url);
    if (got.networkError !== null || got.status !== 200) {
      console.log(`      ${q.padEnd(30)} ${got.networkError !== null ? `network: ${got.networkError}` : `HTTP ${got.status}`}`);
      /*
       * A 404 on an API root is OUR typed host and no statement about the
       * jurisdiction — W3.4's rule. It is printed and never failed on, and the
       * body's first bytes go with it so the next increment can see what
       * answered instead of a CKAN index.
       */
      if (got.bytes > 0 && got.status !== 200) {
        console.log(`      ${' '.repeat(30)} ${JSON.stringify(got.body.slice(0, 120))}`);
      }
      continue;
    }
    const parse = parseVolumeCatalogue(got.body);
    if (parse.kind === 'refused') {
      /*
       * HTTP 200, real bytes, and no shape this reader knows. Two cases, and
       * only one is ours: a CKAN that refused the query says so inside a JSON
       * envelope this parser reads, while a portal that is not CKAN at all
       * answers HTML or a different schema. The second is a typed host being
       * wrong, which is printed; the first is a reader defect, which fails.
       */
      const looksJson = got.body.trimStart().startsWith('{');
      if (!looksJson) {
        console.log(`      ${q.padEnd(30)} 200 but not a CKAN index — ${parse.reason}`);
        continue;
      }
      ours(`${c.state} — ${q}`, parse.reason);
    }
    answered = true;
    console.log(`      ${q.padEnd(30)} 200 · ${parse.total} declared · ${parse.datasets.length} read · ${got.ms} ms`);
    parses.push(parse);
  }
  const parse: VolumeCatalogueParse = answered
    ? mergeVolumeReads(parses)
    : { kind: 'refused', reason: `no query reached ${c.api} as a CKAN index` };
  const verdict = judgeCatalogueReach(parse, {
    inventory,
    matched: parse.kind === 'catalogue' ? parse.datasets.length : 0,
  });
  kv('verdict', verdict.kind === 'not_this_index'
    ? `not this index — ${verdict.detail}`
    : verdict.kind);
  return { parse, verdict, inventory };
}

function printCandidates(parse: VolumeCatalogueParse): void {
  if (parse.kind !== 'catalogue') return;
  const ranked = rankVolumeCandidates(parse.datasets);
  kv('datasets examined', parse.datasets.length);
  kv('carrying a COUNT', ranked.length);
  for (const c of ranked.slice(0, 6)) {
    console.log(`\n      ${c.dataset.title}`);
    console.log(`        publisher   ${c.dataset.organisation ?? '(the catalogue states none)'}`);
    console.log(`        licence     ${c.dataset.licence ?? '(the catalogue states none)'}`);
    console.log(`        sub-state   ${c.subState ? 'yes' : 'NO — state grain only, already held'}`);
    console.log(`        formats     ${c.formats.length > 0 ? c.formats.join(', ') : '(none stated)'}`);
    console.log(`        feed        ${c.machineReadable
      ? `${c.machineReadable.format} ${c.machineReadable.id}${c.machineReadable.datastoreActive ? ' (queryable)' : ''}`
      : 'NO machine-readable resource'}`);
    console.log(`        updated     ${c.dataset.metadataModified ?? '(not stated)'}`);
  }
}

/**
 * Ask a Socrata portal, where a jurisdiction runs one.
 *
 * A second dialect, added because the measurement named it: the ACT
 * answered a CKAN 3 path with `404 {"message":"No service found for this
 * URL."}` — a JSON API that exists and does not speak CKAN.
 *
 * It projects onto the SAME `VolumeDataset` shape, so one judgement serves
 * both dialects. And its catalog API is domain-scoped, so it cannot return
 * another jurisdiction's dataset — the Victorian-department defect cannot
 * recur through this route by construction.
 */
async function askSocrata(portal: typeof SOCRATA_PORTALS[number]): Promise<CatalogueRead> {
  console.log(`\n  · ${portal.state} — ${portal.publisher} (Socrata)`);
  kv('catalog', socrataSearchUrl(portal.domain, '…').split('?')[0]);
  kv('domain', portal.domain);

  let inventory: number | null = null;
  const inv = await ask(socrataInventoryUrl(portal.domain));
  if (inv.networkError === null && inv.status === 200) {
    const p = parseSocrataCatalogue(inv.body);
    if (p.kind === 'catalogue') inventory = p.total;
  }
  kv('the index says it holds', inventory === null
    ? `(it did not say — ${inv.networkError ?? `HTTP ${inv.status}`})`
    : `${inventory.toLocaleString('en-AU')} datasets`);

  const parses: VolumeCatalogueParse[] = [];
  let answered = false;
  for (const q of VOLUME_QUERIES) {
    const got = await ask(socrataSearchUrl(portal.domain, q, 50));
    if (got.networkError !== null || got.status !== 200) {
      console.log(`      ${q.padEnd(30)} ${got.networkError !== null ? `network: ${got.networkError}` : `HTTP ${got.status}`}`);
      if (got.bytes > 0) console.log(`      ${' '.repeat(30)} ${JSON.stringify(got.body.slice(0, 120))}`);
      continue;
    }
    const parse = parseSocrataCatalogue(got.body);
    if (parse.kind === 'refused') {
      const looksJson = got.body.trimStart().startsWith('{');
      if (!looksJson) {
        console.log(`      ${q.padEnd(30)} 200 but not a Socrata catalog — ${parse.reason}`);
        continue;
      }
      ours(`${portal.state} Socrata — ${q}`, parse.reason);
    }
    answered = true;
    console.log(`      ${q.padEnd(30)} 200 · ${parse.total} declared · ${parse.datasets.length} read · ${got.ms} ms`);
    parses.push(parse);
  }
  const parse: VolumeCatalogueParse = answered
    ? mergeVolumeReads(parses)
    : { kind: 'refused', reason: `no query reached the Socrata catalog for ${portal.domain}` };
  const verdict = judgeCatalogueReach(parse, {
    inventory,
    matched: parse.kind === 'catalogue' ? parse.datasets.length : 0,
  });
  kv('verdict', verdict.kind === 'not_this_index' ? `not this index — ${verdict.detail}` : verdict.kind);
  return { parse, verdict, inventory };
}

/**
 * Where does a jurisdiction actually publish? Asked of the harvest's own
 * records, never typed — see the note above `JURISDICTION_DOMAINS`.
 *
 * Runs only where the jurisdiction's typed root did not answer, because that
 * is the one case where the probe would otherwise have to guess. Everything
 * it finds is printed, answered or not: a host that is not a catalogue is
 * still where the publisher's bytes are, and that is what the next
 * increment reads.
 */
async function discoverOwnCatalogue(
  state: VolumeGapState,
  harvestApi: string,
  typedRoot: string,
): Promise<CatalogueRead | null> {
  h(`${state} — where does it actually publish?`);

  // Does the typed root resolve at all? A DNS answer separates "the name
  // does not exist" from "the name exists and would not talk to us".
  const typedHost = new URL(typedRoot).hostname;
  try {
    const addr = await lookup(typedHost);
    kv(`${typedHost} resolves`, `yes — ${addr.address}`);
  } catch (err) {
    const code = (err as { code?: string }).code ?? (err instanceof Error ? err.message : String(err));
    kv(`${typedHost} resolves`, `NO — ${code}`);
  }

  // 1 — the harvest's publishers for this jurisdiction, from its own facet.
  const names = { ACT: 'australian capital territory', NT: 'northern territory', TAS: 'tasmania', WA: 'western australia' } as const;
  const facetGot = await ask(harvestOrgFacetUrl(harvestApi, names[state]));
  if (facetGot.networkError !== null || facetGot.status !== 200) {
    kv('harvest publishers', `not read — ${facetGot.networkError ?? `HTTP ${facetGot.status}`}`);
    return null;
  }
  const facet = parseOrgFacet(facetGot.body);
  if (facet.kind === 'refused') ours(`${state} harvest organisation facet`, facet.reason);
  const named = jurisdictionOrganisations(facet.organisations, state);
  const orgs = governmentPublishers(facet.organisations, state);
  kv('harvest publishers named', `${facet.organisations.length} for the query, ${named.length} of them ${state}'s by their own name, ${orgs.length} of those its government (universities and institutes set aside)`);
  for (const o of named.slice(0, 20)) {
    console.log(`      ${String(o.count).padStart(5)}  ${o.title}  (${o.name})${orgs.includes(o) ? '' : '  — not the government'}`);
  }
  if (orgs.length === 0) return null;

  /*
   * 2 — EVERY dataset those publishers list, read in full.
   *
   * Not a sample: an absence stated from part of a list is the
   * `organization_list`-answered-with-25 fault. Each publisher is paged until
   * what was read reaches what the index declared, and one short read makes
   * the whole enumeration short.
   */
  const datasets: VolumeDataset[] = [];
  const seen = new Set<string>();
  const enumerated: EnumeratedPublisher[] = [];
  for (const o of orgs) {
    let read = 0;
    let declared = o.count;
    for (let start = 0; start < 5_000; start += 1_000) {
      const got = await ask(orgDatasetsUrl(harvestApi, o.name, 1_000, start));
      if (got.networkError !== null || got.status !== 200) {
        console.log(`      ${o.name.padEnd(44)} page at ${start}: ${got.networkError ?? `HTTP ${got.status}`}`);
        break;
      }
      const parse = parseVolumeCatalogue(got.body);
      if (parse.kind === 'refused') ours(`${state} harvest datasets for ${o.name}`, parse.reason);
      declared = parse.total;
      read += parse.datasets.length;
      for (const d of parse.datasets) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        datasets.push(d);
      }
      if (parse.datasets.length === 0 || read >= declared) break;
    }
    enumerated.push({ name: o.name, title: o.title, declared, read });
    console.log(`      ${o.name.padEnd(44)} ${read} of ${declared} read`);
  }
  const complete = enumerationComplete(enumerated);
  kv('enumeration', complete
    ? `complete — ${datasets.length.toLocaleString('en-AU')} datasets across ${enumerated.length} publishers`
    : `SHORT — ${enumerated.filter((p) => p.read < p.declared).map((p) => `${p.name} ${p.read}/${p.declared}`).join(', ')}`);

  const hosts = publicationHostsOf(datasets);
  kv('hosts serving them', hosts.length);
  for (const t of hosts.slice(0, 15)) {
    const own = isJurisdictionHost(t.host, state) ? `${state}'s own` : 'elsewhere';
    console.log(`      ${String(t.datasets).padStart(5)} datasets  ${String(t.resources).padStart(5)} files  ${t.host.padEnd(42)} ${own}  ${t.paths.join(' ')}`);
  }

  // 3 — which of the jurisdiction's own hosts is a catalogue, in which dialect.
  const ownHosts = hosts.filter((t) => isJurisdictionHost(t.host, state)).slice(0, 8);
  if (ownHosts.length === 0) {
    kv('own hosts', `none — every file ${state}'s publishers list is served from outside ${state}'s own domain`);
    return null;
  }
  const answered: { host: string; dialect: CatalogueDialect; inventory: number | null }[] = [];
  const arcgisHosts: string[] = [];
  for (const t of ownHosts) {
    console.log(`\n    ${t.host}`);
    for (const probe of catalogueProbesFor(t.host)) {
      const got = await ask(probe.url);
      if (got.networkError !== null) {
        console.log(`      ${probe.dialect.padEnd(10)} network: ${got.networkError}`);
        continue;
      }
      const a = readCatalogueDialect(probe.dialect, got.status, got.body);
      console.log(`      ${probe.dialect.padEnd(10)} ${a.answered ? 'ANSWERED' : 'no'.padEnd(8)} ${a.detail}`);
      if (a.answered && probe.dialect !== 'arcgis') answered.push({ host: t.host, dialect: probe.dialect, inventory: a.inventory });
      if (a.answered && probe.dialect === 'arcgis') arcgisHosts.push(t.host);
    }
  }
  // A map-service directory is a catalogue of LAYERS. Walk its folders once
  // for a layer named for sales — a lead to record, never a count series.
  for (const t of arcgisHosts) {
    const root = `https://${t}/arcgis/rest/services`;
    const top = await ask(`${root}?f=json`);
    const folders: string[] = (() => {
      try { return (JSON.parse(top.body) as { folders?: string[] }).folders ?? []; } catch { return []; }
    })();
    const hits: string[] = [];
    for (const f of folders.slice(0, 24)) {
      const got = await ask(`${root}/${encodeURIComponent(f)}?f=json`);
      try {
        const services = (JSON.parse(got.body) as { services?: { name?: string; type?: string }[] }).services ?? [];
        for (const sv of services) if (/sale|transfer|valu/i.test(sv.name ?? '')) hits.push(`${sv.name} (${sv.type})`);
      } catch { /* a folder that is not JSON names nothing */ }
    }
    kv(`${t} layers named for sales`, hits.length > 0 ? hits.join(', ') : `none across ${Math.min(folders.length, 24)} folder(s)`);
  }

  if (answered.length === 0) {
    kv('searchable catalogue', `none of ${ownHosts.length} own host(s) answered as CKAN, Socrata or a DCAT feed`);
    /*
     * No catalogue of its own: the Commonwealth catalogue IS where this
     * jurisdiction's data is indexed, and the enumeration above is the
     * whole of it. Judge that — the sale-naming datasets among EVERYTHING its
     * government lists — rather than report the absence of a catalogue as
     * the absence of an answer.
     */
    const saleNaming = datasetsNamingASale(datasets);
    kv('datasets naming a sale', `${saleNaming.length} of ${datasets.length.toLocaleString('en-AU')}`);
    for (const d of saleNaming.slice(0, 12)) console.log(`      ${d.title}  (${d.organisation ?? 'no publisher'})`);
    const parse: VolumeCatalogueParse = { kind: 'catalogue', total: saleNaming.length, datasets: saleNaming };
    return {
      parse,
      verdict: complete
        ? judgeCatalogueReach(parse, { inventory: datasets.length, matched: saleNaming.length })
        : { kind: 'not_this_index', detail: 'the list of its government publishers was not read in full' },
      inventory: datasets.length,
      route: 'harvest_enumeration',
    };
  }

  // 4 — search the biggest one, in its own dialect.
  const best = [...answered].sort((a, b) => (b.inventory ?? 0) - (a.inventory ?? 0))[0];
  kv('searching', `${best.host} as ${best.dialect}${best.inventory !== null ? ` (${best.inventory.toLocaleString('en-AU')} datasets)` : ''}`);
  if (best.dialect === 'ckan' || best.dialect === 'ckan_data') {
    return askCatalogue({ state, publisher: `${best.host} (discovered from the harvest)`, api: ckanRootFor(best.host, best.dialect), kind: 'own' });
  }
  if (best.dialect === 'socrata') {
    return askSocrata({ state, publisher: `${best.host} (discovered from the harvest)`, domain: best.host });
  }
  // DCAT: the feed IS the inventory, so it is judged whole rather than queried.
  const feed = await ask(`https://${best.host}/data.json`);
  const parse = parseDcatCatalogue(feed.body, best.host);
  if (parse.kind === 'refused') ours(`${state} DCAT feed at ${best.host}`, parse.reason);
  const matched = datasetsNamingASale(parse.datasets);
  kv('feed datasets naming a sale', `${matched.length} of ${parse.total}`);
  const matchedParse: VolumeCatalogueParse = { kind: 'catalogue', total: parse.total, datasets: matched };
  return {
    parse: matchedParse,
    verdict: judgeCatalogueReach(matchedParse, { inventory: parse.total, matched: matched.length }),
    inventory: parse.total,
  };
}

async function main(): Promise<void> {
  h('Does ACT, NT, TAS or WA publish a COUNT of residential sales?');
  kv('jurisdictions', VOLUME_GAP_STATES.join(', '));
  kv('already scoring', VOLUME_SCORED_STATES.join(', '));
  kv('periods a reading needs', VOLUME_PERIODS_REQUIRED);
  console.log('\n  All four already hold a PRICE series at state grain (the ABS mean price of');
  console.log('  residential dwellings), so a second price series closes nothing and would');
  console.log('  look, from a dashboard, exactly like a fix. What is missing is a COUNT,');
  console.log('  over four periods, at an area finer than the state.');
  console.log('\n  This writes nothing anywhere: no database, no table, no row, no');
  console.log('  credential. It reads five public catalogue indexes.');

  // The harvest catalogue is asked ONCE and its answer serves every
  // jurisdiction, because it indexes all of them.
  const harvestEntry = VOLUME_CATALOGUES.find((c) => c.kind === 'harvest');
  if (!harvestEntry) ours('configuration', 'no harvest catalogue declared — an absence could not be corroborated');
  h('The Commonwealth catalogue, which harvests the states');
  const harvestRead = await askCatalogue(harvestEntry);
  const harvest = harvestRead.parse;
  printCandidates(harvest);

  const readings: { state: string; coverage: VolumeCoverage; note: string }[] = [];

  for (const state of VOLUME_GAP_STATES) {
    const own = VOLUME_CATALOGUES.find((c) => c.state === state && c.kind === 'own');
    h(`${state}`);
    if (!own) ours(`${state} configuration`, 'no own catalogue declared');
    let ownRead = await askCatalogue(own);
    /*
     * Where the CKAN root did not answer and the jurisdiction runs a Socrata
     * portal, ask that instead. Both are printed: the CKAN 404 is the
     * evidence that sent us here, and hiding it would make the next reader
     * wonder why a second dialect exists.
     */
    const socrata = SOCRATA_PORTALS.find((sp) => sp.state === state);
    if (socrata && !catalogueAnswered(ownRead.verdict)) {
      ownRead = await askSocrata(socrata);
    }
    /*
     * Where the typed root still has not answered, ask the harvest where this
     * jurisdiction actually publishes rather than typing a second guess. The
     * typed root's failure stays printed above: it is the evidence that sent
     * the probe here.
     */
    if (!catalogueAnswered(ownRead.verdict)) {
      const discovered = await discoverOwnCatalogue(state, harvestEntry.api, own.api);
      if (discovered && catalogueAnswered(discovered.verdict)) ownRead = discovered;
    }
    const ownParse = ownRead.parse;
    printCandidates(ownParse);

    /*
     * ── Attribution, then corroboration ─────────────────────────────────
     *
     * The first live run read `countable` for the Northern Territory over
     * "datasets examined 0" and named a VICTORIAN department, because the
     * harvest catalogue's datasets were folded in and then ranked. A harvest
     * indexes every publisher in the country, so a hit in it is a statement
     * about the harvest.
     *
     * So each dataset is attributed to this jurisdiction FIRST — trivially
     * for the jurisdiction's own catalogue, by the publisher's own name for
     * the harvest — and only attributed datasets can become a candidate.
     *
     * Once each, and counted as its sentence reads (`attributedRead`): on the
     * enumeration route the list and the search ask the SAME index, so a
     * dataset can arrive by both, and the sentence's number describes the
     * enumerated list — the 23 Sep run printed "6 name a sale" beside its own
     * "5 of 982" for exactly that reason.
     */
    const read = attributedRead({
      own: ownParse.kind === 'catalogue'
        ? ownParse.datasets.filter((d) => attributableTo(d, state, 'own'))
        : [],
      harvest: harvest.kind === 'catalogue'
        ? harvest.datasets.filter((d) => attributableTo(d, state, 'harvest'))
        : [],
      route: ownRead.route,
    });
    kv('attributable to ' + state, `${read.parse.datasets.length} distinct — `
      + `${read.harvestOnly.length} found only by the harvest search`
      + `${read.overlap > 0 ? `, ${read.overlap} it also returned from ${state}'s own list` : ''}`);
    for (const d of read.harvestOnly.slice(0, 8)) {
      console.log(`      harvest  ${d.title}  (${d.organisation ?? 'no publisher'})`);
    }
    if (ownRead.route === 'harvest_enumeration') {
      kv('the sentence counts', `${read.parse.total} — the enumerated list's own; the search corroborates it`);
    }

    /*
     * Corroboration: BOTH must have ANSWERED, and `200 · 0 declared` on every
     * query is not an answer — measured, `data.nt.gov.au` did exactly that
     * five times, which is indistinguishable from a wrong endpoint.
     */
    const corroborated = catalogueAnswered(ownRead.verdict) && catalogueAnswered(harvestRead.verdict);
    const merged = read.parse;
    const coverage = assessVolumeCoverage(
      corroborated ? merged : (ownParse.kind === 'refused' ? ownParse : merged),
      corroborated,
      ownRead.inventory,
      ownRead.route,
    );
    console.log('');
    kv('reading', coverage.kind);
    kv('corroborated', corroborated
      ? (ownRead.route === 'harvest_enumeration'
        ? 'yes — its government publishers\' whole list, read in full, and the search of the same index'
        : 'yes — both catalogues answered')
      : 'NO — only one answered');
    const note = volumeCoverageNote(coverage, state);
    console.log(`\n  What a report may say:\n    ${note}`);
    readings.push({ state, coverage, note });
  }

  h('READ');
  for (const r of readings) kv(r.state, r.coverage.kind);

  const countable = readings.filter((r) => r.coverage.kind === 'countable');
  const nearMiss = readings.filter((r) =>
    r.coverage.kind === 'state_grain_only' || r.coverage.kind === 'published_as_documents');
  const absent = readings.filter((r) =>
    r.coverage.kind === 'medians_only' || r.coverage.kind === 'no_count_published');
  const unknown = readings.filter((r) => r.coverage.kind === 'catalogue_unavailable');

  console.log('\n  What this settles, and what it does not:\n');
  if (countable.length > 0) {
    console.log(`  · ${countable.map((r) => r.state).join(', ')} — a count series exists, sub-state and`);
    console.log('    machine-readable. Loading it needs a register write, which is a');
    console.log('    migration and an ingest stage and therefore an approval to ask for.');
    console.log('    The resource ids above are what that stage would read.');
  }
  if (nearMiss.length > 0) {
    console.log(`  · ${nearMiss.map((r) => r.state).join(', ')} — a count is published and cannot close`);
    console.log('    the gap as published: either it describes the whole state (which the ABS');
    console.log('    series already does) or it is a document rather than a feed. Recorded as');
    console.log('    a near miss so nobody builds an ingest against it.');
  }
  if (absent.length > 0) {
    console.log(`  · ${absent.map((r) => r.state).join(', ')} — no sub-state count found, corroborated`);
    console.log('    across the jurisdiction\'s own catalogue and the Commonwealth catalogue.');
    console.log('    That is a limit of what is published. It is NOT a count of zero and no');
    console.log('    report may read it as few sales.');
  }
  if (unknown.length > 0) {
    console.log(`  · ${unknown.map((r) => r.state).join(', ')} — could not be established. A typed API`);
    console.log('    root that resolves to nothing is a gap HERE, and this output names it.');
  }
  console.log('');
  console.log('  Exiting 0: every reading above is a measurement. The only red in this');
  console.log('  job is a catalogue answering and this reader refusing its answer.');
}

main().catch((err) => {
  ours('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err));
});
