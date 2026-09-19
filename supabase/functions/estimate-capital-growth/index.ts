import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { geocodeAddress } from '../_shared/geocode/geocoder.ts';
import {
  type AddressGeography,
  mergeGeography,
  parseAddressText,
} from '../_shared/reports/market/addressGeography.pure.ts';
import {
  type CgrCandidate,
  candidateFromPoints,
  estimateCapitalGrowth,
} from '../_shared/reports/market/capitalGrowthEstimate.pure.ts';
import {
  type SalesRegisterSource,
  openDataSalesPoints,
  salesRegisterSourcesFor,
} from '../_shared/reports/market/openDataSalesEvidence.pure.ts';
import { readSalesRegister } from '../_shared/reports/market/salesRegisterRead.ts';
import { periodLabelFor } from '../_shared/reports/market/openData/salesRegister.pure.ts';
import type { EvidenceDwellingType, EvidenceSubject } from '../_shared/reports/market/marketEvidence.pure.ts';

/**
 * Estimate CGR — the capital growth rate the ten-year cash flow assumes,
 * read from the open sales register for the address typed at the top of
 * the Generate Investment Analysis form.
 *
 * What it does, in order:
 *  1. Resolves the address to a geography through the one geocoding chain
 *     (`_shared/geocode/geocoder.ts`): OpenStreetMap's Nominatim for the
 *     street, the ABS boundary server for the suburb's own centroid where no
 *     street was found, Google only where an operator lists it; the council
 *     from the ABS point-in-polygon query. Every answer passes the same
 *     granularity gate, and where nothing answers the typed text is parsed
 *     instead and the reading says so.
 *  2. Asks the register every source the state has, finest grain first
 *     (`salesRegisterSourcesFor`): a suburb series in Victoria and South
 *     Australia, the council series in Queensland, the postcode series in
 *     New South Wales, and the ABS state series beneath every state.
 *  3. Chooses the estimate (`estimateCapitalGrowth`): the finest area that
 *     carries a long-run horizon, with its basis, its caveats and the
 *     other areas' figures as context. Nothing is invented — an address
 *     no series reaches answers `found: false` and the field is left alone.
 *
 * It writes nothing but the geocode cache row the chain keeps.
 *
 * Auth: the gateway JWT in front, and `verifyAuth` inside — a signed-in
 * user (the Financials tab), the internal edge secret or a service-role
 * token.
 */

interface GeocodeOutcome {
  geography: AddressGeography | null;
  note: string | null;
}

/**
 * The address as a geography, through the one geocoding chain
 * (`_shared/geocode/geocoder.ts`): OpenStreetMap, then the suburb's own
 * centroid from the ABS, then Google only where an operator lists it. The
 * council comes from the ABS point-in-polygon query, because Queensland's
 * register is by council and Truganina alone straddles two.
 */
async function geocode(address: string, parsed: AddressGeography, supabase: unknown): Promise<GeocodeOutcome> {
  const outcome = await geocodeAddress(
    supabase,
    { address, suburb: parsed.suburb, state: parsed.state, postcode: parsed.postcode },
    { allowLocalityFallback: true, wantLga: true, feature: 'estimate-capital-growth/geocode' },
  );
  if (!outcome.ok) return { geography: null, note: `the geocoder did not place the address (${outcome.detail}); the typed address was parsed instead` };
  const r = outcome.result;
  return {
    geography: {
      suburb: r.suburb,
      state: r.state,
      postcode: r.postcode,
      lga: r.lga,
      formattedAddress: r.matchedAddress,
      resolvedFrom: 'geocode',
      locationType: `${r.provider}:${r.precision}`,
      notes: [],
    },
    note: null,
  };
}

function dwellingTypeFor(propertyType: unknown): EvidenceDwellingType {
  const t = String(propertyType ?? '').toLowerCase();
  if (!t) return 'any';
  if (/land|lot\b|vacant/.test(t)) return 'land';
  if (/unit|apartment|townhouse|villa|duplex|flat|terrace|strata/.test(t)) return 'attached';
  if (/house|home|dwelling|detached|residential/.test(t)) return 'house';
  return 'any';
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      (Deno.env.get('SUPABASE_URL') || '').trim(),
      (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim(),
    );
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { error: authError } = await verifyAuth(supabase, req.headers, body);
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);

    const propertyAddress = typeof body.propertyAddress === 'string' ? body.propertyAddress.trim().slice(0, 300) : '';
    if (!propertyAddress) return json({ success: false, error: 'propertyAddress is required' }, 400);
    const askedDwelling = dwellingTypeFor(body.propertyType);

    // 1. The geography.
    const parsed = parseAddressText(propertyAddress);
    const geocoded = await geocode(propertyAddress, parsed, supabase);
    const geography = mergeGeography(geocoded.geography, parsed);
    const notes: string[] = [...geography.notes];
    if (geocoded.note) notes.push(geocoded.note);
    if (!geography.state) {
      return json({ success: true, found: false, reason: 'the address names no Australian state, so no series can be read', geography, notes });
    }

    // 2. The register, finest grain first — every source, so the alternatives can be shown.
    const subject: EvidenceSubject = {
      suburb: geography.suburb,
      postcode: geography.postcode,
      state: geography.state,
      dwellingType: askedDwelling,
      resolvedFrom: geography.resolvedFrom === 'geocode' ? 'coordinate' : null,
    };
    const candidates: CgrCandidate[] = [];
    const consulted: Array<{ provider: string; areaKind: string; area: string | null; outcome: string }> = [];
    for (const source of salesRegisterSourcesFor(geography.state) as readonly SalesRegisterSource[]) {
      const area = source.areaKind === 'suburb' ? geography.suburb
        : source.areaKind === 'lga' ? geography.lga
        : source.areaKind === 'postcode' ? geography.postcode
        : geography.state;
      if (!area) {
        consulted.push({ provider: source.provider, areaKind: source.areaKind, area: null, outcome: `no ${source.areaKind} resolved for the address` });
        continue;
      }
      try {
        const register = await readSalesRegister(supabase, { state: geography.state, areaKind: source.areaKind, area });
        if (!register.rows.length) {
          consulted.push({ provider: source.provider, areaKind: source.areaKind, area, outcome: 'the register holds no rows for this area' });
          continue;
        }
        const answer = openDataSalesPoints({
          subject,
          askedDwelling,
          areaKind: source.areaKind,
          area: register.areaLabel ?? area,
          rows: register.rows,
          benchmarkRows: register.benchmarkRows,
          nationalRows: register.nationalRows,
          source,
        });
        const measure = register.rows.some((r) => r.priceMeasure === 'mean') ? 'mean' : 'median';
        const candidate = candidateFromPoints(answer.points, {
          sourceLabel: source.label,
          licence: source.licence,
          measure,
          dwellingType: answer.dwellingType,
          dwellingTypeMatched: answer.dwellingTypeMatched,
          latestPeriod: answer.latestPeriod,
          latestPeriodLabel: answer.latestPeriod && answer.span ? periodLabelFor(answer.latestPeriod, answer.span) : answer.latestPeriod,
          capturedAt: register.capturedAt,
          // The reading's currency: when the register last took this series
          // from its source. The register refreshes itself daily, so this is
          // the newest publication the source had released as of that day.
          loadedAt: register.loadedAt,
        });
        if (!candidate) {
          consulted.push({ provider: source.provider, areaKind: source.areaKind, area: register.areaLabel ?? area, outcome: answer.notes.join('; ') || 'no growth horizon could be computed' });
          continue;
        }
        candidates.push(candidate);
        consulted.push({ provider: source.provider, areaKind: source.areaKind, area: register.areaLabel ?? area, outcome: `${candidate.horizons.map((h) => `${h.years}y`).join(', ')} to ${answer.latestPeriod}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[estimate-capital-growth] ${source.provider} ${source.areaKind} ${area}: ${message}`);
        consulted.push({ provider: source.provider, areaKind: source.areaKind, area, outcome: 'the register could not be read' });
      }
    }

    // 3. The estimate.
    const estimate = estimateCapitalGrowth(candidates);
    if (!estimate) {
      return json({
        success: true,
        found: false,
        reason: 'no open growth series reaches this address yet',
        geography,
        consulted,
        notes,
      });
    }
    console.log(`[estimate-capital-growth] ${geography.suburb ?? ''} ${geography.state} → ${estimate.ratePct}% (${estimate.horizonYears}y, ${estimate.level})`);
    return json({ success: true, found: true, estimate, geography, consulted, notes });
  } catch (error) {
    console.error('[estimate-capital-growth] failed:', error instanceof Error ? error.message : String(error));
    return json({ success: false, ...internalError(error, 'estimate-capital-growth') }, 500);
  }
});
