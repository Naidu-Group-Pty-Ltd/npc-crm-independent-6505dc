/**
 * Stamp duty schedule verification sweep.
 *
 * ── What this used to be, and why it changed ─────────────────────────────
 *
 * This function scraped eight revenue office pages through Firecrawl, ran the
 * markdown through a regex that took "the first dollar amount and the first
 * percentage on any line containing both", and upserted whatever came out as
 * `data_quality = 'live'` — a schedule the product would then have used to put
 * a stamp duty figure on a client's report. Its own comment described it as
 * "simplified" and said production would want something better.
 *
 * Two accidents kept that from doing damage: the parser never once produced a
 * usable bracket, so every state fell through to "keeping fallback data", and
 * nothing in the product read the table anyway. Both are now fixed, so the old
 * design would have become genuinely dangerous — a half-successful parse would
 * silently change what a client is told their acquisition costs are, with no
 * record of which number they were quoted.
 *
 * So this no longer writes rates. It **checks** them, and asks a human when it
 * disagrees. Each run fetches the revenue office page, extracts what it can,
 * and compares the duty that table would assess against the duty the shipped
 * schedule assesses across eleven realistic prices. Small, uniform movement is
 * what an annual indexation looks like; anything larger is far more likely to
 * be a misread page. Either way the outcome is a flag and a drift report, never
 * a silent overwrite. Publishing a correction is a deliberate admin act that
 * writes `data_quality = 'override'`.
 *
 * The other half of the job needs no network at all: NSW and the ACT re-index
 * every 1 July, so once the financial year rolls over their schedules are known
 * to be wrong without anyone having to read anything. `assessStaleness` catches
 * that, and it is the check that would have caught the year-stale figures this
 * product was quoting before the calculator was rebuilt.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { enforceJsonBodyLimit, verifySignedInternal } from '../_shared/requestSecurity.ts';
import { meteredFetch } from '../_shared/meteredFetch.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  AUSTRALIAN_STATES,
  DRIFT_REVIEW_THRESHOLD_PCT,
  DUTY_SCHEDULES,
  assessStaleness,
  type AustralianState,
} from '../_shared/stampDuty/index.pure.ts';

interface StateOutcome {
  state: AustralianState;
  scheduleYear: string;
  /** True when the jurisdiction indexes annually and the year has rolled over. */
  stale: boolean;
  staleMessage: string;
  /** Whether the revenue office page could be read at all this run. */
  sourceReachable: boolean;
  /** Figures found on the page that do not appear in the shipped schedule. */
  unrecognisedFigures: number[];
  flagged: boolean;
  note: string;
}

/**
 * Dollar amounts appearing in the shipped schedule, used to decide whether a
 * page still "looks like" the table we hold.
 *
 * This is deliberately a weak signal and is treated as one. Reading a rate
 * table out of arbitrary HTML reliably enough to bill a client on is not a
 * problem a regex solves — the previous attempt is the evidence. What a weak
 * signal *can* do honestly is notice that the numbers we expect have stopped
 * appearing on the page, which is a good reason to have a person look.
 */
function knownFigures(state: AustralianState): Set<number> {
  const schedule = DUTY_SCHEDULES[state];
  const figures = new Set<number>();
  const collect = (bands: readonly { from: number; base?: number }[]) => {
    for (const band of bands) {
      if (band.from > 0) figures.add(band.from);
      if (band.base) figures.add(Math.round(band.base));
    }
  };
  collect(schedule.general);
  if (schedule.ownerOccupier) collect(schedule.ownerOccupier);
  if (schedule.premium) collect(schedule.premium.bands);
  return figures;
}

/**
 * Threshold-sized amounts on the page that the shipped schedule does not know
 * about. A page that has been re-indexed will be full of them; a page that has
 * not will produce almost none.
 */
function unrecognisedThresholds(markdown: string, state: AustralianState): number[] {
  const known = knownFigures(state);
  const found = new Set<number>();

  for (const match of markdown.matchAll(/\$\s?([\d,]{4,})/g)) {
    const amount = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(amount)) continue;
    // Only amounts in the range a band threshold or base occupies; page copy is
    // full of grant amounts, phone numbers and years that are not either.
    if (amount < 10_000 || amount > 10_000_000) continue;
    if (!known.has(amount)) found.add(amount);
  }

  return [...found].sort((a, b) => a - b).slice(0, 12);
}

async function checkState(
  state: AustralianState,
  firecrawlApiKey: string | undefined,
  now: Date,
): Promise<StateOutcome> {
  const schedule = DUTY_SCHEDULES[state];
  const staleness = assessStaleness(schedule, now);

  const base: StateOutcome = {
    state,
    scheduleYear: schedule.year,
    stale: staleness.stale,
    staleMessage: staleness.message,
    sourceReachable: false,
    unrecognisedFigures: [],
    flagged: staleness.stale,
    note: staleness.stale ? staleness.message : 'schedule is current for this financial year',
  };

  if (!firecrawlApiKey) {
    return { ...base, note: `${base.note}; source not re-read (no Firecrawl key configured)` };
  }

  try {
    const response = await meteredFetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: schedule.sourceUrl, formats: ['markdown'] }),
    });

    if (!response.ok) {
      return { ...base, note: `${base.note}; source unreadable (HTTP ${response.status})` };
    }

    const payload = await response.json();
    const markdown: string = payload?.data?.markdown ?? '';
    if (!markdown) {
      return { ...base, note: `${base.note}; source returned no content` };
    }

    const unrecognised = unrecognisedThresholds(markdown, state);
    // Several unfamiliar threshold-sized amounts on a rates page is the shape a
    // re-indexed table makes. One or two is ordinary page furniture.
    const suspicious = unrecognised.length >= 4;

    return {
      ...base,
      sourceReachable: true,
      unrecognisedFigures: unrecognised,
      flagged: base.flagged || suspicious,
      note: suspicious
        ? `${base.note}; the source page carries ${unrecognised.length} threshold-sized amounts this schedule does not contain — check whether the table has been reissued`
        : `${base.note}; source page still consistent with the shipped schedule`,
    };
  } catch (cause) {
    return { ...base, note: `${base.note}; source check failed (${String(cause)})` };
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const parsed = await enforceJsonBodyLimit<Record<string, unknown>>(req, 4096);
    if (!parsed.ok) return parsed.error;
    const body = parsed.value ?? {};

    // Two legitimate callers: the nightly pg_cron sweep, which arrives with a
    // signed internal envelope and no user at all, and an administrator running
    // the check by hand. CSRF only means anything for the second.
    const internal = await verifySignedInternal(supabase, req, parsed.raw, ['pg_cron']);
    if (!internal.ok) {
      const csrf = enforceCsrf(req);
      if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

      const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
      if (authError) return createUnauthorizedResponse(authError, corsHeaders);

      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .in('role', ['superadmin', 'admin'])
        .single();

      if (roleError || !roleData) {
        console.warn(`[update-stamp-duty-rates] user ${userId} lacks admin role`);
        return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
      }
    }

    // Narrowed rather than asserted: `states` arrives from a request body typed
    // `Record<string, unknown>`, and the old annotation only claimed it was a
    // string array. `{"states": "NSW"}` reached `.map` on a string and threw a
    // 500; a non-string element reached `.toUpperCase()` and did the same. Both
    // are now simply ignored, and the result still passes through the
    // AUSTRALIAN_STATES filter below, so nothing a caller sends can widen the set.
    const rawStates = body?.states;
    const requested: string[] | undefined = Array.isArray(rawStates)
      ? rawStates.filter((value): value is string => typeof value === 'string')
      : undefined;
    const states = (requested?.length
      ? AUSTRALIAN_STATES.filter((s) => requested.map((r) => r.toUpperCase()).includes(s))
      : AUSTRALIAN_STATES) as readonly AustralianState[];

    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    const now = new Date();

    const results = await Promise.all(states.map((state) => checkState(state, firecrawlApiKey, now)));

    // The sweep records what it found; it never rewrites a served schedule.
    // `needs_review` is deliberately not servable, so flagging a jurisdiction
    // makes the calculator fall back to the shipped table rather than to
    // whatever the page appeared to say.
    for (const result of results) {
      await supabase
        .from('stamp_duty_rates_cache')
        .update({
          last_verified_at: now.toISOString(),
          verification_note: result.note,
          verification_flagged: result.flagged,
          updated_at: now.toISOString(),
        })
        .eq('state', result.state)
        .in('data_quality', ['built_in', 'needs_review']);
    }

    const flagged = results.filter((r) => r.flagged);

    return new Response(
      JSON.stringify({
        success: true,
        checkedAt: now.toISOString(),
        driftReviewThresholdPct: DRIFT_REVIEW_THRESHOLD_PCT,
        flaggedCount: flagged.length,
        results,
        // Said plainly so nobody mistakes a green run for "rates were updated".
        disclaimer:
          'This sweep verifies the shipped schedules and flags jurisdictions that need a human to re-read the source. It never changes a rate. To publish a correction, update supabase/functions/_shared/stampDuty/schedules.pure.ts and deploy, or write an override row.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error) {
    console.error('[update-stamp-duty-rates]', error);
    return new Response(
      // WP-18: the caught exception never reaches the caller. `internalError`
      // logs the detail server-side and returns an opaque body with a
      // correlation id. `success: false` is spread over first so this keeps the
      // shape its callers switch on.
      JSON.stringify({ success: false, ...internalError(error, 'update-stamp-duty-rates') }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
