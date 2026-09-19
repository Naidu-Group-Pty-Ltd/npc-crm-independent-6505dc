/**
 * What the calendar can actually say about when this business books.
 *
 * Audit item 20: the Optimize tab showed a "Daily Availability Score" and an
 * "Hourly Performance" bar per hour, and neither could be explained. Both came
 * from a 0–100 number invented in the component — 50 to start with, ±5 for the
 * day of week, ±10 for business hours, ±10 for how full the slot was — averaged
 * across slots and printed as a percentage. A slot with no history at all was
 * given a "historical success" of 50%, so an hour nobody had ever booked
 * scored the same as one with a perfect record.
 *
 * Nothing here invents a number. Every figure is a count of appointments that
 * exist, and a time with no bookings says so rather than scoring half marks.
 */

export interface BookingEventLike {
  startTime?: string | null;
  appointmentStatus?: string | null;
}

export interface SlotFacts {
  /** 0 = Sunday, matching `Date.getDay()`. */
  day: number;
  hour: number;
  booked: number;
  confirmed: number;
  noShow: number;
}

export interface DayFacts {
  day: number;
  booked: number;
  confirmed: number;
  noShow: number;
}

export interface HourFacts {
  hour: number;
  booked: number;
}

export interface BookingPatterns {
  /** Only times that have actually been booked, busiest first. */
  slots: SlotFacts[];
  /** All seven days, Sunday first, so the chart never changes shape. */
  byDay: DayFacts[];
  /** Every hour in the working window, so gaps stay visible as gaps. */
  byHour: HourFacts[];
  /** Appointments counted. Zero means there is nothing to describe. */
  total: number;
  /** The busiest single slot's count, for scaling a bar. */
  busiestSlot: number;
}

const CONFIRMED = new Set(['confirmed', 'showed']);
const NO_SHOW = new Set(['noshow', 'no_show', 'no-show']);

/**
 * Count appointments by weekday and hour.
 *
 * `parse` is injected so this stays free of any date library and reads
 * timestamps exactly as its caller does.
 */
export function summariseBookings(
  events: BookingEventLike[],
  parse: (value: string) => Date | null,
  window: { startHour: number; endHour: number } = { startHour: 8, endHour: 18 },
): BookingPatterns {
  const bySlot = new Map<string, SlotFacts>();
  const byDay: DayFacts[] = Array.from({ length: 7 }, (_, day) => ({
    day,
    booked: 0,
    confirmed: 0,
    noShow: 0,
  }));
  const hours = Array.from(
    { length: Math.max(0, window.endHour - window.startHour) },
    (_, i) => window.startHour + i,
  );
  const byHour = new Map<number, HourFacts>(hours.map((hour) => [hour, { hour, booked: 0 }]));

  let total = 0;

  for (const event of events) {
    if (!event.startTime) continue;
    const at = parse(event.startTime);
    if (!at || Number.isNaN(at.getTime())) continue;

    const day = at.getDay();
    const hour = at.getHours();
    const status = (event.appointmentStatus ?? '').trim().toLowerCase();
    const isConfirmed = CONFIRMED.has(status);
    const isNoShow = NO_SHOW.has(status);

    total += 1;
    byDay[day].booked += 1;
    if (isConfirmed) byDay[day].confirmed += 1;
    if (isNoShow) byDay[day].noShow += 1;

    const hourly = byHour.get(hour);
    if (hourly) hourly.booked += 1;

    const key = `${day}-${hour}`;
    const slot = bySlot.get(key) ?? { day, hour, booked: 0, confirmed: 0, noShow: 0 };
    slot.booked += 1;
    if (isConfirmed) slot.confirmed += 1;
    if (isNoShow) slot.noShow += 1;
    bySlot.set(key, slot);
  }

  const slots = [...bySlot.values()].sort(
    (a, b) => b.booked - a.booked || a.day - b.day || a.hour - b.hour,
  );

  return {
    slots,
    byDay,
    byHour: hours.map((hour) => byHour.get(hour)!),
    total,
    busiestSlot: slots.length > 0 ? slots[0].booked : 0,
  };
}

/**
 * The history behind one time, in words.
 *
 * Returns null where there is none — the caller says "no bookings yet" rather
 * than being handed a number that stands in for an absence.
 */
export function describeSlot(
  facts: { booked: number; confirmed: number; noShow: number } | undefined,
): string | null {
  if (!facts || facts.booked === 0) return null;
  const parts = [`${facts.booked} booked`];
  if (facts.confirmed > 0) parts.push(`${facts.confirmed} confirmed`);
  if (facts.noShow > 0) parts.push(`${facts.noShow} no-show`);
  return parts.join(' · ');
}

/** Look one slot up by weekday and hour. */
export function slotAt(
  patterns: BookingPatterns,
  day: number,
  hour: number,
): SlotFacts | undefined {
  return patterns.slots.find((s) => s.day === day && s.hour === hour);
}
