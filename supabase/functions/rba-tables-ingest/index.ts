import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { internalError } from '../_shared/errorResponse.ts';
import { parseRbaCsv, RBA_WANTED_SERIES, type RbaTableCode, observationsToPersist } from '../_shared/rbaTables.pure.ts';
import { parseCashRateDecisions } from '../_shared/rbaCashRateDecisions.pure.ts';

/**
 * Ingest the RBA statistical tables into `rba_observations` /
 * `rba_series_meta` — the store rba-data-service reads instead of asking a
 * search model for figures.
 *
 * Unlike the ABS and crime ingests, this function does NOT fetch:
 * rba.gov.au refuses this project's egress (Akamai "Access Denied" on all
 * three CSVs, measured from a probe deployed here 2026-09-06), so a loader
 * running where egress works (`scripts/rba/load-rba-tables.mjs`, or an
 * operator's curl) downloads the CSV and POSTs its text verbatim:
 *
 *   `{"table":"f1.1","csv":"<the file's text>"}`
 *
 * ALL parsing is server-side (`_shared/rbaTables.pure.ts`) — the
 * sanctions-register lesson: a loader that parsed differently writes rows
 * no reader matches. The parser refuses (nothing written) on a wrong or
 * moved layout, a truncated file, an unparseable or implausible value, or
 * an absent wanted series; an empty value cell is an absent observation,
 * never zero (G1's future-dated rows). Upserts never delete, so a smaller
 * file can never shrink the store.
 *
 * Auth: the internal edge secret — or, exactly once per table, an empty
 * `rba_series_meta` for that table_code (the per-table self-sealing
 * bootstrap arm; the source is public data and the write is an idempotent
 * upsert of it). Refreshing is re-POSTing a newer file; every figure's
 * currency is read from its own observation date, never from loaded_at.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** The three files are 40–75 KB today; 2 MB refuses abuse without ever refusing a real file. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const rawBody = await req.text().catch(() => '');
  if (rawBody.length > MAX_BODY_BYTES) return json({ success: false, error: 'body_too_large' }, 413);
  let body: { table?: unknown; csv?: unknown } = {};
  try { body = JSON.parse(rawBody); } catch { /* refused below as bad table */ }

  const table = String(body?.table ?? '') as RbaTableCode | 'cash-rate';
  // `cash-rate` is the RBA's own decision-history PAGE rather than a
  // statistical-table CSV. It rides this function because the auth arm, the
  // CORS handling and the sync record are the same; only the parse and the
  // destination differ.
  const isDecisions = table === 'cash-rate';
  if (!isDecisions && !(table in RBA_WANTED_SERIES)) {
    return json({ success: false, error: 'table must be "f1", "f1.1", "g1", "f5" or "cash-rate"' }, 400);
  }
  const csv = typeof body?.csv === 'string' ? body.csv : '';
  if (csv.trim() === '') {
    return json({ success: false, error: isDecisions ? 'page text is required' : 'csv text is required' }, 400);
  }

  // Per-table bootstrap arm (the crime ingest's per-state lesson: a
  // whole-store emptiness gate seals after the first table loads and locks
  // the other two out). A table's first load opens without the secret;
  // re-loading one that holds rows requires it — presented either as the
  // bearer (abs-poa-ingest / crime-data-ingest parity) or as
  // `X-Cron-Secret`, the scheduled-worker channel that can traverse a
  // JWT-checking gateway (the gateway wants a project JWT in Authorization,
  // so a refresh sends the anon JWT there and the secret here).
  const internalSecret = Deno.env.get('INTERNAL_EDGE_SECRET') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  let authorised = internalSecret !== '' &&
    (bearer === internalSecret || req.headers.get('x-cron-secret') === internalSecret);
  if (!authorised) {
    const { count, error } = isDecisions
      ? await supabase
        .from('rba_cash_rate_decisions')
        .select('effective_date', { count: 'exact', head: true })
      : await supabase
        .from('rba_series_meta')
        .select('series_id', { count: 'exact', head: true })
        .eq('table_code', table);
    if (!error && (count ?? 0) === 0) {
      console.log(`[rba-tables-ingest] bootstrap arm: no ${table} series yet, first load permitted`);
      authorised = true;
    }
  }
  if (!authorised) return json({ success: false, error: 'forbidden' }, 403);

  try {
    const chunkAll = <T,>(arr: T[], n: number): T[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

    if (isDecisions) {
      // The decision history, including the Board's unchanged decisions — the
      // only source that can say when the CURRENT target took effect. Parsing
      // throws before anything is written, so a moved layout writes nothing.
      const { decisions, source } = parseCashRateDecisions(csv);
      const loadedAt = new Date().toISOString();
      let written = 0;
      for (const batch of chunkAll([...decisions], 500)) {
        const { error } = await supabase.from('rba_cash_rate_decisions').upsert(
          batch.map((d) => ({
            effective_date: d.effectiveDate,
            change_points: d.changePoints,
            target_percent: d.targetPercent,
            target_text: d.targetText,
            source,
            loaded_at: loadedAt,
          })),
          { onConflict: 'effective_date' },
        );
        if (error) throw new Error(`rba_cash_rate_decisions upsert failed: ${error.message}`);
        written += batch.length;
      }
      const newest = decisions[0];
      const detail = {
        table: 'cash-rate',
        source,
        decisions_written: written,
        unchanged_decisions: decisions.filter((d) => d.changePoints === 0).length,
        newest_effective_date: newest?.effectiveDate ?? null,
        newest_target_percent: newest?.targetPercent ?? null,
      };
      await supabase.from('rba_sync').insert({ detail });
      return json({ success: true, ...detail });
    }

    // Parse the file whole (so truncation and layout drift are still caught
    // against the real row count), then narrow to what this table persists.
    // F1 is daily: storing it whole would evict every monthly and quarterly
    // observation from the reader's bounded window. See RBA_PERSIST_POLICY.
    const parsed = observationsToPersist(parseRbaCsv(csv, table as RbaTableCode)); // throws → nothing written

    const chunk = <T,>(arr: T[], n: number): T[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

    let observationsWritten = 0;
    for (const series of parsed.series) {
      const last = series.observations[series.observations.length - 1];
      const { error: metaError } = await supabase.from('rba_series_meta').upsert({
        series_id: series.id,
        table_code: table,
        title: series.title,
        description: series.description,
        frequency: series.frequency,
        units: series.units,
        source: series.source,
        publication_date: parsed.publicationDate,
        last_observation: last.date,
        loaded_at: new Date().toISOString(),
      }, { onConflict: 'series_id' });
      if (metaError) throw new Error(`rba_series_meta upsert failed for ${series.id}: ${metaError.message}`);

      for (const batch of chunk(series.observations, 500)) {
        const { error } = await supabase.from('rba_observations').upsert(
          batch.map((o) => ({ series_id: series.id, obs_date: o.date, value: o.value })),
          { onConflict: 'series_id,obs_date' },
        );
        if (error) throw new Error(`rba_observations upsert failed for ${series.id}: ${error.message}`);
        observationsWritten += batch.length;
      }
    }

    const detail = {
      table,
      table_title: parsed.tableTitle,
      publication_date: parsed.publicationDate,
      series: parsed.series.map((s) => ({
        id: s.id,
        units: s.units,
        observations: s.observations.length,
        last_observation: s.observations[s.observations.length - 1].date,
      })),
      observations_written: observationsWritten,
    };
    await supabase.from('rba_sync').insert({ detail });
    return json({ success: true, ...detail });
  } catch (error) {
    console.error(`[rba-tables-ingest] ${table} load refused/failed:`, error);
    const message = error instanceof Error ? error.message : String(error);
    // A parse refusal is the caller's file being wrong, not this function
    // breaking — answer 422 with the parser's own reason so the loader
    // prints something actionable.
    if (/mismatch|truncated|implausible|unparseable|missing header|not in|no observations|unexpected non-data|unrecognised units|empty Units/i.test(message)) {
      return json({ success: false, error: message }, 422);
    }
    return json({ success: false, ...internalError(error, 'rba-tables-ingest') }, 500);
  }
});
