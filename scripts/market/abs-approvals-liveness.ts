/**
 * Does the ABS answer, and does our reader accept what it actually sends?
 *
 * ## Why this exists
 *
 * `absBuildingApprovals.pure.ts` is verified against the SDMX-CSV *format* —
 * every test behind it runs on synthetic bodies written to the published
 * standard's shape — because the development egress cannot reach the ABS:
 * the gateway answers **403 to CONNECT** for `data.api.abs.gov.au`, a policy
 * denial in the network allowlist. So the reader has never seen the Bureau's
 * own bytes, and "verified against the format" is not "verified".
 *
 * A GitHub runner has open internet. This closes that gap from CI, BEFORE
 * anything is merged, deployed or scheduled: it fetches the real catalogue,
 * runs the real discovery over it, fetches the real data query and runs the
 * real parser, and prints what the probe would have printed. It writes
 * nothing, anywhere — no database, no Supabase, no credential.
 *
 * ## The exit code is the whole design
 *
 * **The ABS being unreachable is not our failure.** A compliance product
 * cannot have its build decided by somebody else's uptime — this repository
 * already pays for that rule in `PEP_SCREENING_ENGINE.md` ("a compliance
 * decision cannot depend on somebody else's rate limiter"). So a refusal, a
 * timeout or a 5xx from the ABS **reports and exits 0**.
 *
 * What exits 1 is the case that IS ours: the ABS answered, and our discovery
 * or our parser refused what it sent. That is the reader being wrong about
 * the publisher, which is precisely what no synthetic fixture can catch and
 * precisely what this is for.
 */
import {
  ABS_BA_DATAFLOW_CATALOGUE_URL,
  ABS_BA_NAME_PATTERN,
  absBuildingApprovalsUrl,
  currentEdition,
  dataflowRef,
  ABS_BA_PLAUSIBILITY,
  parseAbsBuildingApprovals,
  parseDataflowCatalogue,
  resolveBuildingApprovalsFlow,
  surveyConstructionFlows,
  type ApprovalsAreaKind,
  type DataflowEntry,
} from '../../supabase/functions/_shared/reports/market/openData/absBuildingApprovals.pure.ts';
import {
  ABS_BA_KEY_RULES,
  ABS_SDMX_CSV_ACCEPT,
  ABS_SDMX_STRUCTURE_ACCEPT,
  AREA_DIMENSION,
  absDataStructureUrl,
  composeApprovalsKey,
  narrowedApprovalsUrl,
  parseDataStructure,
} from '../../supabase/functions/_shared/reports/market/openData/absDataStructure.pure.ts';
import {
  APPROVALS_PAGE_MONTHS,
  shiftMonth,
} from '../../supabase/functions/_shared/reports/market/openData/absApprovalsPaging.pure.ts';

const UA = 'npc-property-dashboard/1.0 (+https://github.com/Naidu-Group-Pty-Ltd)';
/** Three years: past the parser's 24-month floor with room to spare. */
const START_PERIOD = process.env.ABS_START_PERIOD ?? '2023-01';
/** The newest month to bound a paged window with. */
const LATEST_MONTH = process.env.ABS_LATEST_MONTH ?? new Date().toISOString().slice(0, 7);

/** `YYYY-MM` n months before `LATEST_MONTH`. */
function monthsBack(n: number): string {
  const [y, m] = LATEST_MONTH.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Inclusive month count between two `YYYY-MM`. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/*
 * Everything prints on ONE stream. The first failing run rendered
 *
 *     THE PARSER REFUSED THE ABS'S OWN DOWNLOAD
 *       the ABS building-approvals download holds 1 months...
 *     ─────────────────────────────────────────
 *
 * with the rule under the message rather than under the heading, because a
 * heading on stdout and a verdict on stderr are two buffers a log viewer
 * interleaves as it pleases. The exit code is what reports the failure; the
 * text is for a person to read, and a garbled verdict is harder to trust.
 */
const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(s.length)); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(26)} ${String(v)}`);

/**
 * Their side. Reported, never failed on.
 *
 * The refusing party's own words are printed, because this script cannot tell
 * the Bureau's refusal from an INTERMEDIARY'S. The development egress answers
 * 403 to CONNECT for `data.api.abs.gov.au` and the ABS would answer 403 for a
 * throttle, and the two send an operator to opposite remedies — the same
 * distinction `x-mission-control-refusal` exists for in the verification
 * broker. A runner sitting behind an allowlist would otherwise make this whole
 * gate a placebo that exits 0 having reached nothing, which is the failure
 * class it was written to close.
 */
function theirs(what: string, detail: unknown, body?: string): never {
  h('THE ABS DID NOT ANSWER');
  kv('stage', what);
  kv('detail', detail);
  if (body !== undefined) kv('what refused, verbatim', JSON.stringify(body.slice(0, 300)));
  console.log('\n  This is a statement about the retrieval, not about the reader.');
  console.log('  Read the line above before believing it was the Bureau: a gateway on');
  console.log('  this egress refuses in the same digits, and that is a green build');
  console.log('  standing over a check that reached nothing.');
  console.log('  Exiting 0: a build must not be decided by another party’s uptime.');
  process.exit(0);
}

async function main(): Promise<void> {
  h('1 · The dataflow catalogue');
  kv('url', ABS_BA_DATAFLOW_CATALOGUE_URL);
  let catalogue: string;
  try {
    const res = await fetch(ABS_BA_DATAFLOW_CATALOGUE_URL, {
      headers: { 'User-Agent': UA, Accept: ABS_SDMX_STRUCTURE_ACCEPT },
      signal: AbortSignal.timeout(90_000),
    });
    kv('status', res.status);
    kv('content-type', res.headers.get('content-type'));
    catalogue = await res.text();
    kv('bytes', catalogue.length.toLocaleString('en-AU'));
    if (!res.ok) theirs('catalogue', `HTTP ${res.status}`, catalogue);
  } catch (error) {
    theirs('catalogue', error instanceof Error ? error.message : String(error));
  }

  h('2 · What the ABS publishes about construction');
  let survey: ReturnType<typeof surveyConstructionFlows>;
  try {
    survey = surveyConstructionFlows(catalogue);
  } catch (error) {
    // The catalogue arrived and we could not read it. Ours.
    console.log(`  REFUSED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  kv('flows matching a term', survey.length);
  for (const f of survey) {
    console.log(`  ${(f.areaKind ?? '—').padEnd(9)} ${f.ref.padEnd(42)} ${f.name}`);
    console.log(`  ${''.padEnd(9)} ${''.padEnd(42)} terms: ${f.keys.join(', ')}`);
  }

  h('3 · Which flow the loader would read');
  let choice: ReturnType<typeof resolveBuildingApprovalsFlow>;
  try {
    choice = resolveBuildingApprovalsFlow(catalogue);
  } catch (error) {
    // Discovery refused a catalogue the ABS really sent. Ours, and the exact
    // thing a synthetic fixture cannot tell us.
    h('DISCOVERY REFUSED THE ABS’S OWN CATALOGUE');
    console.log(`  ${error instanceof Error ? error.message : String(error)}`);
    console.log('\n  The catalogue above is what it was given. Either the selection rule');
    console.log('  is wrong about what the Bureau publishes, or the Bureau publishes');
    console.log('  nothing this loader should read — and the survey says which.');
    process.exit(1);
  }
  kv('flow', dataflowRef(choice.flow));
  kv('name', choice.flow.name);
  kv('grain', choice.areaKind);
  kv('geography score', choice.geographyScore);
  kv('how', choice.how);
  kv('catalogued flows', choice.cataloguedFlows.toLocaleString('en-AU'));
  kv('candidates', choice.candidates.length);

  h('4 · What this build actually measures');
  /*
   * The `/all` baselines that used to run here are GONE, and their numbers
   * are in `SUPPLY_EVIDENCE.md` §3 and §7a where a settled measurement
   * belongs.
   *
   * They cost five minutes and three and three-quarter gigabytes of somebody
   * else's bandwidth on every build, to re-derive a figure nobody disputes —
   * and worse, they sat in FRONT of the question this check now exists to
   * answer, so three consecutive runs were cancelled before reaching it. A
   * check that cannot get to its own verdict is not slow, it is broken.
   *
   * What runs now is the live path: the structure, the key composed from it,
   * the narrowed download, and the parse. `/all` is measured only where the
   * key composed to `all`, because then `/all` IS the live path.
   */
  const EDGE_BUDGET_MS = 150_000;
  const PROBE_MS = 60_000;

  /**
   * The most CSV one invocation may take — and it is a SIZE, not a time.
   *
   * Measured 21 Sep 2026: a runner pulled **3,765 MB in 13.2 s** at 291 MB/s,
   * and the first criterion here ("finished inside the edge budget") called
   * that workable. It was measuring GitHub's bandwidth. An edge function has
   * neither that pipe nor that memory, so a download's feasibility is a
   * property of the download, never of the machine that happened to fetch it
   * — the same rule as everywhere else in this programme: name what was
   * actually measured, not what the measurement was taken on.
   *
   * The number is DERIVED and says so. `await res.text()` holds the body as
   * UTF-16 (2×) and `parseSdmxCsv` builds an object per row before anything
   * is filtered, so peak is several times the wire size against a 256 MB
   * isolate: 24 MB of CSV is ~48 MB of string plus perhaps 100 MB of records.
   *
   * **Memory is estimated here and not measured**, which is the honest limit
   * of this instrument: it measures transfer from a runner, and an edge
   * function's isolate is not something CI can weigh. A download under this
   * ceiling has cleared the constraint this check CAN see.
   */
  const EDGE_BYTE_CEILING = 24 * 1_048_576;

  /**
   * Can an invocation carry this? Finished, under the byte ceiling, and
   * inside the wall clock — in that order of importance. The elapsed check
   * stays as a floor under a transfer that is small but pathologically slow;
   * it is not what decides.
   */
  const workable = (m: { bytes: number; ms: number; finished: boolean }): boolean =>
    m.finished && m.bytes <= EDGE_BYTE_CEILING && m.ms < EDGE_BUDGET_MS;

  /** Says which bound a window failed, because "complete" hid a 3.7 GB body. */
  const verdictOf = (m: { bytes: number; ms: number; finished: boolean }): string => {
    if (!m.finished) return 'DID NOT FINISH';
    if (m.bytes > EDGE_BYTE_CEILING) return `complete, but ${(m.bytes / 1_048_576).toFixed(0)} MB — PAST THE ${EDGE_BYTE_CEILING / 1_048_576} MB CEILING`;
    if (m.ms >= EDGE_BUDGET_MS) return 'complete, but past the wall clock';
    return 'workable';
  };

  /**
   * Stream, count, and stop at the budget. A partial read is a measurement.
   *
   * The byte count is kept across the throw, because losing it is the defect
   * this function exists to remove: an aborted body that reports `0 bytes,
   * timed out` is indistinguishable from a publisher that never answered, and
   * reporting the second when the first is true is what sent the last run to
   * "THE ABS DID NOT ANSWER" over an HTTP 200.
   *
   * The signal's own ceiling is therefore deliberately LOOSER than the probe
   * budget: our own elapsed check is what stops a healthy transfer, so the
   * stop is a cancel we made with a count in hand rather than an abort thrown
   * at us. The signal remains, as the floor under a connection that stalls
   * with no chunk to measure at all.
   */
  async function measure(url: string): Promise<{
    status: number | null; bytes: number; ms: number; finished: boolean; error?: string;
  }> {
    const began = Date.now();
    let status: number | null = null;
    let bytes = 0;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: ABS_SDMX_CSV_ACCEPT },
        signal: AbortSignal.timeout(PROBE_MS + 30_000),
      });
      status = res.status;
      if (!res.body) return { status, bytes: 0, ms: Date.now() - began, finished: false };
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { status, bytes, ms: Date.now() - began, finished: true };
        bytes += value?.byteLength ?? 0;
        if (Date.now() - began > PROBE_MS) {
          await reader.cancel().catch(() => {});
          return { status, bytes, ms: Date.now() - began, finished: false };
        }
      }
    } catch (error) {
      return {
        status, bytes, ms: Date.now() - began, finished: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * The current edition at a coarser grain, read the way the loader would read
   * it — through `resolveBuildingApprovalsFlow`'s own override path, over the
   * real catalogue. Not `survey[0]`: the survey sorts by ref, so at LGA grain
   * that is `BA_LGA2018`, the OLDEST of the nine editions the Bureau
   * publishes. Selecting an edition is `currentEdition`'s job and there must
   * not be a second answer to it here.
   */
  const currentAt = (kind: ApprovalsAreaKind): DataflowEntry | null => {
    const refs = surveyConstructionFlows(catalogue)
      .filter((f) => f.areaKind === kind && ABS_BA_NAME_PATTERN.test(f.name))
      .map((f) => f.ref);
    const entries = parseDataflowCatalogue(catalogue).filter((f) => refs.includes(dataflowRef(f)));
    return currentEdition(entries).chosen;
  };

  interface Window { label: string; flow: DataflowEntry; grain: ApprovalsAreaKind; start: string }
  let carried: Window & { url: string; bytes: number; months?: number } | null = null;


  /*
   * 4a · Narrowing the query, which is the lever the window is not.
   *
   * The parse keeps Original estimates of three residential building types on
   * two measures and discards the rest of the cube — and we are downloading
   * the whole cube to do it, which is why ONE month of LGA data is 61.8 MB
   * and three years of SA2 is past 5 GB. Shrinking a period cannot shrink a
   * cube that is wide rather than long.
   *
   * So this composes the key from the publisher's own data structure, using
   * `composeApprovalsKey` — the production module, not a copy — and measures
   * the narrowed download against the same window that could not be carried.
   * That comparison is the whole design question.
   */
  /*
   * A key belongs to the flow whose structure composed it.
   *
   * The first version composed ONE key from the chosen flow and measured
   * both grains with it, and on 21 Sep 2026 that produced an LGA download of
   * 9,818 bytes carrying eight states and one national row and not a single
   * council — refused by the area floor, correctly. The SA2 flow's
   * `REGION_TYPE` codelist is not the LGA flow's, and a code that means one
   * thing in one document means nothing in another.
   *
   * It is the defect this script's own header warns about, committed one
   * level up: the URL went through the production builder while the KEY came
   * from the wrong document. The loader was never wrong — it reads
   * `absDataStructureUrl(choice.flow)` and queries `choice.flow` — so this
   * was the instrument measuring itself, which is the third time today.
   */
  interface FlowKey { key: string; structureBytes: number; note: string }

  async function keyFor(flow: DataflowEntry, verbose: boolean): Promise<FlowKey> {
    try {
      const res = await fetch(absDataStructureUrl(flow), {
        headers: { 'User-Agent': UA, Accept: ABS_SDMX_STRUCTURE_ACCEPT },
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const structure = parseDataStructure(text);
      const composed = composeApprovalsKey(structure);
      if (verbose) {
        kv('url', absDataStructureUrl(flow));
        kv('bytes', text.length.toLocaleString('en-AU'));
        kv('dimensions', structure.dimensions
          .slice().sort((a, b) => a.position - b.position)
          .map((d) => `${d.position}:${d.id}${d.isTime ? '(time)' : `[${d.codes.length}]`}`).join(' · '));
        kv('key', composed.key);
        // The kept CODES, not just how many. "4 of 43" said nothing about
        // whether `LGA` was the code the data is tagged with, which is the
        // question that turned a working download into nine kilobytes.
        for (const n of composed.narrowed) {
          kv(`  narrowed ${n.dimension}`, `${n.kept.join('+')} (${n.kept.length} of ${n.of}) — ${n.why}`);
        }
        for (const u of composed.unnarrowed) kv(`  OPEN ${u.dimension}`, u.reason);
        /*
         * The dimensions no rule NAMES, with their vocabulary. Each comes
         * back whole and its rows land on the same key as every other value
         * of it — which is how $14,857,000 and $45,670,000 arrived for one
         * council in one month. Guessing at a publisher's words is the
         * `Number of buildings` bet, so the check hands them over.
         */
        const unruled = structure.dimensions
          .filter((d) => !d.isTime && d.codes.length > 0 && !ABS_BA_KEY_RULES.some((r) => r.dimension.test(d.id)))
          .filter((d) => !AREA_DIMENSION.test(d.id));
        for (const d of unruled) {
          kv(`  NO RULE ${d.id}`, `${d.codes.length} codes: ${d.codes.slice(0, 12).map((c) => `${c.id}=${c.name}`).join(' | ')}`);
        }
        if (unruled.length) {
          console.log('');
          console.log('  Each of those comes back WHOLE and collides on (area, period, type).');
          console.log('  That is a correctness problem before it is a size one.');
        }
      }
      return { key: composed.key, structureBytes: text.length, note: composed.unnarrowed.length ? `${composed.unnarrowed.length} dimension(s) left open` : '' };
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error);
      if (verbose) {
        kv('the structure', note);
        kv('the narrowing', 'none — falling back to /all, exactly as the loader does');
      }
      return { key: 'all', structureBytes: 0, note };
    }
  }

  const oversize: Array<{ label: string; flow: DataflowEntry; grain: ApprovalsAreaKind; key: string; bytes: number; over: boolean }> = [];

  h(`4a · The query for ${dataflowRef(choice.flow)}, narrowed at the source`);
  const chosenKey = await keyFor(choice.flow, true);

  h('4b · What the query costs');
  const grains: Array<{ label: string; flow: DataflowEntry; grain: ApprovalsAreaKind; key: string }> = [
    { label: choice.areaKind.toUpperCase(), flow: choice.flow, grain: choice.areaKind, key: chosenKey.key },
  ];
  const lgaFlow = currentAt('lga');
  if (lgaFlow && dataflowRef(lgaFlow) !== dataflowRef(choice.flow)) {
    // Its OWN structure, its OWN key.
    const lgaKey = await keyFor(lgaFlow, false);
    kv(`${dataflowRef(lgaFlow)} key`, `${lgaKey.key}${lgaKey.note ? ` (${lgaKey.note})` : ''}`);
    grains.push({ label: 'LGA', flow: lgaFlow, grain: 'lga', key: lgaKey.key });
  }

  for (const g of grains) {
    const url = g.key === 'all'
      ? absBuildingApprovalsUrl(g.flow, START_PERIOD)
      : narrowedApprovalsUrl(g.flow, START_PERIOD, g.key);
    const m = await measure(url);
    const rate = m.ms > 0 ? m.bytes / (m.ms / 1000) : 0;
    console.log(
      `  ${`${g.label}, ${START_PERIOD}→, ${g.key === 'all' ? '/all' : 'narrowed'}`.padEnd(30)} `
      + `${String(m.status ?? 'ERR').padStart(3)}  ${(m.bytes / 1_048_576).toFixed(1).padStart(7)} MB  `
      + `${(m.ms / 1000).toFixed(1).padStart(6)} s  ${(rate / 1024).toFixed(0).padStart(6)} KB/s  `
      + `${verdictOf(m)}${m.error ? ` (${m.error})` : ''}`,
    );
    if (workable(m) && !carried) {
      carried = { label: `${g.label}, from ${START_PERIOD}`, flow: g.flow, grain: g.grain, start: START_PERIOD, url, bytes: m.bytes };
    }
    oversize.push({ ...g, bytes: m.bytes, over: m.finished && m.bytes > EDGE_BYTE_CEILING });
  }

  /*
   * 4c · How small a window has to be.
   *
   * A grain that is too wide for one invocation is loaded in several, and the
   * only paging lever the KEY does not give is the period: a key selects
   * exact codes, so asking for one state's SA2s means enumerating three
   * hundred of them in a URL, while `startPeriod`/`endPeriod` is two
   * parameters whatever the geography.
   *
   * (A correction rides here. `SUPPLY_EVIDENCE.md` said SA2 "pages by state"
   * because the code's leading digit is its state — which is true for
   * READING a state off a code and useless for ASKING for one. Naming the
   * lever is not the same as having measured it, which is the rule this
   * whole exercise keeps paying for.)
   *
   * So this halves the window until something fits, and reports the number of
   * requests a full load would take. It runs only where the full window did
   * not fit, because a register that already loads needs no paging.
   */
  const tooBig = oversize.filter((o) => o.over && o.key !== 'all');
  if (tooBig.length) {
    h('4c · How small a window has to be');
    for (const g of tooBig) {
      for (const months of [12, 6, 3]) {
        const from = monthsBack(months - 1);
        const m = await measure(narrowedApprovalsUrl(g.flow, from, g.key, LATEST_MONTH));
        const fits = workable(m);
        console.log(
          `  ${`${g.label}, ${months} months (${from}→${LATEST_MONTH})`.padEnd(34)} `
          + `${(m.bytes / 1_048_576).toFixed(1).padStart(7)} MB  ${verdictOf(m)}`,
        );
        if (fits) {
          const spanMonths = monthsBetween(START_PERIOD, LATEST_MONTH);
          kv('  a full load would take', `${Math.ceil(spanMonths / months)} requests of ${months} months`);
          /*
           * A paged window at the FINEST grain beats an unpaged one at a
           * coarser grain, because it is what the loader will actually do.
           * Carrying the coarse download instead would parse a body
           * production never reads — the check measuring a path nobody
           * takes, which is this instrument's own recurring failure.
           */
          if (g.flow === choice.flow) {
            carried = {
              label: `${g.label}, ${months}-month page (${from}→${LATEST_MONTH})`,
              flow: g.flow,
              grain: g.grain,
              start: from,
              url: narrowedApprovalsUrl(g.flow, from, g.key, LATEST_MONTH),
              bytes: m.bytes,
              months,
            };
          }
          break;
        }
      }
    }
  }

  h('5 · What an invocation can actually carry');
  if (!carried) {
    console.log('  No window is small enough for one invocation.');
    console.log('');
    console.log('  The Bureau ANSWERED every one of them — this is not an outage, and');
    console.log('  a window marked "complete" above was a runner with a 291 MB/s pipe');
    console.log('  finishing something an edge function could never hold. The bound');
    console.log(`  that decides is ${EDGE_BYTE_CEILING / 1_048_576} MB of CSV, not the clock.`);
    console.log('');
    console.log('  So the register as configured cannot be loaded, and the remaining');
    console.log('  levers are paging the query — the SA2 code\'s leading digit is its');
    console.log('  state, and this loader is already staged one publisher per');
    console.log('  invocation — or dropping to a coarser grain and saying so on the');
    console.log('  page. Failing, because a schedule that cannot finish is worse than');
    console.log('  no schedule: it writes a partial register every night and reports');
    console.log('  success.');
    process.exit(1);
  }
  kv('workable window', carried.label);
  kv('grain', carried.grain);
  kv('bytes', `${carried.bytes.toLocaleString('en-AU')} (${(carried.bytes / 1_048_576).toFixed(1)} MB of ${EDGE_BYTE_CEILING / 1_048_576} MB)`);
  kv('url', carried.url);
  console.log('');
  console.log('  Transfer is what this can measure. An isolate\'s memory is not, so');
  console.log('  the ceiling above is derived rather than weighed — stated so nobody');
  console.log('  reads a green run as proof the parse fits.');

  h('6 · What the parser makes of it');
  let body: string;
  try {
    const res = await fetch(carried.url, {
      headers: { 'User-Agent': UA, Accept: ABS_SDMX_CSV_ACCEPT },
      signal: AbortSignal.timeout(EDGE_BUDGET_MS),
    });
    if (!res.ok) theirs('data', `HTTP ${res.status} on a URL that answered 200 moments ago`);
    body = await res.text();
    kv('bytes re-read', body.length.toLocaleString('en-AU'));
  } catch (error) {
    theirs('data', error instanceof Error ? error.message : String(error));
  }
  try {
    /*
     * A page is judged against the window it asked for. The register's own
     * twenty-four-month floor is a question about the TABLE after a full
     * load, not about one request of six months — see
     * `ApprovalsParseOptions.minPeriods`.
     */
    const parsed = parseAbsBuildingApprovals(body, carried.grain,
      carried.months ? { minPeriods: Math.min(carried.months, 3) } : {});
    if (carried.months) {
      kv('judged as', `a ${carried.months}-month page, not the register's ${ABS_BA_PLAUSIBILITY.minPeriods}-month floor`);
    }
    kv('areas', parsed.areas.toLocaleString('en-AU'));
    kv('months', parsed.periods.length);
    kv('first period', parsed.periods[0]);
    kv('latest period', parsed.latestPeriod);
    kv('states', parsed.states.sort().join(', ') || '(none read)');
    kv('rows', parsed.rows.length.toLocaleString('en-AU'));
    kv('rows skipped', parsed.skipped.toLocaleString('en-AU'));
    kv('series filtered', parsed.seriesTypeUnfiltered ? 'NO — no series column' : 'yes, Original only');
    kv('columns', JSON.stringify(parsed.columns));
    const withUnits = parsed.rows.filter((r) => r.dwellingUnits !== null).length;
    kv('units published', withUnits.toLocaleString('en-AU'));
    kv('units NULL (suppressed)', (parsed.rows.length - withUnits).toLocaleString('en-AU'));
    h('THE READER ACCEPTS THE ABS\u2019S OWN BYTES');
    console.log('  Verified against the publisher, not against a fixture.');
  } catch (error) {
    h('THE PARSER REFUSED THE ABS\u2019S OWN DOWNLOAD');
    console.log(`  ${error instanceof Error ? error.message : String(error)}`);
    console.log('\n  The ABS answered and this reader would not take it. That is ours,');
    console.log('  and it is exactly what no synthetic fixture could have told us.');
    process.exit(1);
  }

  /*
   * ── 6 · Would the backfill STALL at the register's floor? ───────────────
   *
   * `planApprovalsWork` deepens the register one window at a time until it
   * reaches `REGISTER_FLOOR_PERIOD`. A backfill window carries
   * `minPeriods: APPROVALS_PAGE_MONTHS`, and the parser THROWS on a window
   * that returns fewer months than it asked for — correctly, because for a
   * window wholly in the past a short body is a truncated body.
   *
   * At the publisher's own series START that reasoning inverts. The window
   * straddling it is short for a reason that is not truncation, the parse
   * refuses, `oldest` does not move, and the next invocation plans THE SAME
   * WINDOW. Hourly, for ever: a permanent stall and refused requests at the
   * Bureau's door every hour of every day.
   *
   * Nothing could reach that before the walk advanced itself, because nothing
   * ever deepened the register — `pageIndex` was 0 on every scheduled run.
   * The walk is what makes it reachable, so the walk owes this check.
   *
   * It is exactly this probe's existing exit-1 condition — *the ABS answered
   * and our reader refused what it sent* — asked at the one window where the
   * refusal would be permanent rather than transient. Failing the BUILD is
   * the cheapest possible version of this; a stall discovered in production
   * is the most expensive, and it would be invisible behind a green pg_cron.
   */
  h(`6 · Would a backfill stall at the floor (${START_PERIOD})?`);
  const floorEnd = shiftMonth(START_PERIOD, APPROVALS_PAGE_MONTHS - 1);
  kv('window', `${START_PERIOD} → ${floorEnd}`);
  kv('a backfill demands', `${APPROVALS_PAGE_MONTHS} months`);
  try {
    // `chosenKey` is the key composed from the CHOSEN flow's own structure
    // in stage 4a — the same key production narrows with, not a copy.
    const floorUrl = chosenKey.key === 'all'
      ? absBuildingApprovalsUrl(choice.flow, START_PERIOD)
      : narrowedApprovalsUrl(choice.flow, START_PERIOD, chosenKey.key, floorEnd);
    const res = await fetch(floorUrl, { headers: { 'User-Agent': UA, Accept: ABS_SDMX_CSV_ACCEPT } });
    if (!res.ok) {
      kv('answered', res.status);
      console.log('\n  Not ours: the Bureau did not serve the floor window. Exiting 0.');
      return;
    }
    const body = await res.text();

    // What the publisher actually HOLDS there — asked with the floor off, so
    // the answer is a measurement rather than a refusal.
    const held = parseAbsBuildingApprovals(body, choice.areaKind, { minPeriods: 0 });
    kv('months the ABS holds', held.periods.length);
    kv('range', `${held.periods[0]} → ${held.latestPeriod}`);

    if (held.periods.length >= APPROVALS_PAGE_MONTHS) {
      h('THE FLOOR IS INSIDE THE SERIES — THE WALK TERMINATES');
      console.log(`  ${held.periods.length} months at ${START_PERIOD}, so a backfill window there`);
      console.log('  is satisfied and the walk reaches the floor and settles.');
      return;
    }

    // Short, and the ABS answered cleanly. That is the publisher's series
    // start, and a backfill-shaped read of it would refuse for ever.
    h('THE BACKFILL WOULD STALL AT THE FLOOR');
    console.log(`  The ABS holds ${held.periods.length} month(s) at ${START_PERIOD}, and a backfill`);
    console.log(`  window demands ${APPROVALS_PAGE_MONTHS}. \`planApprovalsWork\` would ask for this`);
    console.log('  window, the parse would refuse it, `oldest` would not move, and the');
    console.log('  next run would ask for the same window. Hourly, indefinitely.');
    console.log('');
    console.log(`  REGISTER_FLOOR_PERIOD is below the publisher's own start. Either move`);
    console.log(`  the floor to ${held.periods[0]} or later, or teach the walk to LEARN the`);
    console.log('  floor from a short-but-well-formed answer instead of being told it.');
    process.exit(1);
  } catch (error) {
    h('THE FLOOR WINDOW REFUSED');
    console.log(`  ${error instanceof Error ? error.message : String(error)}`);
    console.log('\n  The ABS answered the floor window and this reader would not take it.');
    console.log('  That is the stall this stage exists to catch, before it is hourly.');
    process.exit(1);
  }
}

await main();
