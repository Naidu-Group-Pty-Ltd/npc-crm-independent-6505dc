/**
 * Which appointments the calendar overlay actually draws.
 *
 * ## The two ways "nothing happens" survived the first fix
 *
 * Audit item 26 — "I tried toggling on and off the calendar overlay but
 * nothing happens" — was first fixed as a stale memo: the filter read
 * `visibleCalendars` and never listed it as a dependency, so toggles changed
 * state the grid never saw. The memo now recomputes, and two behaviours
 * underneath it still produce the reported experience:
 *
 * 1. **The filter only engaged between the extremes.** It ran when
 *    `0 < visible < all`, so "None" — an empty set — bypassed it entirely and
 *    the grid kept EVERY event. The button that says hide everything showed
 *    everything, while the panel's own badge read "0 events shown".
 *
 * 2. **An appointment on no listed calendar vanished on any toggle.** The
 *    tenant's calendar list is GoHighLevel booking types, and the auditor's
 *    screenshot shows all fourteen reading "0 events" while the month view
 *    holds appointments — the real bookings carry calendar ids the list does
 *    not (a booking type since deleted, an appointment created directly). All
 *    fourteen toggles on: those appointments draw, because the filter is
 *    bypassed. Switch ONE unrelated calendar off: the filter engages on
 *    membership, and every one of them disappears. A toggle about one
 *    calendar silently emptied the month.
 *
 * ## The rule
 *
 * Every appointment belongs to exactly one row of the overlay: its calendar's
 * row when the id is listed, and otherwise the **Other appointments** row,
 * which exists precisely so nothing can be invisible to the panel that decides
 * visibility. The filter is always membership once the overlay has
 * initialised — an empty set means none, the full set means all, and the
 * panel's counts and the grid derive from this one module so they cannot
 * disagree. Outlook is deliberately not part of this rule: it has its own
 * toggle and its own merge step, exactly as before.
 *
 * Initialisation is the caller's, guarded by a ref rather than by
 * `size === 0` — the old guard re-ran whenever a background refresh replaced
 * the calendar list, so "Hide all" undid itself on the next sync tick.
 */

export interface OverlayCalendar {
  id: string;
  name: string;
  eventColor?: string;
}

export interface OverlayEvent {
  id: string;
  calendarId?: string;
}

/**
 * The row for appointments no listed calendar claims.
 *
 * A stable synthetic id, namespaced so a real GoHighLevel id cannot collide
 * with it (GHL ids are alphanumeric).
 */
export const OTHER_CALENDAR_ID = '__other_appointments__';

/** The listed ids, as the membership test wants them. */
export function knownCalendarIds(calendars: readonly OverlayCalendar[]): Set<string> {
  return new Set(calendars.map((c) => c.id));
}

/** The overlay row an event belongs to: its calendar's, else Other. */
export function eventCalendarKey(
  calendarId: string | undefined | null,
  knownIds: ReadonlySet<string>,
): string {
  return calendarId && knownIds.has(calendarId) ? calendarId : OTHER_CALENDAR_ID;
}

/** Whether the grid draws this event, under the current toggles. */
export function isEventVisible(
  calendarId: string | undefined | null,
  visible: ReadonlySet<string>,
  knownIds: ReadonlySet<string>,
): boolean {
  return visible.has(eventCalendarKey(calendarId, knownIds));
}

/** Everything on: every listed calendar plus the Other row. */
export function allVisibleCalendarIds(calendars: readonly OverlayCalendar[]): Set<string> {
  return new Set([...calendars.map((c) => c.id), OTHER_CALENDAR_ID]);
}

export interface OverlayRow {
  id: string;
  name: string;
  eventColor?: string;
  /** Appointments in the loaded range that belong to this row. */
  count: number;
  visible: boolean;
  /** True for the synthetic Other row. */
  isOther: boolean;
}

export interface OverlaySummary {
  /** Rows holding appointments, busiest first. */
  active: OverlayRow[];
  /** Listed calendars with nothing in the loaded range, in list order. */
  empty: OverlayRow[];
  /** Appointments the current toggles draw. */
  shown: number;
  /** Appointments the current toggles hide. */
  hidden: number;
  total: number;
}

/**
 * The panel's whole reading, from the same rule the grid filters by.
 *
 * The Other row appears only when something is actually in it — a synthetic
 * bucket with nothing in it would be furniture — and rows with appointments
 * are ordered busiest first, because fourteen rows of "0 events" above the one
 * that matters is what made the panel unreadable. Empty calendars keep their
 * list order and are the caller's to tuck behind a disclosure.
 */
export function summariseOverlay(
  events: readonly OverlayEvent[],
  calendars: readonly OverlayCalendar[],
  visible: ReadonlySet<string>,
): OverlaySummary {
  const knownIds = knownCalendarIds(calendars);

  const counts = new Map<string, number>();
  let shown = 0;
  for (const event of events) {
    const key = eventCalendarKey(event.calendarId, knownIds);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (visible.has(key)) shown += 1;
  }

  const rows: OverlayRow[] = calendars.map((calendar) => ({
    id: calendar.id,
    name: calendar.name,
    eventColor: calendar.eventColor,
    count: counts.get(calendar.id) ?? 0,
    visible: visible.has(calendar.id),
    isOther: false,
  }));

  const otherCount = counts.get(OTHER_CALENDAR_ID) ?? 0;
  if (otherCount > 0) {
    rows.push({
      id: OTHER_CALENDAR_ID,
      name: 'Other appointments',
      count: otherCount,
      visible: visible.has(OTHER_CALENDAR_ID),
      isOther: true,
    });
  }

  const active = rows.filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
  const empty = rows.filter((row) => row.count === 0);
  const total = events.length;

  return { active, empty, shown, hidden: total - shown, total };
}
