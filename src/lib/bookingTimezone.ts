/**
 * Booking Timezone Configuration
 *
 * This module provides the "source of truth" timezone for all calendar bookings.
 * Users can configure this in Settings. It defaults to Australia/Sydney.
 */

export const AUSTRALIAN_TIMEZONES = [
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
  { value: 'Australia/Hobart', label: 'Hobart (AEST/AEDT)' },
  { value: 'Australia/Lord_Howe', label: 'Lord Howe Island (LHST/LHDT)' },
] as const;

export type AustralianTimezone = typeof AUSTRALIAN_TIMEZONES[number]['value'];

const STORAGE_KEY = 'dashboard-settings';
const DEFAULT_BOOKING_TZ: AustralianTimezone = 'Australia/Sydney';

/**
 * Get the configured booking timezone from localStorage settings.
 * Falls back to Australia/Sydney if not set.
 */
export function getBookingTimezone(): AustralianTimezone {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.bookingTimezone && AUSTRALIAN_TIMEZONES.some(tz => tz.value === parsed.bookingTimezone)) {
        return parsed.bookingTimezone as AustralianTimezone;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_BOOKING_TZ;
}

/**
 * Get the short abbreviation for a timezone at a given instant.
 * e.g. "AEST", "AWST", "ACST"
 */
export function getTimezoneAbbr(timezone: string, isoString?: string | null): string {
  try {
    const date = isoString ? new Date(isoString) : new Date();
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart?.value || timezone.split('/').pop() || 'AEST';
  } catch {
    return timezone.split('/').pop() || 'AEST';
  }
}

/**
 * Get a human-readable label for a timezone value.
 */
export function getTimezoneLabel(tz: string): string {
  return AUSTRALIAN_TIMEZONES.find(t => t.value === tz)?.label || tz;
}
