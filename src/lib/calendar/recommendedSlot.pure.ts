/**
 * Turning a recommended (weekday, hour) into the date it will actually book.
 *
 * Audit item 25: picking "Monday 9am" from the optimiser on a Wednesday opened
 * the booking form on the Monday two days GONE. The recommendations are scored
 * per day-of-week and were then resolved against
 * `eachDayOfInterval(startOfWeek(currentWeek) … endOfWeek(currentWeek))`, so
 * `weekDays[1]` is this calendar week's Monday whether or not it has happened.
 *
 * A recommendation is advice about a booking you are about to make, so it can
 * only ever mean a slot you can still book. The same date has to feed the
 * availability check, which was asking whether a slot in the past was free.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The next date on which `dayOfWeek` falls at `hour`, at or after `now`.
 *
 * Today counts when the hour has not yet passed — a 4pm slot suggested at
 * 9am this morning is today, not next week. Once it has passed, the same
 * weekday next week is the honest answer.
 *
 * `dayOfWeek` is 0=Sunday, matching `Date.getDay()` and the optimiser's own
 * day indices.
 */
export function resolveRecommendedSlot(
  dayOfWeek: number,
  hour: number,
  now: Date = new Date(),
): Date {
  const candidate = new Date(now);
  candidate.setHours(hour, 0, 0, 0);

  const daysAhead = (dayOfWeek - candidate.getDay() + 7) % 7;
  if (daysAhead > 0) {
    // A different weekday: step forward to it. Built from the epoch rather
    // than by mutating the day number so a month or year boundary is the
    // platform's problem, not this function's.
    return new Date(candidate.getTime() + daysAhead * DAY_MS);
  }

  // Today. Keep it only if the hour is still ahead of us.
  if (candidate.getTime() > now.getTime()) return candidate;
  return new Date(candidate.getTime() + 7 * DAY_MS);
}

/**
 * Is the resolved date in a later week than the one on screen?
 *
 * The label read "Mon" and booked a Monday the operator was not looking at, so
 * the surface needs to say which one it means.
 */
export function fallsOutsideWeek(slot: Date, weekStart: Date): boolean {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = start.getTime() + 7 * DAY_MS;
  return slot.getTime() >= end || slot.getTime() < start.getTime();
}
