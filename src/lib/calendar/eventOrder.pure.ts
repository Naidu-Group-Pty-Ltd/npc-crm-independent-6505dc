/**
 * The order a day's appointments are read in.
 *
 * Audit item 23: the 28th listed 16:00 above 13:00 while the 29th listed 14:00
 * above 16:00, on the same screen. Neither the grid's `getEventsForDay` nor the
 * panel's `selectedDateEvents` sorted at all — both only filtered, so a day came
 * out in whatever order the provider happened to return it, and two days could
 * disagree with no rule between them.
 *
 * Earliest first, everywhere. A day is read forwards.
 */

export interface HasStartTime {
  startTime?: string | null;
}

/**
 * Compare by start time, earliest first.
 *
 * `parse` is injected so this stays free of any date library and matches
 * whatever the caller already uses to read a provider timestamp. An
 * unparseable start sorts LAST rather than being dropped or throwing the rest
 * of the order away: an event nobody can place in the day is still an event,
 * and a broken timestamp must not decide where its neighbours appear.
 */
export function byStartTimeAscending<T extends HasStartTime>(
  parse: (value: string) => Date | null,
): (a: T, b: T) => number {
  const at = (event: T): number => {
    if (!event.startTime) return Number.POSITIVE_INFINITY;
    const parsed = parse(event.startTime);
    const time = parsed ? parsed.getTime() : Number.NaN;
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  };
  return (a, b) => at(a) - at(b);
}
