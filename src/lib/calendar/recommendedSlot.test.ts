/**
 * Audit item 25: picking "Monday 9am" from the optimiser on a Wednesday opened
 * the booking form on the Monday two days GONE — the recommendation was scored
 * per weekday and resolved against this calendar week's occurrence of it,
 * whether or not that day had happened.
 */
import { describe, expect, it } from 'vitest';

import { fallsOutsideWeek, resolveRecommendedSlot } from './recommendedSlot.pure';

// Wednesday 26 August 2026, 10:00.
const WEDNESDAY = new Date(2026, 7, 26, 10, 0, 0, 0);

const MONDAY = 1;
const WEDNESDAY_DOW = 3;
const FRIDAY = 5;

describe('resolveRecommendedSlot', () => {
  it('never books a weekday that has already passed this week', () => {
    // The reported case, exactly.
    const slot = resolveRecommendedSlot(MONDAY, 9, WEDNESDAY);
    expect(slot.getDay()).toBe(MONDAY);
    expect(slot.getTime()).toBeGreaterThan(WEDNESDAY.getTime());
  });

  it('picks the upcoming occurrence, not one further out', () => {
    const slot = resolveRecommendedSlot(MONDAY, 9, WEDNESDAY);
    // The Monday after this Wednesday: 31 August 2026.
    expect(slot.getFullYear()).toBe(2026);
    expect(slot.getMonth()).toBe(7);
    expect(slot.getDate()).toBe(31);
    expect(slot.getHours()).toBe(9);
  });

  it('keeps a later weekday in the same week', () => {
    const slot = resolveRecommendedSlot(FRIDAY, 9, WEDNESDAY);
    expect(slot.getDay()).toBe(FRIDAY);
    expect(slot.getDate()).toBe(28);
  });

  it('keeps today when the hour is still ahead', () => {
    // Suggested at 10:00 for 16:00 today — that is today, not next week.
    const slot = resolveRecommendedSlot(WEDNESDAY_DOW, 16, WEDNESDAY);
    expect(slot.getDate()).toBe(26);
    expect(slot.getHours()).toBe(16);
  });

  it('moves to next week when today\'s hour has passed', () => {
    const slot = resolveRecommendedSlot(WEDNESDAY_DOW, 8, WEDNESDAY);
    expect(slot.getDay()).toBe(WEDNESDAY_DOW);
    expect(slot.getDate()).toBe(2);
    expect(slot.getMonth()).toBe(8);
  });

  it('crosses a month boundary without arithmetic of its own', () => {
    // Monday 31 Aug at 10:00 -> a Friday lands in September.
    const monday = new Date(2026, 7, 31, 10, 0, 0, 0);
    const slot = resolveRecommendedSlot(FRIDAY, 9, monday);
    expect(slot.getMonth()).toBe(8);
    expect(slot.getDate()).toBe(4);
  });

  it('always lands on the requested weekday and hour', () => {
    for (let day = 0; day < 7; day += 1) {
      for (const hour of [8, 12, 17]) {
        const slot = resolveRecommendedSlot(day, hour, WEDNESDAY);
        expect(slot.getDay()).toBe(day);
        expect(slot.getHours()).toBe(hour);
        expect(slot.getTime()).toBeGreaterThan(WEDNESDAY.getTime());
      }
    }
  });
});

describe('fallsOutsideWeek', () => {
  it('marks a slot the operator is not looking at', () => {
    // Week beginning Sunday 23 August 2026.
    const weekStart = new Date(2026, 7, 23, 0, 0, 0, 0);
    expect(fallsOutsideWeek(new Date(2026, 7, 31, 9), weekStart)).toBe(true);
    expect(fallsOutsideWeek(new Date(2026, 7, 28, 9), weekStart)).toBe(false);
    expect(fallsOutsideWeek(new Date(2026, 7, 22, 9), weekStart)).toBe(true);
  });
});
