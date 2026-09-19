import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import {
  COMMUTE_CAP_REACHED,
  COMMUTE_DESTINATION_UNKNOWN,
  COMMUTE_NO_ROUTE,
  resolveCbdDestination,
} from '../_shared/reports/location/cbdDestination.pure.ts';
import { projectTransportForLocationIntelligence } from '../_shared/transportReading.pure.ts';
import {
  stampAcquisition,
  subjectKeyFor,
  type EnrichmentStages,
} from '../_shared/reports/location/locationEnrichmentReuse.pure.ts';
import {
  measuredCount,
  measuredDistance,
  measuredName,
  measuredWalkScore,
  placesAreComplete,
  unavailableCategories,
  type PlacesCategory,
  type PlacesLookup,
  type PlacesLookups,
} from '../_shared/reports/location/placesAvailability.pure.ts';
import { amenityProviderOrder, commuteProviderOrder } from '../_shared/openLocation/providers.pure.ts';
import { readAmenityRegister } from '../_shared/openLocation/amenityRegisterStore.ts';
import { buildOsrmRouteUrl, parseOsrmAnswer } from '../_shared/openLocation/osrmRoute.pure.ts';
import { awaitOsmTurn, consumeOsmDailyAllowance } from '../_shared/geocode/osmAllowance.ts';
import { GEOCODER_USER_AGENT } from '../_shared/geocode/geocoder.ts';
import { fetchWithTimeout } from '../_shared/publicAbuseControls.ts';
import { normaliseAuState } from '../_shared/auLocality.pure.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { consumeGoogleDailyCap, type GoogleCapRefusal } from "../_shared/googleMapsDailyCaps.ts";
import { geocodeAddress as geocodeThroughChain } from "../_shared/geocode/geocoder.ts";
import { judgeGoogleMapsBody } from "../_shared/googleMapsBody.pure.ts";
import { assessAuPoint } from "../_shared/auGeoSanity.pure.ts";
import { buildAuGeocodeQuery } from "../_shared/auGeocodeQuery.pure.ts";
import { sourceUnavailable, isSourceUnavailable } from "../_shared/sourceUnavailable.pure.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface LocationIntelligenceInput {
  address: string;
  suburb?: string;
  postcode?: string;
  state?: string;
  lat?: number;
  lng?: number;
}

interface AmenityScore {
  category: string;
  // RF-7.2B.1B2 — null where the provider never answered for this category.
  // A scored row is a claim that somebody looked.
  count: number | null;
  nearest: string | null;
  distance: number | null;
  score: number | null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('Location intelligence service invoked with method:', req.method);
  
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
    const input: LocationIntelligenceInput = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[location-intelligence-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[location-intelligence-service] Authenticated user: ${userId}`);
    console.log('Analyzing location intelligence for:', input.address);

    // The geocode no longer needs Google: it goes through the one geocoding
    // chain (`_shared/geocode/geocoder.ts`). The key is now only what the
    // amenity lookups and the commute call spend, and without it those two
    // are unmeasured — recorded as such, never invented. The old branch here
    // refused the whole measurement for a missing key, back when the key was
    // the geocoder too; a coordinate is a measurement in its own right (the
    // transport reading, the crime area and the report geography all read
    // it), so the run proceeds and says what it could not measure. (The
    // branch before THAT one answered with `generateMockLocationData` —
    // invented school names, a Math.random() walk score and Sydney's
    // coordinates — as HTTP 200 `success: true`; it is gone and stays gone.)
    const googleMapsApiKey = (Deno.env.get('GOOGLE_MAPS_API_KEY') || '').trim();
    if (!googleMapsApiKey) {
      console.warn('[location-intelligence-service] GOOGLE_MAPS_API_KEY not configured — amenities and commute are unmeasured; the geocode proceeds through the chain.');
    }

    
    try {
      const location = await fetchLocationIntelligence(input, googleMapsApiKey, supabase);

      if (!location.resolved) {
        // Deliberately NOT the mock branch below. An address we cannot place
        // is a fact about this property; sample data is a fact about no
        // property, and the caller cannot tell them apart. Both report
        // consumers already guard on `success && data`, so this lands them in
        // the path they take when the service is unreachable — the location
        // section is absent, and `enhancedData.locationIntelligence` stays
        // undefined where the coverage flag can see it.
        console.warn('[location-intelligence-service] unresolved:', location.reason);
        return new Response(JSON.stringify({
          success: false,
          resolved: false,
          reason: location.reason,
          message: UNRESOLVED_MESSAGE[location.reason],
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('✓ Location intelligence data fetched successfully');

      return new Response(JSON.stringify({ 
        success: true, 
        data: location.data,
        usingMockData: false 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (apiError) {
      // A provider failure is a fact about this request, and the caller can
      // retry it. Sample data is a fact about no property at all.
      console.error('❌ Google Maps API error:', apiError);
      return new Response(JSON.stringify(sourceUnavailable(
        'location-intelligence',
        'provider_error',
        `Google Maps could not be reached or answered unusably — location intelligence is unavailable for this request. (${apiError instanceof Error ? apiError.message : 'unknown error'})`,
      )), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    // This used to build a mock profile for a property at 'Unknown, 2000,
    // NSW' and return it 200 `success: true` — a crash dressed as data. A
    // crash is a 500.
    console.error('❌ Critical error in location intelligence service:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'location-intelligence-service'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Why an unresolved location is its own answer.
 *
 * Every figure below — the amenity counts, the nearest school, the walk
 * score, the CBD commute — is measured *from the coordinate*. A wrong
 * coordinate does not make them fail; it makes them describe somewhere else,
 * accurately, and there is nothing in the numbers for a reader to catch.
 * So the coordinate is a precondition, and when it cannot be established
 * this returns the reason instead of a profile.
 */
/**
 * RF-7.2B.1B0 — a refusal by the geocoder is not a fact about the address.
 *
 * Every geocode failure used to collapse into `address_not_resolved`, whose
 * message says "the address could not be resolved to a location in
 * Australia". For a `ZERO_RESULTS` that is true. For a `REQUEST_DENIED` it is
 * FALSE, and it is the expensive kind of false: it blames the customer's
 * address for this deployment's own credential, and sends whoever reads it to
 * re-check an address that was never wrong.
 *
 * Measured in production on 2026-09-12: 24 of 24 geocode attempts over 24
 * hours answered `REQUEST_DENIED`, 0 answered `ZERO_RESULTS`, 0 succeeded —
 * so every report generated in that window carried no coordinate, no
 * geography, and therefore no demographics, SEIFA or employment, while the
 * only recorded reason said the addresses could not be found.
 *
 * `geocoder_unavailable` is therefore its own reading: the remedy is ours
 * (credential, quota, API enablement, billing), not the caller's.
 */
type UnresolvedReason =
  | 'address_not_resolved'
  | 'geocoder_unavailable'
  | 'geocoder_not_attempted'
  | 'supplied_coordinates_rejected';

const UNRESOLVED_MESSAGE: Record<UnresolvedReason, string> = {
  address_not_resolved:
    'The address could not be resolved to a location in Australia — location intelligence is unavailable for this property.',
  geocoder_unavailable:
    'The geocoding service did not answer for this request, so no location could be established. '
    + 'This is a fault in this deployment\'s map service access — the address supplied was never rejected as invalid.',
  // Named for what happened rather than for one of its causes. The lookup was
  // not attempted, and there are three reasons it might not have been: the
  // provider was switched off, the day's allowance was spent, or the shared
  // counter could not be read. `daily_cap_reached` was true for only one of
  // them and told an operator to wait until tomorrow for two states that
  // waiting will not clear. The exact reason is on the outcome and in the log.
  //
  // It is still distinct from `geocoder_unavailable`, which means map service
  // access is broken and is a genuinely different afternoon's work.
  //
  // This string is returned in the response body and can reach a client
  // surface, so it names no environment variable, no limit and no piece of
  // infrastructure. Which of the three refusals it was — the provider turned
  // off, the allowance spent, the shared limiter unreachable — is in the logs,
  // where an operator looks and a customer does not.
  geocoder_not_attempted:
    'Location details are not available for this property at the moment. Nothing is '
    + 'wrong with the address — it was never rejected — and no location information has '
    + 'been estimated in its place.',
  supplied_coordinates_rejected:
    'The supplied coordinates are not a location in Australia — location intelligence is unavailable for this property.',
};

type LocationIntelligenceResult =
  | { resolved: true; data: Record<string, unknown> }
  | { resolved: false; reason: UnresolvedReason };

async function fetchLocationIntelligence(
  input: LocationIntelligenceInput,
  apiKey: string,
  // The counter is shared across isolates, so it is consumed through the
  // database rather than held in memory. `publicAbuseControls` explains why a
  // process-local ceiling is not a ceiling.
  db: unknown,
): Promise<LocationIntelligenceResult> {
  let coordinates: { lat: number; lng: number } | null;
  let reason: UnresolvedReason;
  // RF-7.2B.1B1 — what the acquisition record will say about this run.
  let geocodeStage: EnrichmentStages['geocode'] = 'fetched';
  let matchedAddress: string | null = null;

  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    geocodeStage = 'supplied';
    // A supplied coordinate goes through the same gate as a fetched one.
    // These arrive from stored rows, and the stored rows are where the 183
    // out-of-country points live — trusting the caller here would let the
    // fault back in through the one door the fix did not cover.
    const verdict = assessAuPoint(input.lat as number, input.lng as number, input.state);
    coordinates = verdict.ok ? { lat: input.lat as number, lng: input.lng as number } : null;
    if (!coordinates) {
      console.warn(`[location-intelligence-service] supplied point rejected (${verdict.reason})`);
    }
    reason = 'supplied_coordinates_rejected';
  } else {
    const geocoded = await geocodeAddress(input, apiKey, db);
    coordinates = geocoded.ok ? { lat: geocoded.lat, lng: geocoded.lng } : null;
    matchedAddress = geocoded.ok ? geocoded.matchedAddress : null;
    // Which of the two it was is decided where the provider's own status is
    // in hand, never re-derived here from the absence of a point.
    reason = geocoded.ok
      ? 'address_not_resolved'
      : geocoded.capped
        ? 'geocoder_not_attempted'
        : geocoded.providerRefused
          ? 'geocoder_unavailable'
          : 'address_not_resolved';
  }

  if (!coordinates) return { resolved: false, reason };

  console.log('Coordinates:', coordinates);

  // Fetch enhanced public transport data from dedicated service
  let publicTransportData: any = null;
  if (input.state) {
    try {
      console.log('Fetching detailed public transport data from public-transport-service...');
      // THIS deployment's own project, from the URL Supabase injects into every
      // function runtime -- never a literal.
      //
      // It was `https://<this repository's project>.supabase.co/...`, which is
      // correct in exactly one deployment and a cross-tenant call in every
      // other. A clone of this repository ships the same line and reaches back
      // into the origin project for every location lookup it serves: somebody
      // else's function, somebody else's rate limits, somebody else's bill, and
      // the clone's own `public-transport-service` never invoked at all.
      const projectUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
      if (!projectUrl) {
        throw new Error('SUPABASE_URL is unset — cannot resolve this project’s own functions');
      }
      const transportResponse = await fetch(
        `${projectUrl}/functions/v1/public-transport-service`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: coordinates.lat,
            lng: coordinates.lng,
            state: input.state,
            suburb: input.suburb
          })
        }
      );
      
      if (transportResponse.ok) {
        const transportBody = await transportResponse.json();
        // The transport service historically answered with a bare payload —
        // no `success` wrapper — so its new refusal envelope would read as a
        // payload full of undefineds here, and `transportInfo` below would
        // have preferred it over Google's real, coordinate-measured transit
        // results. An honest refusal must leave the real fallback standing.
        if (isSourceUnavailable(transportBody)) {
          console.log('Public transport service unavailable, will use Google transit data');
        } else if (transportBody?.success === true && transportBody.data) {
          // The service answers `{ success, data: { ... } }`. This used to take
          // the ENVELOPE, so `publicTransportData.stopsWithin1km.length` below
          // dereferenced undefined and threw for every location a loaded GTFS
          // feed covers — Sydney, south-east Queensland, Darwin, Alice Springs.
          publicTransportData = transportBody.data;
          console.log('✓ Public transport data fetched successfully');
        } else {
          console.warn('Public transport service returned an unrecognised body; using Google data');
        }
      } else {
        console.warn('Public transport service returned error, will use Google data');
      }
    } catch (error) {
      console.error('Error fetching public transport data:', error);
    }
  }

  // The six amenity lookups, through the provider order (AMENITY_PROVIDERS,
  // default register,google): the local OSM amenity register answers every
  // category whose (category, state) slice is loaded and current, and
  // Google Places is asked — in parallel, exactly as before — only for the
  // categories the register could not answer. On a deployment whose
  // register has never loaded, every category falls through and this
  // behaves exactly as it always has; `fetchNearbyPlaces` is untouched.
  const amenityOrder = amenityProviderOrder(Deno.env.get);
  const registerState = normaliseAuState(String(input.state ?? ''));
  const GOOGLE_TYPE_FOR: Record<PlacesCategory, string> = {
    transit: 'transit_station',
    schools: 'school',
    healthcare: 'hospital',
    shopping: 'shopping_mall',
    recreation: 'park',
    restaurants: 'restaurant',
  };
  const AMENITY_CATEGORY_ORDER: PlacesCategory[] = ['transit', 'schools', 'healthcare', 'shopping', 'recreation', 'restaurants'];
  const chained: Partial<Record<PlacesCategory, PlacesLookup>> = {};
  const amenitySources: Partial<Record<PlacesCategory, 'register' | 'google'>> = {};
  const amenityRegisterLoadedAt: Record<string, string> = {};
  for (const provider of amenityOrder) {
    const missing = AMENITY_CATEGORY_ORDER.filter((c) => chained[c]?.ok !== true);
    if (missing.length === 0) break;
    if (provider === 'register') {
      const readings = await readAmenityRegister(db, coordinates, registerState, missing, Deno.env.get);
      for (const c of missing) {
        const reading = readings[c];
        if (reading && reading.unavailableReason === null) {
          chained[c] = reading.lookup;
          amenitySources[c] = 'register';
          if (reading.loadedAt) amenityRegisterLoadedAt[c] = reading.loadedAt;
        } else if (reading) {
          console.log(`[location-intelligence-service] register did not answer ${c} (${reading.unavailableReason}); next provider`);
        }
      }
    } else if (provider === 'google') {
      const answers = await Promise.all(
        missing.map((c) => fetchNearbyPlaces(coordinates, GOOGLE_TYPE_FOR[c], apiKey, db)),
      );
      missing.forEach((c, i) => {
        chained[c] = answers[i];
        if (answers[i].ok) amenitySources[c] = 'google';
      });
    }
  }
  const UNMEASURED: PlacesLookup = { ok: false, count: 0, results: [] };
  const transitData = chained.transit ?? UNMEASURED;
  const schoolsData = chained.schools ?? UNMEASURED;
  const healthcareData = chained.healthcare ?? UNMEASURED;
  const shoppingData = chained.shopping ?? UNMEASURED;
  const recreationData = chained.recreation ?? UNMEASURED;
  const restaurantsData = chained.restaurants ?? UNMEASURED;

  // Calculate CBD commute time. No state means no known destination, and a
  // guessed destination is what put a Perth property 82 hours from "the CBD".
  // The measurement follows COMMUTE_PROVIDERS (default osrm,google): OSRM's
  // public router drives the route free, and the Distance Matrix stays
  // selectable — `calculateCommuteTime` is untouched.
  const cbdCoordinates = resolveCbdDestination(input.state);
  const measuredCommute = cbdCoordinates
    ? await measureCommuteThroughChain(coordinates, cbdCoordinates, apiKey, db)
    : { data: COMMUTE_DESTINATION_UNKNOWN, provider: null };
  const commuteData = measuredCommute.data;

  // RF-7.2B.1B2 — the six lookups, named once so that every projection below
  // reads the SAME per-category outcome. `ok` used to be reduced to one
  // complete/partial flag and discarded here, which is what left a failed
  // lookup indistinguishable from a measured zero everywhere downstream.
  const placesLookups: PlacesLookups = {
    transit: transitData,
    schools: schoolsData,
    healthcare: healthcareData,
    shopping: shoppingData,
    recreation: recreationData,
    restaurants: restaurantsData,
  };
  const placesUnavailable = unavailableCategories(placesLookups);
  if (placesUnavailable.length > 0) {
    console.warn(
      `⚠️ Places lookups that did not answer: ${placesUnavailable.join(', ')} `
      + '— these categories are recorded as unmeasured, never as zero.',
    );
  }

  // Calculate walk score and lifestyle score - enhanced with real transport data
  const walkScore = measuredWalkScore(
    calculateWalkScore(placesLookups),
    placesLookups,
  );

  const amenityScores = calculateAmenityScores(placesLookups);

  // Use the GTFS reading where a loaded feed covers the location, otherwise the
  // coordinate-measured Google Places result.
  //
  // What is deliberately NOT written here any more: `qualityScore`,
  // `serviceFrequency`, `routeCoverage`, `transportTypes`, `accessibility` and
  // `summary`. Those were the per-state template — five constants that ignored
  // the coordinate, 822 of them naming Sydney's Central Station across all
  // eight states — and the GTFS service publishes none of them, because a
  // stops file carries no mode, no frequency and no rating. Naming a field the
  // source cannot fill is how the template got written in the first place.
  const transportInfo = publicTransportData ? {
    ...projectTransportForLocationIntelligence({
      verdict: publicTransportData.verdict,
      stops: publicTransportData.stops ?? [],
      countWithinRadius: publicTransportData.stopsWithinRadius ?? 0,
      radiusMetres: publicTransportData.radiusMetres ?? 0,
      nearest: publicTransportData.nearest ?? null,
      feeds: publicTransportData.feeds ?? [],
      sources: publicTransportData.sources ?? [],
      notMeasured: publicTransportData.notMeasured ?? [],
      // When the contributing feed was last loaded, carried through from the
      // transport service so the stored block can state the reading's own
      // currency. A feed with no load stamp answers null; a feed-load date is
      // never presented as the date this measurement was taken.
      feedLoadedAt: publicTransportData.feedLoadedAt ?? null,
    }),
  } : {
    // RF-7.2B.1B2 — `'N/A'` is truthy, so it survived every `||` fallback in
    // the generator's prompt and arrived in front of the model as a value.
    // A transit lookup that never answered reports null.
    nearestStation: measuredName(transitData),
    distanceToStation: measuredDistance(transitData),
    stationsWithin2km: measuredCount(transitData),
    source: amenitySources.transit === 'register' ? 'osm_amenity_register' : 'google_places',
  };

  const data = {
    coordinates,
    commute: commuteData,
    walkScore,
    amenities: amenityScores,
    transport: transportInfo,
    // RF-7.2B.1B2 — every figure below is the MEASURED value or null. A
    // category whose provider call failed stores null, so the two
    // `typeof x === 'number'` guards that compose the model's location context
    // omit the line instead of asserting "Healthcare facilities within 5km: 0"
    // about an address nobody managed to look up. A category that was reached
    // and genuinely holds nothing still stores 0, because that is a fact.
    schools: {
      nearestSchool: measuredName(schoolsData),
      distanceToSchool: measuredDistance(schoolsData),
      schoolsWithin3km: measuredCount(schoolsData),
      topSchools: schoolsData.results.slice(0, 5).map((s: any) => ({
        name: s.name,
        distance: s.distance,
        rating: s.rating
      }))
    },
    healthcare: {
      nearestHospital: measuredName(healthcareData),
      distanceToHospital: measuredDistance(healthcareData),
      facilitiesWithin5km: measuredCount(healthcareData)
    },
    lifestyle: {
      shoppingCenters: measuredCount(shoppingData),
      parks: measuredCount(recreationData),
      restaurants: measuredCount(restaurantsData),
      nearestShopping: measuredName(shoppingData),
      nearestPark: measuredName(recreationData)
    }
  };

  // RF-7.2B.1B1 — the acquisition record. Without it the persisted object could
  // not say which property it described, when it was bought, or whether every
  // stage actually ran, so nothing downstream could safely decide not to buy it
  // again. `stampAcquisition` returns a new object; no measured value is touched.
  const stamped = stampAcquisition(data, {
    subjectKey: subjectKeyFor({
      address: input.address,
      postcode: input.postcode,
      state: input.state,
    }),
    acquiredAt: new Date().toISOString(),
    stages: {
      geocode: geocodeStage,
      // One failed amenity lookup makes the whole set unreusable: a zero that
      // came from an outage reads exactly like a zero that came from a quiet
      // suburb, and only this flag can tell them apart later.
      places: placesAreComplete(placesLookups) ? 'complete' : 'partial',
      // Which ones, so a reader of the record can tell WHAT was not measured
      // rather than only that something was not. Additive: the reuse decision
      // in RF-7.2B.1B1 reads `places` alone and is unchanged.
      placesUnavailable,
      commute: commuteData === COMMUTE_DESTINATION_UNKNOWN
        ? 'destination_unknown'
        : commuteData === COMMUTE_NO_ROUTE ? 'no_route' : 'measured',
      // Which provider answered what — provenance for a record two
      // providers can now produce. Advisory, like `placesUnavailable`.
      amenitySources: Object.fromEntries(
        AMENITY_CATEGORY_ORDER.map((c) => [c, amenitySources[c] ?? 'unmeasured']),
      ),
      ...(Object.keys(amenityRegisterLoadedAt).length > 0 ? { amenityRegisterLoadedAt } : {}),
      ...(measuredCommute.provider ? { commuteProvider: measuredCommute.provider } : {}),
    },
    matchedAddress,
  });

  return { resolved: true, data: stamped };
}

/**
 * Resolve an address to a coordinate, or to nothing.
 *
 * **183 of the 1,112 stored reports that carry a coordinate carry one outside
 * Australia** — Blacksburg Virginia, Manhattan, Knoxville, Bristol,
 * Edinburgh, Auckland, Ottawa, Bulacan — and **64 more carry Sydney CBD to
 * four decimal places**, which is this function's old failure value. Together
 * that is 22% of the corpus. Four faults stacked, and each one produced a
 * confident, plausible, unfalsifiable answer rather than an error:
 *
 *  1. **The question had no locality.** `input.suburb`, `input.postcode` and
 *     `input.state` were all in hand and all spent elsewhere; the geocode got
 *     `input.address` alone, which for 768 of these rows is a bare street
 *     name. `Keystone Drive` is a real street in most English-speaking
 *     countries. This is the fault that caused 180 of the 183 —
 *     see `auGeocodeQuery.pure.ts` for the split.
 *  2. **The request carried no country filter.** `components=country:AU` is a
 *     filter; `region=au` is only a bias, and this had neither.
 *  3. **Nothing checked the answer.** Every property this product reports on
 *     is in Australia, which makes an unusually strong invariant available: a
 *     geocode in Edinburgh is not an unusual listing, it is a wrong answer.
 *  4. **Failure returned Sydney CBD.** Everything below then computed the
 *     schools, hospitals, parks, walk score and CBD commute *of Sydney* and
 *     returned them as the subject property's. Real Google data, correctly
 *     fetched, about a place up to 4,000km away, with nothing in the response
 *     to say so.
 *
 * Faults 1 and 2 are not alternatives. The filter alone only relocates the
 * error: `Keystone Drive` restricted to Australia resolves to some Keystone
 * Drive here, in the wrong suburb, inside the country box, past every gate.
 *
 * The gate is `assessAuPoint` — the same one `resolve-listing-coordinates`
 * applies, rather than a second bounding box written here: country bounds,
 * then the land mask (every rectangle around Australia contains sea), then
 * the record's own state when it names one.
 *
 * Unresolved yields no coordinate, and that means the location section is
 * absent rather than wrong. That is the trade this makes deliberately: a
 * reader can see an absent section, and cannot see a correct-looking figure
 * measured from the wrong continent.
 *
 * It reports WHICH kind of unresolved, because the two have opposite
 * remedies. `providerRefused` is true where the fault is this deployment's —
 * a denied key, an exhausted quota, a request we built wrongly, a provider
 * that could not be reached — and false only where the provider answered
 * about the address itself: `ZERO_RESULTS`, or a point it returned that is
 * not in Australia. Never inferred from the absence of a point, which is what
 * both look like from outside.
 */
type GeocodeOutcome =
  | { ok: true; lat: number; lng: number; matchedAddress: string | null }
  // `capped` is separate from `providerRefused` because the two send an
  // operator to opposite remedies — the same reason the Didit broker reads a
  // refusal from a header rather than guessing it from a body. `capReason`
  // carries WHICH of the three it was, so the diagnostic record is true even
  // though the client-facing reading deliberately is not that specific.
  | { ok: false; providerRefused: boolean; capped?: boolean; capReason?: GoogleCapRefusal };

// `judgeGoogleMapsBody` — the one judge of a Google Maps body — lives in
// `_shared/googleMapsBody.pure.ts` and is what the Places and Distance Matrix
// calls below pass to `meteredFetch`. The geocode itself goes through
// `_shared/geocode/geocoder.ts`, which is the one place a Google geocoder body
// is read and where `ADDRESS_IS_THE_ANSWER` decides what is a statement about
// the address; this function reads the chain's verdict and re-derives nothing
// from the absence of a point.

async function geocodeAddress(
  input: LocationIntelligenceInput,
  _apiKey: string,
  db: unknown,
): Promise<GeocodeOutcome> {
  // The suburb, postcode and state were already in hand — used for the CBD
  // lookup and the transport call, and withheld from the one request that
  // needed them. See `auGeocodeQuery.pure.ts` for the split that measures it.
  const address = buildAuGeocodeQuery(input);
  if (!address) {
    // Nothing was supplied to look up. That is the caller's input, not the
    // provider's refusal.
    console.warn('[location-intelligence-service] no address to geocode');
    return { ok: false, providerRefused: false };
  }

  // The one geocoding chain: OpenStreetMap, then the suburb's own centroid
  // from the ABS, then Google only where an operator lists it. Each provider
  // budgets itself; every answer has passed the granularity gate; the
  // status below is the chain's own, never re-derived from the absence of
  // a point.
  const outcome = await geocodeThroughChain(
    db,
    // The street line is derived from the composed address by the chain; the
    // raw `input.address` is not passed as one because 768 stored rows carry a
    // bare street name there and others carry the whole address.
    { address, suburb: input.suburb, state: input.state, postcode: input.postcode },
    { allowLocalityFallback: true, feature: 'location-intelligence-service/geocode' },
  );
  if (!outcome.ok) {
    if (outcome.reason === 'budget') {
      // Not attempted: an allowance refused it. The chain says WHICH of the
      // three readings it was, in the caps module's own vocabulary, and the
      // one it did not say is read as the counter being unreadable — the
      // reading that sends nobody to wait for a reset that will not come.
      const budget = { reason: outcome.capReason ?? 'limiter_unavailable' } as const;
      console.warn(`[location-intelligence-service] geocode not attempted (${budget.reason}: ${outcome.detail})`);
      return { ok: false, providerRefused: false, capped: true, capReason: budget.reason };
    }
    // Every reason but `no_match` is ours: the provider could not be reached,
    // refused us, or answered nothing usable. Only a provider that looked
    // and found no such address is a statement about the address.
    const refused = outcome.reason !== 'no_match';
    console.warn(
      `[location-intelligence-service] geocode returned no point: ${outcome.reason} — ${outcome.detail}`
      + (refused
        ? ' — this is a fault in our map service access, not in the address'
        : ' — no provider has a match for this address'),
    );
    return { ok: false, providerRefused: refused };
  }

  const { lat, lng } = outcome.result;
  const verdict = assessAuPoint(lat, lng, input.state);
  if (!verdict.ok) {
    // Named rather than swallowed: `outside_australia`, `offshore` and
    // `wrong_state` are different faults with different remedies, and the
    // log is the only place anybody will see which one happened.
    console.warn(`[location-intelligence-service] geocode rejected (${verdict.reason}) for state ${input.state ?? 'unknown'}`);
    // The provider answered about this address and we refused the answer.
    // Ours to explain, but not a service fault.
    return { ok: false, providerRefused: false };
  }

  // What the provider says it MATCHED, kept so a verification can compare
  // the answer against the question. It is evidence, never an input.
  return {
    ok: true,
    lat,
    lng,
    matchedAddress: outcome.result.matchedAddress,
  };
}

async function fetchNearbyPlaces(
  coordinates: { lat: number; lng: number },
  type: string,
  apiKey: string,
  db: unknown,
) {
  // A refused category takes the SAME shape a failed one takes — `ok: false`
  // with a zero count — so `unavailableCategories` records it as unmeasured
  // and every projection downstream omits the line rather than printing a
  // zero. That contract is RF-7.2B.1B2's and nothing here re-implements it.
  if (!apiKey) {
    console.warn(`[location-intelligence-service] ${type} lookup not attempted (no Google Maps key)`);
    return { ok: false, count: 0, results: [] };
  }
  const budget = await consumeGoogleDailyCap(db, 'placesNearby');
  if (!budget.ok) {
    console.warn(`[location-intelligence-service] ${type} lookup not attempted (${budget.reason})`);
    return { ok: false, count: 0, results: [] };
  }

  try {
    const radius = type === 'school' ? 3000 : type === 'park' ? 2000 : 5000;
    const response = await meteredFetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${coordinates.lat},${coordinates.lng}&radius=${radius}&type=${type}&key=${apiKey}`,
      undefined,
      { judgeBody: judgeGoogleMapsBody },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch ${type} data`);
    }

    const data = await response.json();
    
    const results = (data.results || []).slice(0, 10).map((place: any) => {
      const distance = calculateDistance(
        coordinates.lat,
        coordinates.lng,
        place.geometry.location.lat,
        place.geometry.location.lng
      );

      return {
        name: place.name,
        address: place.vicinity,
        rating: place.rating || 0,
        distance: Math.round(distance * 100) / 100,
        userRatingsTotal: place.user_ratings_total || 0
      };
    });

    return {
      ok: true,
      count: results.length,
      results: results.sort((a: any, b: any) => a.distance - b.distance)
    };
  } catch (error) {
    // RF-7.2B.1B1 — `ok` separates "we looked and found nothing" from "the
    // lookup failed". Both produce `count: 0`, and once persisted they are
    // indistinguishable — which is how a Places outage could otherwise be
    // frozen into a report as "this address has no schools". The counts
    // themselves are unchanged; only the acquisition record can see this.
    console.error(`Error fetching ${type}:`, error);
    return { ok: false, count: 0, results: [] };
  }
}

async function calculateCommuteTime(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  apiKey: string,
  db: unknown,
) {
  // One origin and one destination, so one request is one billable ELEMENT
  // and one unit is honest here. A call site that ever sends more must consume
  // that many — see `googleMapsDailyCaps.ts`.
  if (!apiKey) {
    console.warn('[location-intelligence-service] commute not attempted (no Google Maps key)');
    return COMMUTE_CAP_REACHED;
  }
  const budget = await consumeGoogleDailyCap(db, 'distanceMatrix');
  if (!budget.ok) {
    console.warn(`[location-intelligence-service] commute not attempted (${budget.reason})`);
    return COMMUTE_CAP_REACHED;
  }

  try {
    const response = await meteredFetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}&destinations=${destination.lat},${destination.lng}&mode=transit&key=${apiKey}`,
      undefined,
      { judgeBody: judgeGoogleMapsBody },
    );

    if (!response.ok) {
      throw new Error('Distance matrix API failed');
    }

    const data = await response.json();
    
    // Better error handling for Google Maps API response structure
    if (data.rows && data.rows.length > 0 && data.rows[0].elements && data.rows[0].elements.length > 0) {
      const element = data.rows[0].elements[0];
      
      if (element.status === 'OK' && element.duration && element.distance) {
        return {
          durationMinutes: Math.round(element.duration.value / 60),
          distanceKm: Math.round(element.distance.value / 1000 * 10) / 10,
          mode: 'public_transit'
        };
      } else {
        console.warn('Distance Matrix API returned status:', element.status);
      }
    } else {
      console.warn('Distance Matrix API returned unexpected structure:', JSON.stringify(data));
    }
  } catch (error) {
    console.error('Commute calculation error:', error);
  }

  // No route was returned, so there is no commute to report.
  //
  // This used to fall through to `distance * 1.5` minutes of straight line and
  // store it as `mode: 'estimated'`: 438 of the 1,114 stored objects carry one,
  // averaging 10,125 minutes. A figure shaped like a journey with no journey
  // behind it is worse than none, because every reader downstream treats
  // `durationMinutes` as measured. Absent, not estimated.
  return COMMUTE_NO_ROUTE;
}

/**
 * The commute, through the provider order. OSRM's public router measures a
 * DRIVING route (its demo graph has no timetables) and the reading says so
 * in `mode`; the Distance Matrix branch is `calculateCommuteTime`,
 * untouched. A provider's own "no route between these points" is final —
 * it is an answer about the geometry — while an unreachable or refused
 * provider hands the question to the next one. When nothing could attempt
 * the measurement the answer is CAP_REACHED, and when a provider was
 * reached and failed it is NO_ROUTE, which is exactly how the Google-only
 * path already divided the two.
 */
async function measureCommuteThroughChain(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  apiKey: string,
  db: unknown,
): Promise<{ data: typeof COMMUTE_NO_ROUTE | typeof COMMUTE_CAP_REACHED | { durationMinutes: number; distanceKm: number; mode: string }; provider: 'osrm' | 'google' | null }> {
  let reachedAndFailed = false;
  for (const provider of commuteProviderOrder(Deno.env.get)) {
    if (provider === 'osrm') {
      const answer = await osrmCommute(origin, destination, db);
      if (answer.kind === 'route') return { data: answer.commute, provider: 'osrm' };
      if (answer.kind === 'no_route') return { data: COMMUTE_NO_ROUTE, provider: null };
      if (answer.kind === 'unusable') reachedAndFailed = true;
      // 'not_attempted' (allowance refused) falls through silently.
    } else if (provider === 'google') {
      const g = await calculateCommuteTime(origin, destination, apiKey, db);
      if (g === COMMUTE_NO_ROUTE) return { data: g, provider: null };
      if (g !== COMMUTE_CAP_REACHED) return { data: g, provider: 'google' };
      // CAP_REACHED covers "no key" and "cap spent" — the next provider,
      // when the operator listed one after google, may still answer.
    }
  }
  return { data: reachedAndFailed ? COMMUTE_NO_ROUTE : COMMUTE_CAP_REACHED, provider: null };
}

async function osrmCommute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  db: unknown,
): Promise<
  | { kind: 'route'; commute: { durationMinutes: number; distanceKm: number; mode: string } }
  | { kind: 'no_route' }
  | { kind: 'unusable' }
  | { kind: 'not_attempted' }
> {
  // Free, so never metered — but never unbounded either: the same daily
  // allowance and one-a-second turn discipline every public OSM service
  // gets, in the shared limiter, failing closed.
  const allowance = await consumeOsmDailyAllowance(db, 'routing');
  if (!allowance.ok) {
    console.warn(`[location-intelligence-service] commute not attempted on OSRM (${allowance.reason})`);
    return { kind: 'not_attempted' };
  }
  await awaitOsmTurn(db, 'osrm');
  try {
    const res = await fetchWithTimeout(
      buildOsrmRouteUrl(origin, destination),
      { headers: { 'User-Agent': GEOCODER_USER_AGENT, Accept: 'application/json' } },
      8000,
    );
    if (!res.ok) {
      console.warn(`[location-intelligence-service] OSRM answered ${res.status}`);
      return { kind: 'unusable' };
    }
    const parsed = parseOsrmAnswer(await res.json());
    if (parsed.kind === 'route') return { kind: 'route', commute: parsed.commute };
    if (parsed.kind === 'no_route') return { kind: 'no_route' };
    console.warn(`[location-intelligence-service] OSRM answer unusable (${parsed.code})`);
    return { kind: 'unusable' };
  } catch (error) {
    console.warn('[location-intelligence-service] OSRM unreachable:', (error as Error).message);
    return { kind: 'unusable' };
  }
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}



function calculateWalkScore(amenities: any): number {
  let score = 0;
  
  // Transit accessibility (max 30 points), measured from the coordinate.
  //
  // This used to spend the whole 30 on `publicTransportData.qualityScore` — an
  // invented per-state constant taking five values across 1,108 stored reports.
  // The transport service no longer publishes one, and the branch is gone
  // rather than left dormant: a rating is not something a stops file can
  // support, so the only honest transit signal here is distance.
  if (amenities.transit.count > 0) {
    const nearestDistance = amenities.transit.results[0]?.distance || 999;
    if (nearestDistance < 0.5) score += 30;
    else if (nearestDistance < 1) score += 20;
    else if (nearestDistance < 2) score += 10;
  }

  // Shopping & dining (max 25 points)
  const commercialScore = Math.min(25, (amenities.shopping.count + amenities.restaurants.count / 2) * 2);
  score += commercialScore;

  // Schools & education (max 15 points)
  if (amenities.schools.count > 0) {
    score += Math.min(15, amenities.schools.count * 3);
  }

  // Healthcare (max 15 points)
  if (amenities.healthcare.count > 0) {
    score += Math.min(15, amenities.healthcare.count * 5);
  }

  // Recreation & parks (max 15 points)
  if (amenities.recreation.count > 0) {
    score += Math.min(15, amenities.recreation.count * 3);
  }

  return Math.min(100, Math.round(score));
}

function calculateAmenityScores(lookups: PlacesLookups): AmenityScore[] {
  // RF-7.2B.1B2 — one row per category, built from the MEASURED value.
  //
  // A failed lookup used to produce `{ count: 0, nearest: 'N/A', distance: 0,
  // score: 0 }`, which is a scored row asserting that somebody looked and found
  // nothing. Per-category weights are unchanged; only the basis for computing
  // them is now required to exist.
  const WEIGHTS: ReadonlyArray<{
    readonly category: string;
    readonly key: PlacesCategory;
    readonly perItem: number;
  }> = [
    { category: 'Public Transport', key: 'transit', perItem: 20 },
    { category: 'Schools', key: 'schools', perItem: 10 },
    { category: 'Healthcare', key: 'healthcare', perItem: 15 },
    { category: 'Shopping', key: 'shopping', perItem: 12 },
    { category: 'Recreation', key: 'recreation', perItem: 8 },
  ];

  return WEIGHTS.map(({ category, key, perItem }) => {
    const count = measuredCount(lookups[key]);
    return {
      category,
      count,
      nearest: measuredName(lookups[key]),
      distance: measuredDistance(lookups[key]),
      // Absent, not zero: a score of 0 beside an unmeasured category reads as
      // "this area has none of these", which is the claim being refused.
      score: count === null ? null : Math.min(100, count * perItem),
    };
  });
}
