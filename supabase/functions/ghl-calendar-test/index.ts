import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  // Handle CORS preflight requests
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
    
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[ghl-calendar-test] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[ghl-calendar-test] Authenticated user: ${userId}`);
    
    const apiKey = Deno.env.get('GOHIGHLEVEL_API_KEY');
    
    if (!apiKey) {
      console.error('GOHIGHLEVEL_API_KEY not configured');
      return new Response(JSON.stringify({ 
        error: 'GoHighLevel API key not configured',
        success: false 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Testing GoHighLevel API connection...');
    console.log('API Key type:', apiKey.startsWith('eyJ') ? 'JWT Token (Private Integration/OAuth)' : 'API Key');
    console.log('API Key prefix:', apiKey.substring(0, 15) + '...');

    // Parse the JWT to extract location info if it's a Private Integration Token
    let tokenInfo: any = null;
    let locationId: string | null = null;

    if (apiKey.startsWith('eyJ')) {
      try {
        const parts = apiKey.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          tokenInfo = {
            locationId: payload.locationId || payload.location_id,
            companyId: payload.companyId || payload.company_id,
            userId: payload.userId || payload.user_id,
            type: payload.type,
            iss: payload.iss,
            exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null
          };
          locationId = tokenInfo.locationId;
          console.log('Token payload:', JSON.stringify(tokenInfo, null, 2));
        }
      } catch (e) {
        console.log('Could not decode JWT:', e);
      }
    }

    // Try to get locationId from environment variable first
    const envLocationId = Deno.env.get('GOHIGHLEVEL_LOCATION_ID');
    if (envLocationId) {
      locationId = envLocationId;
      console.log('Using locationId from environment:', locationId);
    }

    // Try to get locationId from request body if provided (overrides env)
    try {
      const body = await req.json().catch(() => ({}));
      if (body.locationId) {
        locationId = body.locationId;
        console.log('Using locationId from request:', locationId);
      }
    } catch {}

    const results: any = {
      apiKeyConfigured: true,
      apiKeyType: apiKey.startsWith('eyJ') ? 'JWT Token (Private Integration/OAuth)' : 'API Key',
      tokenInfo,
      permissions: [],
      calendars: [],
      locations: [],
      errors: []
    };

    // For Private Integration tokens, we typically already have the locationId in the token
    // Let's try multiple approaches

    // Approach 1: Try /locations/search endpoint (for Agency tokens)
    console.log('Trying /locations/search endpoint...');
    try {
      const searchResponse = await fetch(`${GHL_API_BASE}/locations/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ limit: 10 })
      });
      
      console.log('Locations search status:', searchResponse.status);
      if (searchResponse.ok) {
        const data = await searchResponse.json();
        console.log('Locations search response:', JSON.stringify(data, null, 2));
        if (data.locations?.length) {
          results.locations = data.locations.map((loc: any) => ({
            id: loc.id,
            name: loc.name
          }));
          if (!locationId) locationId = data.locations[0].id;
        }
      }
    } catch (e) {
      console.log('Locations search error:', e);
    }

    // Approach 2: Try with locationId from token or use a direct calendar call
    if (locationId) {
      console.log('Testing with locationId:', locationId);
      
      // Fetch calendars
      console.log('Fetching calendars...');
      try {
        const calendarsResponse = await fetch(`${GHL_API_BASE}/calendars/?locationId=${locationId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json',
          },
        });

        console.log('Calendars response status:', calendarsResponse.status);
        const calendarsText = await calendarsResponse.text();
        console.log('Calendars raw response:', calendarsText.substring(0, 500));

        let calendarsData;
        try {
          calendarsData = JSON.parse(calendarsText);
        } catch {
          calendarsData = { error: calendarsText };
        }

        if (calendarsResponse.ok && calendarsData.calendars) {
          results.calendars = calendarsData.calendars.map((cal: any) => ({
            id: cal.id,
            name: cal.name,
            description: cal.description,
            calendarType: cal.calendarType,
            isActive: cal.isActive,
            teamMembers: cal.teamMembers?.length || 0,
            slug: cal.slug
          }));
          results.permissions.push('calendars.readonly');
        } else {
          results.errors.push({
            endpoint: 'calendars',
            status: calendarsResponse.status,
            error: calendarsData.error || calendarsData.message || 'Unknown error'
          });
        }
      } catch (err: any) {
        console.error('Error fetching calendars:', err);
        results.errors.push({ endpoint: 'calendars', error: err.message });
      }

      // Fetch calendar events
      console.log('Fetching calendar events...');
      try {
        const now = new Date();
        const startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const endTime = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

        const eventsResponse = await fetch(
          `${GHL_API_BASE}/calendars/events?locationId=${locationId}&startTime=${startTime}&endTime=${endTime}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Version': '2021-07-28',
              'Content-Type': 'application/json',
            },
          }
        );

        console.log('Events response status:', eventsResponse.status);
        const eventsText = await eventsResponse.text();
        console.log('Events raw response:', eventsText.substring(0, 500));

        let eventsData;
        try {
          eventsData = JSON.parse(eventsText);
        } catch {
          eventsData = { error: eventsText };
        }

        if (eventsResponse.ok && eventsData.events) {
          results.eventsCount = eventsData.events.length;
          results.sampleEvents = eventsData.events.slice(0, 5).map((evt: any) => ({
            id: evt.id,
            title: evt.title,
            startTime: evt.startTime,
            endTime: evt.endTime,
            calendarId: evt.calendarId,
            status: evt.status,
            appointmentStatus: evt.appointmentStatus,
            contactId: evt.contactId
          }));
          results.permissions.push('calendars/events.readonly');
        } else {
          results.errors.push({
            endpoint: 'calendars/events',
            status: eventsResponse.status,
            error: eventsData.error || eventsData.message || 'Unknown error'
          });
        }
      } catch (err: any) {
        console.error('Error fetching events:', err);
        results.errors.push({ endpoint: 'calendars/events', error: err.message });
      }

      // Try calendar groups
      console.log('Fetching calendar groups...');
      try {
        const groupsResponse = await fetch(`${GHL_API_BASE}/calendars/groups?locationId=${locationId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json',
          },
        });

        console.log('Groups response status:', groupsResponse.status);
        if (groupsResponse.ok) {
          const groupsData = await groupsResponse.json();
          results.calendarGroups = groupsData.groups || [];
          if (groupsData.groups?.length) {
            results.permissions.push('calendars/groups.readonly');
          }
        }
      } catch (err: any) {
        console.log('Calendar groups error:', err);
      }

    } else {
      results.errors.push({
        endpoint: 'all',
        error: 'No locationId available. Please provide a locationId in the request body or ensure your API key is a Sub-Account/Location level token.'
      });
      
      results.instructions = {
        message: 'Your API key appears to be missing locationId access. Please check:',
        steps: [
          '1. Ensure the API key is a Private Integration Token created at the Sub-Account/Location level',
          '2. Or provide the locationId manually in the request body: {"locationId": "your-location-id"}',
          '3. You can find your locationId in GoHighLevel under Settings > Business Profile > Location ID'
        ]
      };
    }

    // Summary
    results.success = results.permissions.length > 0;
    results.locationIdUsed = locationId;
    results.summary = {
      hasCalendarAccess: results.permissions.includes('calendars.readonly'),
      hasEventsAccess: results.permissions.includes('calendars/events.readonly'),
      hasGroupsAccess: results.permissions.includes('calendars/groups.readonly'),
      calendarsFound: results.calendars.length,
      eventsFound: results.eventsCount || 0,
      totalPermissions: results.permissions.length
    };

    console.log('Final results:', JSON.stringify(results, null, 2));

    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in ghl-calendar-test:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'ghl-calendar-test'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
