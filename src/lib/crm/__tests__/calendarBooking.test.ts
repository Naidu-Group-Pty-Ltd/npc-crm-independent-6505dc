/**
 * The rules a native booking is held to. `crm-calendar` answers in the
 * vendor's shapes; these are the checks the vendor used to make for it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALENDAR_WRITABLE_COLUMNS,
  bookingConflict,
  calendarSlug,
  clockLabel,
  fitsAvailability,
  isTimeZone,
  readAppointmentStatus,
  readAvailability,
  readCalendarInput,
  readMembers,
  readTimeRange,
  rowStatusAfter,
  writeRefusal,
} from "../../../../supabase/functions/_shared/crm/calendarBooking.pure";
import { computeFreeSlots } from "../../../../supabase/functions/_shared/crm/calendarProjection.pure";

const SYDNEY = "Australia/Sydney";
// Tuesday 4 March 2025 in Sydney (daylight saving, UTC+11).
const at = (iso: string) => Date.parse(iso);
const TUE_9_TO_5 = [
  { calendar_id: "c", weekday: 2, start_minute: 9 * 60, end_minute: 17 * 60, slot_minutes: 30 },
];

describe("the attendee status the edit form sends", () => {
  it("reads every status the column accepts", () => {
    for (const s of ["confirmed", "showed", "noshow", "cancelled", "invalid"]) {
      expect(readAppointmentStatus(s)).toEqual({ kind: "set", value: s });
    }
  });

  it('reads "Pending" as no answer yet, which the column spells as null', () => {
    // The form offers "Pending" and the CHECK constraint refuses it.
    expect(readAppointmentStatus("pending")).toEqual({ kind: "set", value: null });
    expect(readAppointmentStatus("new")).toEqual({ kind: "set", value: null });
    expect(readAppointmentStatus("")).toEqual({ kind: "set", value: null });
  });

  it("leaves the column alone when the form sends the row's own lifecycle", () => {
    // `setEditStatus(event.appointmentStatus || event.status)` sends "booked"
    // for every appointment with no attendee status; reading it as a value
    // failed every save of every such appointment.
    expect(readAppointmentStatus("booked")).toEqual({ kind: "leave" });
    expect(readAppointmentStatus("blocked")).toEqual({ kind: "leave" });
    expect(readAppointmentStatus(undefined)).toEqual({ kind: "leave" });
  });

  it("reads the spellings a person types for no-show", () => {
    expect(readAppointmentStatus("No Show")).toEqual({ kind: "set", value: "noshow" });
    expect(readAppointmentStatus("no_show")).toEqual({ kind: "set", value: "noshow" });
  });

  it("refuses a word it does not know, naming the ones it does", () => {
    const reading = readAppointmentStatus("rescheduled");
    expect(reading.kind).toBe("refuse");
    if (reading.kind === "refuse") expect(reading.message).toMatch(/confirmed, showed, no show/);
  });
});

describe("cancelling gives the slot back", () => {
  it("cancels the row when the attendee status says cancelled", () => {
    expect(rowStatusAfter("booked", "cancelled")).toBe("cancelled");
  });

  it("re-books a cancelled row given any other status", () => {
    expect(rowStatusAfter("cancelled", "confirmed")).toBe("booked");
    expect(rowStatusAfter("cancelled", null)).toBe("booked");
  });

  it("never re-labels a blocked time", () => {
    expect(rowStatusAfter("blocked", "cancelled")).toBeUndefined();
  });

  it("does not move when nothing about cancellation changed", () => {
    expect(rowStatusAfter("booked", "showed")).toBeUndefined();
    expect(rowStatusAfter("booked", undefined)).toBeUndefined();
  });

  it("a cancelled row frees its slot in the booking list", () => {
    const appointments = [
      { start_time: "2025-03-03T23:00:00.000Z", end_time: "2025-03-03T23:30:00.000Z", status: "cancelled" },
    ];
    const { slots } = computeFreeSlots({
      availability: TUE_9_TO_5,
      appointments,
      startMs: at("2025-03-03T22:00:00.000Z"),
      endMs: at("2025-03-04T00:00:00.000Z"),
      timeZone: SYDNEY,
    });
    expect(slots.map((s) => s.startTime)).toContain("2025-03-03T23:00:00.000Z");
  });
});

describe("a time range", () => {
  it("must end after it starts", () => {
    expect(readTimeRange("2025-03-04T10:00:00Z", "2025-03-04T09:00:00Z")).toMatchObject({ ok: false });
  });

  it("must be two readable times", () => {
    expect(readTimeRange("tomorrow", "2025-03-04T09:00:00Z")).toMatchObject({ ok: false });
    expect(readTimeRange(undefined, undefined)).toMatchObject({ ok: false });
  });

  it("is refused past a day, where a block is the better tool", () => {
    expect(readTimeRange("2025-03-04T00:00:00Z", "2025-03-06T00:00:00Z")).toMatchObject({ ok: false });
  });

  it("reads a valid range", () => {
    expect(readTimeRange("2025-03-04T00:00:00Z", "2025-03-04T01:00:00Z")).toEqual({
      ok: true,
      startMs: at("2025-03-04T00:00:00Z"),
      endMs: at("2025-03-04T01:00:00Z"),
    });
  });
});

describe("whether a booking may take a time", () => {
  // 10:00–10:30 Tuesday in Sydney is 23:00–23:30 UTC on Monday.
  const tenAm = { startMs: at("2025-03-03T23:00:00Z"), endMs: at("2025-03-03T23:30:00Z") };

  it("refuses a clash with another booking", () => {
    const conflict = bookingConflict({
      ...tenAm,
      timeZone: SYDNEY,
      availability: TUE_9_TO_5,
      appointments: [
        { id: "x", start_time: "2025-03-03T23:15:00Z", end_time: "2025-03-03T23:45:00Z", status: "booked" },
      ],
    });
    expect(conflict?.code).toBe("slot_taken");
    expect(conflict?.message).toMatch(/Override availability/);
  });

  it("refuses a clash with a blocked time", () => {
    const conflict = bookingConflict({
      ...tenAm,
      timeZone: SYDNEY,
      availability: [],
      appointments: [
        { id: "b", start_time: "2025-03-03T22:00:00Z", end_time: "2025-03-04T02:00:00Z", status: "blocked" },
      ],
    });
    expect(conflict?.code).toBe("slot_taken");
  });

  it("does not clash with a cancelled booking, or with the booking being moved", () => {
    const appointments = [
      { id: "gone", start_time: "2025-03-03T23:00:00Z", end_time: "2025-03-03T23:30:00Z", status: "cancelled" },
      { id: "self", start_time: "2025-03-03T23:00:00Z", end_time: "2025-03-03T23:30:00Z", status: "booked" },
    ];
    expect(
      bookingConflict({ ...tenAm, timeZone: SYDNEY, availability: TUE_9_TO_5, appointments, excludeId: "self" }),
    ).toBeNull();
  });

  it("allows back-to-back bookings", () => {
    expect(
      bookingConflict({
        ...tenAm,
        timeZone: SYDNEY,
        availability: TUE_9_TO_5,
        appointments: [
          { id: "x", start_time: "2025-03-03T23:30:00Z", end_time: "2025-03-04T00:00:00Z", status: "booked" },
        ],
      }),
    ).toBeNull();
  });

  it("refuses a time outside the calendar's published hours", () => {
    // 6pm Tuesday Sydney.
    const conflict = bookingConflict({
      startMs: at("2025-03-04T07:00:00Z"),
      endMs: at("2025-03-04T07:30:00Z"),
      timeZone: SYDNEY,
      availability: TUE_9_TO_5,
      appointments: [],
    });
    expect(conflict?.code).toBe("outside_availability");
  });

  it("never refuses for hours a calendar has not published", () => {
    // A fresh calendar with no hours would otherwise refuse every booking.
    expect(
      bookingConflict({
        startMs: at("2025-03-04T07:00:00Z"),
        endMs: at("2025-03-04T07:30:00Z"),
        timeZone: SYDNEY,
        availability: [],
        appointments: [],
      }),
    ).toBeNull();
  });

  it("reads hours in the calendar's own zone, across daylight saving", () => {
    // 9:00 Tuesday Sydney is 22:00 UTC in March (UTC+11) and 23:00 UTC in July (UTC+10).
    expect(fitsAvailability(at("2025-03-03T22:00:00Z"), at("2025-03-03T22:30:00Z"), TUE_9_TO_5, SYDNEY)).toBe(true);
    expect(fitsAvailability(at("2025-07-07T23:00:00Z"), at("2025-07-07T23:30:00Z"), TUE_9_TO_5, SYDNEY)).toBe(true);
    expect(fitsAvailability(at("2025-07-07T22:00:00Z"), at("2025-07-07T22:30:00Z"), TUE_9_TO_5, SYDNEY)).toBe(false);
  });

  it("requires the whole booking inside one window", () => {
    // 4:30pm to 5:30pm Tuesday overruns a window closing at 5pm.
    expect(fitsAvailability(at("2025-03-04T05:30:00Z"), at("2025-03-04T06:30:00Z"), TUE_9_TO_5, SYDNEY)).toBe(false);
  });
});

describe("a calendar's settings", () => {
  it("needs a name to be created, and defaults the rest", () => {
    expect(readCalendarInput({}, "create")).toMatchObject({ ok: false });
    expect(readCalendarInput({ name: "  Client   meetings " }, "create")).toEqual({
      ok: true,
      patch: { name: "Client meetings", calendar_type: "event", timezone: SYDNEY },
    });
  });

  it("changes only what an update sends, and refuses an empty one", () => {
    expect(readCalendarInput({ isActive: false }, "update")).toEqual({ ok: true, patch: { is_active: false } });
    expect(readCalendarInput({}, "update")).toMatchObject({ ok: false });
  });

  it("refuses what the table's CHECK would refuse, in words", () => {
    expect(readCalendarInput({ name: "x".repeat(201) }, "create")).toMatchObject({ ok: false });
    expect(readCalendarInput({ name: "A", calendarType: "webinar" }, "create")).toMatchObject({ ok: false });
    expect(readCalendarInput({ eventColor: "blue" }, "update")).toMatchObject({ ok: false });
    expect(readCalendarInput({ timezone: "Mars/Olympus" }, "update")).toMatchObject({ ok: false });
  });

  it("clears a colour or description sent empty", () => {
    expect(readCalendarInput({ eventColor: "", description: " " }, "update")).toEqual({
      ok: true,
      patch: { event_color: null, description: null },
    });
  });

  it("recognises real time zones only", () => {
    expect(isTimeZone("Australia/Perth")).toBe(true);
    expect(isTimeZone("Australia/Nowhere")).toBe(false);
    expect(isTimeZone("'; drop table")).toBe(false);
  });

  it("writes only columns the allowlist names, and the allowlist names every column the reader sets", () => {
    // The function picks its write through CALENDAR_WRITABLE_COLUMNS, so a
    // field the reader learns without the allowlist learning it would be
    // dropped silently. Every field, sent at once, must survive the pick.
    const everything = readCalendarInput(
      {
        name: "Settlements",
        description: "Handover appointments",
        calendarType: "service",
        eventColor: "#1A2B3C",
        timezone: "Australia/Perth",
        isActive: true,
      },
      "update",
    );
    if (!everything.ok) throw new Error(everything.message);
    expect(Object.keys(everything.patch).sort()).toEqual([...CALENDAR_WRITABLE_COLUMNS].sort());
  });

  it("gives each calendar its own address", () => {
    expect(calendarSlug("Client Meetings — Sydney!", "a1b2c3")).toBe("client-meetings-sydney-a1b2c3");
    expect(calendarSlug("!!!", "abc")).toBe("calendar-abc");
    expect(calendarSlug("x".repeat(100), "z").length).toBeLessThanOrEqual(62);
  });
});

describe("a calendar's team", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  it("reads ids or {userId, role}, once each, keeping the higher role", () => {
    expect(readMembers([A, { userId: A, role: "owner" }, { userId: B }])).toEqual({
      ok: true,
      members: [
        { user_id: A, role: "owner" },
        { user_id: B, role: "member" },
      ],
    });
  });

  it("refuses anything that is not a staff id", () => {
    expect(readMembers(["not-a-user"])).toMatchObject({ ok: false });
    expect(readMembers("everyone")).toMatchObject({ ok: false });
  });

  it("allows an empty team", () => {
    expect(readMembers([])).toEqual({ ok: true, members: [] });
  });
});

describe("a calendar's weekly hours", () => {
  it("reads windows and defaults the slot to 30 minutes", () => {
    expect(readAvailability([{ weekday: 1, startMinute: 540, endMinute: 1020 }])).toEqual({
      ok: true,
      rows: [{ weekday: 1, start_minute: 540, end_minute: 1020, slot_minutes: 30 }],
    });
  });

  it("allows a window running to midnight", () => {
    expect(readAvailability([{ weekday: 5, startMinute: 1380, endMinute: 1440 }])).toMatchObject({ ok: true });
  });

  it("refuses a window that ends before it starts, naming the day", () => {
    const reading = readAvailability([{ weekday: 3, startMinute: 600, endMinute: 540 }]);
    expect(reading).toMatchObject({ ok: false });
    if (!reading.ok) expect(reading.message).toMatch(/Wednesday/);
  });

  it("refuses overlapping windows on one day", () => {
    const reading = readAvailability([
      { weekday: 1, startMinute: 540, endMinute: 720 },
      { weekday: 1, startMinute: 700, endMinute: 900 },
    ]);
    expect(reading).toMatchObject({ ok: false });
    if (!reading.ok) expect(reading.message).toMatch(/09:00–12:00 and 11:40–15:00/);
  });

  it("allows the same hours on different days, and back-to-back windows", () => {
    expect(
      readAvailability([
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 720, endMinute: 900 },
        { weekday: 2, startMinute: 540, endMinute: 720 },
      ]),
    ).toMatchObject({ ok: true });
  });

  it("refuses a slot longer than its window", () => {
    expect(readAvailability([{ weekday: 1, startMinute: 540, endMinute: 570, slotMinutes: 60 }])).toMatchObject({
      ok: false,
    });
  });

  it("refuses values the table's CHECK would refuse", () => {
    expect(readAvailability([{ weekday: 7, startMinute: 540, endMinute: 600 }])).toMatchObject({ ok: false });
    expect(readAvailability([{ weekday: 1, startMinute: 9.5, endMinute: 600 }])).toMatchObject({ ok: false });
    expect(readAvailability([{ weekday: 1, startMinute: 540, endMinute: 600, slotMinutes: 2 }])).toMatchObject({
      ok: false,
    });
  });

  it("an empty list is a real answer: no published hours", () => {
    expect(readAvailability([])).toEqual({ ok: true, rows: [] });
  });

  it("labels the clock as people read it", () => {
    expect(clockLabel(0)).toBe("00:00");
    expect(clockLabel(545)).toBe("09:05");
    expect(clockLabel(1440)).toBe("24:00");
  });
});

describe("what a refused write tells the operator", () => {
  it("does not blame the times for a missing calendar or client", () => {
    // Every 23xxx used to read "check the start and end times".
    const refusal = writeRefusal({ code: "23503" }, "appointment");
    expect(refusal.status).toBe(409);
    expect(refusal.message).not.toMatch(/start and end times/);
    expect(refusal.message).toMatch(/calendar or client no longer exists/);
  });

  it("treats a CHECK refusal as the caller's to fix", () => {
    expect(writeRefusal({ code: "23514" }, "appointment").status).toBe(400);
  });

  it("treats anything else as ours, worth retrying", () => {
    expect(writeRefusal({ code: "57014" }, "hours")).toMatchObject({ status: 503, code: "unavailable" });
    expect(writeRefusal(null, "calendar").status).toBe(503);
  });
});

describe("crm-calendar's source keeps its promises", () => {
  const source = readFileSync(
    resolve(__dirname, "../../../../supabase/functions/crm-calendar/index.ts"),
    "utf8",
  );

  it("gates every action it answers on the calendar permission", () => {
    const answered = [...source.matchAll(/action === '([A-Za-z]+)'/g)].map((m) => m[1]);
    const table = source.slice(source.indexOf("const ACTION_PERMISSION"), source.indexOf("};", source.indexOf("const ACTION_PERMISSION")));
    expect(answered.length).toBeGreaterThan(10);
    for (const action of new Set(answered)) {
      expect(table, `${action} is answered but not gated`).toMatch(new RegExp(`\\b${action}:`));
    }
    expect(source).toMatch(/requireModulePermission\(supabase, actor, 'calendar', needed\)/);
  });

  it("reads the reschedule fields the page and the agent send", () => {
    expect(source).toMatch(/body\?\.newStartTime \?\? body\?\.startTime/);
    expect(source).toMatch(/body\?\.newEndTime \?\? body\?\.endTime/);
  });

  it("reads the client the booking form sends as contactId", () => {
    expect(source).toMatch(/body\?\.clientId \?\? body\?\.contactId/);
  });

  it("no longer tells every constraint failure as a mistake in the times", () => {
    expect(source).not.toMatch(/startsWith\('23'\)/);
  });

  it("never hard-deletes a calendar", () => {
    expect(source).not.toMatch(/from\('crm_calendars'\)\s*\.delete\(\)/);
  });
});
