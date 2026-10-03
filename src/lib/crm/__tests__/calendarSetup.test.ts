/**
 * The calendar setup panel: the form's arithmetic, and that the page can find
 * the panel at all.
 *
 * The second matters more than it looks. `Calendar.tsx` reaches the panel
 * through `import.meta.glob`, which answers an empty record for a missing
 * file without failing anything, so renaming or moving the panel would take
 * the only way to make a calendar off the page while the build, the lint and
 * every other test stayed green.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  businessHoursPreset,
  fromClockInput,
  newDraft,
  prepareHours,
  summariseHours,
  toClockInput,
  toDrafts,
  type HoursDraft,
} from "../calendarSetup.pure";

const ROOT = resolve(__dirname, "../../../..");

function draft(weekday: number, start: string, end: string, slotMinutes = 30): HoursDraft {
  return { ...newDraft(weekday), start, end, slotMinutes };
}

describe("times as a form holds them", () => {
  it("reads a start and an end", () => {
    expect(fromClockInput("09:00", "start")).toBe(540);
    expect(fromClockInput("17:30", "end")).toBe(1050);
  });

  it("reads an end of 00:00 as midnight, because a time input cannot say 24:00", () => {
    expect(fromClockInput("00:00", "end")).toBe(1440);
    expect(fromClockInput("00:00", "start")).toBe(0);
  });

  it("accepts the seconds some browsers add", () => {
    expect(fromClockInput("09:00:00", "start")).toBe(540);
  });

  it.each(["", "9", "25:00", "09:60", "nine"])("refuses %j", (value) => {
    expect(fromClockInput(value, "start")).toBeNull();
  });

  it("writes midnight back as 00:00 so it round-trips", () => {
    expect(toClockInput(1440)).toBe("00:00");
    expect(fromClockInput(toClockInput(1440), "end")).toBe(1440);
    expect(toClockInput(545)).toBe("09:05");
  });
});

describe("the hours the server stored, opened for editing", () => {
  it("lists them by day and time, with a key each", () => {
    const drafts = toDrafts([
      { weekday: 2, startMinute: 780, endMinute: 1020, slotMinutes: 30 },
      { weekday: 1, startMinute: 540, endMinute: 1440, slotMinutes: 60 },
      { weekday: 2, startMinute: 540, endMinute: 720, slotMinutes: 30 },
    ]);
    expect(drafts.map((d) => [d.weekday, d.start, d.end])).toEqual([
      [1, "09:00", "00:00"],
      [2, "09:00", "12:00"],
      [2, "13:00", "17:00"],
    ]);
    expect(new Set(drafts.map((d) => d.key)).size).toBe(3);
  });

  it("round-trips through the server's own rules unchanged", () => {
    const stored = [
      { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 },
      { weekday: 6, startMinute: 600, endMinute: 1440, slotMinutes: 45 },
    ];
    const prepared = prepareHours(toDrafts(stored));
    expect(prepared).toEqual({ ok: true, windows: stored });
  });
});

describe("hours checked before they are sent", () => {
  it("offers a working week the server accepts", () => {
    const prepared = prepareHours(businessHoursPreset());
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.windows.map((w) => w.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(prepared.windows.every((w) => w.startMinute === 540 && w.endMinute === 1020)).toBe(true);
  });

  it("names a blank time, which the server never sees to name", () => {
    const prepared = prepareHours([draft(3, "", "17:00")]);
    expect(prepared).toEqual({ ok: false, message: "A Wednesday window needs a start and an end time." });
  });

  it("refuses a window that closes before it opens, in the server's words", () => {
    const prepared = prepareHours([draft(1, "17:00", "09:00")]);
    if (prepared.ok) throw new Error("expected a refusal");
    expect(prepared.message).toMatch(/Monday window ends at 09:00, before it starts at 17:00/);
  });

  it("refuses overlapping windows on one day", () => {
    const prepared = prepareHours([draft(2, "09:00", "13:00"), draft(2, "12:00", "17:00")]);
    if (prepared.ok) throw new Error("expected a refusal");
    expect(prepared.message).toMatch(/Two Tuesday windows overlap/);
  });

  it("refuses a slot longer than its window", () => {
    const prepared = prepareHours([draft(4, "09:00", "09:30", 60)]);
    if (prepared.ok) throw new Error("expected a refusal");
    expect(prepared.message).toMatch(/60-minute slot does not fit/);
  });

  it("sends an empty week, which is how a calendar stops publishing hours", () => {
    expect(prepareHours([])).toEqual({ ok: true, windows: [] });
  });

  it("allows a window that runs to midnight", () => {
    const prepared = prepareHours([draft(5, "18:00", "00:00", 60)]);
    expect(prepared).toEqual({
      ok: true,
      windows: [{ weekday: 5, startMinute: 1080, endMinute: 1440, slotMinutes: 60 }],
    });
  });
});

describe("a calendar's row in the list", () => {
  it("names its open days, Monday first", () => {
    expect(
      summariseHours([
        { weekday: 0, startMinute: 600, endMinute: 900, slotMinutes: 30 },
        { weekday: 1, startMinute: 540, endMinute: 1020, slotMinutes: 30 },
        { weekday: 1, startMinute: 1080, endMinute: 1200, slotMinutes: 30 },
      ]),
    ).toBe("Mon, Sun");
  });

  it("says so when there are none", () => {
    expect(summariseHours([])).toBe("No hours set");
  });
});

describe("the page finds the panel", () => {
  const page = readFileSync(resolve(ROOT, "src/pages/Calendar.tsx"), "utf8");

  it("names, through its glob, a file this line carries", () => {
    // The type argument nests angle brackets, so the call is matched up to its
    // first string rather than parsed.
    const globbed = [
      ...page.matchAll(/import\.meta\.glob[\s\S]{0,200}?\(\s*'([^']+CalendarSetup\.tsx)'/g),
    ].map((m) => m[1]);
    expect(globbed).toHaveLength(1);
    expect(existsSync(resolve(ROOT, "src/pages", globbed[0]))).toBe(true);
  });

  it("is reached only through the glob, so the prime still builds without it", () => {
    expect(page).not.toMatch(/from\s+['"][^'"]*CalendarSetup['"]/);
    expect(page).not.toMatch(/import\(\s*['"][^'"]*CalendarSetup/);
  });

  it("draws it only for somebody who may change the calendar", () => {
    expect(page).toMatch(/CalendarSetup && canEditCalendar &&/);
  });

  it("exports the panel as the default the glob loads", () => {
    const panel = readFileSync(resolve(ROOT, "src/components/calendar/native/CalendarSetup.tsx"), "utf8");
    expect(panel).toMatch(/export default function CalendarSetup\(/);
  });
});
