// Pinned to the version `_shared/ghl-rate-limiter.ts` declares, for the reason
// `_shared/ghlConversationPaging.ts` records at its own head: a floating `@2`
// resolves to a different `SupabaseClient` instantiation and the limiter's
// first parameter stops matching it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { mapWithConcurrency } from '../_shared/boundedConcurrency.pure.ts';
import { ghlFetchShared, tokenKeyFor } from '../_shared/ghl-rate-limiter.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

/** Independent per-calendar reads, overlapped but bounded. */
const CALENDAR_CONCURRENCY = 6;

/**
 * Notes for an appointment live in THIS database, not in GoHighLevel.
 *
 * Measured against the live account on 2026-08-31: of 65 appointments, 62
 * carry a `notes` key and one has anything in it. GHL returns the field on
 * both the list and the detail endpoint, so nothing is lost on the way in —
 * it was never stored on the appointment. `appointment_notes` is where it goes.
 *
 * Every one of these degrades to a no-op rather than failing the act it
 * accompanies: a booking must not fail because a note could not be filed, and
 * a calendar must not fail to load because notes could not be read.
 */
async function saveAppointmentNotes(
  supabase: any,
  appointmentGhlId: string | null | undefined,
  notes: string | null | undefined,
  userId?: string | null,
): Promise<void> {
  if (!appointmentGhlId || notes === undefined || notes === null) return;
  try {
    const { error } = await supabase
      .from('appointment_notes')
      .upsert({
        appointment_ghl_id: appointmentGhlId,
        notes,
        updated_at: new Date().toISOString(),
        updated_by: userId ?? null,
      }, { onConflict: 'appointment_ghl_id' });
    if (error) console.error('[ghl-calendar] Could not store appointment notes:', error.message);
  } catch (e) {
    console.error('[ghl-calendar] Could not store appointment notes:', String(e));
  }
}

/** Stored notes for a set of appointments, keyed by GHL event id. */
async function loadAppointmentNotes(
  supabase: any,
  ids: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  try {
    const { data, error } = await supabase
      .from('appointment_notes')
      .select('appointment_ghl_id, notes')
      .in('appointment_ghl_id', unique);
    if (error) {
      console.error('[ghl-calendar] Could not read appointment notes:', error.message);
      return {};
    }
    const map: Record<string, string> = {};
    for (const row of data ?? []) {
      if (typeof row?.notes === 'string' && row.notes.trim() !== '') {
        map[row.appointment_ghl_id] = row.notes;
      }
    }
    return map;
  } catch (e) {
    console.error('[ghl-calendar] Could not read appointment notes:', String(e));
    return {};
  }
}



interface GHLTeamMember {
  userId: string;
  name?: string;
  email?: string;
}

interface GHLCalendar {
  id: string;
  name: string;
  description?: string;
  calendarType: string;
  isActive: boolean;
  teamMembers?: GHLTeamMember[];
  slug?: string;
  eventColor?: string;
}

interface GHLEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  calendarId: string;
  status: string;
  appointmentStatus?: string;
  contactId?: string;
  notes?: string;
  address?: string;
}

// Default calendar colors for consistent color coding
const CALENDAR_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#a855f7', // purple
  '#eab308', // yellow
  '#22c55e', // green
  '#0ea5e9', // sky
  '#e11d48', // rose
];

const toMillisString = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Already millis
  if (/^\d+$/.test(trimmed)) return trimmed;

  const ms = Date.parse(trimmed);
  if (!Number.isNaN(ms)) return String(ms);

  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : String(d.getTime());
};

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
    
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    const apiKey = _ghlCreds.apiKey;
    const locationId = _ghlCreds.locationId;
    console.log(`[ghl-calendar] Using GHL account: ${_ghlCreds.label}`);
    
    if (!apiKey || !locationId) {
      console.error('GHL credentials not configured');
      return new Response(JSON.stringify({ 
        error: 'GoHighLevel credentials not configured',
        success: false 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);

    // Supabase client calls functions with POST; read params from query string OR JSON body
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[ghl-calendar] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[ghl-calendar] Authenticated user: ${userId}`);

    const action = url.searchParams.get('action') || body.action || 'all';
    const calendarId = url.searchParams.get('calendarId') || body.calendarId || null;
    const startTime = url.searchParams.get('startTime') || body.startTime || null;
    const endTime = url.searchParams.get('endTime') || body.endTime || null;

    console.log(`GHL Calendar action: ${action}, calendarId: ${calendarId}`);

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-04-15',
      'Content-Type': 'application/json',
    };

    /**
     * Every GHL call in this file goes through the SHARED limiter now.
     *
     * GoHighLevel rate-limits per TOKEN (~100 requests / 10s), and this
     * function fires up to `CALENDAR_CONCURRENCY` requests at once, on the
     * same token that `ghl-conversations-cron`, the migration workers and the
     * marketing dump are already using. Thirteen raw `fetch` calls here
     * cooperated with none of them: a page load could burst straight through
     * the budget and take the other callers' 429s with it, and nothing here
     * honoured `Retry-After` or backed off at all.
     *
     * `ghlFetchShared` serialises the reservation through Postgres so every
     * isolate and every function share one budget, retries 429/5xx with the
     * vendor's own `Retry-After`, and — since this change — meters the call.
     * `api_usage_log` held ZERO GHL rows before it, so a workspace running on
     * the prime's forwarded GoHighLevel key spent it for free.
     */
    const ghlTokenKey = tokenKeyFor(_ghlCreds.label, apiKey);
    const ghlFetch = (target: string, init: RequestInit = { method: 'GET', headers }) =>
      ghlFetchShared(supabase, ghlTokenKey, target, init, { logTag: `ghl-calendar:${action}` });

    // Fetch calendars
    if (action === 'calendars' || action === 'all') {
      console.log('Fetching calendars...');
      const calendarsResponse = await ghlFetch(`${GHL_API_BASE}/calendars/?locationId=${locationId}`, {
        method: 'GET',
        headers,
      });

      if (!calendarsResponse.ok) {
        const errorText = await calendarsResponse.text();
        console.error('Calendars fetch error:', errorText);
        return new Response(JSON.stringify({ 
          error: 'Failed to fetch calendars',
          details: errorText,
          success: false 
        }), {
          status: calendarsResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const calendarsData = await calendarsResponse.json();
      
      // Add color to each calendar
      const rawCalendars = calendarsData.calendars || [];
      const calendars: GHLCalendar[] = rawCalendars.map((cal: any, index: number) => ({
        ...cal,
        eventColor: cal.eventColor || CALENDAR_COLORS[index % CALENDAR_COLORS.length],
      }));
      
      if (action === 'calendars') {
        return new Response(JSON.stringify({
          success: true,
          calendars,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // For 'all' action, continue to fetch events
      
      // Fetch events - GHL API requires calendarId, so we fetch for each calendar
      console.log('Fetching events...');
      const now = new Date();
      // GHL expects startTime/endTime in millis (string)
      const defaultStartTime = toMillisString(startTime) ?? String(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const defaultEndTime = toMillisString(endTime) ?? String(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      let allEvents: GHLEvent[] = [];
      
      // If calendarId is specified, only fetch for that calendar
      const calendarsToFetch = calendarId 
        ? calendars.filter(c => c.id === calendarId)
        : calendars;

      // GHL requires one request PER CALENDAR, and these are independent of
      // each other — nothing in calendar N's answer affects calendar N+1's
      // request. Awaiting them one at a time made the Calendar page cost the
      // sum of every calendar's latency: measured on the clone 13 Sep 2026,
      // 6.4s average and 10.3s peak across 12 calls, for a page a person is
      // sitting in front of. They overlap now, bounded so a location with
      // many calendars cannot open an unbounded fan of sockets.
      const calendarPages = await mapWithConcurrency(
        calendarsToFetch,
        CALENDAR_CONCURRENCY,
        async (cal) => {
          const eventsUrl = `${GHL_API_BASE}/calendars/events?locationId=${locationId}&calendarId=${cal.id}&startTime=${defaultStartTime}&endTime=${defaultEndTime}`;
          const eventsResponse = await ghlFetch(eventsUrl);
          if (!eventsResponse.ok) {
            throw new Error(`${eventsResponse.status} ${await eventsResponse.text()}`);
          }
          const eventsData = await eventsResponse.json();
          return (eventsData.events || []).map((event: any) => ({ ...event, calendarId: cal.id }));
        },
      );
      // One calendar failing is that calendar's failure. The loop this replaces
      // caught per-iteration and carried on, and the page showing the other
      // calendars beats the page showing none.
      //
      // But a calendar that FAILED and a calendar with no events drew exactly
      // the same thing — an empty column — while the response still said
      // `success: true`. The names of the ones that failed travel now, because
      // a reader cannot otherwise tell a quiet Tuesday from a calendar that
      // was never read.
      const failedCalendars: string[] = [];
      for (const r of calendarPages.results) {
        if (r.error) {
          console.error(`Failed to fetch events for calendar ${r.item.name}: ${r.error}`);
          failedCalendars.push(r.item.name);
        } else if (r.value) {
          allEvents = [...allEvents, ...r.value];
          console.log(`Fetched ${r.value.length} events from calendar: ${r.item.name}`);
        }
      }

      console.log(`Total events fetched: ${allEvents.length}`);

      // Map calendar names and colors to events
      const calendarMap = new Map(calendars.map(c => [c.id, { name: c.name, color: c.eventColor }]));
      // Notes come from this database, not from GHL. Every path that returns
      // events merges them, or the panel shows "No notes" depending on which
      // action happened to fetch the day.
      const storedNotesAll = await loadAppointmentNotes(supabase, allEvents.map((e: any) => e?.id));
      const eventsWithCalendarInfo = allEvents.map(event => {
        const calInfo = calendarMap.get(event.calendarId);
        return {
          ...event,
          calendarName: calInfo?.name || 'Unknown Calendar',
          calendarColor: calInfo?.color || CALENDAR_COLORS[0],
          notes: storedNotesAll[event.id] ?? event.notes ?? '',
        };
      });

      return new Response(JSON.stringify({
        success: true,
        calendars,
        events: eventsWithCalendarInfo,
        failedCalendars,
        dateRange: {
          start: defaultStartTime,
          end: defaultEndTime,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch events only
    if (action === 'events') {
      console.log('Fetching events only...');
      const now = new Date();
      // GHL expects startTime/endTime in millis (string)
      const defaultStartTime = toMillisString(startTime) ?? String(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const defaultEndTime = toMillisString(endTime) ?? String(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      // If caller didn't provide calendarId, fetch calendars and pull events per calendar
      if (!calendarId) {
        const calendarsResponse = await ghlFetch(`${GHL_API_BASE}/calendars/?locationId=${locationId}`, {
          method: 'GET',
          headers,
        });

        if (!calendarsResponse.ok) {
          const errorText = await calendarsResponse.text();
          console.error('Calendars fetch error (events):', errorText);
          return new Response(JSON.stringify({ error: 'Failed to fetch calendars', details: errorText, success: false }), {
            status: calendarsResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const calendarsData = await calendarsResponse.json();
        const rawCalendars = calendarsData.calendars || [];
        const calendars: GHLCalendar[] = rawCalendars.map((cal: any, index: number) => ({
          ...cal,
          eventColor: cal.eventColor || CALENDAR_COLORS[index % CALENDAR_COLORS.length],
        }));

        // Same independent per-calendar fan-out as the `calendars` action
        // above, overlapped for the same reason.
        let allEvents: GHLEvent[] = [];
        const eventPages = await mapWithConcurrency(calendars, CALENDAR_CONCURRENCY, async (cal) => {
          const eventsUrl = `${GHL_API_BASE}/calendars/events?locationId=${locationId}&calendarId=${cal.id}&startTime=${defaultStartTime}&endTime=${defaultEndTime}`;
          const eventsResponse = await ghlFetch(eventsUrl);
          if (!eventsResponse.ok) {
            throw new Error(`${eventsResponse.status} ${await eventsResponse.text()}`);
          }
          const eventsData = await eventsResponse.json();
          return (eventsData.events || []).map((event: any) => ({ ...event, calendarId: cal.id }));
        });
        const failedCalendars: string[] = [];
        for (const r of eventPages.results) {
          if (r.error) {
            console.error(`Failed to fetch events for calendar ${r.item.name} (events): ${r.error}`);
            failedCalendars.push(r.item.name);
          } else if (r.value) {
            allEvents = [...allEvents, ...r.value];
          }
        }

        const calendarMap = new Map(calendars.map(c => [c.id, { name: c.name, color: c.eventColor }]));
        // Notes come from this database, not from GHL — see the helpers at the
        // top of this file. A stored note wins; GHL's own value is the fallback
        // so an appointment created outside this product still shows whatever
        // it carries.
        const storedNotes = await loadAppointmentNotes(supabase, allEvents.map((e: any) => e?.id));
        const eventsWithCalendarInfo = allEvents.map(event => {
          const calInfo = calendarMap.get(event.calendarId);
          return {
            ...event,
            calendarName: calInfo?.name || 'Unknown Calendar',
            calendarColor: calInfo?.color || CALENDAR_COLORS[0],
            notes: storedNotes[event.id] ?? event.notes ?? '',
          };
        });

        return new Response(JSON.stringify({
          success: true,
          events: eventsWithCalendarInfo,
          failedCalendars,
          dateRange: { start: defaultStartTime, end: defaultEndTime },
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // calendarId provided
      const eventsUrl = `${GHL_API_BASE}/calendars/events?locationId=${locationId}&calendarId=${calendarId}&startTime=${defaultStartTime}&endTime=${defaultEndTime}`;
      const eventsResponse = await ghlFetch(eventsUrl);

      if (!eventsResponse.ok) {
        const errorText = await eventsResponse.text();
        console.error('Events fetch error:', errorText);
        return new Response(JSON.stringify({ error: 'Failed to fetch events', details: errorText, success: false }), {
          status: eventsResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const eventsData = await eventsResponse.json();
      const singleCalendarEvents = eventsData.events || [];
      const storedNotesSingle = await loadAppointmentNotes(supabase, singleCalendarEvents.map((e: any) => e?.id));
      return new Response(JSON.stringify({
        success: true,
        events: singleCalendarEvents.map((e: any) => ({
          ...e,
          notes: storedNotesSingle[e?.id] ?? e?.notes ?? '',
        })),
        dateRange: { start: defaultStartTime, end: defaultEndTime },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update/reschedule an event
    if (action === 'update') {
      const { eventId, newStartTime, newEndTime, title, notes, appointmentStatus, overrideAvailability, assignedUserId } = body;

      if (!eventId) {
        return new Response(JSON.stringify({
          error: 'Missing required field: eventId',
          success: false
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Updating event ${eventId}, overrideAvailability: ${!!overrideAvailability}`);

      const updatePayload: Record<string, unknown> = {};
      if (newStartTime) updatePayload.startTime = newStartTime;
      if (newEndTime) updatePayload.endTime = newEndTime;
      if (title !== undefined) updatePayload.title = title;
      if (notes !== undefined) updatePayload.notes = notes;
      // Filed on our side as well; see saveAppointmentNotes.
      await saveAppointmentNotes(supabase, eventId, notes, userId);
      if (appointmentStatus) updatePayload.appointmentStatus = appointmentStatus;
      if (assignedUserId) updatePayload.assignedUserId = assignedUserId;
      // When overrideAvailability is true, tell GHL to skip free-slot validation
      if (overrideAvailability) {
        updatePayload.ignoreFreeSlotValidation = true;
        if (newStartTime) {
          updatePayload.selectedSlot = newStartTime;
          updatePayload.selectedTimezone = 'Australia/Sydney';
        }
      }

      const updateResponse = await ghlFetch(`${GHL_API_BASE}/calendars/events/appointments/${eventId}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('Event update error:', errorText);
        // Parse GHL error message for better user feedback
        let ghlMessage = 'Failed to update event';
        try {
          const ghlError = JSON.parse(errorText);
          const msg = ghlError.message;
          ghlMessage = Array.isArray(msg) ? msg.join(', ') : (msg || ghlMessage);
        } catch { /* use default */ }
        return new Response(JSON.stringify({
          error: ghlMessage,
          details: errorText,
          success: false
        }), {
          status: updateResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const updateData = await updateResponse.json();
      console.log('Event updated successfully');

      return new Response(JSON.stringify({
        success: true,
        event: updateData,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Delete an event
    if (action === 'delete') {
      const { eventId } = body;

      if (!eventId) {
        return new Response(JSON.stringify({
          error: 'Missing required field: eventId',
          success: false
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Deleting event ${eventId} (setting status to cancelled)`);

      // GHL does not support a DELETE endpoint for appointments.
      // The correct approach is to update the appointmentStatus to "cancelled".
      // NOTE: GHL uses "appointmentStatus" (not "status") for this field.
      const deleteResponse = await ghlFetch(`${GHL_API_BASE}/calendars/events/appointments/${eventId}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentStatus: 'cancelled' }),
      });

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text();
        console.error('Event delete/cancel error:', errorText);
        let ghlMessage = 'Failed to delete event';
        try {
          const ghlError = JSON.parse(errorText);
          const msg = ghlError.message;
          ghlMessage = Array.isArray(msg) ? msg.join(', ') : (msg || ghlMessage);
        } catch { /* use default */ }
        return new Response(JSON.stringify({
          error: ghlMessage,
          details: errorText,
          success: false
        }), {
          status: deleteResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('Event cancelled successfully');

      return new Response(JSON.stringify({
        success: true,
        deleted: eventId,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch contact details
    if (action === 'contact') {
      const { contactId } = body;

      if (!contactId) {
        return new Response(JSON.stringify({
          error: 'Missing required field: contactId',
          success: false
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Fetching contact details for: ${contactId}`);

      const contactResponse = await ghlFetch(`${GHL_API_BASE}/contacts/${contactId}`, {
        method: 'GET',
        headers,
      });

      if (!contactResponse.ok) {
        const errorText = await contactResponse.text();
        console.error('Contact fetch error:', errorText);
        return new Response(JSON.stringify({
          error: 'Failed to fetch contact',
          details: errorText,
          success: false
        }), {
          status: contactResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const contactData = await contactResponse.json();
      console.log('Contact fetched successfully');

      return new Response(JSON.stringify({
        success: true,
        contact: contactData.contact || contactData,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Search contacts
    if (action === 'searchContacts') {
      const { query, limit = 10 } = body;

      if (!query) {
        return new Response(JSON.stringify({
          error: 'Missing required field: query',
          success: false
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Searching contacts for: ${query}`);

      const searchResponse = await ghlFetch(`${GHL_API_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(query)}&limit=${limit}`, {
        method: 'GET',
        headers,
      });

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error('Contact search error:', errorText);
        return new Response(JSON.stringify({
          error: 'Failed to search contacts',
          details: errorText,
          success: false
        }), {
          status: searchResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const searchData = await searchResponse.json();
      console.log(`Found ${searchData.contacts?.length || 0} contacts`);

      return new Response(JSON.stringify({
        success: true,
        contacts: searchData.contacts || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch calendar groups
    if (action === 'groups') {
      console.log('Fetching calendar groups...');

      const groupsResponse = await ghlFetch(`${GHL_API_BASE}/calendars/groups?locationId=${locationId}`, {
        method: 'GET',
        headers,
      });

      if (!groupsResponse.ok) {
        const errorText = await groupsResponse.text();
        console.error('Groups fetch error:', errorText);
        return new Response(JSON.stringify({
          error: 'Failed to fetch calendar groups',
          details: errorText,
          success: false
        }), {
          status: groupsResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const groupsData = await groupsResponse.json();
      console.log(`Fetched ${groupsData.groups?.length || 0} calendar groups`);

      return new Response(JSON.stringify({
        success: true,
        groups: groupsData.groups || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Block off time slot
    if (action === 'blockSlot') {
      const { calendarId: targetCalendarId, startTime: blockStart, endTime: blockEnd, title: blockTitle } = body;

      if (!targetCalendarId || !blockStart || !blockEnd) {
        return new Response(JSON.stringify({
          error: 'Missing required fields: calendarId, startTime, endTime',
          success: false
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Blocking slot on calendar ${targetCalendarId}`);

      const blockPayload = {
        calendarId: targetCalendarId,
        locationId,
        startTime: blockStart,
        endTime: blockEnd,
        title: blockTitle || 'Blocked',
        appointmentStatus: 'confirmed',
      };

      const blockResponse = await ghlFetch(`${GHL_API_BASE}/calendars/events/block-slots`, {
        method: 'POST',
        headers,
        body: JSON.stringify(blockPayload),
      });

      if (!blockResponse.ok) {
        const errorText = await blockResponse.text();
        console.error('Block slot error:', errorText);
        return new Response(JSON.stringify({
          error: 'Failed to block slot',
          details: errorText,
          success: false
        }), {
          status: blockResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const blockData = await blockResponse.json();
      console.log('Slot blocked successfully');

      return new Response(JSON.stringify({
        success: true,
        blockedSlot: blockData,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get free slots for a calendar
    if (action === 'freeSlots') {
      const { calendarId: targetCalendarId, startDate, endDate, timezone = 'Australia/Sydney' } = body;

      if (!targetCalendarId || !startDate || !endDate) {
        return new Response(JSON.stringify({
          error: 'Missing required fields: calendarId, startDate, endDate',
          success: false
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Fetching free slots for calendar ${targetCalendarId}`);

      const slotsResponse = await ghlFetch(`${GHL_API_BASE}/calendars/${targetCalendarId}/free-slots?startDate=${startDate}&endDate=${endDate}&timezone=${encodeURIComponent(timezone)}`, {
        method: 'GET',
        headers,
      });

      if (!slotsResponse.ok) {
        const errorText = await slotsResponse.text();
        console.error('Free slots fetch error:', errorText);
        return new Response(JSON.stringify({
          error: 'Failed to fetch free slots',
          details: errorText,
          success: false
        }), {
          status: slotsResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const slotsData = await slotsResponse.json();
      console.log(`Fetched free slots`);

      return new Response(JSON.stringify({
        success: true,
        slots: slotsData,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create a new appointment
    if (action === 'create') {
      const { calendarId: targetCalendarId, title, startTime: appointmentStart, endTime: appointmentEnd, contactId: appointmentContactId, notes, address, assignedUserId, overrideAvailability } = body;

      if (!targetCalendarId || !appointmentStart || !appointmentEnd) {
        return new Response(JSON.stringify({
          error: 'Missing required fields: calendarId, startTime, endTime',
          success: false
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Creating appointment on calendar ${targetCalendarId}: ${title || 'Untitled'}, contactId: ${appointmentContactId || 'none'}, overrideAvailability: ${!!overrideAvailability}`);

      const createPayload: Record<string, unknown> = {
        calendarId: targetCalendarId,
        locationId,
        startTime: appointmentStart,
        endTime: appointmentEnd,
        title: title || 'New Appointment',
      };
      if (appointmentContactId) createPayload.contactId = appointmentContactId;
      if (notes) createPayload.notes = notes;
      if (address) createPayload.address = address;
      if (assignedUserId) createPayload.assignedUserId = assignedUserId;
      // When overrideAvailability is true, tell GHL to skip free-slot validation
      if (overrideAvailability) {
        createPayload.ignoreFreeSlotValidation = true;
        createPayload.selectedSlot = appointmentStart;
        createPayload.selectedTimezone = 'Australia/Sydney';
      }

      console.log('[ghl-calendar] Create payload:', JSON.stringify(createPayload));

      const createResponse = await ghlFetch(`${GHL_API_BASE}/calendars/events/appointments`, {
        method: 'POST',
        headers,
        body: JSON.stringify(createPayload),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('Appointment create error:', errorText);
        // Parse GHL error to extract the actual message
        let ghlMessage = 'Failed to create appointment';
        try {
          const ghlError = JSON.parse(errorText);
          const msg = ghlError.message;
          ghlMessage = Array.isArray(msg) ? msg.join(', ') : (msg || ghlMessage);
        } catch { /* use default */ }
        return new Response(JSON.stringify({
          error: ghlMessage,
          details: errorText,
          success: false
        }), {
          status: createResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const createData = await createResponse.json();
      let createdEvent = createData.appointment || createData;
      console.log('Appointment created successfully:', createData?.id || createData?.appointment?.id);

      /**
       * Read the appointment back, because the create response is not the
       * appointment.
       *
       * For a Zoom calendar, GoHighLevel provisions the meeting and writes the
       * join URL onto the appointment's `address` — AFTER it answers the
       * create. So the response this function used to return carried no
       * address at all, and the browser passed `result.event?.address` to
       * `send-appointment-notification` as `undefined`.
       *
       * The consequence was reported in the 19 Sep 2026 clone audit as "only
       * the client gets the zoom link": the client's confirmation comes from
       * GHL's own sender, which knows the link because it sends later, while
       * the additional contact and the finance partner got our Meeting
       * Invitation with a Type row reading "Zoom Meeting" and no link on it —
       * an invitation to a meeting they cannot join.
       *
       * The read is the fix at the cause: every caller of `create` gets a
       * complete event without having to know how thin GHL's create response
       * is. It NEVER fails the booking — the appointment exists either way,
       * and a merge only ever adds fields the create response did not carry.
       */
      const createdId = createdEvent?.id;
      if (createdId) {
        try {
          const readBack = await ghlFetch(
            `${GHL_API_BASE}/calendars/events/appointments/${createdId}`,
            { method: 'GET', headers },
          );
          if (readBack.ok) {
            const readData = await readBack.json();
            const readEvent = readData?.appointment || readData?.event || readData;
            if (readEvent && typeof readEvent === 'object') {
              // The read wins field by field, and only where it has something:
              // an empty string from the read must not erase a title the
              // create response did carry.
              const merged: Record<string, unknown> = { ...createdEvent };
              for (const [key, value] of Object.entries(readEvent)) {
                if (value !== null && value !== undefined && value !== '') merged[key] = value;
              }
              createdEvent = merged;
              console.log('[ghl-calendar] Appointment re-read; address present:', Boolean(merged.address));
            }
          } else {
            console.warn('[ghl-calendar] Appointment re-read returned', readBack.status);
          }
        } catch (readError) {
          console.warn('[ghl-calendar] Appointment re-read failed:', readError);
        }
      }

      // GHL accepts the field and does not keep it, so the note is filed here.
      // Never fails the booking.
      await saveAppointmentNotes(supabase, createdEvent?.id, notes, userId);

      return new Response(JSON.stringify({
        success: true,
        event: { ...createdEvent, notes: notes ?? createdEvent?.notes ?? '' },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ 
      error: 'Invalid action',
      validActions: ['all', 'calendars', 'events', 'update', 'delete', 'contact', 'searchContacts', 'groups', 'blockSlot', 'freeSlots', 'create'],
      success: false 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in ghl-calendar:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'ghl-calendar'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
