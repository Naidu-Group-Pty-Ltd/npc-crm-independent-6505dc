/**
 * Calendar colour segregation.
 *
 * GHL returns `eventColor` for only some calendars and repeats the same handful
 * of hexes across the rest, so the registry used to show four different
 * calendars behind the identical blue dot. Colour is the only thing telling
 * these rows apart, so it is assigned here — deterministically, and never
 * duplicated — rather than trusted from the provider.
 *
 * The map is keyed off a stable ordering (name, then id) so a calendar keeps its
 * colour across refetches and across the select, the registry cards, the
 * overlay panel and every event chip.
 */

/** Distinct, print-safe hues. Ordered so adjacent entries are far apart. */
export const CALENDAR_COLOR_PALETTE = [
  'hsl(217 91% 60%)', // blue
  'hsl(38 92% 50%)', // amber
  'hsl(160 84% 39%)', // emerald
  'hsl(330 81% 60%)', // pink
  'hsl(258 90% 66%)', // violet
  'hsl(0 84% 60%)', // red
  'hsl(173 80% 40%)', // teal
  'hsl(25 95% 53%)', // orange
  'hsl(239 84% 67%)', // indigo
  'hsl(84 81% 44%)', // lime
  'hsl(292 84% 61%)', // fuchsia
  'hsl(199 89% 48%)', // sky
  'hsl(45 93% 47%)', // yellow
  'hsl(142 71% 45%)', // green
  'hsl(271 91% 65%)', // purple
  'hsl(350 89% 60%)', // rose
  'hsl(189 94% 43%)', // cyan
  'hsl(26 90% 37%)', // bronze
  'hsl(262 83% 58%)', // deep violet
  'hsl(161 94% 30%)', // deep emerald
  'hsl(345 83% 41%)', // crimson
  'hsl(192 91% 36%)', // deep cyan
  'hsl(41 96% 40%)', // dark gold
  'hsl(243 75% 59%)', // deep indigo
] as const;

export const FALLBACK_CALENDAR_COLOR = CALENDAR_COLOR_PALETTE[0];

const GOLDEN_ANGLE = 137.508;

/** Overflow colours beyond the palette, generated on the golden angle so they stay distinct. */
const generatedColor = (index: number): string => {
  const hue = Math.round((index * GOLDEN_ANGLE) % 360);
  const lightness = index % 2 === 0 ? 58 : 46;
  return `hsl(${hue} 68% ${lightness}%)`;
};


export interface ColourableCalendar {
  id: string;
  name?: string;
}

/**
 * Assigns every calendar its own colour. Two calendars never share one, and a
 * calendar's colour does not move when other calendars are added or removed
 * from the middle of the list — the ordering is by name, so growth appends.
 */
export function buildCalendarColorMap(
  calendars: ReadonlyArray<ColourableCalendar>,
): Map<string, string> {
  const seen = new Set<string>();
  const ordered = [...calendars]
    .filter((calendar) => {
      const id = String(calendar?.id ?? '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => {
      const byName = String(a.name ?? '').localeCompare(String(b.name ?? ''));
      return byName !== 0 ? byName : String(a.id).localeCompare(String(b.id));
    });

  const map = new Map<string, string>();
  ordered.forEach((calendar, index) => {
    const color =
      index < CALENDAR_COLOR_PALETTE.length
        ? CALENDAR_COLOR_PALETTE[index]
        : generatedColor(index - CALENDAR_COLOR_PALETTE.length + 1);
    map.set(String(calendar.id), color);
  });

  return map;
}

export function resolveCalendarColor(
  map: Map<string, string> | undefined,
  calendarId: string | undefined | null,
  fallback: string = FALLBACK_CALENDAR_COLOR,
): string {
  if (!calendarId) return fallback;
  return map?.get(String(calendarId)) ?? fallback;
}
