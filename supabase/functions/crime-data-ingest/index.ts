import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { internalError } from '../_shared/errorResponse.ts';
import {
  createNswAccumulator, feedChunk, NSW_SOURCE_LABEL, parseQldLgaCsv,
  QLD_SOURCE_LABEL, stateTotals, zipSingleDeflateSpan, type CrimeSeriesRow,
} from '../_shared/crimeIngest.pure.ts';
import {
  NT_MIN_PUBLISHED_ROWS, NT_SOURCE_LABEL, SA_CLASSIFICATION_FROM, SA_LEVEL1,
  SA_LEVEL2_SERIES_NOTE, SA_MIN_PUBLISHED_ROWS, SA_SOURCE_LABEL, assertPublishedSize,
  parseNtCrimeCsv, parseSaCrimeCsv, saFinancialYearLabel,
  totalsByOffence, windowsFromMonthCounts, type MonthCount, type WindowedRow,
} from '../_shared/crimeIngestSaNt.pure.ts';
import { normaliseCouncilTokens } from '../_shared/planning/developmentActivity.pure.ts';

/**
 * Ingest the two published recorded-crime datasets into `crime_reference` —
 * the loader IS this function, running where credentials and egress live
 * (the abs-poa-ingest pattern, which is the sanctions-register lesson).
 *
 * Four stages, one per source, because their cadences and shapes differ:
 *  - `{"stage":"nsw"}` — BOCSAR's postcode dataset (quarterly releases).
 *    The 4.2 MB zip unpacks to a 60 MB CSV; the parser reduces it line by
 *    line into fixed-size window accumulators precisely so this stage fits
 *    the edge worker's memory (the single-pass ABS ingest found that
 *    ceiling the hard way).
 *  - `{"stage":"qld"}` — QPS's LGA dataset (monthly releases).
 *  - `{"stage":"sa","fy":"2025-26"}` then `{"stage":"sa","finalise":true}` —
 *    SAPOL publishes ONE FILE PER FINANCIAL YEAR, seven of them at ~10 MB,
 *    and no edge invocation holds 70 MB. So each call stages one year's
 *    monthly counts and the finalise pass derives the windows from the
 *    table. SA is postcode-keyed, which is the platform's own geography.
 *  - `{"stage":"nt"}` — one file carries the NT's whole 31-month series, so
 *    it stages and derives in a single call. NT publishes no postcode: its
 *    geography is a Reporting Region, with a Statistical Area 2 breakdown
 *    inside `NT Balance` that the T-stream's coordinate lookup can resolve.
 *
 * Each stage writes the per-area rows AND `state_total` rows (plain
 * addition over every area in the same file), records the load in
 * `crime_sync`, and refuses anything outside the measured shape — the
 * parsers throw on header drift, truncated downloads, implausible area
 * counts and broken rollup identities, so a bad file refuses instead of
 * loading.
 *
 * Auth: the internal edge secret — or, exactly once, an empty
 * `crime_reference` (the self-sealing bootstrap arm; sources are public
 * and the write is an idempotent upsert of that public data).
 *
 * Refreshing is re-invoking the stages; rows carry the data's own
 * latest_month, so currency is read from the data, never from loaded_at.
 */

const NSW_URL = 'https://bocsarblob.blob.core.windows.net/bocsar-open-data/PostcodeData.zip';
const QLD_URL = 'https://open-crime-data.s3-ap-southeast-2.amazonaws.com/Crime%20Statistics/LGA_Reported_Offences_Number.csv';

/**
 * SA and NT are discovered through their portals' own catalogue rather than
 * from a hard-coded file URL.
 *
 * SAPOL publishes ONE FILE PER FINANCIAL YEAR under resource ids that change
 * with every release, and NT publishes one PACKAGE PER MONTH. A pinned URL
 * would be stale the day either of them publishes again — and worse, it would
 * be stale silently, since a 404 on a refresh looks like a network problem.
 * Asking the catalogue and REFUSING when the wanted release is not there is
 * the difference between a load that fails loudly and one that quietly keeps
 * serving last year's figures.
 */
const SA_PACKAGE = 'https://data.sa.gov.au/data/api/3/action/package_show?id=crime-statistics';
const NT_SEARCH =
  'https://data.nt.gov.au/api/3/action/package_search?q=crime+statistics&rows=8&sort=metadata_modified+desc';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const UA = 'npc-property-dashboard-crime-ingest';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // The stage is read before authorisation because the bootstrap arm is
  // PER STATE: with both stages writing one table, a whole-table emptiness
  // gate seals after the first stage and locks the second out — which is
  // exactly what happened on the first production load (QLD loaded, NSW
  // answered forbidden). Each state's first load opens without the secret;
  // re-loading a state that holds rows requires it.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const stage = String(body?.stage ?? '');
  const stageState = stage === 'nsw' ? 'NSW' : stage === 'qld' ? 'QLD'
    : stage === 'sa' ? 'SA' : stage === 'nt' ? 'NT' : null;

  const internalSecret = Deno.env.get('INTERNAL_EDGE_SECRET') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  let authorised = internalSecret !== '' && bearer === internalSecret;
  if (!authorised && stageState) {
    const { count, error } = await supabase
      .from('crime_reference')
      .select('area', { count: 'exact', head: true })
      .eq('state', stageState as string);
    if (!error && (count ?? 0) === 0) {
      console.log(`[crime-data-ingest] bootstrap arm: no ${stageState} rows yet, first load permitted`);
      authorised = true;
    }
  }
  if (!authorised) return json({ success: false, error: 'forbidden' }, 403);

  try {
    const chunk = <T,>(arr: T[], n: number): T[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

    /** Stage a parse's monthly counts. Idempotent by its own key. */
    const stageMonthCounts = async (
      db: typeof supabase, state: 'SA' | 'NT',
      areaKind: 'postcode' | 'region' | 'sa2', counts: readonly MonthCount[],
    ) => {
      for (const batch of chunk([...counts], 1000)) {
        const { error } = await db.from('crime_month_counts').upsert(
          batch.map((c) => ({
            state, area_kind: areaKind, area: c.area, offence: c.offence,
            month: c.month, count: c.count, loaded_at: new Date().toISOString(),
          })),
          { onConflict: 'state,area_kind,area,offence,month' },
        );
        if (error) throw new Error(`crime_month_counts upsert failed: ${error.message}`);
      }
    };

    /**
     * Read every staged month back.
     *
     * Paged explicitly: PostgREST caps a response and TRUNCATES silently past
     * it, and a window derived from a truncated series is a smaller number
     * that looks exactly like a real one (the §25 lesson).
     */
    const readMonthCounts = async (
      db: typeof supabase, state: 'SA' | 'NT', areaKind: 'postcode' | 'region' | 'sa2',
    ): Promise<MonthCount[]> => {
      const page = 1000;
      const out: MonthCount[] = [];
      for (let from = 0; ; from += page) {
        const { data, error } = await db.from('crime_month_counts')
          .select('area, offence, month, count')
          .eq('state', state).eq('area_kind', areaKind)
          .order('area', { ascending: true }).order('offence', { ascending: true })
          .order('month', { ascending: true })
          .range(from, from + page - 1);
        if (error) throw new Error(`crime_month_counts read failed: ${error.message}`);
        const rows = (data ?? []) as MonthCount[];
        out.push(...rows);
        if (rows.length < page) return out;
      }
    };

    /** Write windowed rows plus their state totals, carrying an honest null prior. */
    const upsertWindowed = async (
      db: typeof supabase, state: 'SA' | 'NT',
      areaKind: 'postcode' | 'region' | 'sa2', rows: readonly WindowedRow[],
      source: string, noteFor: (r: WindowedRow) => string | null,
    ) => {
      const totals = totalsByOffence(rows).map((r) => ({ ...r, area: state }));
      const all = [
        ...rows.map((r) => ({ kind: areaKind as string, r })),
        ...totals.map((r) => ({ kind: 'state_total', r })),
      ];
      for (const batch of chunk(all, 500)) {
        const { error } = await db.from('crime_reference').upsert(
          batch.map(({ kind, r }) => ({
            state, area_kind: kind, area: r.area, offence: r.offence,
            months12: r.months12,
            prior12: r.prior12,
            year_totals: r.yearTotals,
            latest_month: r.latestMonth,
            series_from: r.seriesFrom,
            source,
            series_note: noteFor(r),
            // A postcode is already its own token; a named area gets the same
            // normalisation the LGA lookup uses, so one indexed read resolves it.
            area_token: kind === 'postcode' ? r.area : normaliseCouncilTokens(r.area),
            loaded_at: new Date().toISOString(),
          })),
          { onConflict: 'state,area_kind,area,offence' },
        );
        if (error) throw new Error(`crime_reference upsert failed: ${error.message}`);
      }
      return { rows: rows.length, state_totals: totals.length, latest_month: rows[0]?.latestMonth ?? null };
    };

    /**
     * A per-100k benchmark whose denominator is NAMED, or no rate at all.
     *
     * The population is the 2021 Census usual residents of exactly the postal
     * areas this register covers, joined on the register's own keys. A state
     * whose geography carries no joinable population keeps `population` null
     * and offers count-change context only — a rate with an unnamed
     * denominator is the one thing this layer will not publish.
     */
    const namedBenchmark = async (
      db: typeof supabase, state: string, total12: number,
      areas: readonly string[], latestMonth: string, _unused: string, registerName: string,
    ) => {
      const benchmark: Record<string, unknown> = { state, total12, latest_month: latestMonth };
      const { data, error } = await db.from('abs_census_poa').select('population').in('poa', [...areas]);
      if (!error && data && data.length > 0) {
        const population = data.reduce((s: number, r: { population: number | null }) => s + (r.population ?? 0), 0);
        if (population > 0) {
          benchmark.population = population;
          benchmark.rate_per_100k = Math.round((total12 / population) * 100_000);
          benchmark.denominator =
            `2021 Census usual residents of the ${data.length} matched postal areas ` +
            `(of ${areas.length} in the ${registerName} file)`;
        }
      }
      const { error: benchError } = await db.from('crime_state_benchmarks')
        .upsert(benchmark, { onConflict: 'state' });
      if (benchError) console.warn('[crime-data-ingest] benchmark write failed (load itself succeeded):', benchError.message);
      return benchmark;
    };

    const upsert = async (
      state: 'NSW' | 'QLD',
      areaKind: 'postcode' | 'lga',
      rows: CrimeSeriesRow[],
      source: string,
    ) => {
      const totals = stateTotals(rows).map((r) => ({ ...r, area: state }));
      const all = [
        ...rows.map((r) => ({ kind: areaKind, r })),
        ...totals.map((r) => ({ kind: 'state_total' as const, r })),
      ];
      for (const batch of chunk(all, 500)) {
        const { error } = await supabase.from('crime_reference').upsert(
          batch.map(({ kind, r }) => ({
            state,
            area_kind: kind,
            area: r.area,
            offence: r.offence,
            months12: r.months12,
            prior12: r.prior12,
            year_totals: r.yearTotals,
            latest_month: r.latestMonth,
            series_from: r.seriesFrom,
            source,
            area_token: kind === 'lga' ? normaliseCouncilTokens(r.area) : r.area,
            loaded_at: new Date().toISOString(),
          })),
          { onConflict: 'state,area_kind,area,offence' },
        );
        if (error) throw new Error(`crime_reference upsert failed: ${error.message}`);
      }
      return { rows: rows.length, state_totals: totals.length, latest_month: rows[0]?.latestMonth };
    };

    if (stage === 'nsw') {
      console.log('[crime-data-ingest] nsw stage: downloading from BOCSAR…');
      const res = await fetch(NSW_URL, { headers: { 'User-Agent': 'npc-property-dashboard-crime-ingest' } });
      if (!res.ok) return json({ success: false, error: `BOCSAR download answered ${res.status}` }, 502);
      // The 4.2 MB zip inflates to a 60 MB CSV, and holding that as one
      // string is what put the first attempt over WORKER_RESOURCE_LIMIT —
      // so the single deflate entry is located from the central directory
      // and STREAMED through the accumulator, line by line. Verified
      // byte-identical to the whole-string parse against the real archive.
      const zipBytes = new Uint8Array(await res.arrayBuffer());
      const span = zipSingleDeflateSpan(zipBytes);
      const stream = new Blob([zipBytes.subarray(span.start, span.start + span.length)]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw'))
        .pipeThrough(new TextDecoderStream());
      const accumulator = createNswAccumulator();
      let carry = '';
      for await (const chunk of stream) carry = feedChunk(accumulator, carry, chunk);
      if (carry.trim() !== '') accumulator.feedLine(carry);
      const rows = accumulator.finish();
      const detail = { stage, source: NSW_SOURCE_LABEL, ...(await upsert('NSW', 'postcode', rows, NSW_SOURCE_LABEL)) };

      // The state per-100k benchmark, with the denominator NAMED: the 2021
      // Census usual-resident population of exactly the postcodes in this
      // file — a join on the file's own keys, never a typed-in state figure.
      const totals = stateTotals(rows);
      const total12 = totals.reduce((s, r) => s + r.months12, 0);
      const areas = [...new Set(rows.map((r) => r.area))];
      const { data: popRows, error: popError } = await supabase
        .from('abs_census_poa').select('population').in('poa', areas);
      let benchmark: Record<string, unknown> = { state: 'NSW', total12, latest_month: rows[0]?.latestMonth };
      if (!popError && popRows && popRows.length > 0) {
        const population = popRows.reduce((s: number, r: { population: number | null }) => s + (r.population ?? 0), 0);
        if (population > 0) {
          benchmark = {
            ...benchmark,
            population,
            rate_per_100k: Math.round((total12 / population) * 100_000),
            denominator: `2021 Census usual residents of the ${popRows.length} matched postal areas (of ${areas.length} in the BOCSAR file)`,
          };
        }
      }
      const { error: benchError } = await supabase.from('crime_state_benchmarks')
        .upsert(benchmark, { onConflict: 'state' });
      if (benchError) console.warn('[crime-data-ingest] benchmark write failed (load itself succeeded):', benchError.message);

      await supabase.from('crime_sync').insert({ detail: { ...detail, benchmark } });
      return json({ success: true, ...detail });
    }

    if (stage === 'qld') {
      console.log('[crime-data-ingest] qld stage: downloading from QPS open data…');
      const res = await fetch(QLD_URL, { headers: { 'User-Agent': 'npc-property-dashboard-crime-ingest' } });
      if (!res.ok) return json({ success: false, error: `QPS download answered ${res.status}` }, 502);
      const rows = parseQldLgaCsv(await res.text());
      const detail = { stage, source: QLD_SOURCE_LABEL, ...(await upsert('QLD', 'lga', rows, QLD_SOURCE_LABEL)) };

      // No LGA-population join exists yet (abs_census_poa is POA-keyed), so
      // the QLD benchmark carries counts only; the reading offers state
      // count-change context, never a rate with an unnamed denominator.
      const divisions = new Set(['Offences Against the Person', 'Offences Against Property', 'Other Offences']);
      const total12 = stateTotals(rows).filter((r) => divisions.has(r.offence)).reduce((s, r) => s + r.months12, 0);
      const { error: benchError } = await supabase.from('crime_state_benchmarks')
        .upsert({ state: 'QLD', total12, latest_month: rows[0]?.latestMonth }, { onConflict: 'state' });
      if (benchError) console.warn('[crime-data-ingest] benchmark write failed (load itself succeeded):', benchError.message);

      await supabase.from('crime_sync').insert({ detail });
      return json({ success: true, ...detail });
    }

    // ---------------------------------------------------------------------
    // South Australia — one financial-year file per call, then a finalise pass
    // ---------------------------------------------------------------------
    if (stage === 'sa') {
      const wantedFy = typeof body?.fy === 'string' ? body.fy : null;

      if (!body?.finalise) {
        if (!wantedFy) {
          return json({ success: false, error: 'sa stage needs {"fy":"2025-26"} or {"finalise":true}' }, 400);
        }
        const cat = await fetch(SA_PACKAGE, { headers: { 'User-Agent': UA } });
        if (!cat.ok) return json({ success: false, error: `data.sa.gov.au catalogue answered ${cat.status}` }, 502);
        const pkg = await cat.json();
        const resources = (pkg?.result?.resources ?? []) as Array<{ name?: string; url?: string }>;
        // The catalogue holds the Family & Domestic Abuse files beside the
        // crime files, and SAPOL's own note is explicit that the FDA file is a
        // SUBSET of the crime file for the same year and the two must never be
        // added together. `saFinancialYearLabel` returns null for anything but
        // a crime file, so the FDA rows cannot be picked up by accident.
        const match = resources.find((r) => saFinancialYearLabel(r.name ?? '') === wantedFy);
        if (!match?.url) {
          return json({
            success: false,
            error: `data.sa.gov.au publishes no crime-statistics file for ${wantedFy} — ` +
              `available: ${resources.map((r) => saFinancialYearLabel(r.name ?? '')).filter(Boolean).join(', ')}`,
          }, 404);
        }

        console.log(`[crime-data-ingest] sa stage: downloading ${wantedFy} from ${match.url}`);
        const res = await fetch(match.url, { headers: { 'User-Agent': UA } });
        if (!res.ok) return json({ success: false, error: `SAPOL download answered ${res.status}` }, 502);
        const parsed = parseSaCrimeCsv(await res.text());
        // A short download parses cleanly and yields a smaller number that
        // looks exactly like a real one, so the size is asked here, where the
        // file is known to be a published one.
        assertPublishedSize(parsed.audit, SA_MIN_PUBLISHED_ROWS, `SA ${wantedFy}`);

        const counts: MonthCount[] = [...parsed.level1, ...parsed.level2];
        await stageMonthCounts(supabase, 'SA', 'postcode', counts);
        const detail = { stage, fy: wantedFy, source: SA_SOURCE_LABEL, staged: counts.length, ...parsed.audit };
        await supabase.from('crime_sync').insert({ detail });
        return json({ success: true, ...detail });
      }

      // Finalise: derive the windows from every month staged so far. Level 1
      // spans the whole history and carries a prior-year comparison; Level 2
      // exists only under the classification SAPOL adopted in July 2025 and
      // carries NULL, with the reason stored beside it.
      const staged = await readMonthCounts(supabase, 'SA', 'postcode');
      if (staged.length === 0) return json({ success: false, error: 'no SA month counts staged yet' }, 409);
      const isLevel1 = (o: string) => (SA_LEVEL1 as readonly string[]).includes(o);
      const l1 = windowsFromMonthCounts(staged.filter((c) => isLevel1(c.offence)), { comparablePrior: true });
      const l2 = windowsFromMonthCounts(staged.filter((c) => !isLevel1(c.offence)), { comparablePrior: false });
      const written = await upsertWindowed(supabase, 'SA', 'postcode', [...l1, ...l2], SA_SOURCE_LABEL,
        (r) => (isLevel1(r.offence) ? null : SA_LEVEL2_SERIES_NOTE));

      // The benchmark denominator is NAMED, the NSW way: the 2021 Census
      // usual-resident population of exactly the postcodes this register
      // covers, joined on the file's own keys.
      const total12 = totalsByOffence(l1).reduce((s, r) => s + r.months12, 0);
      const areas = [...new Set(l1.map((r) => r.area))];
      const benchmark = await namedBenchmark(supabase, 'SA', total12, areas, l1[0]?.latestMonth ?? '',
        'BOCSAR', 'SAPOL crime-statistics');
      const detail = { stage, finalise: true, source: SA_SOURCE_LABEL, classification_from: SA_CLASSIFICATION_FROM, ...written, benchmark };
      await supabase.from('crime_sync').insert({ detail });
      return json({ success: true, ...detail });
    }

    // ---------------------------------------------------------------------
    // Northern Territory — one file carries the whole series
    // ---------------------------------------------------------------------
    if (stage === 'nt') {
      const cat = await fetch(NT_SEARCH, { headers: { 'User-Agent': UA } });
      if (!cat.ok) return json({ success: false, error: `data.nt.gov.au catalogue answered ${cat.status}` }, 502);
      const found = await cat.json();
      const packages = (found?.result?.results ?? []) as Array<{ title?: string; resources?: Array<{ format?: string; url?: string; name?: string }> }>;
      const csv = packages
        .flatMap((p) => (p.resources ?? []).map((r) => ({ ...r, title: p.title })))
        .find((r) => (r.format ?? '').toUpperCase() === 'CSV' && /crime_statistics/i.test(r.url ?? ''));
      if (!csv?.url) {
        return json({ success: false, error: 'data.nt.gov.au returned no crime-statistics CSV in its latest packages' }, 404);
      }

      console.log(`[crime-data-ingest] nt stage: downloading ${csv.url}`);
      const res = await fetch(csv.url, { headers: { 'User-Agent': UA } });
      if (!res.ok) return json({ success: false, error: `NT download answered ${res.status}` }, 502);
      const parsed = parseNtCrimeCsv(await res.text());
      assertPublishedSize(parsed.audit, NT_MIN_PUBLISHED_ROWS, 'NT release');

      await stageMonthCounts(supabase, 'NT', 'region', parsed.region);
      await stageMonthCounts(supabase, 'NT', 'sa2', parsed.sa2);
      const regions = windowsFromMonthCounts(parsed.region, { comparablePrior: true });
      const sa2s = windowsFromMonthCounts(parsed.sa2, { comparablePrior: true });
      const written = await upsertWindowed(supabase, 'NT', 'region', regions, NT_SOURCE_LABEL, () => null);
      const written2 = await upsertWindowed(supabase, 'NT', 'sa2', sa2s, NT_SOURCE_LABEL, () => null);

      // No NT population join exists on this geography, so the benchmark
      // carries counts only — a rate with an unnamed denominator is the one
      // thing this layer will not publish.
      const total12 = totalsByOffence(regions).reduce((s, r) => s + r.months12, 0);
      const { error: benchError } = await supabase.from('crime_state_benchmarks')
        .upsert({ state: 'NT', total12, latest_month: regions[0]?.latestMonth ?? '' }, { onConflict: 'state' });
      if (benchError) console.warn('[crime-data-ingest] NT benchmark write failed (load itself succeeded):', benchError.message);

      const detail = {
        stage, source: NT_SOURCE_LABEL, release: csv.title ?? null,
        region_rows: written.rows, sa2_rows: written2.rows, ...parsed.audit,
      };
      await supabase.from('crime_sync').insert({ detail });
      return json({ success: true, ...detail });
    }

    return json({ success: false, error: 'stage must be "nsw", "qld", "sa" or "nt"' }, 400);
  } catch (error) {
    console.error(`[crime-data-ingest] ${stage} stage failed:`, error);
    return json({ success: false, ...internalError(error, 'crime-data-ingest') }, 500);
  }
});
