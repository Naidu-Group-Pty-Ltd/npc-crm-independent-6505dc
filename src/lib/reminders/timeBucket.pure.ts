/**
 * When a reminder is due, as one rule both tabs read.
 *
 * ## The defect this exists for
 *
 * The Reminders hub has two tabs. The **client** tab leads with a row of
 * time-bucket chips — All, Overdue, Today, This Week, This Month, Later — and
 * they are the control an operator actually reaches for, because a reminder
 * list is a list of things that are due. The **team** tab was reported twice
 * as "doesn't have a filters bar like client reminders have": an earlier pass
 * gave it a search box and two selects, and that closed the smaller half of
 * the complaint while leaving the dominant control absent. The team tab lists
 * reminders marked "Overdue" in red and offered no way to see only those.
 *
 * ## Why it is a module
 *
 * The client tab's rule was an inline `switch` over local `todayStart`,
 * `weekEnd` and `monthEnd` bindings. Copying it into the team tab is how two
 * tabs come to disagree about what "This Week" means — and this product has
 * already paid for that once, with two review-interval tables thirty lines
 * apart booking different dates (see `reviewSchedule.pure`).
 *
 * The boundaries are the client tab's own, unchanged: the week ends on Sunday
 * (`weekStartsOn: 1`), "This Week" and "This Month" both run from the start of
 * TODAY rather than from the start of the period — so a reminder that was due
 * on Monday and is now overdue appears under Overdue and not under This Week —
 * and "Later" is everything past the end of the month.
 */
import { endOfMonth, endOfWeek, startOfDay } from 'date-fns';

export type ReminderTimeBucket = 'all' | 'overdue' | 'today' | 'week' | 'month' | 'later';

export interface ReminderTimeBucketOption {
  value: ReminderTimeBucket;
  label: string;
}

/** The chips, in the order the client tab has always drawn them. */
export const REMINDER_TIME_BUCKETS: readonly ReminderTimeBucketOption[] = [
  { value: 'all', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'later', label: 'Later' },
] as const;

/**
 * Does a reminder due at `due` belong in `bucket`?
 *
 * `now` is a parameter rather than read here, so the function stays pure and a
 * test can pin the day.
 */
export function matchesTimeBucket(
  due: Date,
  bucket: ReminderTimeBucket,
  now: Date,
): boolean {
  if (bucket === 'all') return true;

  const todayStart = startOfDay(now);
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const monthEnd = endOfMonth(now);

  switch (bucket) {
    // The client tab spells these `isPast(d) && !isToday(d)` and `isToday(d)`.
    // Those two helpers read the SYSTEM CLOCK and ignore whatever `now` is
    // passed — which is invisible where `now` is the clock, and makes the
    // function untestable and wrong anywhere else. The predicates below are
    // exactly equivalent for a real clock: everything before today's start is
    // overdue (an earlier hour today is Today's, not overdue), and "today" is
    // the same calendar day. This module's own spec is what found it.
    case 'overdue': return due < todayStart;
    case 'today': return startOfDay(due).getTime() === todayStart.getTime();
    case 'week': return due >= todayStart && due <= weekEnd;
    case 'month': return due >= todayStart && due <= monthEnd;
    case 'later': return due > monthEnd;
    default: return true;
  }
}

/**
 * How many of `dueDates` fall in each bucket.
 *
 * Used for the count beside a chip. `all` counts everything, so a chip row can
 * be rendered from one pass without the caller special-casing it.
 */
export function countByBucket(
  dueDates: readonly Date[],
  now: Date,
): Record<ReminderTimeBucket, number> {
  const counts = { all: 0, overdue: 0, today: 0, week: 0, month: 0, later: 0 };
  for (const due of dueDates) {
    for (const { value } of REMINDER_TIME_BUCKETS) {
      if (matchesTimeBucket(due, value, now)) counts[value] += 1;
    }
  }
  return counts;
}
