import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';
import { internalError } from '../_shared/errorResponse.ts';
import { parseErpTable1 } from '../_shared/absRegional.pure.ts';

/**
 * Ingest the ABS "Regional population" SA2 datacube into
 * `abs_sa2_population` / `abs_sa2_meta` — the store the regional-trends
 * reading serves population levels and growth from.
 *
 * This function IS the loader (the abs-poa-ingest pattern): abs.gov.au
 * answers this project's egress directly — measured from a probe deployed
 * here 2026-09-06, unlike rba.gov.au and the SALM hosts, which refuse it —
 * so it fetches the published cube itself and parses it through
 * `_shared/absRegional.pure.ts`, the one implementation, also under test.
 * The parser refuses (nothing written) on drifted headers, a broken year
 * run, an implausible SA2 count or value, or a latest-year national total
 * outside the measured plausibility anchor; the file's ".." marker is an
 * absent observation, never zero.
 *
 * Invocation: `{"stage":"erp"}` loads the pinned current release.
 * Refreshing after the next annual release is: update the two constants
 * below (release + filename, both printed by the ABS on the release page),
 * deploy, invoke — or pass `{"stage":"erp","release":"2025-26","file":
 * "32180DS0003_2001-26.xlsx"}`, both fields shape-validated so this can
 * never be pointed anywhere but the pinned ABS path.
 *
 * Auth: the internal edge secret (bearer or X-Cron-Secret) — or, exactly
 * once, an empty `abs_sa2_meta` (the self-sealing bootstrap arm; the
 * source is public data and the write is an idempotent upsert of it).
 */

const ABS_HOST = 'https://www.abs.gov.au';
const DEFAULT_RELEASE = '2024-25';
const DEFAULT_FILE = '32180DS0003_2001-25.xlsx';
const SOURCE_LABEL = 'ABS Regional population — estimated resident population by SA2 (cat. 3218.0 datacube 32180DS0003)';

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

  const body = await req.json().catch(() => ({})) as { stage?: unknown; release?: unknown; file?: unknown };
  if (String(body?.stage ?? '') !== 'erp') {
    return json({ success: false, error: 'stage must be "erp"' }, 400);
  }
  const release = String(body?.release ?? DEFAULT_RELEASE);
  const file = String(body?.file ?? DEFAULT_FILE);
  // Shape-validated path segments: the fetch can only ever address the ABS
  // regional-population release directory — never a caller-chosen host.
  if (!/^\d{4}-\d{2}$/.test(release)) return json({ success: false, error: 'release must look like "2024-25"' }, 400);
  if (!/^32180DS\d{4}_[\d-]+\.xlsx$/.test(file)) return json({ success: false, error: 'file must be a 32180DS… datacube name' }, 400);

  // Per-store bootstrap arm: the first load opens without the secret;
  // re-loading once rows exist requires it (bearer for sibling-ingest
  // parity, or X-Cron-Secret — the channel that traverses the
  // JWT-checking gateway).
  const internalSecret = Deno.env.get('INTERNAL_EDGE_SECRET') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  let authorised = internalSecret !== '' &&
    (bearer === internalSecret || req.headers.get('x-cron-secret') === internalSecret);
  if (!authorised) {
    const { count, error } = await supabase
      .from('abs_sa2_meta')
      .select('sa2_code', { count: 'exact', head: true });
    if (!error && (count ?? 0) === 0) {
      console.log('[abs-regional-ingest] bootstrap arm: no SA2 rows yet, first load permitted');
      authorised = true;
    }
  }
  if (!authorised) return json({ success: false, error: 'forbidden' }, 403);

  try {
    const url = `${ABS_HOST}/statistics/people/population/regional-population/${release}/${file}`;
    console.log(`[abs-regional-ingest] downloading ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': 'npc-property-dashboard-regional-ingest' } });
    if (!res.ok) return json({ success: false, error: `ABS download answered ${res.status}` }, 502);
    const bytes = new Uint8Array(await res.arrayBuffer());

    const workbook = XLSX.read(bytes, { type: 'array' });
    const sheet = workbook.Sheets['Table 1'];
    if (!sheet) throw new Error(`workbook has no "Table 1" sheet (sheets: ${workbook.SheetNames.join(', ')})`);
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];

    const parsed = parseErpTable1(grid); // throws → nothing written

    const chunk = <T,>(arr: T[], n: number): T[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

    let observationsWritten = 0;
    const now = new Date().toISOString();
    for (const metaBatch of chunk(parsed.rows, 500)) {
      const { error } = await supabase.from('abs_sa2_meta').upsert(
        metaBatch.map((r) => ({
          sa2_code: r.sa2Code,
          sa2_name: r.sa2Name,
          state_name: r.stateName,
          sa3_name: r.sa3Name,
          sa4_name: r.sa4Name,
          gccsa_name: r.gccsaName,
          release,
          first_year: parsed.years[0],
          last_year: parsed.latestYear,
          loaded_at: now,
        })),
        { onConflict: 'sa2_code' },
      );
      if (error) throw new Error(`abs_sa2_meta upsert failed: ${error.message}`);
    }

    const observations = parsed.rows.flatMap((r) =>
      Object.entries(r.erpByYear).map(([year, erp]) => ({ sa2_code: r.sa2Code, year: Number(year), erp })),
    );
    for (const batch of chunk(observations, 1000)) {
      const { error } = await supabase.from('abs_sa2_population').upsert(batch, { onConflict: 'sa2_code,year' });
      if (error) throw new Error(`abs_sa2_population upsert failed: ${error.message}`);
      observationsWritten += batch.length;
    }

    const nationalLatest = parsed.rows.reduce((s, r) => s + (r.erpByYear[parsed.latestYear] ?? 0), 0);
    const detail = {
      stage: 'erp',
      release,
      file,
      source: SOURCE_LABEL,
      sa2_rows: parsed.rows.length,
      years: `${parsed.years[0]}–${parsed.latestYear}`,
      observations_written: observationsWritten,
      national_latest: nationalLatest,
    };
    await supabase.from('abs_regional_sync').insert({ detail });
    return json({ success: true, ...detail });
  } catch (error) {
    console.error('[abs-regional-ingest] erp load refused/failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (/drifted|refused|implausible|anchor|contiguous|year row|no "Table 1"|not the SA2 datacube|year columns/i.test(message)) {
      return json({ success: false, error: message }, 422);
    }
    return json({ success: false, ...internalError(error, 'abs-regional-ingest') }, 500);
  }
});
