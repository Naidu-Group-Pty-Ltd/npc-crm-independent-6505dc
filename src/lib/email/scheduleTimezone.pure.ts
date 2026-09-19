/**
 * Turning a wall-clock time in a named zone into an instant.
 *
 * Audit item 46 — Schedule send offered a date and a time and never said what
 * they meant. It built a `Date` from the browser's own zone and posted
 * `.toISOString()`, which is correct for somebody scheduling in their own
 * timezone and silently wrong for anybody scheduling around a recipient's.
 * Nothing on screen named the zone either, so "9:00 AM" was an assumption
 * rather than a statement.
 *
 * There is no timezone library in this project, and there does not need to be:
 * `Intl.DateTimeFormat` can report what a given instant reads as in a given
 * zone, and inverting that gives the instant for a wall-clock reading. This is
 * the whole of it, kept pure so the awkward part — DST — can be tested.
 */

/**
 * The zones the picker offers.
 *
 * `Intl.supportedValuesOf('timeZone')` returns region/city zones only — 418 of
 * them on this runtime, and NOT `UTC` or any `Etc/*` entry — so a list taken
 * straight from it cannot offer UTC at all. The reader's own zone leads,
 * because it is the default and scrolling to find it is the thing a picker
 * should never make you do; UTC follows, because a person scheduling around
 * somebody else's clock often wants it; the rest are alphabetical as the
 * runtime gives them.
 */
export function availableTimeZones(): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.('timeZone') ?? [];
  } catch { /* older runtime */ }
  return [...new Set([currentTimeZone(), 'UTC', ...zones])];
}

/** The reader's own zone, which is what the picker should start on. */
export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * How far `timeZone` is from UTC at a particular instant.
 *
 * Formatting the instant into the zone and reading it back AS IF it were UTC
 * gives the offset. Positive east of Greenwich.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // `hour12: false` yields 24 for midnight in some engines.
  const asIfUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'));
  return asIfUtc - instant.getTime();
}

export interface WallClock {
  year: number;
  /** 1-12, as a person writes it. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * The instant at which `timeZone` reads as this wall clock.
 *
 * Two passes, because the offset depends on the instant and the instant
 * depends on the offset: the first guess uses the offset at the naive UTC
 * reading, the second corrects it using the offset actually in force. That is
 * what makes a time on a DST boundary land right.
 *
 * A wall clock that does not exist (the hour a spring-forward skips) resolves
 * to the instant the clock jumps to, and one that happens twice resolves to
 * the first. Both are the conventional readings, and both are a real time.
 */
export function zonedWallClockToInstant(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
  const secondPass = naive - zoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

/** `Australia/Sydney` → `Australia/Sydney (GMT+10)`, for a picker row. */
export function describeTimeZone(timeZone: string, at: Date = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-AU', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    return name ? `${timeZone} (${name})` : timeZone;
  } catch {
    return timeZone;
  }
}

/** What the chosen instant reads as where the sender is standing. */
export function describeInstantIn(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(instant);
  } catch {
    return instant.toISOString();
  }
}
