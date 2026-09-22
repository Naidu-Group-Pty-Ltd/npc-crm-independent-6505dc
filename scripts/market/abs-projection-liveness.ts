/**
 * Does the ABS publish population projections, and at what grain?
 *
 * ## Why this exists
 *
 * W3.3 is written as *"National forward demand: ABS population projections by
 * SA2"*, and **that premise has never been checked**. Two premises in this
 * programme have already been wrong by exactly that route — *"no integrated
 * layer publishes overlays at a point"*, wrong for four jurisdictions, and
 * *"Queensland publishes none"* of a median sale price it publishes under a
 * different product. Both were wrong because nobody asked the publisher.
 *
 * The development egress cannot ask: the gateway answers **403 to CONNECT**
 * for `data.api.abs.gov.au`. A GitHub runner has open internet, so this asks
 * from CI, and it writes nothing anywhere — no database, no Supabase, no
 * credential.
 *
 * ## What it measures, and why the grain is the whole question
 *
 * A projection at SA2 describes the property's own area. A projection for a
 * state describes a region the property happens to sit in, and printing one
 * beside a property is the defect `MARKET_FIGURES_IN_THE_REPORT.md` already
 * names: *a state figure beside a suburb one reads as the suburb's.* So the
 * grain is read from the flow's own region CODELIST rather than from its
 * title, by counting codes by ASGS shape. A measured `state` answer is a
 * finding that shapes the design, not a failure.
 *
 * It also reads the SERIES dimension, because the ABS publishes assumption
 * SETS rather than one forecast, and a reading that picks one silently has
 * adopted an assumption nobody chose.
 *
 * ## The exit code is the whole design
 *
 * `abs-approvals-liveness.ts`'s rule, for the same reason. **The ABS being
 * unreachable is not our failure**, so a refusal, a timeout or a 5xx reports
 * and exits 0. What exits 1 is the case that IS ours: the ABS answered and
 * our own reader could not read what it sent. A measured absence — the ABS
 * publishes projections and not at SA2 — exits 0 and says so in as many
 * words, because a build must not go red over another party's publishing
 * decisions.
 */
import {
  ABS_BA_DATAFLOW_CATALOGUE_URL,
  dataflowRef,
  parseDataflowCatalogue,
  type DataflowEntry,
} from '../../supabase/functions/_shared/reports/market/openData/absBuildingApprovals.pure.ts';
import {
  ABS_SDMX_STRUCTURE_ACCEPT,
  absDataStructureUrl,
  isOurRequestFault,
  parseDataStructure,
} from '../../supabase/functions/_shared/reports/market/openData/absDataStructure.pure.ts';
import {
  ABS_PROJECTION_SOURCE_LABEL,
  ESTIMATE_NAME_PATTERN,
  GRAIN_PRESENCE_FLOOR,
  PROJECTION_GRAIN_LABEL,
  PROJECTION_GRAIN_ORDER,
  PROJECTION_NAME_PATTERN,
  describesTheArea,
  readProjectionStructure,
  surveyPopulationFlows,
  type ProjectionGrain,
} from '../../supabase/functions/_shared/reports/market/openData/absPopulationProjections.pure.ts';

const UA = 'npc-property-dashboard/1.0 (+https://github.com/Naidu-Group-Pty-Ltd)';
const FETCH_MS = 90_000;

/*
 * One stream. A heading on stdout and a verdict on stderr are two buffers a
 * log viewer interleaves as it pleases, which is how the ABS approvals probe's
 * first failing run printed its rule under the message instead of under the
 * heading.
 */
const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(s.length)); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(28)} ${String(v)}`);

/** Their side. Reported, never failed on. */
function theirs(what: string, detail: unknown, body?: string): never {
  h('THE ABS DID NOT ANSWER');
  kv('stage', what);
  kv('detail', detail);
  if (body !== undefined) kv('what refused, verbatim', JSON.stringify(body.slice(0, 300)));
  console.log('\n  This is a statement about the retrieval, not about the register.');
  console.log('  Read the line above before believing it was the Bureau: a gateway on');
  console.log('  this egress refuses in the same digits, and that is a green build');
  console.log('  standing over a check that reached nothing.');
  console.log('  Exiting 0: a build must not be decided by another party’s uptime.');
  process.exit(0);
}

/** Our side. The only thing that fails this job. */
function ours(what: string, detail: unknown): never {
  h('OUR READER REFUSED THE ABS’S OWN ANSWER');
  kv('stage', what);
  kv('detail', detail);
  console.log('\n  The ABS answered and this repository could not read it. That is the');
  console.log('  one failure a synthetic fixture can never catch, and it is what this');
  console.log('  job exists for.');
  process.exit(1);
}

interface Fetched { status: number; body: string; bytes: number; ms: number }

async function get(url: string, accept: string): Promise<Fetched> {
  const began = Date.now();
  const res = await fetch(url, {
    headers: { accept, 'user-agent': UA },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  const body = await res.text();
  return { status: res.status, body, bytes: body.length, ms: Date.now() - began };
}

async function getOrTheirs(url: string, accept: string, stage: string): Promise<Fetched> {
  let got: Fetched;
  try {
    got = await get(url, accept);
  } catch (err) {
    theirs(stage, err instanceof Error ? err.message : String(err));
  }
  if (got.status !== 200) theirs(stage, `HTTP ${got.status}`, got.body);
  return got;
}

async function main(): Promise<void> {
  h('1 · What the ABS publishes about population');
  kv('catalogue', ABS_BA_DATAFLOW_CATALOGUE_URL);
  kv('projection rule', String(PROJECTION_NAME_PATTERN));
  kv('refusal rule', String(ESTIMATE_NAME_PATTERN));

  const cat = await getOrTheirs(ABS_BA_DATAFLOW_CATALOGUE_URL, ABS_SDMX_STRUCTURE_ACCEPT, 'the dataflow catalogue');
  kv('http', `${cat.status} · ${cat.bytes} bytes · ${cat.ms} ms`);
  let entries: DataflowEntry[];
  try {
    entries = parseDataflowCatalogue(cat.body);
  } catch (err) {
    ours('reading the catalogue', err instanceof Error ? err.message : String(err));
  }
  kv('flows in the catalogue', entries.length);

  const surveyed = surveyPopulationFlows(entries);
  const projections = surveyed.filter((s) => s.kind === 'projection');
  const estimates = surveyed.filter((s) => s.kind === 'estimate');
  kv('projection flows', projections.length);
  kv('estimate flows (REFUSED)', estimates.length);

  console.log('\n  Projections — admissible:');
  if (projections.length === 0) console.log('      (none)');
  for (const s of projections) console.log(`      ${dataflowRef(s.entry).padEnd(46)} ${s.entry.name}`);

  console.log('\n  Estimates — named so the two cannot be confused:');
  if (estimates.length === 0) console.log('      (none)');
  for (const s of estimates) console.log(`      ${dataflowRef(s.entry).padEnd(46)} ${s.entry.name}`);

  if (projections.length === 0) {
    h('MEASURED: THE CATALOGUE HOLDS NO POPULATION PROJECTION FLOW');
    console.log('  W3.3 is written as "ABS population projections by SA2". The ABS\'s own');
    console.log('  catalogue answered and names no projection flow at all, so the premise');
    console.log('  is wrong at its first step and the forward reading has to come from');
    console.log('  somewhere else — which is a design finding, not a defect.');
    console.log('\n  Exiting 0: this is a measurement.');
    process.exit(0);
  }

  h('2 · Each projection flow’s own structure');
  const findings: Array<{ ref: string; name: string; finest: ProjectionGrain | null; sa2: number }> = [];
  for (const s of projections) {
    const url = absDataStructureUrl(s.entry);
    console.log('');
    kv('flow', `${dataflowRef(s.entry)} — ${s.entry.name}`);
    let got: Fetched;
    try {
      got = await get(url, ABS_SDMX_STRUCTURE_ACCEPT);
    } catch (err) {
      kv('structure', `not reached — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    kv('structure http', `${got.status} · ${got.bytes} bytes · ${got.ms} ms`);
    /*
     * A 406 is the server saying it cannot serve what we ASKED FOR, which is a
     * statement about our request. The first run of this probe sent the XML
     * structure media type with no fallback, took 406 on every flow, and
     * printed "THE PREMISE DOES NOT HOLD" over it — so this case is ours and
     * fails the job rather than being skipped past.
     */
    if (isOurRequestFault(got.status)) {
      ours(`requesting the structure of ${dataflowRef(s.entry)}`,
        `HTTP ${got.status} — the Accept header this probe sent is not one the ABS serves: `
        + JSON.stringify(got.body.slice(0, 200)));
    }
    if (got.status !== 200) { kv('skipped', `HTTP ${got.status}`); continue; }
    let reading: ReturnType<typeof readProjectionStructure>;
    try {
      reading = readProjectionStructure(parseDataStructure(got.body));
    } catch (err) {
      ours(`reading the structure of ${dataflowRef(s.entry)}`, err instanceof Error ? err.message : String(err));
    }

    console.log('      dimensions:');
    for (const d of reading.dimensions) {
      console.log(`        ${String(d.position).padStart(2)}. ${d.id.padEnd(22)} ${String(d.codes).padStart(6)} codes${d.isTime ? '  (time)' : ''}`);
    }

    if (!reading.region) {
      kv('region dimension', 'NONE MATCHED — the flow names no geography this reader knows');
      findings.push({ ref: dataflowRef(s.entry), name: s.entry.name, finest: null, sa2: 0 });
      continue;
    }
    kv('region dimension', reading.region.dimensionId);
    console.log('      region codes by grain:');
    for (const grain of PROJECTION_GRAIN_ORDER) {
      const n = reading.region.counts[grain] ?? 0;
      if (n === 0) continue;
      const enough = n >= GRAIN_PRESENCE_FLOOR ? '' : `  (below the floor of ${GRAIN_PRESENCE_FLOOR} — not coverage)`;
      console.log(`        ${grain.padEnd(9)} ${String(n).padStart(6)}${enough}`);
    }
    if (reading.region.unplaced.length > 0) {
      /*
       * WITH THEIR NAMES. The first live run printed bare ids — `11, 12, 21,
       * 22, 31, 32, 41, 42` — beside `finest grain: state`, and a two-digit
       * ASGS code is very likely a capital-city and rest-of-state split,
       * which would be FINER than state and therefore understate the answer.
       * "Very likely" is not a measurement; the name is. This is the line
       * that turns the next run into the rule.
       */
      kv('codes the rules could not place', reading.region.unplaced.length);
      for (const c of reading.region.unplaced.slice(0, 20)) {
        console.log(`        ${c.id.padEnd(12)} ${c.name}`);
      }
    }
    kv('finest published grain', reading.finestGrain ?? '(none reached the floor)');
    kv('describes the property’s area', reading.finestGrain ? (describesTheArea(reading.finestGrain) ? 'YES' : 'no — a larger region') : 'no');
    kv('series dimension', reading.seriesDimensionId ?? '(none — the ABS models assumptions as a cross-product)');
    if (reading.seriesNames.length > 0) {
      console.log(`      series the publisher offers: ${reading.seriesNames.join(' · ')}`);
    }
    kv('assumption dimensions', reading.assumptions.map((a) => `${a.id}(${a.choices.length})`).join(' × ') || '(none)');
    kv('combinations a figure rests on', reading.combinations);
    for (const a of reading.assumptions) {
      console.log(`        ${a.id.padEnd(14)} ${a.choices.map((c) => c.name).join(' · ')}`);
    }
    findings.push({
      ref: dataflowRef(s.entry),
      name: s.entry.name,
      finest: reading.finestGrain,
      sa2: reading.region.counts.sa2 ?? 0,
    });
  }

  h('3 · What W3.3’s premise actually is');
  const withSa2 = findings.filter((f) => f.sa2 >= GRAIN_PRESENCE_FLOOR);
  const finestAnywhere = PROJECTION_GRAIN_ORDER.find((g) => findings.some((f) => f.finest === g)) ?? null;
  kv('flows read', findings.length);
  /*
   * A verdict over nothing is the defect this probe shipped with. The
   * catalogue answered and named projection flows; if none of their
   * structures was read, that is a failure of THIS SCRIPT and the premise is
   * untested — so it must be impossible to print a conclusion here.
   */
  if (findings.length === 0) {
    ours('reading any projection structure',
      `the catalogue named ${projections.length} projection flow(s) and none of their `
      + 'structures was read, so nothing about the premise was measured');
  }
  kv('flows publishing SA2', withSa2.length);
  kv('finest grain anywhere', finestAnywhere ?? '(none)');

  if (withSa2.length > 0) {
    console.log('\n  The premise HOLDS: the ABS publishes population projections at SA2.');
    for (const f of withSa2) console.log(`      ${f.ref} — ${f.sa2} SA2 codes`);
    console.log('\n  A reading from these describes the property’s own area and is drawn');
    console.log('  with the figure rather than apart from it.');
    return;
  }

  h('MEASURED: THE PREMISE DOES NOT HOLD');
  console.log(`  ${ABS_PROJECTION_SOURCE_LABEL} exists and is published, and NOT at SA2.`);
  if (finestAnywhere) {
    console.log(`  The finest grain any projection flow publishes is ${finestAnywhere} —`);
    console.log(`  ${PROJECTION_GRAIN_LABEL[finestAnywhere]}.`);
    console.log('');
    console.log('  Two things follow, and both are design decisions rather than defects.');
    console.log('  A reading at this grain is a fact about a region the property sits IN,');
    console.log('  so it is drawn apart under a heading saying so — the rule a state');
    console.log('  median beside a suburb one already pays for. And forward demand AT the');
    console.log('  property’s own area is published by the state governments rather than');
    console.log('  by the Bureau, which makes it a per-jurisdiction register (W3.4) and');
    console.log('  not a national one.');
  } else {
    console.log('  No projection flow reached the grain floor at all, so this deployment');
    console.log('  can state no projected figure from the ABS for any geography.');
  }
  console.log('\n  Exiting 0: a build must not go red over another party’s publishing');
  console.log('  decisions. What this changes is the design, and the coverage statement');
  console.log('  is what a reader gets in the meantime.');
}

main().catch((err) => {
  ours('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err));
});
