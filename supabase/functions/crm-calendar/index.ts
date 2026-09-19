/**
 * The calendar, served out of this deployment's own Postgres.
 *
 * `ghl-calendar` answers eleven actions straight out of GoHighLevel's API and
 * persists none of it — measured 19 Sep 2026, there is no calendar or
 * appointment table anywhere in this schema. Of the four CRM surfaces this
 * clone had to make independent, three were a substitution and this one was a
 * build.
 *
 * ── The contract is the vendor's, deliberately ──────────────────────────────
 *
 * Same action names, same request bodies, same response keys. `Calendar.tsx` is
 * 2,306 lines and `useGHLCalendar.tsx` declares the objects it works in; making
 * the native provider answer in the vendor's shapes means neither has to
 * change, and a later prime cascade touching either file merges instead of
 * conflicting. `calendarProjection.pure.ts` is the translation and is tested
 * without a database.
 *
 * ── What this function will NOT do ──────────────────────────────────────────
 *
 * It refuses when the deployment's `CRM_PROVIDER` is not `native`. Every clone
 * receives the prime's whole function set, so a GHL deployment can reach this
 * URL on nothing worse than a stale bundle. Answering it would write
 * appointments into tables that deployment's operators never open — a silent
 * second calendar, which is worse than a 409.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { refuseWrongProvider, servingCrmProvider } from '../_shared/crm/crmProvider.ts';
import {
  computeFreeSlots,
  projectAppointment,
  projectCalendar,
  type CrmAppointmentRow,
  type CrmAvailabilityRow,
  type CrmCalendarMemberRow,
  type CrmCalendarRow,
} from '../_shared/crm/calendarProjection.pure.ts';

const CALENDAR_COLUMNS =
  'id, name, description, calendar_type, is_active, slug, event_color, timezone';
const APPOINTMENT_COLUMNS =
  'id, calendar_id, title, start_time, end_time, status, appointment_status, ' +
  'client_id, contact_name, contact_email, contact_phone, notes, address, blocked_reason';

/** Every response carries the provider that served it. See `crmProvider.pure.ts`. */
function ok(body: Record<string, unknown>, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ success: true, provider: servingCrmProvider(), ...body }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'x-crm-provider': servingCrmProvider() },
  });
}

function fail(
  error: string,
  status: number,
  corsHeaders: Record<string, string>,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({ success: false, error, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** A default window, matching what `ghl-calendar` assumes when none is given. */
function defaultWindow(startTime?: string, endTime?: string) {
  const start = startTime ?? new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const end = endTime ?? new Date(Date.now() + 60 * 24 * 3600_000).toISOString();
  return { start, end };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Reject cross-site cookie-authenticated mutations (exact-origin).
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const wrongProvider = refuseWrongProvider('native', corsHeaders);
  if (wrongProvider) return wrongProvider;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json().catch(() => ({}));

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }

    const action: string = body?.action ?? 'all';

    // ── calendars / all ────────────────────────────────────────────────────
    if (action === 'calendars' || action === 'all') {
      const { data: calendarRows, error: calendarError } = await supabase
        .from('crm_calendars')
        .select(CALENDAR_COLUMNS)
        .eq('is_active', true)
        .order('name');
      // A read that FAILED is not a set that is EMPTY. Answering [] here draws
      // an empty calendar page that is indistinguishable from a deployment
      // nobody has configured yet.
      if (calendarError) {
        return fail('Could not read calendars', 503, corsHeaders, { code: 'calendars_unavailable' });
      }

      const { data: memberRows } = await supabase
        .from('crm_calendar_members')
        .select('calendar_id, user_id, role');

      const calendars = (calendarRows ?? []).map((row, i) =>
        projectCalendar(row as CrmCalendarRow, i, (memberRows ?? []) as CrmCalendarMemberRow[]),
      );

      if (action === 'calendars') return ok({ calendars }, corsHeaders);

      const { start, end } = defaultWindow(body?.startTime, body?.endTime);
      let query = supabase
        .from('crm_appointments')
        .select(APPOINTMENT_COLUMNS)
        .gte('start_time', start)
        .lte('start_time', end);
      if (body?.calendarId) query = query.eq('calendar_id', body.calendarId);

      const { data: appointmentRows, error: appointmentError } = await query.order('start_time');
      if (appointmentError) {
        return fail('Could not read appointments', 503, corsHeaders, { code: 'events_unavailable' });
      }

      const byId = new Map(calendars.map((c) => [c.id, c]));
      const events = (appointmentRows ?? []).map((row) =>
        projectAppointment(row as CrmAppointmentRow, byId.get((row as CrmAppointmentRow).calendar_id)),
      );

      return ok(
        {
          calendars,
          events,
          // The native provider reads one table, so there is no per-calendar
          // fan-out to partially fail. Reported as empty rather than omitted,
          // because the page reads the key and an absent key is a TS2339.
          failedCalendars: [],
          dateRange: { start, end },
        },
        corsHeaders,
      );
    }

    // ── events ─────────────────────────────────────────────────────────────
    if (action === 'events') {
      const { start, end } = defaultWindow(body?.startTime, body?.endTime);
      let query = supabase
        .from('crm_appointments')
        .select(APPOINTMENT_COLUMNS)
        .gte('start_time', start)
        .lte('start_time', end);
      if (body?.calendarId) query = query.eq('calendar_id', body.calendarId);

      const { data, error } = await query.order('start_time');
      if (error) return fail('Could not read appointments', 503, corsHeaders, { code: 'events_unavailable' });

      const { data: calendarRows } = await supabase
        .from('crm_calendars')
        .select(CALENDAR_COLUMNS);
      const byId = new Map(
        (calendarRows ?? []).map((row, i) => {
          const projected = projectCalendar(row as CrmCalendarRow, i);
          return [projected.id, projected];
        }),
      );

      return ok(
        {
          events: (data ?? []).map((row) =>
            projectAppointment(row as CrmAppointmentRow, byId.get((row as CrmAppointmentRow).calendar_id)),
          ),
          failedCalendars: [],
          dateRange: { start, end },
        },
        corsHeaders,
      );
    }

    // ── create ─────────────────────────────────────────────────────────────
    if (action === 'create') {
      const { calendarId, title, startTime, endTime } = body ?? {};
      if (!calendarId || !startTime || !endTime) {
        return fail('Missing required field: calendarId, startTime and endTime', 400, corsHeaders);
      }
      const { data, error } = await supabase
        .from('crm_appointments')
        .insert({
          calendar_id: calendarId,
          title: title || 'Appointment',
          start_time: startTime,
          end_time: endTime,
          status: 'booked',
          appointment_status: body?.appointmentStatus ?? 'confirmed',
          client_id: body?.clientId ?? null,
          contact_name: body?.contactName ?? null,
          contact_email: body?.contactEmail ?? null,
          contact_phone: body?.contactPhone ?? null,
          notes: body?.notes ?? null,
          address: body?.address ?? null,
          created_by: userId === 'service_role' ? null : userId,
        })
        .select(APPOINTMENT_COLUMNS)
        .single();

      if (error) {
        // A CHECK constraint refusing an end before a start is the operator's
        // mistake and is told as such; anything else is ours.
        const isConstraint = typeof error.code === 'string' && error.code.startsWith('23');
        return fail(
          isConstraint ? 'That appointment is not valid: check the start and end times.' : 'Could not create the appointment',
          isConstraint ? 400 : 503,
          corsHeaders,
        );
      }

      return ok(
        { event: projectAppointment(data as CrmAppointmentRow), location: data?.address ?? null },
        corsHeaders,
      );
    }

    // ── update (also carries reschedule) ───────────────────────────────────
    if (action === 'update') {
      const eventId = body?.eventId;
      if (!eventId) return fail('Missing required field: eventId', 400, corsHeaders);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body?.startTime !== undefined) patch.start_time = body.startTime;
      if (body?.endTime !== undefined) patch.end_time = body.endTime;
      if (body?.title !== undefined) patch.title = body.title;
      if (body?.notes !== undefined) patch.notes = body.notes;
      if (body?.address !== undefined) patch.address = body.address;
      if (body?.calendarId !== undefined) patch.calendar_id = body.calendarId;
      if (body?.appointmentStatus !== undefined) patch.appointment_status = body.appointmentStatus;

      const { data, error } = await supabase
        .from('crm_appointments')
        .update(patch)
        .eq('id', eventId)
        .select(APPOINTMENT_COLUMNS)
        .maybeSingle();

      if (error) return fail('Could not update the appointment', 503, corsHeaders);
      // A row that is ABSENT is 404 and final; a read that FAILED is 503 and
      // worth retrying. `CASE_TENANT_COLUMN.md` is where that distinction was
      // paid for — twelve handlers reported "not found" about a live record.
      if (!data) return fail('Appointment not found', 404, corsHeaders);

      return ok({ event: projectAppointment(data as CrmAppointmentRow) }, corsHeaders);
    }

    // ── delete ─────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const eventId = body?.eventId;
      if (!eventId) return fail('Missing required field: eventId', 400, corsHeaders);

      const { data, error } = await supabase
        .from('crm_appointments')
        .delete()
        .eq('id', eventId)
        .select('id')
        .maybeSingle();

      if (error) return fail('Could not delete the appointment', 503, corsHeaders);
      if (!data) return fail('Appointment not found', 404, corsHeaders);
      return ok({ deleted: eventId }, corsHeaders);
    }

    // ── blockSlot ──────────────────────────────────────────────────────────
    if (action === 'blockSlot') {
      const { calendarId, startTime, endTime } = body ?? {};
      if (!calendarId || !startTime || !endTime) {
        return fail('Missing required field: calendarId, startTime and endTime', 400, corsHeaders);
      }
      // The column's own CHECK requires a reason on a blocked row, so a caller
      // that sends none gets the default rather than a constraint violation
      // they cannot act on.
      const reason = (body?.title || body?.reason || 'Blocked').toString();
      const { error } = await supabase.from('crm_appointments').insert({
        calendar_id: calendarId,
        title: reason,
        start_time: startTime,
        end_time: endTime,
        status: 'blocked',
        blocked_reason: reason,
        created_by: userId === 'service_role' ? null : userId,
      });
      if (error) return fail('Could not block that slot', 503, corsHeaders);
      return ok({}, corsHeaders);
    }

    // ── freeSlots ──────────────────────────────────────────────────────────
    if (action === 'freeSlots') {
      const calendarId = body?.calendarId;
      if (!calendarId) return fail('Missing required field: calendarId', 400, corsHeaders);

      const { data: calendarRow, error: calendarError } = await supabase
        .from('crm_calendars')
        .select(CALENDAR_COLUMNS)
        .eq('id', calendarId)
        .maybeSingle();
      if (calendarError) return fail('Could not read that calendar', 503, corsHeaders);
      if (!calendarRow) return fail('Calendar not found', 404, corsHeaders);

      const timeZone = (calendarRow as CrmCalendarRow).timezone || 'Australia/Sydney';
      const startMs = Date.parse(body?.startDate ?? new Date().toISOString());
      const endMs = Date.parse(body?.endDate ?? new Date(Date.now() + 14 * 24 * 3600_000).toISOString());
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return fail('startDate and endDate must be a valid range', 400, corsHeaders);
      }

      const [{ data: availability }, { data: appointments }] = await Promise.all([
        supabase
          .from('crm_calendar_availability')
          .select('calendar_id, weekday, start_minute, end_minute, slot_minutes')
          .eq('calendar_id', calendarId),
        supabase
          .from('crm_appointments')
          .select('start_time, end_time, status')
          .eq('calendar_id', calendarId)
          .lte('start_time', new Date(endMs).toISOString())
          .gte('end_time', new Date(startMs).toISOString()),
      ]);

      const result = computeFreeSlots({
        availability: (availability ?? []) as CrmAvailabilityRow[],
        appointments: (appointments ?? []) as Pick<CrmAppointmentRow, 'start_time' | 'end_time' | 'status'>[],
        startMs,
        endMs,
        timeZone,
        now: Date.now(),
      });

      // `slots` keeps the vendor's key so the hook reads it unchanged.
      // `noAvailabilityPublished` is the third state the vendor never had to
      // express and a native deployment does: an empty list here means "nobody
      // has said when this calendar is open", not "fully booked".
      return ok(
        { slots: result.slots, noAvailabilityPublished: result.noAvailabilityPublished },
        corsHeaders,
      );
    }

    // ── groups ─────────────────────────────────────────────────────────────
    if (action === 'groups') {
      // Calendar groups are a GoHighLevel grouping construct. This deployment
      // has no such concept, and that is a real answer rather than a failure —
      // the page renders no grouping control and carries on. It is NOT reported
      // as an error, because an error here would make the page announce a fault
      // on a deployment that is working exactly as designed.
      return ok({ groups: [] }, corsHeaders);
    }

    // ── contact ────────────────────────────────────────────────────────────
    if (action === 'contact') {
      const contactId = body?.contactId;
      if (!contactId) return fail('Missing required field: contactId', 400, corsHeaders);

      const { data, error } = await supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname, primary_email, primary_mobile')
        .eq('id', contactId)
        .maybeSingle();

      if (error) return fail('Could not read that contact', 503, corsHeaders);
      if (!data) return fail('Contact not found', 404, corsHeaders);

      return ok(
        {
          contact: {
            id: data.id,
            firstName: data.primary_first_name,
            lastName: data.primary_surname,
            name: [data.primary_first_name, data.primary_surname].filter(Boolean).join(' '),
            email: data.primary_email ?? undefined,
            phone: data.primary_mobile ?? undefined,
          },
        },
        corsHeaders,
      );
    }

    // ── searchContacts ─────────────────────────────────────────────────────
    if (action === 'searchContacts') {
      const query = typeof body?.query === 'string' ? body.query.trim() : '';
      if (!query) return fail('Missing required field: query', 400, corsHeaders);
      const limit = Math.min(Number(body?.limit) || 10, 50);

      // Every term is escaped into a LIKE pattern rather than interpolated into
      // a PostgREST `or()` string. `SCREENING_EXECUTION.md` records what an
      // interpolated filter cost: a claim predicate that never once parsed, and
      // a test double whose regex agreed with it while only the server did not.
      const safe = query.replace(/[\\%_,()]/g, (c) => `\\${c}`);
      const pattern = `%${safe}%`;

      const { data, error } = await supabase
        .from('clients')
        .select('id, primary_first_name, primary_surname, primary_email, primary_mobile')
        .or(
          [
            `primary_first_name.ilike.${pattern}`,
            `primary_surname.ilike.${pattern}`,
            `primary_email.ilike.${pattern}`,
            `primary_mobile.ilike.${pattern}`,
          ].join(','),
        )
        .limit(limit);

      if (error) return fail('Could not search contacts', 503, corsHeaders);

      return ok(
        {
          contacts: (data ?? []).map((row) => ({
            id: row.id,
            firstName: row.primary_first_name,
            lastName: row.primary_surname,
            name: [row.primary_first_name, row.primary_surname].filter(Boolean).join(' '),
            email: row.primary_email ?? undefined,
            phone: row.primary_mobile ?? undefined,
          })),
        },
        corsHeaders,
      );
    }

    return fail(`Unknown action: ${action}`, 400, corsHeaders);
  } catch (err) {
    return new Response(JSON.stringify(internalError(err, 'crm-calendar')), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
