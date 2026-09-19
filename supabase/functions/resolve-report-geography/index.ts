/**
 * ME-5 item 15 — the forward geography writer.
 *
 * `report_geography` holds a canonical suburb, SA2, remoteness and urban centre
 * for every report whose coordinate could be placed. It was populated once, by
 * hand, for the 1,114 reports that existed — and **nothing wrote a row for a
 * report created afterwards.** A derived table that only a backfill maintains
 * is correct on the day it lands and silently stale from the next one, which is
 * the failure this programme keeps finding.
 *
 * This is what maintains it. It resolves the geography for reports that have no
 * row, from the report's own stored coordinate, against the ABS ASGS 2021
 * boundaries — the same deterministic point-in-polygon the backfill used, and
 * the same pure module (`asgsGeography.pure.ts`) decides what the answer means.
 *
 * ## RF-7.2B.1 — this is no longer the only caller
 *
 * The per-report body now lives in `_shared/geography/resolveOneReportGeography.ts`
 * so the generator can resolve the report in hand BEFORE the Client-Safe Gate
 * decides whether ABS data belongs to the subject property. **There is one
 * geography algorithm**: this function selects the batch and that module
 * resolves each member, so a first generation and this sweep cannot disagree.
 *
 * Lifting it out is also what exposed the defect that had emptied this table:
 * the write said `method: 'point_in_polygon'` and the CHECK constraint admits
 * only `'asgs_point_in_polygon'`, so every upsert was rejected and the rejection
 * was swallowed into a per-report `write_failed:` string in a results array
 * nobody reads, under HTTP 200. Fixed in the shared module, in the one place
 * that now writes.
 *
 * ## Four rules
 *
 * **The coordinate is the question, and the free-text address is never
 * consulted.** `ADDRESS_COMPOSITION.md` records why an address cannot prove a
 * suburb, and 183 stored reports prove it the other way by having been geocoded
 * to London, Lisbon and Washington State.
 *
 * **A failed boundary service is unresolved, never guessed.** The ArcGIS
 * endpoint reports failures as HTTP 200 with an error body, so that shape is
 * treated as transport failure and the row is written `unresolved` with
 * `boundary_service_unavailable` — a state the sweep will retry, unlike
 * `outside_australia`, which is final.
 *
 * **It never writes to `investment_reports`.** The stored report keeps exactly
 * the bytes it was written with; this is a record beside it.
 *
 * **The batch is bounded.** Each layer is a separate query, so one report costs
 * seven requests to a public service somebody else pays to run. A small batch
 * that drains over several invocations is the courteous shape, and it also
 * means a bad deploy cannot spend an afternoon of somebody's rate limit.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createCorsHeaders } from '../_shared/auth.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { resolveOneReportGeography } from '../_shared/geography/resolveOneReportGeography.ts';

const corsHeaders = createCorsHeaders();

/** Reports resolved per invocation. Seven public queries each. */
const BATCH = 8;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Reports with no geography row yet. Never re-resolves a settled one:
    // a resolved coordinate does not change, and re-running would spend a
    // public service's budget to write the same answer.
    const { data: pending, error: readError } = await supabase
      .from('investment_reports')
      .select('id, location_intelligence')
      .not('location_intelligence', 'is', null)
      .limit(200);

    if (readError) {
      return new Response(
        JSON.stringify({ success: false, error: 'could not read reports', detail: readError.message }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: existing } = await supabase
      .from('report_geography').select('report_id').limit(5000);
    const done = new Set((existing ?? []).map((r) => r.report_id as string));

    const todo = (pending ?? []).filter((r) => !done.has(r.id as string)).slice(0, BATCH);
    const results: Array<{ reportId: string; status: string }> = [];

    for (const row of todo) {
      const li = row.location_intelligence as Record<string, unknown> | null;
      const coords = (li?.coordinates ?? null) as Record<string, unknown> | null;

      const outcome = await resolveOneReportGeography({
        supabase,
        reportId: row.id as string,
        latitude: num(coords?.lat),
        longitude: num(coords?.lng),
      });

      results.push({
        reportId: row.id as string,
        status: outcome.writeError ? `write_failed: ${outcome.writeError}` : outcome.status,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      resolved: results.length,
      remaining: Math.max(0, (pending ?? []).filter((r) => !done.has(r.id as string)).length - results.length),
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('resolve-report-geography failed:', error);
    return new Response(
      JSON.stringify({ success: false, ...internalError(error, 'resolve-report-geography') }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
