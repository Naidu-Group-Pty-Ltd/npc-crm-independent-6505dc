/**
 * The native calendar's arithmetic, asserted by execution.
 *
 * Availability is stored as "Tuesdays, 9 to 5" — minutes from midnight in the
 * calendar's own zone — because that is how a person states it. Turning that
 * into an instant is the one piece of this feature that is genuinely easy to
 * get wrong and impossible to eyeball, and Australia/Sydney observes daylight
 * saving, so the same 9am is a different instant in January and July. A fixed
 * +10 books every customer an hour out for half the year; reading the server's
 * zone books them ten hours out all year, because an edge function runs in UTC.
 *
 * Both DST transitions are asserted below, in both directions, against real
 * `Intl` data rather than a table anybody here maintains.
 */
import { describe, expect, it } from "vitest";
import {
  CALENDAR_COLORS,
  computeFreeSlots,
  projectAppointment,
  projectCalendar,
  zonedDateParts,
  zonedWallClockToUtc,
  type CrmAppointmentRow,
  type CrmCalendarRow,
} from "../../../../supabase/functions/_shared/crm/calendarProjection.pure.ts";

const SYD = "Australia/Sydney";

const calendar: CrmCalendarRow = {
  id: "cal-1",
  name: "Sales",
  description: null,
  calendar_type: "event",
  is_active: true,
  slug: null,
  event_color: null,
  timezone: SYD,
};

describe("wall clock to instant, across both DST transitions", () => {
  it("holds AEST (UTC+10) in the southern winter", () => {
    // 2026-07-14 09:00 Sydney = 2026-07-13 23:00 UTC.
    const ts = zonedWallClockToUtc(2026, 7, 14, 9 * 60, SYD);
    expect(new Date(ts).toISOString()).toBe("2026-07-13T23:00:00.000Z");
  });

  it("holds AEDT (UTC+11) in the southern summer", () => {
    // 2026-01-14 09:00 Sydney = 2026-01-13 22:00 UTC.
    const ts = zonedWallClockToUtc(2026, 1, 14, 9 * 60, SYD);
    expect(new Date(ts).toISOString()).toBe("2026-01-13T22:00:00.000Z");
  });

  it("spring forward: the same wall clock is an hour earlier in UTC after the step", () => {
    // Sydney springs forward on the first Sunday in October (2026-10-04).
    const before = zonedWallClockToUtc(2026, 10, 3, 9 * 60, SYD);
    const after = zonedWallClockToUtc(2026, 10, 5, 9 * 60, SYD);
    expect(new Date(before).toISOString()).toBe("2026-10-02T23:00:00.000Z");
    expect(new Date(after).toISOString()).toBe("2026-10-04T22:00:00.000Z");
    // Two calendar days apart, but 47 hours — which is the whole point.
    expect(after - before).toBe(47 * 60 * 60 * 1000);
  });

  it("autumn back: 48 hours becomes 49", () => {
    // Sydney falls back on the first Sunday in April (2026-04-05).
    const before = zonedWallClockToUtc(2026, 4, 4, 9 * 60, SYD);
    const after = zonedWallClockToUtc(2026, 4, 6, 9 * 60, SYD);
    expect(after - before).toBe(49 * 60 * 60 * 1000);
  });

  it("reads the calendar date and weekday in the zone, not in UTC", () => {
    // 2026-07-13T23:30Z is already Tuesday the 14th in Sydney.
    const parts = zonedDateParts(Date.parse("2026-07-13T23:30:00Z"), SYD);
    expect(parts).toMatchObject({ year: 2026, month: 7, day: 14, weekday: 2 });
  });
});

describe("free slots", () => {
  const tuesday9to11 = {
    calendar_id: "cal-1",
    weekday: 2,
    start_minute: 9 * 60,
    end_minute: 11 * 60,
    slot_minutes: 60,
  };
  // Tue 14 Jul 2026, 00:00 -> 23:59 Sydney.
  const startMs = Date.parse("2026-07-13T14:00:00Z");
  const endMs = Date.parse("2026-07-14T14:00:00Z");

  it("lays the window out in the calendar zone", () => {
    const { slots, noAvailabilityPublished } = computeFreeSlots({
      availability: [tuesday9to11],
      appointments: [],
      startMs,
      endMs,
      timeZone: SYD,
    });
    expect(noAvailabilityPublished).toBe(false);
    expect(slots.map((s) => s.startTime)).toEqual([
      "2026-07-13T23:00:00.000Z", // 09:00 Sydney
      "2026-07-14T00:00:00.000Z", // 10:00 Sydney
    ]);
  });

  it("a booking removes its slot", () => {
    const { slots } = computeFreeSlots({
      availability: [tuesday9to11],
      appointments: [
        {
          start_time: "2026-07-13T23:00:00.000Z",
          end_time: "2026-07-14T00:00:00.000Z",
          status: "booked",
        },
      ],
      startMs,
      endMs,
      timeZone: SYD,
    });
    expect(slots.map((s) => s.startTime)).toEqual(["2026-07-14T00:00:00.000Z"]);
  });

  it("a BLOCKED slot removes its slot too — that is what blocking is for", () => {
    const { slots } = computeFreeSlots({
      availability: [tuesday9to11],
      appointments: [
        {
          start_time: "2026-07-13T23:00:00.000Z",
          end_time: "2026-07-14T00:00:00.000Z",
          status: "blocked",
        },
      ],
      startMs,
      endMs,
      timeZone: SYD,
    });
    expect(slots).toHaveLength(1);
  });

  it("a CANCELLED appointment gives the slot back", () => {
    const { slots } = computeFreeSlots({
      availability: [tuesday9to11],
      appointments: [
        {
          start_time: "2026-07-13T23:00:00.000Z",
          end_time: "2026-07-14T00:00:00.000Z",
          status: "cancelled",
        },
      ],
      startMs,
      endMs,
      timeZone: SYD,
    });
    expect(slots).toHaveLength(2);
  });

  it("a partial overlap still removes the slot", () => {
    // 09:30-09:45 Sydney collides with the 09:00 slot and nothing else.
    const { slots } = computeFreeSlots({
      availability: [tuesday9to11],
      appointments: [
        {
          start_time: "2026-07-13T23:30:00.000Z",
          end_time: "2026-07-13T23:45:00.000Z",
          status: "booked",
        },
      ],
      startMs,
      endMs,
      timeZone: SYD,
    });
    expect(slots.map((s) => s.startTime)).toEqual(["2026-07-14T00:00:00.000Z"]);
  });

  it("an appointment that merely touches a boundary does not remove it", () => {
    // 08:00-09:00 Sydney ends exactly as the 09:00 slot begins.
    const { slots } = computeFreeSlots({
      availability: [tuesday9to11],
      appointments: [
        {
          start_time: "2026-07-13T22:00:00.000Z",
          end_time: "2026-07-13T23:00:00.000Z",
          status: "booked",
        },
      ],
      startMs,
      endMs,
      timeZone: SYD,
    });
    expect(slots).toHaveLength(2);
  });

  it("never offers a time already past", () => {
    const { slots } = computeFreeSlots({
      availability: [tuesday9to11],
      appointments: [],
      startMs,
      endMs,
      timeZone: SYD,
      now: Date.parse("2026-07-13T23:30:00Z"), // 09:30 Sydney
    });
    expect(slots.map((s) => s.startTime)).toEqual(["2026-07-14T00:00:00.000Z"]);
  });

  it("a window that does not divide evenly does not emit a short final slot", () => {
    const { slots } = computeFreeSlots({
      availability: [{ ...tuesday9to11, end_minute: 10 * 60 + 30 }],
      appointments: [],
      startMs,
      endMs,
      timeZone: SYD,
    });
    // 09:00-10:00 fits; 10:00-11:00 would run past the 10:30 close.
    expect(slots).toHaveLength(1);
  });

  it('no published availability is its own answer, not "fully booked"', () => {
    const { slots, noAvailabilityPublished } = computeFreeSlots({
      availability: [],
      appointments: [],
      startMs,
      endMs,
      timeZone: SYD,
    });
    expect(slots).toEqual([]);
    expect(noAvailabilityPublished).toBe(true);
  });

  it("offers no slot twice when the walk revisits a wall clock", () => {
    // The whole first week of April 2026 spans the autumn-back transition.
    const { slots } = computeFreeSlots({
      availability: [tuesday9to11],
      appointments: [],
      startMs: Date.parse("2026-03-30T00:00:00Z"),
      endMs: Date.parse("2026-04-12T00:00:00Z"),
      timeZone: SYD,
    });
    expect(new Set(slots.map((s) => s.startTime)).size).toBe(slots.length);
  });
});

describe("projection onto the shapes the page already renders", () => {
  it("gives a calendar with no colour one from the shared palette", () => {
    expect(projectCalendar(calendar, 0).eventColor).toBe(CALENDAR_COLORS[0]);
    expect(projectCalendar(calendar, 9).eventColor).toBe(CALENDAR_COLORS[1]);
    expect(
      projectCalendar({ ...calendar, event_color: "#abc" }, 0).eventColor,
    ).toBe("#abc");
  });

  it("carries a calendar’s own team, and nobody else’s", () => {
    const projected = projectCalendar(calendar, 0, [
      { calendar_id: "cal-1", user_id: "u1", role: "owner" },
      { calendar_id: "cal-2", user_id: "u2", role: "member" },
    ]);
    expect(projected.teamMembers).toEqual([{ userId: "u1" }]);
  });

  const appointment: CrmAppointmentRow = {
    id: "a1",
    calendar_id: "cal-1",
    title: "Discovery call",
    start_time: "2026-07-13T23:00:00.000Z",
    end_time: "2026-07-14T00:00:00.000Z",
    status: "booked",
    appointment_status: "confirmed",
    client_id: "client-1",
    contact_name: "A",
    contact_email: null,
    contact_phone: null,
    notes: "bring the file",
    address: null,
    blocked_reason: null,
  };

  it("keeps the lifecycle and the attendance apart", () => {
    const e = projectAppointment(appointment, {
      name: "Sales",
      eventColor: "#abc",
    });
    expect(e.status).toBe("booked");
    expect(e.appointmentStatus).toBe("confirmed");
    expect(e.calendarName).toBe("Sales");
    expect(e.contactId).toBe("client-1");
  });

  it("draws a blocked slot as what it is, never as a nameless box", () => {
    const e = projectAppointment({
      ...appointment,
      status: "blocked",
      title: "",
      blocked_reason: "Annual leave",
    });
    expect(e.title).toBe("Annual leave");
  });

  it("omits an absent field rather than sending an empty one", () => {
    const e = projectAppointment({
      ...appointment,
      notes: null,
      address: null,
      client_id: null,
    });
    expect(e.notes).toBeUndefined();
    expect(e.address).toBeUndefined();
    expect(e.contactId).toBeUndefined();
  });
});
