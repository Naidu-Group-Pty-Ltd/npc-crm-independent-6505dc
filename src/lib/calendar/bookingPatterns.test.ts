/**
 * Audit item 20: the Optimize tab printed a "Daily Availability Score" and an
 * "Hourly Performance" percentage that nobody could explain, because both came
 * from a 0-100 number invented in the component. A slot with no history at all
 * was assigned a "historical success" of 50%, so an hour nobody had ever booked
 * scored the same as one with a perfect record.
 *
 * These pin the replacement: every figure is a count of appointments that
 * exist, and an absence reads as an absence.
 */
import { describe, expect, it } from 'vitest';

import {
  describeSlot,
  slotAt,
  summariseBookings,
} from './bookingPatterns.pure';

const parse = (value: string): Date | null => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Monday 31 Aug 2026 is a Monday; 2 Sep is a Wednesday.
const events = [
  { startTime: '2026-08-31T09:00:00', appointmentStatus: 'confirmed' },
  { startTime: '2026-08-31T09:30:00', appointmentStatus: 'showed' },
  { startTime: '2026-08-31T14:00:00', appointmentStatus: 'noshow' },
  { startTime: '2026-09-02T14:00:00', appointmentStatus: 'confirmed' },
  { startTime: '2026-09-02T14:15:00', appointmentStatus: 'cancelled' },
];

describe('summariseBookings', () => {
  it('counts what happened, by weekday and hour', () => {
    const p = summariseBookings(events, parse);
    expect(p.total).toBe(5);

    const monday9 = slotAt(p, 1, 9);
    expect(monday9).toMatchObject({ booked: 2, confirmed: 2, noShow: 0 });

    const wednesday14 = slotAt(p, 3, 14);
    expect(wednesday14).toMatchObject({ booked: 2, confirmed: 1, noShow: 0 });
  });

  it('invents nothing for a time that was never booked', () => {
    const p = summariseBookings(events, parse);
    // The old code scored an untried hour at 50%. There is no entry at all now.
    expect(slotAt(p, 5, 11)).toBeUndefined();
    expect(describeSlot(slotAt(p, 5, 11))).toBeNull();
  });

  it('keeps every weekday and hour so a gap stays visible', () => {
    const p = summariseBookings(events, parse);
    expect(p.byDay).toHaveLength(7);
    expect(p.byDay[0]).toMatchObject({ day: 0, booked: 0 });
    expect(p.byHour.map((h) => h.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('orders by how often a time is actually booked', () => {
    const p = summariseBookings(events, parse);
    expect(p.slots[0].booked).toBe(2);
    expect(p.busiestSlot).toBe(2);
  });

  it('counts a no-show separately from a cancellation', () => {
    const p = summariseBookings(events, parse);
    expect(p.byDay[1]).toMatchObject({ booked: 3, confirmed: 2, noShow: 1 });
    // The cancelled Wednesday booking is counted as booked, not confirmed.
    expect(p.byDay[3]).toMatchObject({ booked: 2, confirmed: 1, noShow: 0 });
  });

  it('says nothing at all when there is nothing to say', () => {
    const p = summariseBookings([], parse);
    expect(p.total).toBe(0);
    expect(p.slots).toEqual([]);
    expect(p.busiestSlot).toBe(0);
  });

  it('ignores an event with no or unreadable start', () => {
    const p = summariseBookings(
      [{ startTime: null }, { startTime: 'not a date' }, ...events],
      parse,
    );
    expect(p.total).toBe(5);
  });
});

describe('describeSlot', () => {
  it('reads as plain facts', () => {
    expect(describeSlot({ booked: 4, confirmed: 4, noShow: 0 })).toBe('4 booked · 4 confirmed');
    expect(describeSlot({ booked: 6, confirmed: 4, noShow: 1 })).toBe('6 booked · 4 confirmed · 1 no-show');
    expect(describeSlot({ booked: 1, confirmed: 0, noShow: 0 })).toBe('1 booked');
  });

  it('returns nothing rather than a zero that looks like a measurement', () => {
    expect(describeSlot({ booked: 0, confirmed: 0, noShow: 0 })).toBeNull();
    expect(describeSlot(undefined)).toBeNull();
  });
});
