import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';
import {
  buildMacroReading, cpiProjectionsFromMeasured,
  type MacroFigure, type RbaMetaRow, type RbaObsRow,
} from '../_shared/rbaReading.pure.ts';

/**
 * Serve the macro-economic reading from the loaded RBA statistical tables
 * (`rba_observations` / `rba_series_meta`, loaded by rba-tables-ingest from
 * F1.1, G1 and F5) — replacing a path that asked a search model for "exact
 * current values" and validated almost nothing it said.
 *
 * What changed, and why each part matters:
 *  - **The figures are transcriptions, not model output.** The cash rate is
 *    F1.1's own FIRMMCRT cell; inflation is G1's; lending rates are F5's.
 *    Nothing here can misremember a number.
 *  - **Every figure carries its own reference period** (the observation's
 *    date) and the table's own publication date — never the retrieval
 *    date. The old path stamped `lastUpdate: today` on whatever it got,
 *    which is the freshness-of-load-is-not-currency-of-data mistake.
 *  - **GDP, unemployment and participation are gone from the response**,
 *    because these tables do not carry them. The old path coerced their
 *    absence with `|| 0` — a 0.0% unemployment rate — and the generator
 *    printed hardcoded fallbacks for them under a "VERIFIED" heading.
 *  - **CPI projections are a named assumption** (convergence from the
 *    measured year-ended CPI toward the RBA target midpoint), never
 *    labelled as an RBA or Treasury forecast nobody read.
 *  - An empty store answers `sourceUnavailable` — there is no fallback
 *    figure, because a stale rate wearing today's date is worse than none.
 */

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[rba-data-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[rba-data-service] Authenticated user: ${userId}`);

    const { data: metaRows, error: metaError } = await supabase
      .from('rba_series_meta')
      .select('series_id, table_code, title, description, units, publication_date');
    if (metaError) throw new Error(`rba_series_meta read failed: ${metaError.message}`);

    // Four years of history is enough to date the cash rate's last move and
    // carry every series' latest readings: ~400 rows for the 11 series,
    // comfortably under PostgREST's 1,000-row cap — bounded explicitly so a
    // silent truncation cannot masquerade as a shorter series.
    const windowStart = new Date();
    windowStart.setUTCFullYear(windowStart.getUTCFullYear() - 4);
    const { data: obsRows, error: obsError } = await supabase
      .from('rba_observations')
      .select('series_id, obs_date, value')
      .gte('obs_date', windowStart.toISOString().slice(0, 10))
      .order('obs_date', { ascending: false })
      .limit(1000);
    if (obsError) throw new Error(`rba_observations read failed: ${obsError.message}`);

    const obs: RbaObsRow[] = (obsRows ?? []).map((r: { series_id: string; obs_date: string; value: unknown }) => ({
      series_id: r.series_id,
      obs_date: r.obs_date,
      value: Number(r.value),
    }));
    // The decision history — 401 rows, tiny — is the authority for the current
    // target's EFFECTIVE date. F1's change column records only non-zero moves,
    // so without this the service can say when the rate last changed but not
    // when the rate in force took effect, and those differ whenever the Board
    // meets and holds.
    const { data: decisionRows, error: decisionError } = await supabase
      .from('rba_cash_rate_decisions')
      .select('effective_date, change_points, target_percent')
      .order('effective_date', { ascending: false })
      .limit(600);
    if (decisionError) throw new Error(`rba_cash_rate_decisions read failed: ${decisionError.message}`);

    const reading = buildMacroReading(
      (metaRows ?? []) as RbaMetaRow[],
      obs,
      (decisionRows ?? []).map((d: { effective_date: string; change_points: unknown; target_percent: unknown }) => ({
        effective_date: d.effective_date,
        change_points: d.change_points === null ? null : Number(d.change_points),
        target_percent: d.target_percent === null ? null : Number(d.target_percent),
      })),
    );

    if (!reading) {
      // Nothing loaded. The old `getFallbackData()` answered here with a
      // cash rate hard-coded at 4.10% stamped with TODAY'S date — over a
      // year stale by the time it was removed. A stale rate wearing
      // today's date is worse than no rate.
      return new Response(JSON.stringify(sourceUnavailable(
        'rba-economics',
        'not_configured',
        'The RBA statistical tables (F1.1, G1, F5) are not loaded — run scripts/rba/load-rba-tables.mjs. Economic figures are unavailable rather than served from memory.',
      )), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const measuredCpi: MacroFigure | null = reading.inflation?.yearEnded ?? null;
    return new Response(JSON.stringify({
      success: true,
      data: {
        ...reading,
        cpiProjections: cpiProjectionsFromMeasured(measuredCpi),
        retrievedAt: new Date().toISOString(),
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in RBA data service:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to read RBA data';
    return new Response(JSON.stringify({
      error: errorMessage,
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
