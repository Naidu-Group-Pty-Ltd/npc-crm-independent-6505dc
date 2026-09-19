/**
 * domain-data-service — Domain Suburb Performance Statistics for one market.
 *
 * ## What this replaces
 *
 * The previous version requested `/v1/suburbPerformanceStatistics/{state}/{suburb}`
 * — a route Domain has deprecated, missing the `{postcode}` segment the live
 * route requires — so it answered 404 on every call and its own log line read
 * `lastSuccess: "Never"`. Had it ever succeeded, the extraction read fields the
 * response does not carry (`medianSoldPricePercentChange`,
 * `auctionClearanceRate`, `numberListedForRent`) and reduced twelve periods to
 * the latest one, discarding the series a capital-growth reading is made of.
 * Every report's Growth dimension was therefore absent, and with it the grade.
 *
 * ## Three rules
 *
 * **The postcode is a path segment and is required.** A caller must hold one
 * it trusts — the generator passes the postal area resolved from the verified
 * coordinate and nothing weaker — because a wrong postcode does not fail, it
 * describes somebody else's suburb. The request is composed by
 * `domainSuburbPerformanceUrl`, which refuses without one.
 *
 * **The series is extracted once, by `domainEvidence.pure.ts`.** The scoring
 * engine reads `MarketEvidence` points; this service returns them beside the
 * legacy summary fields (median sold price, sales, days on market) that the
 * qualitative regeneration and the agent tool already read.
 *
 * **A refusal is named, never smoothed over.** Domain's status and its own
 * `X-Domain-Security-Reason` header travel back to the caller as `refusal`,
 * so the grade that is withheld for want of this series can say which
 * provider refused and why. Nothing here estimates, defaults or falls back.
 *
 * The call goes through `meteredFetch`: `DOMAIN_API_KEY` is the prime's
 * forwarded credential on a provisioned workspace and every lookup is billed.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { meteredFetch } from '../_shared/meteredFetch.ts';
import {
  DOMAIN_EVIDENCE_VERSION,
  DOMAIN_SUBURB_PERFORMANCE_LICENSING,
  describeDomainRefusal,
  domainCategoryFor,
  readDomainProblem,
  domainEvidencePoints,
  domainSuburbPerformanceUrl,
  dwellingTypeFor,
  parseDomainSuburbPerformance,
  type DomainPropertyCategory,
} from '../_shared/reports/market/domainEvidence.pure.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface DomainDataRequest {
  suburb?: string;
  state?: string;
  postcode?: string | number;
  propertyCategory?: DomainPropertyCategory;
  /** The stored property type; used to choose the category when none is given. */
  propertyType?: string;
  healthCheck?: boolean;
}

/** The legacy summary fields other callers read, beside the evidence. */
interface SuburbPerformance {
  medianSoldPrice?: number;
  numberSold?: number;
  medianRentListingPrice?: number;
  numberRented?: number;
  daysOnMarket?: number;
  auctionClearanceRate?: number;
  annualGrowth?: number;
  dataSource: string;
  dataQuality: 'live' | 'fallback' | 'unavailable';
  lastUpdated: string;
  apiStatus?: string;
  periodEnding?: string;
}

// Track API health across invocations of this isolate.
let lastSuccessfulCall: Date | null = null;
let consecutiveFailures = 0;

const json = (headers: HeadersInit, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

function fallbackData(apiStatus: string) {
  return {
    dataSource: 'Domain API unavailable',
    dataQuality: 'unavailable' as const,
    lastUpdated: new Date().toISOString(),
    apiStatus,
    lastSuccessfulFetch: lastSuccessfulCall?.toISOString() || 'Never',
    consecutiveFailures,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[domain-data-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[domain-data-service] Authenticated user: ${userId}`);

    const domainApiKey = Deno.env.get('DOMAIN_API_KEY');
    if (!domainApiKey) {
      console.error('❌ DOMAIN_API_KEY not configured in environment');
      return json(corsHeaders, {
        success: false,
        error: 'Domain API key not configured',
        dataQuality: 'unavailable',
        refusal: { kind: 'not_configured', summary: 'DOMAIN_API_KEY is not set on this project' },
      }, 500);
    }

    const { suburb, state, postcode, propertyCategory, propertyType, healthCheck }: DomainDataRequest = body;

    if (healthCheck) {
      return await performHealthCheck(domainApiKey, corsHeaders);
    }

    const category: DomainPropertyCategory = propertyCategory === 'unit' || propertyCategory === 'house'
      ? propertyCategory
      : domainCategoryFor(propertyType);
    const request = domainSuburbPerformanceUrl({ state, suburb, postcode, propertyCategory: category });
    if (!request.ok) {
      console.warn(`⛔ Domain request not made: ${request.reason} (suburb=${suburb ?? ''}, state=${state ?? ''}, postcode=${postcode ?? ''})`);
      return json(corsHeaders, {
        success: false,
        error: request.reason,
        dataQuality: 'unavailable',
        refusal: { kind: 'request_invalid', summary: request.reason },
        fallbackData: fallbackData('Request not made'),
      });
    }

    console.log(`Fetching Domain suburb performance: ${request.state} / ${request.suburb} / ${request.postcode} (${category})`);

    const response = await meteredFetch(request.url, {
      method: 'GET',
      headers: { 'X-Api-Key': domainApiKey, 'Accept': 'application/json' },
    }, {
      feature: 'reports/domain-suburb-performance',
      metadata: { state: request.state, suburb: request.suburb, postcode: request.postcode, propertyCategory: category },
    });

    if (!response.ok) {
      consecutiveFailures++;
      const securityReason = response.headers.get('x-domain-security-reason');
      // Domain's problem-details body names the restriction where its header
      // does not ("Operation not permitted on project" — measured 15 Sep 2026
      // on both products). Only `title` and `detail` are read from it, and
      // only the classified refusal travels to the caller.
      const errorText = await response.text().catch(() => '');
      const problem = readDomainProblem(errorText);
      const refusal = describeDomainRefusal(response.status, securityReason, problem.detail);
      console.error(`❌ Domain API ${refusal.summary}`, JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        securityReason,
        bodyPreview: errorText.slice(0, 200),
        suburb: request.suburb,
        state: request.state,
        postcode: request.postcode,
        consecutiveFailures,
        lastSuccess: lastSuccessfulCall?.toISOString() || 'Never',
      }));
      return json(corsHeaders, {
        success: false,
        error: `Domain API error: ${response.status} ${response.statusText}`,
        dataQuality: 'unavailable',
        refusal: { ...refusal, status: response.status, securityReason: securityReason ?? null, detail: problem.detail },
        fallbackData: fallbackData(`${response.status} - ${refusal.summary}`),
      });
    }

    const payload = await response.json();
    const series = parseDomainSuburbPerformance(payload, category);
    if (!series) {
      consecutiveFailures++;
      console.error('❌ Domain API answered 200 with a body that is not a suburb-performance series:', JSON.stringify(payload).slice(0, 300));
      return json(corsHeaders, {
        success: false,
        error: 'Domain API answered with an unrecognised body',
        dataQuality: 'unavailable',
        refusal: { kind: 'unparseable_body', summary: 'HTTP 200 with a body that is not the documented series shape', status: 200 },
        fallbackData: fallbackData('200 - unrecognised body'),
      });
    }

    consecutiveFailures = 0;
    lastSuccessfulCall = new Date();

    const subject = {
      suburb: request.suburb,
      postcode: request.postcode,
      state: request.state,
      dwellingType: dwellingTypeFor(propertyType ?? category),
      resolvedFrom: null,
    };
    const extracted = domainEvidencePoints({
      subject,
      series,
      askedDwelling: subject.dwellingType,
      licensingStatus: DOMAIN_SUBURB_PERFORMANCE_LICENSING,
    });

    const priced = series.entries.filter((e) => (e.values.medianSoldPrice ?? 0) > 0);
    const latest = priced.length ? priced[priced.length - 1] : series.entries[series.entries.length - 1];
    const performanceData: SuburbPerformance = {
      medianSoldPrice: latest?.values.medianSoldPrice ?? undefined,
      numberSold: latest?.values.numberSold ?? undefined,
      medianRentListingPrice: latest?.values.medianRentListingPrice ?? undefined,
      numberRented: latest?.values.numberRentListing ?? undefined,
      daysOnMarket: latest?.values.daysOnMarket ?? undefined,
      auctionClearanceRate: extracted.points.auctionClearanceRate?.value,
      annualGrowth: extracted.points.growth1Year?.value,
      periodEnding: latest ? `${latest.year}${latest.month === null ? '' : `-${String(latest.month).padStart(2, '0')}`}` : undefined,
      dataSource: 'Domain API (Live Data)',
      dataQuality: 'live',
      lastUpdated: new Date().toISOString(),
      apiStatus: 'Operational',
    };

    console.log(
      `✅ Domain series received: ${series.entries.length} periods, ${extracted.pricedPeriods} priced, `
      + `${Object.keys(extracted.points).length} evidence points`
      + (extracted.notes.length ? ` — ${extracted.notes.join(' ')}` : ''),
    );

    return json(corsHeaders, {
      success: true,
      data: {
        ...performanceData,
        evidence: {
          version: DOMAIN_EVIDENCE_VERSION,
          licensingStatus: DOMAIN_SUBURB_PERFORMANCE_LICENSING,
          points: extracted.points,
          notes: extracted.notes,
          pricedPeriods: extracted.pricedPeriods,
        },
        series,
        subject,
      },
      suburb: request.suburb,
      state: request.state,
      postcode: request.postcode,
      propertyCategory: category,
    });

  } catch (error) {
    consecutiveFailures++;
    console.error('❌ Unexpected error in domain-data-service:', error);
    console.error('Consecutive failures:', consecutiveFailures);
    return json(corsHeaders, {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      dataQuality: 'unavailable',
      refusal: { kind: 'service_error', summary: error instanceof Error ? error.message : 'Unknown error' },
      fallbackData: fallbackData('Service Error'),
    });
  }
});

/** One real request against a known market; the answer is Domain's, not ours. */
async function performHealthCheck(apiKey: string, corsHeaders: HeadersInit) {
  console.log('🔍 Performing Domain API health check...');
  try {
    const probe = domainSuburbPerformanceUrl({ state: 'NSW', suburb: 'Sydney', postcode: '2000', propertyCategory: 'house' });
    if (!probe.ok) throw new Error(probe.reason);
    const response = await meteredFetch(probe.url, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json' },
    }, { feature: 'reports/domain-health-check' });

    const securityReason = response.headers.get('x-domain-security-reason');
    const problem = response.ok ? { title: null, detail: null } : readDomainProblem(await response.text().catch(() => ''));
    const healthStatus = {
      service: 'Domain Data Service',
      route: 'v2/suburbPerformanceStatistics',
      apiStatus: response.ok ? 'Operational' : 'Error',
      statusCode: response.status,
      message: response.ok ? 'API operational - series retrieved' : describeDomainRefusal(response.status, securityReason, problem.detail).summary,
      securityReason: securityReason ?? null,
      lastSuccessfulCall: lastSuccessfulCall?.toISOString() || 'Never',
      consecutiveFailures,
      timestamp: new Date().toISOString(),
    };
    console.log('Health check result:', JSON.stringify(healthStatus, null, 2));
    return json(corsHeaders, { success: response.ok, health: healthStatus });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    return json(corsHeaders, {
      success: false,
      health: {
        service: 'Domain Data Service',
        apiStatus: 'Error',
        message: error instanceof Error ? error.message : 'Health check failed',
        timestamp: new Date().toISOString(),
      },
    });
  }
}
