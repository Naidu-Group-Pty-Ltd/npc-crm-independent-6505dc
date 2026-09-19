/**
 * amenity-register-ingest — loads one state's amenity register slices from
 * a public Overpass instance.
 *
 * Fired daily by pg_cron (one job per state, migration
 * 20261130090000), and runnable by hand with the same body. Each
 * invocation walks the six categories for its state, one Overpass request
 * at a time, and records every slice attempt in `amenity_register_syncs`.
 * The register READ (location-intelligence-service, school-data-service)
 * never talks to Overpass; this function is the only thing that does.
 *
 * The etiquette rules are the geocoder's: an identifying User-Agent, one
 * request at a time behind the shared turn limiter, a daily allowance
 * that fails closed, and a `[timeout:]` inside every query so an
 * abandoned request stops costing the mirror (probe 248254 ran the
 * server's 180 s default long after pg_net hung up at 30 s).
 *
 * Budget: the six categories share one invocation against the edge
 * ceiling, so the loop stops when the wall clock says so and reports the
 * remainder as skipped — the investment-report resume lesson: a hand-off,
 * never a failure. The starting category rotates by day so a clipped
 * tail is a different tail tomorrow.
 *
 * A parse of ZERO rows is refused as failed (the sanctions loader's
 * rule): no Australian state holds zero schools, parks or supermarkets,
 * so an empty answer is a wrong answer, and refusing it leaves the
 * previous load standing.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { fetchWithTimeout } from '../_shared/publicAbuseControls.ts';
import { awaitOsmTurn, consumeOsmDailyAllowance } from '../_shared/geocode/osmAllowance.ts';
import { GEOCODER_USER_AGENT } from '../_shared/geocode/geocoder.ts';
import {
  AMENITY_CATEGORIES,
  AMENITY_FILTERS,
  AMENITY_STATES,
  OVERPASS_MIRRORS,
  buildSliceQuery,
  parseAmenityCsv,
  type AmenityCategory,
  type AmenityState,
} from '../_shared/openLocation/overpassAmenities.pure.ts';
import {
  closeSliceSync,
  openSliceSync,
  pruneSliceRows,
  upsertSliceRows,
} from '../_shared/openLocation/amenityRegisterStore.ts';

/** Wall-clock a full six-category run may spend before handing the rest off. */
const RUN_BUDGET_MS = 120_000;
/**
 * A run scoped to named categories is a repair, not the nightly sweep: it
 * has one or two slices to finish and nobody queued behind it, so it gets
 * room for the union-then-per-pair ladder below. The edge wall allowance
 * comfortably covers it; the ledger, not the HTTP response, is the record.
 */
const SCOPED_RUN_BUDGET_MS = 300_000;
/**
 * One Overpass fetch may take at most this long — STRICTLY ABOVE the
 * `[timeout:90]` every query grants the server. The first ceiling was
 * 60 s, so the client hung up on queries the server was still lawfully
 * computing ("The signal has been aborted" on VIC recreation, three
 * times, 16 Sep 2026) — which both loses the answer and wastes the
 * mirror's compute, the very discourtesy the `[timeout:]` discipline
 * exists to prevent.
 */
const FETCH_CEILING_MS = 100_000;
/**
 * The whole-union attempt gets a shorter first window: the heaviest union
 * that ever succeeded (NSW recreation) took ~40 s, so a union still
 * running at 50 s is one the per-pair ladder should finish instead — and
 * the window it did not spend is the ladder's to use.
 */
const UNION_FIRST_WINDOW_MS = 50_000;
/** Malformed-row ceiling: Overpass CSV does not escape, so a stray tab in a
 * name breaks its own row — measured essentially never. Past 2% something
 * else is wrong and the slice is refused. */
const MALFORMED_FLOOR = 20;
const MALFORMED_RATIO = 0.02;

interface SliceOutcome {
  category: AmenityCategory;
  status: 'succeeded' | 'failed' | 'skipped';
  rows?: number;
  error?: string;
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { error: authError } = await verifyAuth(supabase, req.headers, body);
  if (authError) return createUnauthorizedResponse(authError, corsHeaders);

  const state = String(body.state ?? '').toUpperCase() as AmenityState;
  if (!AMENITY_STATES.includes(state)) {
    return json({ success: false, error: `state must be one of ${AMENITY_STATES.join(', ')}` }, 400);
  }

  // An explicit subset for manual runs; otherwise all six, rotated by day
  // so a budget-clipped tail never starves the same categories every night.
  const asked = Array.isArray(body.categories)
    ? (body.categories.map(String).filter((c): c is AmenityCategory =>
        (AMENITY_CATEGORIES as string[]).includes(c)))
    : null;
  const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000);
  const rotation = dayOfYear % AMENITY_CATEGORIES.length;
  const categories = asked && asked.length > 0
    ? asked
    : [...AMENITY_CATEGORIES.slice(rotation), ...AMENITY_CATEGORIES.slice(0, rotation)];

  const startedAt = Date.now();
  const deadlineAt = startedAt + (asked && asked.length > 0 ? SCOPED_RUN_BUDGET_MS : RUN_BUDGET_MS);
  const outcomes: SliceOutcome[] = [];

  for (const category of categories) {
    if (deadlineAt - Date.now() < 25_000) {
      outcomes.push({ category, status: 'skipped', error: 'run budget spent; next run resumes' });
      continue;
    }
    try {
      outcomes.push(await loadSlice(supabase, category, state, deadlineAt));
    } catch (error) {
      // loadSlice closes its own ledger row on every path it can reach;
      // this catch is for faults before a ledger row exists.
      outcomes.push({ category, status: 'failed', error: (error as Error).message?.slice(0, 300) });
    }
  }

  const failed = outcomes.filter((o) => o.status === 'failed').length;
  return json({
    success: failed === 0,
    state,
    elapsedMs: Date.now() - startedAt,
    outcomes,
  });
});

async function loadSlice(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  category: AmenityCategory,
  state: AmenityState,
  deadlineAt: number,
): Promise<SliceOutcome> {
  const syncId = await openSliceSync(supabase, category, state);
  const fail = async (error: string): Promise<SliceOutcome> => {
    await closeSliceSync(supabase, syncId, { status: 'failed', error: error.slice(0, 500) });
    return { category, status: 'failed', error };
  };
  const windowMs = () => deadlineAt - Date.now() - 5_000;

  try {
    const filters = AMENITY_FILTERS[category];
    // The union-first window is a HOLD-BACK for the per-pair ladder below,
    // and a category of ONE tag pair has no ladder to hold anything back
    // for: its union IS its only query, so the shorter window buys nothing
    // and costs the difference. Measured 16 Sep 2026, the nightly sweep
    // under a slow mirror (~45-50 s a request): VIC and QLD `schools` —
    // one pair each — were aborted at 50 s and the slice failed outright,
    // where the 100 s ceiling they were entitled to would have carried
    // them. A single-pair category therefore gets the whole ceiling on its
    // first and only attempt.
    let fetched = await fetchSliceCsv(
      supabase,
      buildSliceQuery(category, state),
      Math.min(filters.length > 1 ? UNION_FIRST_WINDOW_MS : FETCH_CEILING_MS, windowMs()),
    );

    // A union of several tag pairs can outgrow the granted window while
    // each pair alone is an ordinary query (measured on VIC recreation and
    // the four-way transit union). Ask per pair, merge, and demand every
    // pair succeed — a category missing one pair's rows would undercount
    // as confidently as a complete one.
    if ('error' in fetched && filters.length > 1) {
      console.warn(`[amenity-register-ingest] ${category}/${state} union failed (${fetched.error}); retrying per tag pair`);
      const parts: string[] = [];
      let mirrors = '';
      for (const filter of filters) {
        const part = await fetchSliceCsv(
          supabase,
          buildSliceQuery(category, state, [filter]),
          Math.min(FETCH_CEILING_MS, windowMs()),
        );
        if ('error' in part) return await fail(`per-pair retry failed on ${filter[0]}=${filter[1]}: ${part.error}`);
        parts.push(part.csv);
        mirrors = part.mirror;
      }
      // Concatenate bodies under the first header; the parser dedupes
      // nothing, so merge dedupe happens on rows below.
      const [head, ...rest] = parts;
      fetched = { csv: [head, ...rest.map((c) => c.split('\n').slice(1).join('\n'))].join('\n'), mirror: `${mirrors} (per-pair)` };
    }
    if ('error' in fetched) return await fail(fetched.error);

    const parsed = parseAmenityCsv(fetched.csv, category);
    // A per-pair merge can list one element twice (a node tagged both
    // restaurant and cafe answers both queries); the upsert would take it
    // idempotently, but dedupe here so rows_written tells the truth.
    const seen = new Set<string>();
    parsed.rows = parsed.rows.filter((r) => {
      const key = `${r.osmType}/${r.osmId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (parsed.rows.length === 0) {
      return await fail(`parsed zero rows from ${fetched.mirror} (${fetched.csv.length} bytes) — an empty state slice is a wrong answer, previous load kept`);
    }
    const malformedCeiling = Math.max(MALFORMED_FLOOR, Math.round(parsed.rows.length * MALFORMED_RATIO));
    if (parsed.malformed > malformedCeiling) {
      return await fail(`${parsed.malformed} malformed rows against a ceiling of ${malformedCeiling} — refusing the slice`);
    }

    const written = await upsertSliceRows(supabase, parsed.rows, state, syncId);
    await pruneSliceRows(supabase, category, state, syncId);
    await closeSliceSync(supabase, syncId, {
      status: 'succeeded',
      rowsWritten: written,
      detail: {
        mirror: fetched.mirror,
        bytes: fetched.csv.length,
        malformed: parsed.malformed,
        offCategory: parsed.offCategory,
      },
    });
    return { category, status: 'succeeded', rows: written };
  } catch (error) {
    return await fail((error as Error).message?.slice(0, 300) ?? 'unknown ingest fault');
  }
}

/**
 * One Overpass ask, tried against the mirror list. Etiquette per REQUEST,
 * not per slice: each attempt takes the shared one-a-second turn and one
 * unit of the day's allowance, and a spent allowance stops the second
 * mirror too — the ceiling is ours, not the mirror's.
 */
async function fetchSliceCsv(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  query: string,
  budgetMs: number,
): Promise<{ csv: string; mirror: string } | { error: string }> {
  if (budgetMs < 15_000) return { error: 'window spent before the attempt' };
  let lastError = 'no mirror attempted';
  for (const mirror of OVERPASS_MIRRORS) {
    await awaitOsmTurn(supabase, 'overpass');
    const allowance = await consumeOsmDailyAllowance(supabase, 'amenities');
    if (!allowance.ok) return { error: `overpass allowance refused: ${allowance.reason}` };
    try {
      const res = await fetchWithTimeout(mirror, {
        method: 'POST',
        headers: {
          'User-Agent': GEOCODER_USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(query)}`,
      }, budgetMs);
      if (!res.ok) {
        lastError = `${mirror} answered ${res.status}`;
        continue;
      }
      return { csv: await res.text(), mirror };
    } catch (error) {
      lastError = `${mirror}: ${(error as Error).message?.slice(0, 120)}`;
    }
  }
  return { error: lastError };
}
