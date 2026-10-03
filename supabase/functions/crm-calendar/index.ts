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
 *
 * ── Who may do what ─────────────────────────────────────────────────────────
 *
 * A signed-in session is not thereby somebody who may book. Every action is
 * gated on the `calendar` module permission the Calendar page itself reads
 * (`useModulePermissions('calendar')`): reading needs view, and booking or
 * setting a calendar up needs edit. A client's own appointments tab is also
 * readable with view on `client_management`, because that tab lives on the
 * client's page. Internal calls (the dashboard agent, signed with the internal
 * edge secret) pass, as they do on every function behind `requireModulePermission`.
 *
 * ── Setting a calendar up ───────────────────────────────────────────────────
 *
 * The vendor owned calendar setup and this deployment's tables had no writer:
 * nothing created a calendar, named its team or published its hours, so a
 * fresh deployment had nothing to book into. `listCalendarSettings`,
 * `createCalendar`, `updateCalendar`, `setCalendarMembers` and
 * `setAvailability` are that writer. The rules they and the booking actions
 * are held to live in `calendarBooking.pure.ts`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { requireModulePermission, type ModulePerm } from '../_shared/authz.ts';
import { pickAllowed } from '../_shared/wp09Guards.ts';
import { refuseWrongProvider, servingCrmProvider } from '../_shared/crm/crmProvider.ts';
import {
  CALENDAR_WRITABLE_COLUMNS,
  bookingConflict,
  calendarSlug,
  isUuid,
  readAppointmentStatus,
  readAvailability,
  readCalendarInput,
  readMembers,
  readTimeRange,
  rowStatusAfter,
  writeRefusal,
  type WriteRefusal,
} from '../_shared/crm/calendarBooking.pure.ts';
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

function refused(refusal: WriteRefusal, corsHeaders: Record<string, string>): Response {
  return fail(refusal.message, refusal.status, corsHeaders, { code: refusal.code });
}

// deno-lint-ignore no-explicit-any
type Db = any;

type BookingTarget =
  | {
      ok: true;
      calendar: ReturnType<typeof projectCalendar>;
      timeZone: string;
      availability: CrmAvailabilityRow[];
      appointments: { id: string; start_time: string; end_time: string; status: string }[];
    }
  | { ok: false; status: number; message: string };

/**
 * The calendar a booking would land in, with what it would be checked against:
 * its published hours and anything already on it across the range. A calendar
 * that does not exist is a 404 named as such, not a foreign-key violation, and
 * a calendar somebody switched off takes no new bookings.
 */
async function loadBookingTarget(
  supabase: Db,
  calendarId: string,
  startMs: number,
  endMs: number,
): Promise<BookingTarget> {
  const { data: calendarRow, error: calendarError } = await supabase
    .from('crm_calendars')
    .select(CALENDAR_COLUMNS)
    .eq('id', calendarId)
    .maybeSingle();
  if (calendarError) {
    return { ok: false, status: 503, message: 'Could not read that calendar. Please try again.' };
  }
  if (!calendarRow) return { ok: false, status: 404, message: 'That calendar no longer exists.' };
  const row = calendarRow as CrmCalendarRow;
  if (!row.is_active) {
    return {
      ok: false,
      status: 409,
      message: 'That calendar has been switched off. Turn it back on in Manage calendars to book into it.',
    };
  }

  const [hours, busy] = await Promise.all([
    supabase
      .from('crm_calendar_availability')
      .select('calendar_id, weekday, start_minute, end_minute, slot_minutes')
      .eq('calendar_id', calendarId),
    supabase
      .from('crm_appointments')
      .select('id, start_time, end_time, status')
      .eq('calendar_id', calendarId)
      .neq('status', 'cancelled')
      .lt('start_time', new Date(endMs).toISOString())
      .gt('end_time', new Date(startMs).toISOString())
      .limit(50),
  ]);
  // Checking against a read that failed would wave a double-booking through.
  if (hours.error || busy.error) {
    return { ok: false, status: 503, message: 'Could not check that time is free. Please try again.' };
  }
  return {
    ok: true,
    calendar: projectCalendar(row, 0),
    timeZone: row.timezone || 'Australia/Sydney',
    availability: (hours.data ?? []) as CrmAvailabilityRow[],
    appointments: busy.data ?? [],
  };
}

/** The permission each action needs on the `calendar` module. */
const ACTION_PERMISSION: Record<string, ModulePerm> = {
  all: 'can_view',
  calendars: 'can_view',
  events: 'can_view',
  clientAppointments: 'can_view',
  freeSlots: 'can_view',
  groups: 'can_view',
  contact: 'can_view',
  searchContacts: 'can_view',
  create: 'can_edit',
  update: 'can_edit',
  delete: 'can_edit',
  blockSlot: 'can_edit',
  listCalendarSettings: 'can_edit',
  createCalendar: 'can_edit',
  updateCalendar: 'can_edit',
  setCalendarMembers: 'can_edit',
  setAvailability: 'can_edit',
};

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

    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Authentication required', corsHeaders);
    }

    const action: string = body?.action ?? 'all';

    // An unknown action is answered as one below; only a known one is gated,
    // so a typo is told as a typo rather than as a permission it does not need.
    const needed = ACTION_PERMISSION[action];
    if (needed) {
      const actor = { userId, authMethod };
      let perm = await requireModulePermission(supabase, actor, 'calendar', needed);
      if (!perm.ok && action === 'clientAppointments') {
        perm = await requireModulePermission(supabase, actor, 'client_management', 'can_view');
      }
      if (!perm.ok) {
        return fail(
          needed === 'can_view'
            ? 'You do not have access to the calendar.'
            : 'You can view the calendar but not change it.',
          403,
          corsHeaders,
          { code: perm.reason_code ?? 'forbidden' },
        );
      }
    }
    const actorId = isUuid(userId) ? userId : null;

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
      const events = (appointmentRows ?? []).map((row) => {
        const appointment = row as unknown as CrmAppointmentRow;
        return projectAppointment(appointment, byId.get(appointment.calendar_id));
      });

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
          events: (data ?? []).map((row) => {
            const appointment = row as unknown as CrmAppointmentRow;
            return projectAppointment(appointment, byId.get(appointment.calendar_id));
          }),
          failedCalendars: [],
          dateRange: { start, end },
        },
        corsHeaders,
      );
    }

    // ── clientAppointments ─────────────────────────────────────────────────
    // One client's appointments, newest first. GoHighLevel answered this by
    // contact id (`ghl-calendar-proxy` → getContactAppointments); here the
    // appointment carries the client's own id, so no vendor id is involved.
    if (action === 'clientAppointments') {
      const clientId = body?.clientId;
      if (!clientId || typeof clientId !== 'string') {
        return fail('Missing required field: clientId', 400, corsHeaders);
      }
      const { data, error } = await supabase
        .from('crm_appointments')
        .select(APPOINTMENT_COLUMNS)
        .eq('client_id', clientId)
        .order('start_time', { ascending: false })
        .limit(200);
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
          events: (data ?? []).map((row) => {
            const appointment = row as unknown as CrmAppointmentRow;
            return projectAppointment(appointment, byId.get(appointment.calendar_id));
          }),
        },
        corsHeaders,
      );
    }

    // ── create ─────────────────────────────────────────────────────────────
    if (action === 'create') {
      const calendarId = body?.calendarId;
      if (!isUuid(calendarId)) return fail('Choose a calendar to book into.', 400, corsHeaders);
      const range = readTimeRange(body?.startTime, body?.endTime);
      if (!range.ok) return fail(range.message, 400, corsHeaders);
      const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Appointment';
      if (title.length > 300) return fail('Keep the title under 300 characters.', 400, corsHeaders);
      const status = readAppointmentStatus(body?.appointmentStatus ?? 'confirmed');
      if (status.kind === 'refuse') return fail(status.message, 400, corsHeaders);

      const target = await loadBookingTarget(supabase, calendarId, range.startMs, range.endMs);
      if (!target.ok) return fail(target.message, target.status, corsHeaders);
      if (!body?.overrideAvailability) {
        const conflict = bookingConflict({
          startMs: range.startMs,
          endMs: range.endMs,
          timeZone: target.timeZone,
          availability: target.availability,
          appointments: target.appointments,
        });
        if (conflict) return fail(conflict.message, 409, corsHeaders, { code: conflict.code });
      }

      // The page's form sends the client as `contactId` (the vendor's word);
      // the dashboard agent sends `clientId`. Both name a row in `clients`.
      const clientId = body?.clientId ?? body?.contactId ?? null;
      let client: { name: string | null; email: string | null; phone: string | null } | null = null;
      if (clientId !== null && clientId !== '') {
        if (!isUuid(clientId)) return fail('That client could not be read.', 400, corsHeaders);
        const { data: row, error: clientError } = await supabase
          .from('clients')
          .select('id, primary_first_name, primary_surname, primary_email, primary_mobile')
          .eq('id', clientId)
          .maybeSingle();
        if (clientError) return fail('Could not read that client. Please try again.', 503, corsHeaders);
        if (!row) return fail('That client no longer exists. Refresh the page and try again.', 409, corsHeaders);
        client = {
          name: [row.primary_first_name, row.primary_surname].filter(Boolean).join(' ') || null,
          email: row.primary_email ?? null,
          phone: row.primary_mobile ?? null,
        };
      }

      const { data, error } = await supabase
        .from('crm_appointments')
        .insert({
          calendar_id: calendarId,
          title,
          start_time: new Date(range.startMs).toISOString(),
          end_time: new Date(range.endMs).toISOString(),
          status: status.kind === 'set' && status.value === 'cancelled' ? 'cancelled' : 'booked',
          appointment_status: status.kind === 'set' ? status.value : 'confirmed',
          client_id: client ? clientId : null,
          contact_name: body?.contactName ?? client?.name ?? null,
          contact_email: body?.contactEmail ?? client?.email ?? null,
          contact_phone: body?.contactPhone ?? client?.phone ?? null,
          notes: body?.notes ?? null,
          address: body?.address ?? null,
          created_by: actorId,
        })
        .select(APPOINTMENT_COLUMNS)
        .single();

      if (error) return refused(writeRefusal(error, 'appointment'), corsHeaders);

      const created = data as unknown as CrmAppointmentRow;
      return ok(
        {
          event: projectAppointment(created, target.calendar),
          location: created?.address ?? null,
        },
        corsHeaders,
      );
    }

    // ── update (also carries reschedule) ───────────────────────────────────
    if (action === 'update') {
      const eventId = body?.eventId;
      if (!isUuid(eventId)) return fail('Missing required field: eventId', 400, corsHeaders);

      const { data: currentRow, error: readError } = await supabase
        .from('crm_appointments')
        .select('id, calendar_id, start_time, end_time, status')
        .eq('id', eventId)
        .maybeSingle();
      if (readError) return fail('Could not read the appointment. Please try again.', 503, corsHeaders);
      // A row that is ABSENT is 404 and final; a read that FAILED is 503 and
      // worth retrying. `CASE_TENANT_COLUMN.md` is where that distinction was
      // paid for — twelve handlers reported "not found" about a live record.
      if (!currentRow) return fail('Appointment not found', 404, corsHeaders);
      const current = currentRow as { calendar_id: string; start_time: string; end_time: string; status: string };
      const isBlock = current.status === 'blocked';

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

      // A reschedule arrives as `newStartTime`/`newEndTime` from both the page
      // and the dashboard agent; `startTime`/`endTime` is accepted as well.
      // Reading only the second pair is how a reschedule reported success and
      // moved nothing.
      const startRaw = body?.newStartTime ?? body?.startTime;
      const endRaw = body?.newEndTime ?? body?.endTime;
      const targetCalendarId = body?.calendarId ?? current.calendar_id;
      if (body?.calendarId !== undefined && !isUuid(body.calendarId)) {
        return fail('That calendar could not be read.', 400, corsHeaders);
      }
      const moving =
        startRaw !== undefined || endRaw !== undefined || targetCalendarId !== current.calendar_id;
      if (moving) {
        const range = readTimeRange(startRaw ?? current.start_time, endRaw ?? current.end_time);
        if (!range.ok) return fail(range.message, 400, corsHeaders);
        patch.start_time = new Date(range.startMs).toISOString();
        patch.end_time = new Date(range.endMs).toISOString();
        if (targetCalendarId !== current.calendar_id) patch.calendar_id = targetCalendarId;

        // A blocked time may sit over anything; that is what blocking is for.
        if (!isBlock) {
          const target = await loadBookingTarget(supabase, targetCalendarId, range.startMs, range.endMs);
          if (!target.ok) return fail(target.message, target.status, corsHeaders);
          if (!body?.overrideAvailability) {
            const conflict = bookingConflict({
              startMs: range.startMs,
              endMs: range.endMs,
              timeZone: target.timeZone,
              availability: target.availability,
              appointments: target.appointments,
              excludeId: eventId,
            });
            if (conflict) return fail(conflict.message, 409, corsHeaders, { code: conflict.code });
          }
        }
      }

      if (body?.title !== undefined) {
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title || title.length > 300) {
          return fail('Give the appointment a title of 1 to 300 characters.', 400, corsHeaders);
        }
        patch.title = title;
        // A block is drawn by its reason, so renaming it renames the reason.
        if (isBlock) patch.blocked_reason = title;
      }
      if (body?.notes !== undefined) patch.notes = body.notes;
      if (body?.address !== undefined) patch.address = body.address;

      const status = readAppointmentStatus(body?.appointmentStatus);
      if (status.kind === 'refuse') return fail(status.message, 400, corsHeaders);
      if (status.kind === 'set') {
        if (isBlock && status.value !== null) {
          return fail('A blocked time has no attendee. Delete it to free the time.', 400, corsHeaders);
        }
        if (!isBlock) {
          patch.appointment_status = status.value;
          const rowStatus = rowStatusAfter(current.status, status.value);
          if (rowStatus) patch.status = rowStatus;
        }
      }

      const { data, error } = await supabase
        .from('crm_appointments')
        .update(patch)
        .eq('id', eventId)
        .select(APPOINTMENT_COLUMNS)
        .maybeSingle();

      if (error) return refused(writeRefusal(error, 'appointment'), corsHeaders);
      if (!data) return fail('Appointment not found', 404, corsHeaders);

      return ok({ event: projectAppointment(data as unknown as CrmAppointmentRow) }, corsHeaders);
    }

    // ── delete ─────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const eventId = body?.eventId;
      if (!isUuid(eventId)) return fail('Missing required field: eventId', 400, corsHeaders);

      const { data, error } = await supabase
        .from('crm_appointments')
        .delete()
        .eq('id', eventId)
        .select('id')
        .maybeSingle();

      if (error) return fail('Could not delete the appointment. Please try again.', 503, corsHeaders);
      if (!data) return fail('Appointment not found', 404, corsHeaders);
      return ok({ deleted: eventId }, corsHeaders);
    }

    // ── blockSlot ──────────────────────────────────────────────────────────
    if (action === 'blockSlot') {
      const calendarId = body?.calendarId;
      if (!isUuid(calendarId)) return fail('Choose a calendar to block time on.', 400, corsHeaders);
      const range = readTimeRange(body?.startTime, body?.endTime);
      if (!range.ok) return fail(range.message, 400, corsHeaders);
      // The column's own CHECK requires a reason on a blocked row, so a caller
      // that sends none gets the default rather than a constraint violation
      // they cannot act on.
      const reason = (body?.title || body?.reason || 'Blocked').toString().trim().slice(0, 300) || 'Blocked';
      const { error } = await supabase.from('crm_appointments').insert({
        calendar_id: calendarId,
        title: reason,
        start_time: new Date(range.startMs).toISOString(),
        end_time: new Date(range.endMs).toISOString(),
        status: 'blocked',
        blocked_reason: reason,
        created_by: actorId,
      });
      if (error) return refused(writeRefusal(error, 'appointment'), corsHeaders);
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
      const safe = query.replace(/[\\%_,()]/g, (c: string) => `\\${c}`);
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

    // ── listCalendarSettings ───────────────────────────────────────────────
    // Every calendar, switched off or not, with its team and weekly hours,
    // and the staff a team can be chosen from: what the setup dialog draws.
    if (action === 'listCalendarSettings') {
      const [calendars, members, hours, staff] = await Promise.all([
        supabase
          .from('crm_calendars')
          .select(CALENDAR_COLUMNS)
          .order('is_active', { ascending: false })
          .order('name'),
        supabase.from('crm_calendar_members').select('calendar_id, user_id, role'),
        supabase
          .from('crm_calendar_availability')
          .select('calendar_id, weekday, start_minute, end_minute, slot_minutes')
          .order('weekday')
          .order('start_minute'),
        supabase
          .from('custom_users')
          .select('id, first_name, last_name, username, email')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('first_name'),
      ]);
      if (calendars.error || members.error || hours.error || staff.error) {
        return fail('Could not read the calendar settings. Please try again.', 503, corsHeaders, {
          code: 'settings_unavailable',
        });
      }
      const memberRows = (members.data ?? []) as CrmCalendarMemberRow[];
      const hourRows = (hours.data ?? []) as CrmAvailabilityRow[];
      return ok(
        {
          calendars: ((calendars.data ?? []) as CrmCalendarRow[]).map((row, i) => ({
            ...projectCalendar(row, i, memberRows),
            timezone: row.timezone,
            eventColor: row.event_color ?? undefined,
            members: memberRows
              .filter((m) => m.calendar_id === row.id)
              .map((m) => ({ userId: m.user_id, role: m.role })),
            availability: hourRows
              .filter((h) => h.calendar_id === row.id)
              .map((h) => ({
                weekday: h.weekday,
                startMinute: h.start_minute,
                endMinute: h.end_minute,
                slotMinutes: h.slot_minutes,
              })),
          })),
          staff: (staff.data ?? []).map((u: Record<string, string | null>) => ({
            id: u.id,
            name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.email,
            email: u.email,
          })),
        },
        corsHeaders,
      );
    }

    // ── createCalendar ─────────────────────────────────────────────────────
    if (action === 'createCalendar') {
      const reading = readCalendarInput(body, 'create');
      if (!reading.ok) return fail(reading.message, 400, corsHeaders);
      const slug = calendarSlug(reading.patch.name ?? 'calendar', crypto.randomUUID().slice(0, 6));
      const { data, error } = await supabase
        .from('crm_calendars')
        .insert({ ...pickAllowed(reading.patch, CALENDAR_WRITABLE_COLUMNS), slug, created_by: actorId })
        .select(CALENDAR_COLUMNS)
        .single();
      if (error) return refused(writeRefusal(error, 'calendar'), corsHeaders);

      // Whoever sets a calendar up is on its team, so it is never created with
      // nobody behind it. A failure here is reported, not hidden: the calendar
      // exists and its team can be set again.
      let teamSaved = true;
      if (actorId) {
        const { error: memberError } = await supabase
          .from('crm_calendar_members')
          .insert({ calendar_id: (data as CrmCalendarRow).id, user_id: actorId, role: 'owner' });
        teamSaved = !memberError;
      }
      const calendar = data as CrmCalendarRow;
      return ok(
        {
          calendar: projectCalendar(
            calendar,
            0,
            teamSaved && actorId ? [{ calendar_id: calendar.id, user_id: actorId, role: 'owner' }] : [],
          ),
          teamSaved,
        },
        corsHeaders,
      );
    }

    // ── updateCalendar ─────────────────────────────────────────────────────
    // Renames, recolours, re-zones, or switches a calendar off. There is no
    // hard delete: a calendar carries its appointments, and deleting it would
    // cascade them away. Switched off, it leaves the booking list and keeps
    // its history.
    if (action === 'updateCalendar') {
      const calendarId = body?.calendarId;
      if (!isUuid(calendarId)) return fail('Missing required field: calendarId', 400, corsHeaders);
      const reading = readCalendarInput(body, 'update');
      if (!reading.ok) return fail(reading.message, 400, corsHeaders);
      const { data, error } = await supabase
        .from('crm_calendars')
        .update({ ...pickAllowed(reading.patch, CALENDAR_WRITABLE_COLUMNS), updated_at: new Date().toISOString() })
        .eq('id', calendarId)
        .select(CALENDAR_COLUMNS)
        .maybeSingle();
      if (error) return refused(writeRefusal(error, 'calendar'), corsHeaders);
      if (!data) return fail('That calendar no longer exists.', 404, corsHeaders);
      return ok({ calendar: projectCalendar(data as CrmCalendarRow, 0) }, corsHeaders);
    }

    // ── setCalendarMembers ─────────────────────────────────────────────────
    // Replaces a calendar's team. Only active staff accounts may join, so a
    // removed or mistyped account cannot be put on a calendar. The new team
    // is written before the departed are removed, so a failure part-way
    // leaves too many members rather than none.
    if (action === 'setCalendarMembers') {
      const calendarId = body?.calendarId;
      if (!isUuid(calendarId)) return fail('Missing required field: calendarId', 400, corsHeaders);
      const reading = readMembers(body?.members);
      if (!reading.ok) return fail(reading.message, 400, corsHeaders);

      const { data: calendarRow, error: calendarError } = await supabase
        .from('crm_calendars')
        .select('id')
        .eq('id', calendarId)
        .maybeSingle();
      if (calendarError) return fail('Could not read that calendar. Please try again.', 503, corsHeaders);
      if (!calendarRow) return fail('That calendar no longer exists.', 404, corsHeaders);

      const ids = reading.members.map((m) => m.user_id);
      if (ids.length > 0) {
        const { data: found, error: staffError } = await supabase
          .from('custom_users')
          .select('id')
          .in('id', ids)
          .eq('is_active', true)
          .is('deleted_at', null);
        if (staffError) return fail('Could not check those staff accounts. Please try again.', 503, corsHeaders);
        const known = new Set((found ?? []).map((u: { id: string }) => u.id.toLowerCase()));
        if (ids.some((id) => !known.has(id))) {
          return fail('One of those people is not an active staff account.', 400, corsHeaders);
        }
        const { error: upsertError } = await supabase
          .from('crm_calendar_members')
          .upsert(
            reading.members.map((m) => ({ calendar_id: calendarId, user_id: m.user_id, role: m.role })),
            { onConflict: 'calendar_id,user_id' },
          );
        if (upsertError) return refused(writeRefusal(upsertError, 'team'), corsHeaders);
      }

      const { data: existing, error: existingError } = await supabase
        .from('crm_calendar_members')
        .select('id, user_id')
        .eq('calendar_id', calendarId);
      if (existingError) return fail("Could not read the calendar's team. Please try again.", 503, corsHeaders);
      const keep = new Set(ids);
      const departed = (existing ?? [])
        .filter((m: { user_id: string }) => !keep.has(m.user_id.toLowerCase()))
        .map((m: { id: string }) => m.id);
      if (departed.length > 0) {
        const { error: deleteError } = await supabase
          .from('crm_calendar_members')
          .delete()
          .in('id', departed);
        if (deleteError) return refused(writeRefusal(deleteError, 'team'), corsHeaders);
      }
      return ok({ members: reading.members.map((m) => ({ userId: m.user_id, role: m.role })) }, corsHeaders);
    }

    // ── setAvailability ────────────────────────────────────────────────────
    // Replaces a calendar's weekly hours as a set. The new windows are written
    // before the old ones are removed, and the old ones are removed by id, so
    // a failure leaves the previous hours standing rather than none. Sending
    // an empty list is how a calendar stops publishing hours.
    if (action === 'setAvailability') {
      const calendarId = body?.calendarId;
      if (!isUuid(calendarId)) return fail('Missing required field: calendarId', 400, corsHeaders);
      const reading = readAvailability(body?.availability);
      if (!reading.ok) return fail(reading.message, 400, corsHeaders);

      const { data: calendarRow, error: calendarError } = await supabase
        .from('crm_calendars')
        .select('id')
        .eq('id', calendarId)
        .maybeSingle();
      if (calendarError) return fail('Could not read that calendar. Please try again.', 503, corsHeaders);
      if (!calendarRow) return fail('That calendar no longer exists.', 404, corsHeaders);

      const { data: previous, error: previousError } = await supabase
        .from('crm_calendar_availability')
        .select('id')
        .eq('calendar_id', calendarId);
      if (previousError) return fail("Could not read the calendar's hours. Please try again.", 503, corsHeaders);

      let insertedIds: string[] = [];
      if (reading.rows.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from('crm_calendar_availability')
          .insert(reading.rows.map((r) => ({ ...r, calendar_id: calendarId })))
          .select('id');
        if (insertError) return refused(writeRefusal(insertError, 'hours'), corsHeaders);
        insertedIds = (inserted ?? []).map((r: { id: string }) => r.id);
      }

      const oldIds = (previous ?? []).map((r: { id: string }) => r.id);
      if (oldIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('crm_calendar_availability')
          .delete()
          .in('id', oldIds);
        if (deleteError) {
          // Put the calendar back as it was rather than leave both sets.
          if (insertedIds.length > 0) {
            await supabase.from('crm_calendar_availability').delete().in('id', insertedIds);
          }
          return refused(writeRefusal(deleteError, 'hours'), corsHeaders);
        }
      }

      return ok(
        {
          availability: reading.rows.map((r) => ({
            weekday: r.weekday,
            startMinute: r.start_minute,
            endMinute: r.end_minute,
            slotMinutes: r.slot_minutes,
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
