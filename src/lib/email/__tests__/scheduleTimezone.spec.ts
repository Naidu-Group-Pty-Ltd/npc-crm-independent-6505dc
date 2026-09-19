/**
 * Audit item 46 — Schedule send never said what timezone it meant.
 *
 * The awkward part is DST, so that is what these are about.
 */
import { describe, expect, it } from 'vitest';

import {
  availableTimeZones,
  currentTimeZone,
  describeInstantIn,
  describeTimeZone,
  zoneOffsetMs,
  zonedWallClockToInstant,
} from '../scheduleTimezone.pure';

const HOUR = 3_600_000;

describe('the offset at an instant', () => {
  it('is zero for UTC', () => {
    expect(zoneOffsetMs(new Date('2026-08-31T00:00:00Z'), 'UTC')).toBe(0);
  });

  it('follows the southern-hemisphere seasons', () => {
    // Sydney is UTC+10 in winter and UTC+11 under daylight saving.
    expect(zoneOffsetMs(new Date('2026-07-01T00:00:00Z'), 'Australia/Sydney')).toBe(10 * HOUR);
    expect(zoneOffsetMs(new Date('2026-12-01T00:00:00Z'), 'Australia/Sydney')).toBe(11 * HOUR);
  });

  it('follows the northern-hemisphere seasons too', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), 'Europe/London')).toBe(0);
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), 'Europe/London')).toBe(HOUR);
  });

  it('handles a zone with a half-hour offset', () => {
    expect(zoneOffsetMs(new Date('2026-08-31T00:00:00Z'), 'Australia/Adelaide')).toBe(9.5 * HOUR);
  });
});

describe('a wall clock becomes an instant', () => {
  it('reads back as the time that was typed', () => {
    for (const zone of ['UTC', 'Australia/Sydney', 'Australia/Adelaide', 'America/New_York', 'Asia/Kolkata']) {
      const instant = zonedWallClockToInstant(
        { year: 2026, month: 9, day: 15, hour: 9, minute: 0 },
        zone,
      );
      expect(describeInstantIn(instant, zone)).toMatch(/9:00 am/i);
    }
  });

  it('is the same instant whichever zone describes it', () => {
    const sydney9 = zonedWallClockToInstant({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, 'Australia/Sydney');
    // Sydney is UTC+10 on 1 July, so 09:00 there is 23:00 the previous day UTC.
    expect(sydney9.toISOString()).toBe('2026-06-30T23:00:00.000Z');
  });

  it('lands correctly on the day the clocks go forward', () => {
    // Sydney springs forward at 02:00 on the first Sunday in October.
    // 10:00 that morning is already UTC+11, i.e. 23:00 UTC the day before.
    const after = zonedWallClockToInstant({ year: 2026, month: 10, day: 4, hour: 10, minute: 0 }, 'Australia/Sydney');
    expect(describeInstantIn(after, 'Australia/Sydney')).toMatch(/10:00 am/i);
    expect(zoneOffsetMs(after, 'Australia/Sydney')).toBe(11 * HOUR);
  });

  it('lands correctly on the day the clocks go back', () => {
    const after = zonedWallClockToInstant({ year: 2026, month: 4, day: 5, hour: 10, minute: 0 }, 'Australia/Sydney');
    expect(describeInstantIn(after, 'Australia/Sydney')).toMatch(/10:00 am/i);
    expect(zoneOffsetMs(after, 'Australia/Sydney')).toBe(10 * HOUR);
  });

  it('resolves a wall clock that never happens to a real instant', () => {
    // 02:30 on the spring-forward morning does not exist in Sydney.
    const skipped = zonedWallClockToInstant({ year: 2026, month: 10, day: 4, hour: 2, minute: 30 }, 'Australia/Sydney');
    expect(Number.isNaN(skipped.getTime())).toBe(false);
  });
});

describe('what the picker shows', () => {
  it('offers real zones and starts on the reader’s own', () => {
    const zones = availableTimeZones();
    expect(zones.length).toBeGreaterThan(100);
    expect(zones[0]).toBe(currentTimeZone());
    expect(new Set(zones).size).toBe(zones.length);
  });

  it('offers UTC, which the runtime list does not contain', () => {
    // `Intl.supportedValuesOf('timeZone')` returns region/city zones only —
    // no `UTC`, no `Etc/*` — so a picker built straight from it could never
    // offer the one zone somebody scheduling across zones is most likely to
    // reach for.
    const runtimeZones = (Intl as unknown as { supportedValuesOf: (k: string) => string[] })
      .supportedValuesOf('timeZone');
    expect(runtimeZones).not.toContain('UTC');
    expect(availableTimeZones()).toContain('UTC');
  });

  it('labels a zone with its offset', () => {
    expect(describeTimeZone('Australia/Sydney', new Date('2026-07-01T00:00:00Z')))
      .toBe('Australia/Sydney (GMT+10)');
  });

  it('never throws on a zone this runtime does not know', () => {
    expect(describeTimeZone('Not/AZone')).toBe('Not/AZone');
    expect(() => describeInstantIn(new Date(), 'Not/AZone')).not.toThrow();
  });
});
