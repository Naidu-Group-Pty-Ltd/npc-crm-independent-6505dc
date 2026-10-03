/**
 * The rules a native booking is held to, decided without a database.
 *
 * `crm-calendar` answers in GoHighLevel's shapes so `Calendar.tsx` and
 * `useGHLCalendar.tsx` work unchanged. Answering in the vendor's shapes was
 * not enough on its own, because the vendor also ENFORCED things this
 * deployment's tables do not: a slot already taken, a time outside the
 * calendar's hours, a status word its own form sends. Without these rules a
 * native calendar double-booked anyone, refused every edit to an appointment
 * with no attendee status, and kept a cancelled booking holding its slot.
 *
 * Four rules:
 *
 * **The form's words are read, never trusted as columns.** The edit form
 * offers "Pending" and falls back to the row's own `status` ("booked",
 * "blocked") when an appointment has no attendee status, and the column's
 * CHECK accepts neither. Translating here keeps the form identical to the
 * prime's, which is the file a cascade would otherwise revert.
 *
 * **Cancelling gives the slot back.** `computeFreeSlots` frees a slot only for
 * a row whose `status` is `cancelled`, so an attendee status of "cancelled"
 * that left the row "booked" kept the slot taken.
 *
 * **A booking is checked against the calendar, unless the operator says
 * otherwise.** Both booking forms carry an "Override availability" switch,
 * which on the vendor bypassed exactly these two checks. A calendar that
 * publishes no hours has no hours to be outside of, so it is never refused for
 * that, only for a clash.
 *
 * **Setup is validated in full before anything is written.** Availability is
 * replaced as a set, so one bad window refuses the set rather than leaving a
 * calendar half-configured.
 */
import {
  zonedDateParts,
  zonedWallClockToUtc,
  type CrmAvailabilityRow,
} from "./calendarProjection.pure.ts";

export const APPOINTMENT_STATUSES = [
  "confirmed",
  "showed",
  "noshow",
  "cancelled",
  "invalid",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const CALENDAR_TYPES = [
  "event",
  "round_robin",
  "collective",
  "class",
  "service",
] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];

/** The label both booking forms give the switch that bypasses these checks. */
export const OVERRIDE_CONTROL = "Override availability";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

// ── Attendee status ─────────────────────────────────────────────────────────

export type StatusReading =
  | { readonly kind: "set"; readonly value: AppointmentStatus | null }
  | { readonly kind: "leave" }
  | { readonly kind: "refuse"; readonly message: string };

/**
 * What an attendee status sent by a caller means for the column.
 *
 * `undefined` leaves the column alone. "Pending" and "new" are the absence of
 * an answer, which the column spells as null. "booked" and "blocked" are the
 * ROW's lifecycle, which the edit form sends back when an appointment has no
 * attendee status; reading them as an instruction would fail the save of every
 * such appointment, so they leave the column as it is.
 */
export function readAppointmentStatus(raw: unknown): StatusReading {
  if (raw === undefined) return { kind: "leave" };
  if (raw === null) return { kind: "set", value: null };
  if (typeof raw !== "string") {
    return { kind: "refuse", message: "The appointment status must be text." };
  }
  const word = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (word === "" || word === "pending" || word === "new") {
    return { kind: "set", value: null };
  }
  if (word === "booked" || word === "blocked") return { kind: "leave" };
  const match = APPOINTMENT_STATUSES.find((s) => s === word);
  if (match) return { kind: "set", value: match };
  return {
    kind: "refuse",
    message:
      `"${raw.trim().slice(0, 40)}" is not an appointment status. ` +
      "Use confirmed, showed, no show, cancelled or invalid.",
  };
}

/**
 * The row's lifecycle after an attendee status changes, or undefined when it
 * does not move. A blocked slot is never re-labelled: its CHECK ties
 * `blocked` to a reason, and a block is not somebody's booking.
 */
export function rowStatusAfter(
  current: string,
  appointmentStatus: AppointmentStatus | null | undefined,
): "booked" | "cancelled" | undefined {
  if (current === "blocked" || appointmentStatus === undefined) return undefined;
  if (appointmentStatus === "cancelled") {
    return current === "cancelled" ? undefined : "cancelled";
  }
  return current === "cancelled" ? "booked" : undefined;
}

// ── Times ───────────────────────────────────────────────────────────────────

// Every reading below says `message?: undefined` on its success branch. The
// browser build is not strict, and without strictNullChecks a boolean `ok`
// does not narrow, so a refusal's sentence could not otherwise be read there.
export type TimeRange =
  | { readonly ok: true; readonly startMs: number; readonly endMs: number; readonly message?: undefined }
  | { readonly ok: false; readonly message: string };

/** Two instants a caller sent, read as a range that ends after it starts. */
export function readTimeRange(start: unknown, end: unknown): TimeRange {
  const startMs = typeof start === "string" ? Date.parse(start) : NaN;
  const endMs = typeof end === "string" ? Date.parse(end) : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { ok: false, message: "The start and end must both be valid times." };
  }
  if (endMs <= startMs) {
    return { ok: false, message: "The end must be after the start." };
  }
  if (endMs - startMs > 24 * 60 * 60_000) {
    return {
      ok: false,
      message: "An appointment cannot run longer than 24 hours. Block the time instead.",
    };
  }
  return { ok: true, startMs, endMs };
}

// ── Conflicts ───────────────────────────────────────────────────────────────

export type BookingConflict = {
  readonly code: "slot_taken" | "outside_availability";
  readonly message: string;
};

type BusyRow = {
  readonly id: string;
  readonly start_time: string;
  readonly end_time: string;
  readonly status: string;
};

/** True when the range sits wholly inside one published window on its day. */
export function fitsAvailability(
  startMs: number,
  endMs: number,
  availability: readonly CrmAvailabilityRow[],
  timeZone: string,
): boolean {
  const { year, month, day, weekday } = zonedDateParts(startMs, timeZone);
  return availability.some((w) => {
    if (w.weekday !== weekday) return false;
    const opens = zonedWallClockToUtc(year, month, day, w.start_minute, timeZone);
    const closes = zonedWallClockToUtc(year, month, day, w.end_minute, timeZone);
    return opens <= startMs && endMs <= closes;
  });
}

/**
 * Why a booking may not take this range, or null when it may.
 *
 * A clash is read first, because "somebody is already there" is the more
 * useful thing to be told. A cancelled row never clashes: cancelling is the
 * slot coming back. The row being moved never clashes with itself.
 */
export function bookingConflict(input: {
  readonly startMs: number;
  readonly endMs: number;
  readonly timeZone: string;
  readonly availability: readonly CrmAvailabilityRow[];
  readonly appointments: readonly BusyRow[];
  readonly excludeId?: string;
}): BookingConflict | null {
  const clash = input.appointments.some((a) => {
    if (a.status === "cancelled" || a.id === input.excludeId) return false;
    const s = Date.parse(a.start_time);
    const e = Date.parse(a.end_time);
    return Number.isFinite(s) && Number.isFinite(e) && input.startMs < e && input.endMs > s;
  });
  if (clash) {
    return {
      code: "slot_taken",
      message:
        "That time overlaps another booking or blocked time on this calendar. " +
        `Choose a free time, or turn on "${OVERRIDE_CONTROL}" to book it anyway.`,
    };
  }
  if (
    input.availability.length > 0 &&
    !fitsAvailability(input.startMs, input.endMs, input.availability, input.timeZone)
  ) {
    return {
      code: "outside_availability",
      message:
        "That time is outside this calendar's published hours. " +
        `Choose a time inside them, or turn on "${OVERRIDE_CONTROL}" to book it anyway.`,
    };
  }
  return null;
}

// ── Calendar setup ──────────────────────────────────────────────────────────

export type CalendarPatch = {
  name?: string;
  description?: string | null;
  calendar_type?: CalendarType;
  event_color?: string | null;
  timezone?: string;
  is_active?: boolean;
};

/**
 * The `crm_calendars` columns a caller may set, and nothing else. The
 * function picks the write through this set as well as through
 * `readCalendarInput`, so a field added to the reader without being added
 * here is dropped rather than written; a test keeps the two in step.
 */
export const CALENDAR_WRITABLE_COLUMNS: Set<string> = new Set<keyof CalendarPatch>([
  "name",
  "description",
  "calendar_type",
  "event_color",
  "timezone",
  "is_active",
]);

export type CalendarReading =
  | { readonly ok: true; readonly patch: CalendarPatch; readonly message?: undefined }
  | { readonly ok: false; readonly message: string };

/** True for a time zone the runtime can actually format in. */
export function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * A calendar's settings as a caller sent them. On create the name is
 * required; on update only what was sent is changed, and nothing sent is a
 * refusal rather than a write that changes nothing.
 */
export function readCalendarInput(
  raw: Record<string, unknown> | null | undefined,
  mode: "create" | "update",
): CalendarReading {
  const body = raw ?? {};
  const patch: CalendarPatch = {};

  if (body.name !== undefined || mode === "create") {
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (name.length < 1 || name.length > 200) {
      return { ok: false, message: "Give the calendar a name of 1 to 200 characters." };
    }
    patch.name = name;
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      return { ok: false, message: "The description must be text." };
    }
    const description = (body.description ?? "").toString().trim();
    if (description.length > 2000) {
      return { ok: false, message: "Keep the description under 2,000 characters." };
    }
    patch.description = description || null;
  }

  if (body.calendarType !== undefined) {
    const type = CALENDAR_TYPES.find((t) => t === body.calendarType);
    if (!type) {
      return { ok: false, message: "That is not a calendar type this deployment supports." };
    }
    patch.calendar_type = type;
  } else if (mode === "create") {
    patch.calendar_type = "event";
  }

  if (body.eventColor !== undefined) {
    if (body.eventColor === null || body.eventColor === "") {
      patch.event_color = null;
    } else if (typeof body.eventColor === "string" && /^#[0-9a-f]{6}$/i.test(body.eventColor)) {
      patch.event_color = body.eventColor.toLowerCase();
    } else {
      return { ok: false, message: "The colour must be a six-digit hex value with a leading #." };
    }
  }

  if (body.timezone !== undefined || mode === "create") {
    const zone = typeof body.timezone === "string" && body.timezone.trim()
      ? body.timezone.trim()
      : mode === "create" ? "Australia/Sydney" : "";
    if (!isTimeZone(zone)) {
      return { ok: false, message: "That is not a time zone this deployment recognises." };
    }
    patch.timezone = zone;
  }

  if (body.isActive !== undefined) {
    if (mode === "create") {
      return { ok: false, message: "A new calendar is always active." };
    }
    if (typeof body.isActive !== "boolean") {
      return { ok: false, message: "isActive must be true or false." };
    }
    patch.is_active = body.isActive;
  }

  if (mode === "update" && Object.keys(patch).length === 0) {
    return { ok: false, message: "Nothing to change was sent." };
  }
  return { ok: true, patch };
}

/**
 * A slug for a new calendar: its name, made URL-safe, plus a suffix the
 * caller supplies so two calendars with one name cannot collide on the
 * column's unique index.
 */
export function calendarSlug(name: string, suffix: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  const tail = suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return [base || "calendar", tail].filter(Boolean).join("-");
}

// ── Members ─────────────────────────────────────────────────────────────────

export type MemberRow = { readonly user_id: string; readonly role: "owner" | "member" };

export type MembersReading =
  | { readonly ok: true; readonly members: MemberRow[]; readonly message?: undefined }
  | { readonly ok: false; readonly message: string };

/** A calendar's team as a caller sent it: user ids, or `{userId, role}`. */
export function readMembers(raw: unknown): MembersReading {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "Send the team as a list of staff." };
  }
  if (raw.length > 50) {
    return { ok: false, message: "A calendar can have at most 50 team members." };
  }
  const byUser = new Map<string, MemberRow>();
  for (const entry of raw) {
    const userId = typeof entry === "string"
      ? entry
      : entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).userId
        : undefined;
    if (!isUuid(userId)) {
      return { ok: false, message: "Every team member must be a staff account." };
    }
    const roleRaw = entry && typeof entry === "object"
      ? (entry as Record<string, unknown>).role
      : undefined;
    const role = roleRaw === "owner" ? "owner" : "member";
    const key = userId.trim().toLowerCase();
    const prior = byUser.get(key);
    // The same person listed twice is one member, and the higher role stands.
    byUser.set(key, {
      user_id: key,
      role: prior?.role === "owner" ? "owner" : role,
    });
  }
  return { ok: true, members: [...byUser.values()] };
}

// ── Availability ────────────────────────────────────────────────────────────

export type AvailabilityRow = {
  readonly weekday: number;
  readonly start_minute: number;
  readonly end_minute: number;
  readonly slot_minutes: number;
};

export type AvailabilityReading =
  | { readonly ok: true; readonly rows: AvailabilityRow[]; readonly message?: undefined }
  | { readonly ok: false; readonly message: string };

export function clockLabel(minute: number): string {
  if (minute === 1440) return "24:00";
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function intIn(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

/**
 * A calendar's weekly hours as a caller sent them, validated as a set.
 *
 * An empty list is a real answer: the calendar publishes no hours, which
 * `freeSlots` reports as such and which stops bookings being refused as
 * outside them.
 */
export function readAvailability(raw: unknown): AvailabilityReading {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "Send the hours as a list of windows." };
  }
  if (raw.length > 70) {
    return { ok: false, message: "A calendar can publish at most 70 windows a week." };
  }
  const rows: AvailabilityRow[] = [];
  for (const entry of raw) {
    const w = (entry ?? {}) as Record<string, unknown>;
    const weekday = intIn(w.weekday, 0, 6);
    const start = intIn(w.startMinute, 0, 1439);
    const end = intIn(w.endMinute, 1, 1440);
    const slot = w.slotMinutes === undefined ? 30 : intIn(w.slotMinutes, 5, 480);
    if (weekday === null) {
      return { ok: false, message: "Each window needs a day of the week." };
    }
    const day = WEEKDAY_NAMES[weekday];
    if (start === null || end === null) {
      return { ok: false, message: `A ${day} window has a start or end that is not a time of day.` };
    }
    if (end <= start) {
      return {
        ok: false,
        message: `A ${day} window ends at ${clockLabel(end)}, before it starts at ${clockLabel(start)}.`,
      };
    }
    if (slot === null) {
      return { ok: false, message: `A ${day} window's slot length must be 5 to 480 minutes.` };
    }
    if (slot > end - start) {
      return {
        ok: false,
        message:
          `A ${slot}-minute slot does not fit in ${day} ${clockLabel(start)}–${clockLabel(end)}.`,
      };
    }
    rows.push({ weekday, start_minute: start, end_minute: end, slot_minutes: slot });
  }

  rows.sort((a, b) => a.weekday - b.weekday || a.start_minute - b.start_minute);
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const next = rows[i];
    if (prev.weekday === next.weekday && next.start_minute < prev.end_minute) {
      return {
        ok: false,
        message:
          `Two ${WEEKDAY_NAMES[next.weekday]} windows overlap ` +
          `(${clockLabel(prev.start_minute)}–${clockLabel(prev.end_minute)} and ` +
          `${clockLabel(next.start_minute)}–${clockLabel(next.end_minute)}). Merge them into one.`,
      };
    }
  }
  return { ok: true, rows };
}

// ── What a refused write tells the caller ───────────────────────────────────

export type WriteRefusal = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
};

/**
 * A database refusal, told as what the operator can do about it.
 *
 * Only the codes that are the caller's to fix become 4xx. Anything else is
 * ours, answered 503 so a retry is reasonable, and never described as a
 * mistake in the times the operator entered.
 */
export function writeRefusal(
  error: { readonly code?: string | null } | null | undefined,
  subject: "appointment" | "calendar" | "hours" | "team",
): WriteRefusal {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "23503") {
    return {
      status: 409,
      code: "missing_reference",
      message:
        subject === "appointment"
          ? "That calendar or client no longer exists. Refresh the page and try again."
          : "That calendar no longer exists. Refresh the page and try again.",
    };
  }
  if (code === "23514" || code === "23502") {
    const detail: Record<typeof subject, string> = {
      appointment:
        "That appointment is not valid: it needs a title of 1 to 300 characters and an end after its start.",
      calendar: "Those calendar settings are not valid.",
      hours: "Those hours are not valid.",
      team: "That team is not valid.",
    };
    return { status: 400, code: "invalid", message: detail[subject] };
  }
  if (code === "23505") {
    return {
      status: 409,
      code: "duplicate",
      message:
        subject === "calendar"
          ? "A calendar with that address already exists. Try again."
          : "That already exists. Refresh the page and try again.",
    };
  }
  if (code.startsWith("22")) {
    return { status: 400, code: "invalid", message: "One of the values sent could not be read." };
  }
  const nouns: Record<typeof subject, string> = {
    appointment: "the appointment",
    calendar: "the calendar",
    hours: "the calendar's hours",
    team: "the calendar's team",
  };
  return {
    status: 503,
    code: "unavailable",
    message: `Could not save ${nouns[subject]}. Please try again.`,
  };
}
