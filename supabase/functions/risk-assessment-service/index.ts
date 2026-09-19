import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface RiskAssessmentRequest {
  suburb: string;
  state: string;
  postcode: string;
  latitude?: number;
  longitude?: number;
}

interface RiskAssessment {
  floodRisk?: {
    level: 'Low' | 'Medium' | 'High' | 'Very High' | 'Unknown';
    description: string;
    dataSource: string;
    floodHeight?: number | null;
    averageRecurrenceInterval?: number | null;
    lastUpdated?: string;
    note?: string;
    activeWarnings?: number;
  };
  bushfireRisk?: {
    level: 'Low' | 'Medium' | 'High' | 'Extreme' | 'Unknown';
    description: string;
    dataSource: string;
    officialSource?: string;
    note?: string;
    category?: string;
    overlayCode?: string;
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
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // SECURITY: Verify authentication
    const body = await req.json();
    const { suburb, state, postcode, latitude, longitude }: RiskAssessmentRequest = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[risk-assessment-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[risk-assessment-service] Authenticated user: ${userId}`);
    console.log(`🔍 Risk assessment request: ${suburb}, ${state}, ${postcode}`);

    // Check cache first
    const cachedData = await checkRiskCache(supabase, suburb, postcode, state);
    
    if (cachedData) {
      const ageHours = Math.round((Date.now() - new Date(cachedData.fetched_at).getTime()) / (1000 * 60 * 60));
      console.log(`✅ Cache HIT! Risk data age: ${ageHours} hours`);
      
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            floodRisk: cachedData.flood_risk,
            bushfireRisk: cachedData.bushfire_risk
          },
          suburb,
          state,
          postcode,
          cached: true,
          cachedAt: cachedData.fetched_at,
          note: 'Risk data from cache. Flood data from AFRIP, bushfire risk from state services.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('❌ Cache MISS. Fetching fresh risk data...');
    const startTime = Date.now();

    // Initialize risk assessment object
    const riskAssessment: RiskAssessment = {};

    // Fetch real flood risk data from AFRIP (Geoscience Australia)
    if (latitude && longitude) {
      console.log(`Fetching flood risk for coordinates: ${latitude}, ${longitude}`);
      riskAssessment.floodRisk = await fetchFloodRiskFromAFRIP(latitude, longitude, suburb, state);
    } else {
      console.log('No coordinates provided, using postcode-based estimate');
      riskAssessment.floodRisk = await fetchFloodRiskByPostcode(postcode, suburb, state);
    }

    // Fetch real bushfire risk data from state-specific services
    console.log(`Fetching bushfire risk for ${state}`);
    if (latitude && longitude) {
      riskAssessment.bushfireRisk = await fetchBushfireRiskByState(state, suburb, postcode, latitude, longitude);
    } else {
      riskAssessment.bushfireRisk = await fetchBushfireRiskByPostcode(state, suburb, postcode);
    }

    const responseTime = Date.now() - startTime;
    console.log(`⏱️ Risk assessment fetched in ${responseTime}ms`);

    // Cache only readings a source actually produced. An 'Unavailable'
    // reading is an outage, and caching an outage for 180 days pins it long
    // after the source recovers.
    const floodUnavailable = riskAssessment.floodRisk?.dataSource?.startsWith('Unavailable') ?? true;
    const bushfireUnavailable = riskAssessment.bushfireRisk?.dataSource?.startsWith('Unavailable') ?? true;
    if (!floodUnavailable && !bushfireUnavailable) {
      await cacheRiskData(supabase, suburb, postcode, state, latitude, longitude, riskAssessment);
    }

    // Log API health
    await logApiHealth(supabase, 'risk-assessment', '/assess', 'success', responseTime, 
      floodUnavailable ? 'unavailable' : 'live');

    return new Response(
      JSON.stringify({
        success: true,
        data: riskAssessment,
        suburb,
        state,
        postcode,
        cached: false,
        note: 'Flood data from AFRIP (Geoscience Australia). Bushfire risk from state mapping services where reachable; unavailable readings are stated, never estimated.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error in risk-assessment-service:', error);
    
    // Log API health failure
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await logApiHealth(supabase, 'risk-assessment', '/assess', 'error', null, 'estimated', 
        error instanceof Error ? error.message : 'Unknown error');
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return new Response(
      JSON.stringify({
        ...internalError(error, 'risk-assessment-service'),
        success: false,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function checkRiskCache(supabase: any, suburb: string, postcode: string, state: string) {
  const { data, error } = await supabase
    .from('risk_assessment_cache')
    .select('*')
    .eq('suburb', suburb.toLowerCase())
    .eq('postcode', postcode)
    .eq('state', state.toUpperCase())
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error('Cache query error:', error);
    return null;
  }

  return data;
}

async function cacheRiskData(
  supabase: any, 
  suburb: string, 
  postcode: string, 
  state: string,
  latitude: number | undefined,
  longitude: number | undefined,
  riskAssessment: RiskAssessment
) {
  console.log('💾 Caching risk data for 180 days...');
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 180);

  const { error } = await supabase
    .from('risk_assessment_cache')
    .upsert({
      suburb: suburb.toLowerCase(),
      postcode,
      state: state.toUpperCase(),
      latitude,
      longitude,
      flood_risk: riskAssessment.floodRisk,
      bushfire_risk: riskAssessment.bushfireRisk,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      // Only reached when both readings came from their real sources — the
      // handler skips caching any 'Unavailable' reading outright.
      data_quality: 'live'
    }, {
      onConflict: 'suburb,postcode,state'
    });

  if (error) {
    console.error('❌ Error caching risk data:', error);
  } else {
    console.log('✅ Risk data cached successfully');
  }
}

async function logApiHealth(
  supabase: any,
  serviceName: string,
  endpoint: string,
  status: string,
  responseTime: number | null,
  dataQuality: string,
  errorMessage?: string
) {
  const { error } = await supabase
    .from('api_health_log')
    .insert({
      service_name: serviceName,
      endpoint,
      status,
      response_time_ms: responseTime,
      data_quality: dataQuality,
      error_message: errorMessage
    });

  if (error) {
    console.error('Failed to log API health:', error);
  }
}

async function fetchFloodRiskFromAFRIP(latitude: number, longitude: number, suburb: string, state: string) {
  try {
    console.log('Fetching flood risk from AFRIP/Geoscience Australia...');
    
    // AFRIP (Australian Flood Risk Information Portal) - Geoscience Australia
    // WMS/WFS Service endpoint for flood hazard data
    const wfsUrl = 'https://services.ga.gov.au/gis/services/NFRAG_Floodplain_Risk_Information/MapServer/WFSServer';
    
    // Query flood hazard layers using WFS GetFeature request
    const queryUrl = `${wfsUrl}?service=WFS&version=2.0.0&request=GetFeature&typeName=NFRAG_Floodplain_Risk_Information&outputFormat=application/json&CQL_FILTER=INTERSECTS(geom,POINT(${longitude} ${latitude}))`;
    
    try {
      const response = await fetch(queryUrl, {
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(8000) // 8 second timeout
      });

      if (response.ok) {
        const data = await response.json();
        console.log('AFRIP flood data received');
        
        if (data.features && data.features.length > 0) {
          const feature = data.features[0];
          const properties = feature.properties;
          
          // Extract flood risk level from properties
          let level: 'Low' | 'Medium' | 'High' | 'Very High' | 'Unknown' = 'Unknown';
          let description = '';
          
          if (properties.FLOOD_RISK || properties.RISK_LEVEL) {
            const riskValue = properties.FLOOD_RISK || properties.RISK_LEVEL;
            level = mapFloodRiskLevel(riskValue);
            description = `This area is within a mapped flood risk zone. ${getFloodRiskDescription(level)}`;
          } else {
            level = 'Low';
            description = 'No significant flood risk identified in AFRIP database for this location.';
          }
          
          return {
            level,
            description,
            dataSource: 'Australian Flood Risk Information Portal (AFRIP) - Geoscience Australia',
            floodHeight: properties.FLOOD_HEIGHT_M || null,
            averageRecurrenceInterval: properties.ARI_YEARS || null,
            lastUpdated: properties.LAST_UPDATED || '2024'
          };
        } else {
          // No flood data in AFRIP for this location
          return {
            level: 'Low' as const,
            description: 'This location is not within a mapped flood risk area according to AFRIP data. However, flood risk can change due to weather patterns and development.',
            dataSource: 'Australian Flood Risk Information Portal (AFRIP) - Geoscience Australia',
            note: 'Always check with local council for the most current flood information.'
          };
        }
      }
      
      console.log('AFRIP API response not OK, status:', response.status);
    } catch (apiError: any) {
      console.log('AFRIP API fetch failed:', apiError.message);
    }

    // Try alternative: BoM Flood Warning Service
    try {
      console.log('Trying BoM Flood Warning Service...');
      const bomUrl = `http://www.bom.gov.au/fwo/IDZ00001.warnings_summary.json`;
      
      const response = await fetch(bomUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        const data = await response.json();
        console.log('BoM flood warnings received');
        
        // Check if there are active flood warnings for the state
        const stateWarnings = data.warnings?.filter((w: any) => 
          w.state === state && w.type === 'flood'
        ) || [];
        
        if (stateWarnings.length > 0) {
          return {
            level: 'Medium' as const,
            description: `Active flood warnings exist for ${state}. Check Bureau of Meteorology for current conditions.`,
            dataSource: 'Bureau of Meteorology Flood Warning Service',
            activeWarnings: stateWarnings.length
          };
        }
      }
    } catch (bomError: any) {
      console.log('BoM flood warning fetch failed:', bomError.message);
    }

    // Fallback: Generate estimate based on location patterns
    return floodRiskUnavailable(suburb, state);

  } catch (error: any) {
    console.error('Error fetching flood risk:', error);
    return floodRiskUnavailable(suburb, state);
  }
}

async function fetchFloodRiskByPostcode(postcode: string, suburb: string, state: string) {
  console.log('Fetching flood risk by postcode (no coordinates)');
  
  // Without coordinates, we can only provide general estimates
  // In production, you would geocode the postcode first
  return {
    level: 'Unknown' as const,
    description: 'Precise flood risk assessment requires property coordinates. General flood information can be found through your local council or AFRIP at https://afrip.ga.gov.au/',
    dataSource: 'Unavailable (coordinates required for AFRIP assessment)',
    note: 'Contact your local council for detailed flood risk information for this postcode.'
  };
}

function mapFloodRiskLevel(value: any): 'Low' | 'Medium' | 'High' | 'Very High' | 'Unknown' {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower.includes('very high') || lower.includes('extreme')) return 'Very High';
    if (lower.includes('high')) return 'High';
    if (lower.includes('medium') || lower.includes('moderate')) return 'Medium';
    if (lower.includes('low')) return 'Low';
  }
  if (typeof value === 'number') {
    if (value >= 4) return 'Very High';
    if (value >= 3) return 'High';
    if (value >= 2) return 'Medium';
    if (value >= 1) return 'Low';
  }
  return 'Unknown';
}

function getFloodRiskDescription(level: string): string {
  const descriptions: Record<string, string> = {
    'Very High': 'Significant flood risk exists. Properties may experience regular flooding during major rainfall events. Flood insurance is strongly recommended.',
    'High': 'Elevated flood risk. The area may be subject to flooding during significant rainfall events. Consider flood mitigation measures.',
    'Medium': 'Moderate flood risk. Some flooding may occur during heavy rainfall. Check with local council for specific property information.',
    'Low': 'Minimal flood risk identified. However, local conditions can vary and should be verified with local council.'
  };
  return descriptions[level] || 'Flood risk level requires further assessment.';
}

function floodRiskUnavailable(suburb: string, state: string) {
  // The honest reading when AFRIP cannot be reached. The old version here was
  // `generateFloodEstimate`: a list of fifteen suburb-name fragments decided
  // Medium or Low for the whole country — and it substring-matched, so any
  // suburb containing "kew" or "richmond" inherited a flood history it may
  // not have. A flood rating is a fact about a property; guessed, it either
  // alarms an owner or reassures a buyer, and both are wrong.
  return {
    level: 'Unknown' as const,
    description: `Flood risk could not be assessed for ${suburb}, ${state} — the AFRIP service was unreachable. Consult your local council's flood maps or https://afrip.ga.gov.au/ directly.`,
    dataSource: 'Unavailable (AFRIP unreachable)',
    note: 'For accurate flood risk assessment, retry later or consult https://afrip.ga.gov.au/'
  };
}

async function fetchBushfireRiskByState(
  state: string, 
  suburb: string, 
  postcode: string, 
  latitude: number, 
  longitude: number
) {
  const stateUpper = state.toUpperCase();
  
  try {
    switch (stateUpper) {
      case 'NSW':
        return await fetchNSWBushfireRisk(suburb, postcode, latitude, longitude);
      case 'VIC':
        return await fetchVICBushfireRisk(suburb, postcode, latitude, longitude);
      case 'QLD':
        return await fetchQLDBushfireRisk(suburb, postcode, latitude, longitude);
      case 'SA':
        return await fetchSABushfireRisk(suburb, postcode, latitude, longitude);
      case 'WA':
        return await fetchWABushfireRisk(suburb, postcode, latitude, longitude);
      case 'TAS':
        return await fetchTASBushfireRisk(suburb, postcode, latitude, longitude);
      case 'NT':
        return await fetchNTBushfireRisk(suburb, postcode, latitude, longitude);
      case 'ACT':
        return await fetchACTBushfireRisk(suburb, postcode, latitude, longitude);
      default:
        return bushfireRiskUnavailable(state);
    }
  } catch (error: any) {
    console.error(`Error fetching ${state} bushfire risk:`, error);
    return bushfireRiskUnavailable(state);
  }
}

async function fetchBushfireRiskByPostcode(state: string, suburb: string, postcode: string) {
  // Without coordinates, provide state-specific general risk information
  return bushfireRiskUnavailable(state);
}

// NSW Rural Fire Service (RFS)
async function fetchNSWBushfireRisk(suburb: string, postcode: string, latitude: number, longitude: number) {
  try {
    console.log('Fetching NSW RFS bushfire risk data...');
    
    // NSW RFS Bushfire Prone Land mapping
    // Using NSW Spatial Services WFS endpoint
    const wfsUrl = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Bushfire_Prone_Land/MapServer/0/query';
    const queryUrl = `${wfsUrl}?geometry=${longitude},${latitude}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
    
    const response = await fetch(queryUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('NSW RFS data received');
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const attributes = feature.attributes;
        
        // Property is in bushfire prone land
        const category = attributes.CATEGORY || attributes.BF_CATEGORY || 'Unknown';
        let level: 'Low' | 'Medium' | 'High' | 'Extreme' | 'Unknown';
        
        if (category.toLowerCase().includes('vegetation category 1')) {
          level = 'Extreme';
        } else if (category.toLowerCase().includes('vegetation')) {
          level = 'High';
        } else if (category.toLowerCase().includes('buffer')) {
          level = 'Medium';
        } else {
          level = 'High';
        }
        
        return {
          level,
          description: `This property is designated as Bushfire Prone Land (${category}). A Bushfire Attack Level (BAL) assessment is required for development. Properties must comply with AS 3959 construction standards.`,
          dataSource: 'NSW Rural Fire Service (RFS) - Bushfire Prone Land Mapping',
          category,
          officialSource: getStateBushfireDataSource('NSW'),
          note: 'All development in bushfire prone land requires a BAL assessment and compliance with NSW Planning for Bushfire Protection guidelines.'
        };
      } else {
        return {
          level: 'Low' as const,
          description: 'This property is not currently mapped as Bushfire Prone Land by NSW RFS. However, bushfire risk can exist outside mapped areas.',
          dataSource: 'NSW Rural Fire Service (RFS) - Bushfire Prone Land Mapping',
          officialSource: getStateBushfireDataSource('NSW'),
          note: 'Even properties outside bushfire prone land should maintain defensible space during fire season.'
        };
      }
    }
  } catch (error: any) {
    console.log('NSW RFS API fetch failed:', error.message);
  }
  
  return bushfireRiskUnavailable('NSW');
}

// VIC Country Fire Authority (CFA)
async function fetchVICBushfireRisk(suburb: string, postcode: string, latitude: number, longitude: number) {
  try {
    console.log('Fetching VIC CFA bushfire risk data...');
    
    // Victoria CFA Bushfire Management Overlay (BMO)
    // Using VIC DataVic WFS endpoint
    const wfsUrl = 'https://services.land.vic.gov.au/catalogue/publicproxy/guest/dv_geoserver/wfs';
    const queryUrl = `${wfsUrl}?service=WFS&version=2.0.0&request=GetFeature&typeName=PLANNING_BMO&outputFormat=application/json&CQL_FILTER=INTERSECTS(geom,POINT(${longitude} ${latitude}))`;
    
    const response = await fetch(queryUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('VIC CFA data received');
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const properties = feature.properties;
        
        return {
          level: 'High' as const,
          description: 'This property is within a Bushfire Management Overlay (BMO) area. Development requires a bushfire management plan and BAL assessment. Property must comply with bushfire protection standards.',
          dataSource: 'Country Fire Authority (CFA) Victoria - Bushfire Management Overlay',
          overlayCode: properties.ZONE_CODE || properties.BMO_CODE,
          officialSource: getStateBushfireDataSource('VIC'),
          note: 'BMO areas have specific planning requirements. Consult with CFA and local council before development.'
        };
      } else {
        return {
          level: 'Low' as const,
          description: 'This property is not within a mapped Bushfire Management Overlay. Standard fire safety practices recommended.',
          dataSource: 'Country Fire Authority (CFA) Victoria - Bushfire Management Overlay',
          officialSource: getStateBushfireDataSource('VIC'),
          note: 'Bushfire risk can exist outside overlay areas. Maintain defensible space during fire danger periods.'
        };
      }
    }
  } catch (error: any) {
    console.log('VIC CFA API fetch failed:', error.message);
  }
  
  return bushfireRiskUnavailable('VIC');
}

// QLD Fire and Emergency Services (QFES)
async function fetchQLDBushfireRisk(suburb: string, postcode: string, latitude: number, longitude: number) {
  try {
    console.log('Fetching QLD QFES bushfire risk data...');
    
    // Queensland Bushfire Prone Areas
    // Using QLD Government WFS endpoint
    const wfsUrl = 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/BushfireProneAreas/MapServer/0/query';
    const queryUrl = `${wfsUrl}?geometry=${longitude},${latitude}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
    
    const response = await fetch(queryUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('QLD QFES data received');
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const attributes = feature.attributes;
        
        const category = attributes.CATEGORY || attributes.TYPE || 'Bushfire Prone Area';
        
        return {
          level: 'High' as const,
          description: `This property is within a designated Bushfire Prone Area (${category}). Development requires compliance with Queensland Development Code MP 3.4 and a bushfire management plan.`,
          dataSource: 'Queensland Fire and Emergency Services (QFES) - Bushfire Prone Areas',
          category,
          officialSource: getStateBushfireDataSource('QLD'),
          note: 'Properties in bushfire prone areas must comply with QDC MP 3.4 construction standards.'
        };
      } else {
        return {
          level: 'Low' as const,
          description: 'This property is not currently mapped as a Bushfire Prone Area. Standard bushfire safety practices recommended.',
          dataSource: 'Queensland Fire and Emergency Services (QFES) - Bushfire Prone Areas',
          officialSource: getStateBushfireDataSource('QLD'),
          note: 'Bushfire preparedness is important statewide during fire season.'
        };
      }
    }
  } catch (error: any) {
    console.log('QLD QFES API fetch failed:', error.message);
  }
  
  return bushfireRiskUnavailable('QLD');
}

// SA Country Fire Service (CFS)
async function fetchSABushfireRisk(suburb: string, postcode: string, latitude: number, longitude: number) {
  try {
    console.log('Fetching SA CFS bushfire risk data...');
    
    // South Australia Bushfire Prone Areas
    // Using SA Government data portal
    const wfsUrl = 'https://data.sa.gov.au/data/api/3/action/datastore_search';
    const queryUrl = `${wfsUrl}?resource_id=bushfire-prone-areas&filters={"LATITUDE":"${latitude}","LONGITUDE":"${longitude}"}`;
    
    const response = await fetch(queryUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('SA CFS data received');
      
      if (data.result && data.result.records && data.result.records.length > 0) {
        const record = data.result.records[0];
        
        return {
          level: 'High' as const,
          description: 'This property is within a Bushfire Prone Area. Development requires compliance with SA Planning and Design Code bushfire protection measures and a BAL assessment.',
          dataSource: 'SA Country Fire Service (CFS) - Bushfire Prone Areas',
          officialSource: getStateBushfireDataSource('SA'),
          note: 'Bushfire prone areas have specific development requirements under the SA Planning and Design Code.'
        };
      } else {
        return {
          level: 'Medium' as const,
          description: 'This property is not within a mapped Bushfire Prone Area. South Australia experiences regular bushfire seasons - maintain appropriate defensible space.',
          dataSource: 'SA Country Fire Service (CFS) - Bushfire Prone Areas',
          officialSource: getStateBushfireDataSource('SA'),
          note: 'SA is prone to severe fire danger days. Prepare a bushfire survival plan regardless of mapping.'
        };
      }
    }
  } catch (error: any) {
    console.log('SA CFS API fetch failed:', error.message);
  }
  
  return bushfireRiskUnavailable('SA');
}

// WA Department of Fire and Emergency Services (DFES)
async function fetchWABushfireRisk(suburb: string, postcode: string, latitude: number, longitude: number) {
  try {
    console.log('Fetching WA DFES bushfire risk data...');
    
    // Western Australia Bushfire Prone Areas
    // Using WA Government spatial data
    const wfsUrl = 'https://catalogue.data.wa.gov.au/api/3/action/datastore_search';
    const queryUrl = `${wfsUrl}?resource_id=bushfire-prone-areas&filters={"latitude":"${latitude}","longitude":"${longitude}"}`;
    
    const response = await fetch(queryUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('WA DFES data received');
      
      if (data.result && data.result.records && data.result.records.length > 0) {
        return {
          level: 'High' as const,
          description: 'This property is within a designated Bushfire Prone Area. Development requires compliance with AS 3959 and a BAL assessment as per State Planning Policy 3.7.',
          dataSource: 'WA Department of Fire and Emergency Services (DFES) - Bushfire Prone Areas',
          officialSource: getStateBushfireDataSource('WA'),
          note: 'Bushfire prone areas in WA require compliance with SPP 3.7 and Guidelines for Planning in Bushfire Prone Areas.'
        };
      } else {
        return {
          level: 'Medium' as const,
          description: 'This property is not currently mapped as Bushfire Prone. WA experiences severe bushfire seasons - maintain defensible space and fire preparedness.',
          dataSource: 'WA Department of Fire and Emergency Services (DFES) - Bushfire Prone Areas',
          officialSource: getStateBushfireDataSource('WA'),
          note: 'Bushfire risk exists across much of WA. Prepare a bushfire plan and maintain adequate defensible space.'
        };
      }
    }
  } catch (error: any) {
    console.log('WA DFES API fetch failed:', error.message);
  }
  
  return bushfireRiskUnavailable('WA');
}

// TAS Tasmania Fire Service (TFS)
async function fetchTASBushfireRisk(suburb: string, postcode: string, latitude: number, longitude: number) {
  try {
    console.log('Fetching TAS Fire Service bushfire risk data...');
    
    // Tasmania Bushfire Prone Areas
    // Using TAS Government LIST (Land Information System Tasmania)
    const wfsUrl = 'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/CadastreAndAdministrative/MapServer/13/query';
    const queryUrl = `${wfsUrl}?geometry=${longitude},${latitude}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
    
    const response = await fetch(queryUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('TAS Fire Service data received');
      
      if (data.features && data.features.length > 0) {
        return {
          level: 'High' as const,
          description: 'This property is within a Bushfire-Prone Area. Development requires a BAL assessment and compliance with the Tasmanian Planning Scheme bushfire code.',
          dataSource: 'Tasmania Fire Service (TFS) - Bushfire Prone Areas',
          officialSource: getStateBushfireDataSource('TAS'),
          note: 'Tasmania experiences severe bushfire conditions. Properties in prone areas must comply with E1.0 Bushfire-Prone Areas Code.'
        };
      } else {
        return {
          level: 'Medium' as const,
          description: 'This property is not within a mapped Bushfire-Prone Area. Tasmania experiences bushfire risk statewide - maintain fire preparedness.',
          dataSource: 'Tasmania Fire Service (TFS) - Bushfire Prone Areas',
          officialSource: getStateBushfireDataSource('TAS'),
          note: 'Bushfire risk exists across Tasmania. Prepare a bushfire survival plan for fire danger periods.'
        };
      }
    }
  } catch (error: any) {
    console.log('TAS Fire Service API fetch failed:', error.message);
  }
  
  return bushfireRiskUnavailable('TAS');
}

// NT Police, Fire and Emergency Services (NTPFES)
async function fetchNTBushfireRisk(suburb: string, postcode: string, latitude: number, longitude: number) {
  try {
    console.log('Fetching NT PFES bushfire risk data...');
    
    // Northern Territory Bushfire Risk Areas
    // Using NT Government open data portal
    const apiUrl = 'https://data.gov.au/api/3/action/datastore_search';
    const queryUrl = `${apiUrl}?resource_id=nt-bushfire-risk&filters={"latitude":"${latitude}","longitude":"${longitude}"}`;
    
    const response = await fetch(queryUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('NT PFES data received');
      
      if (data.result && data.result.records && data.result.records.length > 0) {
        return {
          level: 'High' as const,
          description: 'This property is in a bushfire risk area. The NT experiences extensive bushfire activity annually. Maintain large defensible space and prepare for fire season (typically April-November).',
          dataSource: 'NT Police, Fire and Emergency Services (NTPFES) - Bushfire Risk Areas',
          officialSource: getStateBushfireDataSource('NT'),
          note: 'NT bushfire seasons are extensive. Maintain defensible space of at least 50-100m in high-risk areas.'
        };
      } else {
        return {
          level: 'Medium' as const,
          description: 'Bushfire risk information available through NT PFES. The Northern Territory experiences significant annual bushfire activity across most regions.',
          dataSource: 'NT Police, Fire and Emergency Services (NTPFES)',
          officialSource: getStateBushfireDataSource('NT'),
          note: 'Bushfire is a significant risk across the NT. Prepare property and plan for the annual fire season.'
        };
      }
    }
  } catch (error: any) {
    console.log('NT PFES API fetch failed:', error.message);
  }
  
  return bushfireRiskUnavailable('NT');
}

// ACT Emergency Services Agency (ESA)
async function fetchACTBushfireRisk(suburb: string, postcode: string, latitude: number, longitude: number) {
  try {
    console.log('Fetching ACT ESA bushfire risk data...');
    
    // ACT Bushfire Prone Areas
    // Using ACT Government data portal
    const wfsUrl = 'https://www.data.act.gov.au/api/geospatial/';
    const queryUrl = `${wfsUrl}bushfire-prone-areas?$where=intersects(location,POINT(${longitude} ${latitude}))`;
    
    const response = await fetch(queryUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('ACT ESA data received');
      
      if (data && data.length > 0) {
        return {
          level: 'High' as const,
          description: 'This property is within a Bushfire Prone Area. Given ACT\'s 2003 bushfire history, properties must comply with strict bushfire protection standards and maintain defensible space.',
          dataSource: 'ACT Emergency Services Agency (ESA) - Bushfire Prone Areas',
          officialSource: getStateBushfireDataSource('ACT'),
          note: 'ACT has strict bushfire planning requirements. Development requires BAL assessment and compliance with Territory Plan bushfire provisions.'
        };
      } else {
        return {
          level: 'Medium' as const,
          description: 'This property is not within a mapped Bushfire Prone Area. However, given ACT\'s bushfire history, all properties should maintain fire preparedness.',
          dataSource: 'ACT Emergency Services Agency (ESA) - Bushfire Prone Areas',
          officialSource: getStateBushfireDataSource('ACT'),
          note: 'The ACT is surrounded by bushfire-prone landscapes. Maintain defensible space and prepare a bushfire survival plan.'
        };
      }
    }
  } catch (error: any) {
    console.log('ACT ESA API fetch failed:', error.message);
  }
  
  return bushfireRiskUnavailable('ACT');
}

function bushfireRiskUnavailable(state: string) {
  // The honest reading when the state mapping service cannot be reached (or
  // no coordinates were supplied to ask it with). The old version here was
  // `generateBushfireEstimate`: any suburb whose NAME contained "hills",
  // "ranges" or "forest" was rated **Extreme** — Baulkham Hills and Surry
  // Hills alike — and five whole states were rated High, labelled
  // "Estimated". A bushfire rating drives construction standards (AS 3959)
  // and insurance; it is measured from mapping, never from a suburb's name.
  return {
    level: 'Unknown' as const,
    description: `Bushfire risk could not be assessed — the ${getStateBushfireAgency(state)} mapping service was unreachable or the property's coordinates were not available. Obtain the property's rating from the official source directly.`,
    dataSource: `Unavailable (${getStateBushfireAgency(state)} not reached)`,
    officialSource: getStateBushfireDataSource(state),
    note: 'Bushfire risk varies by exact location. Obtain a formal Bushfire Attack Level (BAL) assessment for construction or insurance purposes.'
  };
}

function getStateBushfireAgency(state: string): string {
  const agencies: Record<string, string> = {
    'NSW': 'NSW Rural Fire Service (RFS)',
    'VIC': 'Country Fire Authority (CFA)',
    'QLD': 'Queensland Fire and Emergency Services (QFES)',
    'WA': 'Department of Fire and Emergency Services (DFES)',
    'SA': 'Country Fire Service (CFS)',
    'TAS': 'Tasmania Fire Service (TFS)',
    'ACT': 'ACT Emergency Services Agency (ESA)',
    'NT': 'Northern Territory Police, Fire and Emergency Services (NTPFES)',
  };
  return agencies[state.toUpperCase()] || 'State Emergency Services';
}

function getStateBushfireDataSource(state: string): string {
  const sources: Record<string, string> = {
    'NSW': 'https://www.rfs.nsw.gov.au/plan-and-prepare/building-in-a-bush-fire-area',
    'VIC': 'https://www.cfa.vic.gov.au/plan-prepare/your-local-area-info',
    'QLD': 'https://www.qfes.qld.gov.au/prepare/bushfire',
    'WA': 'https://www.dfes.wa.gov.au/hazard-information/bushfire',
    'SA': 'https://www.cfs.sa.gov.au/public-safety/bushfire-risk-ratings',
    'TAS': 'https://www.fire.tas.gov.au/prepare',
    'ACT': 'https://esa.act.gov.au/prepare/bushfires',
    'NT': 'https://pfes.nt.gov.au/fire-and-rescue/bushfires',
  };
  return sources[state.toUpperCase()] || 'State-based emergency services website';
}
