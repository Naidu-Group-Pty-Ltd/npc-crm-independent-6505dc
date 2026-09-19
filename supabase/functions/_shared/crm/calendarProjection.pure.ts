/**
 * Native calendar rows, projected onto the shapes the Calendar page already
 * renders.
 *
 * `Calendar.tsx` is 2,306 lines and `useGHLCalendar.tsx` declares the objects it
 * works in — `GHLCalendar`, `GHLEvent`, `GHLFreeSlot`. The whole value of the
 * provider switch is that neither has to change, so a native row has to arrive
 * looking like the vendor's did. This module is that translation, and it is
 * pure so the shape can be asserted without a database.
 *
 * The names keep their `GHL` prefix on the wire deliberately. Renaming the
 * interface would touch every one of those 2,306 lines for no behavioural gain,
 * and a rename is exactly the kind of diff that makes a later prime cascade
 * conflict on a file this clone did not need to change.
 */

export type CrmCalendarRow = {
  id: string;
  name: string;
  description: string | null;
  calendar_type: string;
  is_active: boolean;
  slug: string | null;
  event_color: string | null;
  timezone: string;
};

export type CrmCalendarMemberRow = {
  calendar_id: string;
  user_id: string;
  role: string;
};

export type CrmAppointmentRow = {
  id: string;
  calendar_id: string;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  appointment_status: string | null;
  client_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  address: string | null;
  blocked_reason: string | null;
};

export type CrmAvailabilityRow = {
  calendar_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  slot_minutes: number;
};

/** The vendor-shaped calendar the page renders. */
export type ProjectedCalendar = {
  id: string;
  name: string;
  description?: string;
  calendarType: string;
  isActive: boolean;
  teamMembers: { userId: string }[];
  slug?: string;
  eventColor?: string;
};

/** The vendor-shaped event the page renders. */
export type ProjectedEvent = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  calendarId: string;
  calendarName?: string;
  calendarColor?: string;
  status: string;
  appointmentStatus?: string;
  contactId?: string;
  notes?: string;
  address?: string;
};

export type ProjectedSlot = { startTime: string; endTime: string };

/**
 * The palette a calendar with no colour of its own falls back to.
 *
 * Mirrors `ghl-calendar`'s CALENDAR_COLORS so the two providers do not draw the
 * same calendar in different colours if a deployment is ever switched back.
 */
export const CALENDAR_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#ef4444",
  "#6366f1",
];

export function projectCalendar(
  row: CrmCalendarRow,
  index: number,
  members: CrmCalendarMemberRow[] = [],
): ProjectedCalendar {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    calendarType: row.calendar_type,
    isActive: row.is_active,
    teamMembers: members
      .filter((m) => m.calendar_id === row.id)
      .map((m) => ({ userId: m.user_id })),
    slug: row.slug ?? undefined,
    eventColor:
      row.event_color ?? CALENDAR_COLORS[index % CALENDAR_COLORS.length],
  };
}

export function projectAppointment(
  row: CrmAppointmentRow,
  calendar?: { name: string; eventColor?: string },
): ProjectedEvent {
  return {
    id: row.id,
    // A blocked slot is drawn as what it is. It has no customer and no title
    // worth borrowing, and labelling it with an empty string is how a calendar
    // comes to show a nameless box nobody can explain.
    title:
      row.status === "blocked" ? (row.blocked_reason ?? "Blocked") : row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    calendarId: row.calendar_id,
    calendarName: calendar?.name,
    calendarColor: calendar?.eventColor,
    status: row.status,
    appointmentStatus: row.appointment_status ?? undefined,
    contactId: row.client_id ?? undefined,
    notes: row.notes ?? undefined,
    address: row.address ?? undefined,
  };
}

// ── Time zones ──────────────────────────────────────────────────────────────
//
// Availability is stored as minutes from midnight IN THE CALENDAR'S OWN ZONE,
// because that is how a person states it: "Tuesdays, 9 to 5". Turning that into
// an instant is not `new Date(y, m, d, h)` — that reads the SERVER's zone, and
// an edge function runs in UTC. Nor is it a fixed +10/+11: Australia/Sydney
// observes daylight saving, so the same "9am Tuesday" is a different instant in
// January and July, and a calendar that ignores it books people an hour out for
// half the year.

/** The zone's offset from UTC, in ms, at a given instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const at: Record<string, string> = {};
  for (const p of parts) at[p.type] = p.value;
  const asIfUtc = Date.UTC(
    Number(at.year),
    Number(at.month) - 1,
    Number(at.day),
    Number(at.hour) % 24,
    Number(at.minute),
    Number(at.second),
  );
  return asIfUtc - utcMs;
}

/**
 * The UTC instant of a wall-clock time in `timeZone`.
 *
 * Two passes, because the offset depends on the instant we are trying to find.
 * The first guess is corrected by the offset AT that guess; where the guess
 * landed on the far side of a DST transition the second read disagrees, and the
 * correction is redone. This is the standard resolution and it is why the
 * spring-forward and autumn-back cases are both asserted in the tests.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string,
): number {
  const guess = Date.UTC(
    year,
    month - 1,
    day,
    Math.floor(minutes / 60),
    minutes % 60,
  );
  const first = zoneOffsetMs(guess, timeZone);
  let ts = guess - first;
  const second = zoneOffsetMs(ts, timeZone);
  if (second !== first) ts = guess - second;
  return ts;
}

/** The calendar date, in `timeZone`, that an instant falls on. */
export function zonedDateParts(
  utcMs: number,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const at: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) at[p.type] = p.value;
  const WEEKDAYS: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(at.year),
    month: Number(at.month),
    day: Number(at.day),
    weekday: WEEKDAYS[at.weekday] ?? 0,
  };
}

export type FreeSlotsResult = {
  slots: ProjectedSlot[];
  /**
   * True when this calendar publishes no availability at all.
   *
   * An empty `slots` array means two completely different things — "fully
   * booked" and "nobody has said when this calendar is open" — and a booking UI
   * that cannot tell them apart shows "no times available" to a customer whose
   * real problem is that an operator never filled the roster in. The vendor
   * answered this question for us; a native deployment has to answer it itself,
   * and the honest answer has three states rather than two.
   */
  noAvailabilityPublished: boolean;
};

/**
 * Free slots between two instants.
 *
 * Walks the range a day at a time in the calendar's own zone, lays each day's
 * availability windows over it, and removes every slot that overlaps an
 * appointment. A `blocked` row removes a slot exactly as a `booked` one does —
 * that is what blocking is for — while a `cancelled` one does not, because a
 * cancellation is the slot coming back.
 */
export function computeFreeSlots(input: {
  availability: CrmAvailabilityRow[];
  appointments: Pick<CrmAppointmentRow, "start_time" | "end_time" | "status">[];
  startMs: number;
  endMs: number;
  timeZone: string;
  now?: number;
}): FreeSlotsResult {
  const { availability, appointments, startMs, endMs, timeZone } = input;
  if (availability.length === 0) {
    return { slots: [], noAvailabilityPublished: true };
  }

  const busy = appointments
    .filter((a) => a.status !== "cancelled")
    .map((a) => ({
      start: Date.parse(a.start_time),
      end: Date.parse(a.end_time),
    }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));

  const notBefore = input.now ?? -Infinity;
  const slots: ProjectedSlot[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Step by calendar day in the zone. Start a day early and end a day late so a
  // window that straddles midnight-UTC is not clipped by the walk itself.
  for (
    let cursor = startMs - DAY_MS;
    cursor <= endMs + DAY_MS;
    cursor += DAY_MS
  ) {
    const { year, month, day, weekday } = zonedDateParts(cursor, timeZone);
    for (const window of availability) {
      if (window.weekday !== weekday) continue;
      const step = window.slot_minutes;
      for (
        let m = window.start_minute;
        m + step <= window.end_minute;
        m += step
      ) {
        const slotStart = zonedWallClockToUtc(year, month, day, m, timeZone);
        const slotEnd = slotStart + step * 60_000;
        if (slotStart < startMs || slotEnd > endMs) continue;
        if (slotStart < notBefore) continue;
        const overlaps = busy.some(
          (b) => slotStart < b.end && slotEnd > b.start,
        );
        if (overlaps) continue;
        slots.push({
          startTime: new Date(slotStart).toISOString(),
          endTime: new Date(slotEnd).toISOString(),
        });
      }
    }
  }

  // The day-by-day walk can visit the same wall-clock slot twice where a zone
  // steps backward; a booking list must never offer one twice.
  const seen = new Set<string>();
  const unique = slots.filter((s) => {
    if (seen.has(s.startTime)) return false;
    seen.add(s.startTime);
    return true;
  });
  unique.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return { slots: unique, noAvailabilityPublished: false };
}
