/**
 * The rule the client tab has always applied, now written down once so the
 * team tab cannot apply a different one.
 */
import { describe, expect, it } from 'vitest';

import {
  REMINDER_TIME_BUCKETS,
  countByBucket,
  matchesTimeBucket,
} from '../timeBucket.pure';

// A Wednesday, so "this week" has days on both sides of it.
const NOW = new Date('2026-09-16T10:00:00');
const at = (iso: string) => new Date(iso);

describe('matchesTimeBucket', () => {
  it('puts a reminder from last week in Overdue and nowhere else', () => {
    const due = at('2026-09-09T09:00:00');
    expect(matchesTimeBucket(due, 'overdue', NOW)).toBe(true);
    expect(matchesTimeBucket(due, 'today', NOW)).toBe(false);
    expect(matchesTimeBucket(due, 'week', NOW)).toBe(false);
    expect(matchesTimeBucket(due, 'month', NOW)).toBe(false);
  });

  it('does not call an earlier hour today "overdue"', () => {
    // `isPast` on its own would; the client tab's rule excludes today and this
    // is the case that distinguishes the two.
    const earlierToday = at('2026-09-16T08:00:00');
    expect(matchesTimeBucket(earlierToday, 'overdue', NOW)).toBe(false);
    expect(matchesTimeBucket(earlierToday, 'today', NOW)).toBe(true);
  });

  it('counts today inside This Week and This Month', () => {
    const laterToday = at('2026-09-16T18:00:00');
    expect(matchesTimeBucket(laterToday, 'week', NOW)).toBe(true);
    expect(matchesTimeBucket(laterToday, 'month', NOW)).toBe(true);
  });

  it('ends the week on Sunday', () => {
    expect(matchesTimeBucket(at('2026-09-20T23:00:00'), 'week', NOW)).toBe(true);
    expect(matchesTimeBucket(at('2026-09-21T00:30:00'), 'week', NOW)).toBe(false);
  });

  it('runs This Week and This Month from TODAY, not from the period start', () => {
    // Monday of this week has already passed. It is overdue, not upcoming —
    // showing it under "This Week" would present a missed obligation as a
    // future one.
    const mondayGone = at('2026-09-14T09:00:00');
    expect(matchesTimeBucket(mondayGone, 'week', NOW)).toBe(false);
    expect(matchesTimeBucket(mondayGone, 'month', NOW)).toBe(false);
    expect(matchesTimeBucket(mondayGone, 'overdue', NOW)).toBe(true);
  });

  it('puts anything past the end of the month in Later', () => {
    expect(matchesTimeBucket(at('2026-09-30T23:00:00'), 'later', NOW)).toBe(false);
    expect(matchesTimeBucket(at('2026-10-01T01:00:00'), 'later', NOW)).toBe(true);
    expect(matchesTimeBucket(at('2026-10-01T01:00:00'), 'month', NOW)).toBe(false);
  });

  it('lets everything through on "all"', () => {
    for (const iso of ['2020-01-01T00:00:00', '2026-09-16T10:00:00', '2099-01-01T00:00:00']) {
      expect(matchesTimeBucket(at(iso), 'all', NOW)).toBe(true);
    }
  });
});

describe('countByBucket', () => {
  it('counts every bucket in one pass, with all as the total', () => {
    const dates = [
      at('2026-09-09T09:00:00'), // overdue
      at('2026-09-14T09:00:00'), // overdue
      at('2026-09-16T18:00:00'), // today, week, month
      at('2026-09-19T09:00:00'), // week, month
      at('2026-09-28T09:00:00'), // month
      at('2026-11-02T09:00:00'), // later
    ];
    expect(countByBucket(dates, NOW)).toEqual({
      all: 6, overdue: 2, today: 1, week: 2, month: 3, later: 1,
    });
  });

  it('answers zero for every bucket on an empty list', () => {
    expect(countByBucket([], NOW)).toEqual({
      all: 0, overdue: 0, today: 0, week: 0, month: 0, later: 0,
    });
  });
});

describe('REMINDER_TIME_BUCKETS', () => {
  it('leads with All and is the order the client tab draws', () => {
    expect(REMINDER_TIME_BUCKETS.map((b) => b.value)).toEqual([
      'all', 'overdue', 'today', 'week', 'month', 'later',
    ]);
  });
});
