/**
 * The calendar setup form's arithmetic, kept out of the component so it can be
 * tested without a browser.
 *
 * A form edits hours as "HH:MM" strings, and the server stores minutes since
 * midnight. Two things are easy to get wrong between them: an `<input
 * type="time">` cannot say "24:00", so a window that runs to midnight is
 * entered as an end of 00:00; and the form must refuse what the server would
 * refuse, in the same sentence. The second is why `prepareHours` calls the
 * server's own `readAvailability` rather than a copy of its rules.
 */
import {
  CALENDAR_TYPES,
  clockLabel,
  readAvailability,
  type CalendarType,
} from "../../../supabase/functions/_shared/crm/calendarBooking.pure.ts";

export { CALENDAR_TYPES, clockLabel, type CalendarType };

/** Index = the server's weekday (0 = Sunday). */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The order a working week is read in: Monday first, Sunday last. */
export const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const CALENDAR_TYPE_LABELS: Record<CalendarType, string> = {
  event: "Standard",
  round_robin: "Round robin",
  collective: "Collective",
  class: "Class",
  service: "Service",
};

/** The zones an Australian business books in. Lord Howe keeps its half hour. */
export const AUSTRALIAN_TIME_ZONES = [
  { value: "Australia/Sydney", label: "Sydney, Canberra (AEST/AEDT)" },
  { value: "Australia/Melbourne", label: "Melbourne (AEST/AEDT)" },
  { value: "Australia/Hobart", label: "Hobart (AEST/AEDT)" },
  { value: "Australia/Brisbane", label: "Brisbane (AEST, no daylight saving)" },
  { value: "Australia/Adelaide", label: "Adelaide (ACST/ACDT)" },
  { value: "Australia/Darwin", label: "Darwin (ACST, no daylight saving)" },
  { value: "Australia/Perth", label: "Perth (AWST)" },
  { value: "Australia/Lord_Howe", label: "Lord Howe Island" },
] as const;

/** One window as the form holds it. */
export type HoursDraft = {
  readonly key: string;
  readonly weekday: number;
  readonly start: string;
  readonly end: string;
  readonly slotMinutes: number;
};

/** One window as the server sends and accepts it. */
export type HoursWindow = {
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly slotMinutes: number;
};

/** Minutes since midnight as an `<input type="time">` value. Midnight-end is 00:00. */
export function toClockInput(minute: number): string {
  return minute >= 1440 ? "00:00" : clockLabel(minute);
}

/**
 * An `<input type="time">` value as minutes since midnight, or null when it is
 * not a time. An END of 00:00 means the window runs to midnight.
 */
export function fromClockInput(value: string, role: "start" | "end"): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return role === "end" && total === 0 ? 1440 : total;
}

let draftCounter = 0;
function draftKey(): string {
  draftCounter += 1;
  return `w${draftCounter}`;
}

export function toDrafts(windows: readonly HoursWindow[]): HoursDraft[] {
  return [...windows]
    .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)
    .map((w) => ({
      key: draftKey(),
      weekday: w.weekday,
      start: toClockInput(w.startMinute),
      end: toClockInput(w.endMinute),
      slotMinutes: w.slotMinutes,
    }));
}

export function newDraft(weekday: number, from?: HoursDraft): HoursDraft {
  return {
    key: draftKey(),
    weekday,
    start: from?.start ?? "09:00",
    end: from?.end ?? "17:00",
    slotMinutes: from?.slotMinutes ?? 30,
  };
}

/** Monday to Friday, nine to five, in half-hour slots: the usual first week. */
export function businessHoursPreset(): HoursDraft[] {
  return [1, 2, 3, 4, 5].map((weekday) => newDraft(weekday));
}

export type PreparedHours =
  | { readonly ok: true; readonly windows: HoursWindow[]; readonly message?: undefined }
  | { readonly ok: false; readonly message: string };

/**
 * The form's windows as the server will accept them, or the sentence the
 * server would refuse them with. A blank or unreadable time is named here
 * because the server never sees the string to name it.
 */
export function prepareHours(drafts: readonly HoursDraft[]): PreparedHours {
  const raw: HoursWindow[] = [];
  for (const d of drafts) {
    const day = WEEKDAY_NAMES[d.weekday] ?? "A";
    const startMinute = fromClockInput(d.start, "start");
    const endMinute = fromClockInput(d.end, "end");
    if (startMinute === null || endMinute === null) {
      return { ok: false, message: `A ${day} window needs a start and an end time.` };
    }
    raw.push({ weekday: d.weekday, startMinute, endMinute, slotMinutes: d.slotMinutes });
  }
  const reading = readAvailability(raw);
  if (!reading.ok) return { ok: false, message: reading.message };
  return {
    ok: true,
    windows: reading.rows.map((r) => ({
      weekday: r.weekday,
      startMinute: r.start_minute,
      endMinute: r.end_minute,
      slotMinutes: r.slot_minutes,
    })),
  };
}

/** The days a calendar opens ("Mon, Tue, Wed"), for its row in the list. */
export function summariseHours(windows: readonly HoursWindow[]): string {
  if (windows.length === 0) return "No hours set";
  const days = new Set(windows.map((w) => w.weekday));
  return WEEKDAY_DISPLAY_ORDER.filter((d) => days.has(d))
    .map((d) => WEEKDAY_NAMES[d].slice(0, 3))
    .join(", ");
}
