/**
 * Converts a date string (YYYY-MM-DD) and time string (HH:MM) into an ISO
 * timestamp that represents that wall-clock time in a given IANA timezone,
 * regardless of the user's browser timezone.
 *
 * Example: toTimezoneISO('2025-02-07', '16:30', 'Australia/Sydney') → '2025-02-07T05:30:00.000Z'
 * (because Sydney is UTC+11 in Feb, so 16:30 AEDT = 05:30 UTC)
 */
export function toTimezoneISO(dateStr: string, timeStr: string, timezone: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);

  const offsetMinutes = getTimezoneOffsetMinutes(year, month - 1, day, hours, minutes, timezone);
  const utcMs = Date.UTC(year, month - 1, day, hours, minutes, 0, 0) - offsetMinutes * 60_000;
  return new Date(utcMs).toISOString();
}

/**
 * Convenience wrapper that always uses Australia/Sydney.
 */
export function toSydneyISO(dateStr: string, timeStr: string): string {
  return toTimezoneISO(dateStr, timeStr, 'Australia/Sydney');
}

/**
 * Given a Date object representing a time that should be treated as Sydney
 * wall-clock time, return an ISO string in UTC.
 */
export function dateToSydneyISO(date: Date): string {
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return toSydneyISO(dateStr, timeStr);
}

function getTimezoneOffsetMinutes(year: number, month: number, day: number, hours: number, minutes: number, timezone: string): number {
  const utcGuess = Date.UTC(year, month, day, hours, minutes, 0, 0);

  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(utcGuess));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);

  const tzMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (tzMs - utcGuess) / 60_000;
}

// Keep old getSydneyOffsetMinutes as alias for backward compat
function getSydneyOffsetMinutes(year: number, month: number, day: number, hours: number, minutes: number): number {
  return getTimezoneOffsetMinutes(year, month, day, hours, minutes, 'Australia/Sydney');
}

function parseSydneyLocale(_str: string): Date {
  // Unused but kept for reference
  return new Date();
}
