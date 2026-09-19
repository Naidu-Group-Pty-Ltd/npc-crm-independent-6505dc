import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { internalError } from '../_shared/errorResponse.ts';
import { parseJsonBody } from '../_shared/validate.ts';
import { SchoolDataRequest, PUBLIC_SERVICE_MAX_BODY_BYTES } from '../_shared/publicServiceSchemas.ts';
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';
import { consumeGoogleDailyCap } from '../_shared/googleMapsDailyCaps.ts';
import { amenityProviderOrder } from '../_shared/openLocation/providers.pure.ts';
import { readRegisterSchools } from '../_shared/openLocation/amenityRegisterStore.ts';
import { OSM_AMENITY_ATTRIBUTION } from '../_shared/openLocation/overpassAmenities.pure.ts';
import { normaliseAuState } from '../_shared/auLocality.pure.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface SchoolDataRequest {
  suburb: string;
  state: string;
  postcode: string;
  latitude?: number;
  longitude?: number;
}

interface School {
  name: string;
  type: 'Government' | 'Catholic' | 'Independent' | 'Other';
  level: 'Primary' | 'Secondary' | 'Combined' | 'Special' | 'Other';
  address: string;
  postcode: string;
  icsea?: number;
  studentCount?: number;
  naplan?: any;
  rating?: number;
  distance?: number;
  schoolId?: string;
  websiteUrl?: string;
}

Deno.serve(async (req) => {
  console.log('🏫 School Data service invoked');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // WP-24: bounded and shape-checked. This endpoint takes no session,
    // so a bare req.json() read whatever was sent.
    const __parsed = await parseJsonBody(req, SchoolDataRequest, corsHeaders, PUBLIC_SERVICE_MAX_BODY_BYTES);
    if (!__parsed.ok) return __parsed.response;
    const { suburb, state, postcode, latitude, longitude } = __parsed.data;
    console.log('Fetching school data for:', suburb, state, postcode);

    if (!suburb || !state || !postcode) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Suburb, state, and postcode are required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Two real sources, in order: the imported schools directory, then
    // Google Places measured from the coordinate. There is no third: the old
    // final fallback invented "<suburb> Public School" and "<suburb> High
    // School" with an ICSEA guessed from a postcode list and a student count
    // of 450 — named institutions that do not exist, in a client's report.
    const schoolData = await fetchSchoolDataFromDB(supabase, suburb, state, postcode, latitude, longitude);

    if (!schoolData) {
      return new Response(JSON.stringify(sourceUnavailable(
        'school-data',
        'no_data_for_location',
        'Neither the schools directory nor Google Places holds school data for this location — school figures are unavailable rather than invented.',
      )), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      data: schoolData 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('❌ Error in School Data service:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'school-data-service'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function fetchSchoolDataFromDB(
  supabase: any,
  suburb: string, 
  state: string, 
  postcode: string,
  latitude?: number,
  longitude?: number
) {
  try {
    console.log('🔍 Querying schools_directory database...');
    
    // Query schools from database by postcode and state
    const { data: schools, error } = await supabase
      .from('schools_directory')
      .select('*')
      .eq('postcode', postcode)
      .eq('state', state.toUpperCase());

    if (error) {
      console.error('❌ Database query error:', error);
      throw error;
    }

    if (schools && schools.length > 0) {
      console.log(`✅ Found ${schools.length} schools in database`);
      
      // Calculate distances if coordinates provided
      const schoolsWithDistance = schools.map((school: any) => ({
        name: school.name,
        type: school.school_type || 'Government',
        level: school.school_level || 'Combined',
        address: school.address || `${school.suburb}, ${state} ${postcode}`,
        postcode: school.postcode,
        icsea: school.icsea_score,
        studentCount: school.student_count,
        naplan: school.naplan_data,
        rating: calculateSchoolRating(school.icsea_score, school.naplan_data),
        distance: latitude && longitude && school.latitude && school.longitude
          ? calculateDistance(latitude, longitude, school.latitude, school.longitude)
          : undefined,
        schoolId: school.id,
        websiteUrl: school.website_url
      }));

      // Sort by distance if available, otherwise by rating
      schoolsWithDistance.sort((a: typeof schoolsWithDistance[number], b: typeof schoolsWithDistance[number]) => {
        if (a.distance !== undefined && b.distance !== undefined) {
          return a.distance - b.distance;
        }
        return (b.rating || 0) - (a.rating || 0);
      });

      const summary = calculateSchoolSummary(schoolsWithDistance, postcode);
      
      return {
        schools: schoolsWithDistance,
        summary,
        dataSource: 'Schools Directory Database (Cached)',
        dataQuality: 'cached',
        lastUpdated: new Date().toISOString(),
        note: 'School data from local database. For latest information, visit myschool.edu.au'
      };
    }

    console.log('⚠️ No schools found in database, attempting fallback sources...');

    // Fallback sources in the AMENITY_PROVIDERS order (default
    // register,google): the local OSM amenity register answers free from
    // its daily-refreshed slice, and Google Places stays selectable and is
    // asked exactly as before when the register cannot answer. A register
    // slice that is current but holds zero schools within the radius still
    // falls through — the legacy contract never reported "0 schools", it
    // reported no data, and an OSM absence is weaker evidence than a
    // directory absence.
    if (latitude && longitude) {
      for (const provider of amenityProviderOrder(Deno.env.get)) {
        if (provider === 'register') {
          const registerAnswer = await fetchSchoolsFromRegister(supabase, latitude, longitude, state, postcode);
          if (registerAnswer) {
            console.log(`✅ Found ${registerAnswer.schools.length} schools in the amenity register`);
            return registerAnswer;
          }
        } else if (provider === 'google') {
          const googleSchools = await fetchSchoolsFromGooglePlaces(latitude, longitude, supabase);
          if (googleSchools.length > 0) {
            console.log(`✅ Found ${googleSchools.length} schools from Google Places API`);
            return {
              schools: googleSchools,
              summary: calculateSchoolSummary(googleSchools, postcode),
              dataSource: 'Google Places API',
              dataQuality: 'live',
              lastUpdated: new Date().toISOString(),
              note: 'School data from Google Places API. ICSEA scores and ratings not available.'
            };
          }
        }
      }
    }

    // Neither real source answered; there is nothing honest to return.
    console.log('No school data available for this location');
    return null;

  } catch (error: any) {
    console.error('❌ Error fetching school data:', error);
    return null;
  }
}

/**
 * Schools from the local OSM amenity register — the same daily-refreshed
 * slice location-intelligence-service reads, at this service's own 5 km
 * radius. Null (fall through to the next provider) when the slice is not
 * current, when the read fails, or when it holds no named school within
 * the radius: the legacy contract never reported "0 schools", and an OSM
 * absence is weaker evidence than a directory absence. Sector comes from
 * the element's own tags or reads 'Other' — never the old mapper's
 * hardcoded 'Government'.
 */
async function fetchSchoolsFromRegister(
  supabase: any,
  latitude: number,
  longitude: number,
  state: string,
  postcode: string,
) {
  const normalisedState = normaliseAuState(String(state ?? ''));
  if (!normalisedState) {
    console.log('⚠️ Amenity register skipped: state could not be normalised');
    return null;
  }
  const reading = await readRegisterSchools(
    supabase,
    { lat: latitude, lng: longitude },
    normalisedState,
    5000,
    Deno.env.get,
  );
  if (!reading.ok) {
    console.log(`⚠️ Amenity register did not answer schools (${reading.reason}); next provider`);
    return null;
  }
  const schools: School[] = reading.rows
    .filter((r) => r.name !== null)
    .map((r) => ({
      name: r.name as string,
      type: (r.school_sector ?? 'Other') as School['type'],
      level: 'Combined' as const,
      address: r.address ?? '',
      postcode: r.postcode ?? postcode,
      distance: calculateDistance(latitude, longitude, r.lat, r.lon),
    }))
    .filter((s) => (s.distance ?? Infinity) <= 5)
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
    .slice(0, 20);
  if (schools.length === 0) return null;
  return {
    schools,
    summary: calculateSchoolSummary(schools, postcode),
    dataSource: 'OpenStreetMap Amenity Register',
    dataQuality: 'cached',
    lastUpdated: reading.loadedAt,
    note: `School data from the local OpenStreetMap amenity register (slice loaded ${reading.loadedAt.slice(0, 10)}). `
      + `${OSM_AMENITY_ATTRIBUTION}. ICSEA scores and ratings are not available from this source; `
      + 'for the latest information visit myschool.edu.au',
  };
}

async function fetchSchoolsFromGooglePlaces(
  latitude: number,
  longitude: number,
  // The allowance is shared with every other Places Nearby caller and held in
  // the database, because a ceiling inside one isolate is not a ceiling.
  db: unknown,
): Promise<School[]> {
  try {
    const googleApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!googleApiKey) {
      console.log('⚠️ Google Maps API key not configured');
      return [];
    }

    // One unit for the one billable Places Nearby request below. An empty
    // array is what an unconfigured key and a failed lookup already return,
    // and the caller answers it with `null` — "nothing honest to return" —
    // rather than reporting a location with no schools. So a refusal needs no
    // new absence path; it takes the one that is already correct.
    const budget = await consumeGoogleDailyCap(db, 'placesNearby');
    if (!budget.ok) {
      console.warn(`⚠️ School lookup not attempted (${budget.reason}); reporting no data rather than none found`);
      return [];
    }

    console.log('🔍 Fetching schools from Google Places API...');
    
    const radius = 5000; // 5km radius
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=${radius}&type=school&key=${googleApiKey}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`⚠️ Google Places API returned status: ${response.status}`);
      return [];
    }

    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      return data.results.map((place: any) => ({
        name: place.name,
        type: 'Government' as const,
        level: 'Combined' as const,
        address: place.vicinity || '',
        postcode: '',
        rating: place.rating ? Math.min(5, place.rating) : 3,
        distance: calculateDistance(
          latitude,
          longitude,
          place.geometry.location.lat,
          place.geometry.location.lng
        ),
        websiteUrl: place.website || undefined
      }));
    }

    return [];
  } catch (error) {
    console.error('❌ Google Places API error:', error);
    return [];
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
  return Math.round(R * c * 10) / 10;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function calculateSchoolRating(icsea: number | null, naplan: any): number {
  if (!icsea && !naplan) return 3;
  
  let rating = 3;
  
  if (icsea) {
    if (icsea >= 1150) rating = 5;
    else if (icsea >= 1100) rating = 4.5;
    else if (icsea >= 1050) rating = 4;
    else if (icsea >= 1000) rating = 3.5;
    else if (icsea >= 950) rating = 3;
    else if (icsea >= 900) rating = 2.5;
    else rating = 2;
  }
  
  if (naplan?.overall) {
    if (naplan.overall >= 450) rating = Math.min(5, rating + 0.5);
    else if (naplan.overall <= 350) rating = Math.max(1, rating - 0.5);
  }
  
  return Math.round(rating * 2) / 2;
}

function calculateSchoolSummary(schools: School[], postcode: string) {
  if (!schools || schools.length === 0) {
    return {
      totalSchools: 0,
      primarySchools: 0,
      secondarySchools: 0,
      averageICSEA: null,
      averageRating: null,
      topRatedSchools: [],
      nearestSchool: null,
      educationQuality: 'No school data available'
    };
  }
  
  const primarySchools = schools.filter(s => s.level === 'Primary' || s.level === 'Combined');
  const secondarySchools = schools.filter(s => s.level === 'Secondary' || s.level === 'Combined');
  
  const icseaValues = schools.map(s => s.icsea).filter(i => i !== null && i !== undefined) as number[];
  const averageICSEA = icseaValues.length > 0 
    ? Math.round(icseaValues.reduce((a, b) => a + b, 0) / icseaValues.length)
    : null;
  
  const ratings = schools.map(s => s.rating).filter(r => r !== null && r !== undefined) as number[];
  const averageRating = ratings.length > 0
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
    : null;
  
  const topRated = [...schools]
    .filter(s => s.rating && s.rating >= 4)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 5);
  
  const nearest = schools.length > 0 ? schools[0] : null;
  
  return {
    totalSchools: schools.length,
    primarySchools: primarySchools.length,
    secondarySchools: secondarySchools.length,
    averageICSEA,
    averageRating,
    topRatedSchools: topRated.map(s => ({
      name: s.name,
      rating: s.rating,
      level: s.level,
      type: s.type,
      icsea: s.icsea
    })),
    nearestSchool: nearest ? {
      name: nearest.name,
      distance: nearest.distance || 'Unknown',
      rating: nearest.rating,
      level: nearest.level
    } : null,
    educationQuality: getEducationQualityDescription(averageICSEA, averageRating)
  };
}

function getEducationQualityDescription(icsea: number | null, rating: number | null): string {
  if (!icsea && !rating) return 'Education quality data unavailable';
  
  if (icsea && icsea >= 1100) {
    return 'Excellent - This area has access to high-performing schools with well-above-average ICSEA scores.';
  } else if (icsea && icsea >= 1000) {
    return 'Very Good - Schools in this area perform above the national average.';
  } else if (icsea && icsea >= 950) {
    return 'Good - Schools in this area are close to the national average.';
  } else if (rating && rating >= 4) {
    return 'Good - Schools in this area are well-rated by the community.';
  } else {
    return 'Average - Schools in this area perform around the national average.';
  }
}
