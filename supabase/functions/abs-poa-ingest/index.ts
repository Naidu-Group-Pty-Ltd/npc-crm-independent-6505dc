import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { internalError } from '../_shared/errorResponse.ts';
// jszip's esm.sh types declare no default export while its runtime ships
// one; the interop below satisfies both.
import * as jszipMod from 'https://esm.sh/jszip@3.10.1';
const JSZip = (jszipMod as unknown as { default?: typeof jszipMod }).default ?? jszipMod;
// xlsx 0.18.5 is the last SheetJS release on the public npm registry; the
// newer builds live only on cdn.sheetjs.com, which Supabase's bundler
// refuses to import from. 0.18.5 was verified against the real SEIFA
// workbook to parse identically to 0.20.3 before this pin was chosen.
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';
import {
  GCP_TABLES,
  assembleCensusRows,
  checkSeifaCoverage,
  parseGcpCsv,
  parseSeifaTable1,
} from '../_shared/absPoaIngest.pure.ts';

/**
 * Ingest the ABS's published Postal-Area data into the reference tables the
 * demographic, employment and SEIFA services read.
 *
 * This function IS the loader — it runs where the credentials and the egress
 * already live, which is the lesson of the sanctions register's first year
 * (a loader that needs a repository secret nobody set has never run). It
 * downloads the two published files, parses them through
 * `_shared/absPoaIngest.pure.ts` (the one implementation, also under test),
 * refuses anything implausible, and upserts. Reference data, not a cache:
 * rows carry the data's own `reference_period` (2021), because freshness of
 * a load is not currency of the data.
 *
 * Refreshing after the 2026 Census releases (mid-2027) is: update the two
 * URLs and the reference period below, deploy, invoke both stages.
 *
 * The ingest runs in TWO stages — `{"stage":"seifa"}` then
 * `{"stage":"census"}` — because the single-pass version exceeded the edge
 * worker's memory on its first invocation (WORKER_RESOURCE_LIMIT): the
 * 38MB DataPack, the SEIFA workbook model and the assembled rows do not fit
 * together. SEIFA loads first; the census stage checks its POAs against the
 * SEIFA keys already in the database, so the cross-source sanity check
 * survives the split.
 *
 * Auth: the internal edge secret — or, exactly once, an empty database. The
 * bootstrap arm lets the very first load run before any secret has been
 * threaded through, and it seals itself: the moment `abs_census_poa` holds a
 * row, only the secret opens this door. Re-opening it would take deleting
 * the reference data, which already requires the service role. The sources
 * are public and the write is an idempotent upsert of that public data, so
 * the bootstrap window's worst case is loading the ABS's own figures.
 */

const GCP_URL = 'https://www.abs.gov.au/census/find-census-data/datapacks/download/2021_GCP_POA_for_AUS_short-header.zip';
const SEIFA_URL = 'https://www.abs.gov.au/statistics/people/people-and-communities/socio-economic-indexes-areas-seifa-australia/2021/Postal%20Area%2C%20Indexes%2C%20SEIFA%202021.xlsx';
const REFERENCE_PERIOD = '2021';
const SOURCE_LABEL = 'ABS Census 2021 GCP DataPack (POA) G01/G02/G37/G46/G54/G60; SEIFA 2021 POA indexes';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ── Authorisation ────────────────────────────────────────────────────────
  const internalSecret = Deno.env.get('INTERNAL_EDGE_SECRET') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  let authorised = internalSecret !== '' && bearer === internalSecret;
  if (!authorised) {
    const { count, error } = await supabase
      .from('abs_census_poa')
      .select('poa', { count: 'exact', head: true });
    if (!error && (count ?? 0) === 0) {
      console.log('[abs-poa-ingest] bootstrap arm: reference table is empty, first load permitted');
      authorised = true;
    }
  }
  if (!authorised) return json({ success: false, error: 'forbidden' }, 403);

  let stage = 'unknown';
  try {
    stage = String((await req.json().catch(() => ({})))?.stage ?? '');
    const chunk = <T,>(arr: T[], n: number): T[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

    if (stage === 'seifa') {
      console.log('[abs-poa-ingest] seifa stage: downloading from the ABS…');
      const seifaRes = await fetch(SEIFA_URL, { headers: { 'User-Agent': 'npc-property-dashboard-abs-ingest' } });
      if (!seifaRes.ok) return json({ success: false, error: `SEIFA download answered ${seifaRes.status}` }, 502);
      const wb = XLSX.read(new Uint8Array(await seifaRes.arrayBuffer()), { type: 'array' });
      const sheet = wb.Sheets['Table 1'];
      if (!sheet) return json({ success: false, error: 'SEIFA workbook has no "Table 1"' }, 502);
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
      const seifaRows = parseSeifaTable1(aoa);
      for (const batch of chunk(seifaRows, 500)) {
        const { error } = await supabase.from('abs_seifa_poa').upsert(
          batch.map((r) => ({ ...r, reference_period: REFERENCE_PERIOD })),
          { onConflict: 'poa' },
        );
        if (error) return json({ success: false, error: `abs_seifa_poa upsert failed: ${error.message}` }, 500);
      }
      return json({ success: true, stage, seifa_rows: seifaRows.length, reference_period: REFERENCE_PERIOD });
    }

    if (stage === 'census') {
      // The cross-source check needs SEIFA loaded first. PostgREST caps a
      // single read at its max-rows setting (1,000 here), so the keys are
      // paginated — a `.limit(5000)` silently returned 1,000 and this stage
      // refused a database that was actually loaded.
      const seifaPoaKeys: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error: seifaErr } = await supabase
          .from('abs_seifa_poa').select('poa').order('poa').range(from, from + 999);
        if (seifaErr) return json({ success: false, error: `SEIFA keys unreadable: ${seifaErr.message}` }, 500);
        seifaPoaKeys.push(...(page ?? []).map((r: { poa: string }) => r.poa));
        if (!page || page.length < 1000) break;
      }
      if (seifaPoaKeys.length < 2000) {
        return json({ success: false, error: 'run the seifa stage first — the census stage refuses without its cross-check' }, 409);
      }

      console.log('[abs-poa-ingest] census stage: downloading DataPack from the ABS…');
      const gcpRes = await fetch(GCP_URL, { headers: { 'User-Agent': 'npc-property-dashboard-abs-ingest' } });
      if (!gcpRes.ok) return json({ success: false, error: `DataPack download answered ${gcpRes.status}` }, 502);
      let zip: Awaited<ReturnType<typeof JSZip.loadAsync>> | null = await JSZip.loadAsync(await gcpRes.arrayBuffer());
      const gcp: Record<string, Map<string, Record<string, number | null>>> = {};
      for (const [table, cols] of Object.entries(GCP_TABLES)) {
        const name = Object.keys(zip.files).find((f) => f.endsWith(`2021Census_${table}_AUST_POA.csv`));
        if (!name) return json({ success: false, error: `${table} CSV missing from DataPack` }, 502);
        gcp[table] = parseGcpCsv(await zip.files[name].async('string'), cols);
      }
      zip = null; // release the archive before assembling and upserting

      const census = assembleCensusRows(gcp);
      const withSeifa = checkSeifaCoverage(census, new Set(seifaPoaKeys));
      const nationalPopulation = census.reduce((s, r) => s + (r.population ?? 0), 0);
      console.log('[abs-poa-ingest] census parsed and verified:', { rows: census.length, nationalPopulation, withSeifa });

      for (const batch of chunk(census, 250)) {
        const { error } = await supabase.from('abs_census_poa').upsert(
          batch.map((r) => ({ ...r, reference_period: REFERENCE_PERIOD, source: SOURCE_LABEL })),
          { onConflict: 'poa' },
        );
        if (error) return json({ success: false, error: `abs_census_poa upsert failed: ${error.message}` }, 500);
      }
      const detail = {
        census_rows: census.length,
        seifa_rows: seifaPoaKeys.length,
        national_population: nationalPopulation,
        poas_with_seifa: withSeifa,
        reference_period: REFERENCE_PERIOD,
        source: SOURCE_LABEL,
      };
      const { error: syncError } = await supabase.from('abs_poa_sync').insert({ detail });
      if (syncError) console.warn('[abs-poa-ingest] sync record failed (load itself succeeded):', syncError.message);
      return json({ success: true, stage, ...detail });
    }

    return json({ success: false, error: 'stage must be "seifa" or "census"' }, 400);
  } catch (error) {
    console.error(`[abs-poa-ingest] ${stage} stage failed:`, error);
    return json({ success: false, ...internalError(error, 'abs-poa-ingest') }, 500);
  }
});
