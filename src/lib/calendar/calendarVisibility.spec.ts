/**
 * "I tried toggling on and off the calendar overlay but nothing happens."
 *
 * Audit item 26, second pass. The first fix made the grid recompute when the
 * toggles changed; these pin the two behaviours that still produced the
 * reported experience afterwards, and the rule that ends them:
 *
 *   • "Hide all" bypassed the filter (it only engaged between the extremes),
 *     so the button that says hide everything showed everything;
 *   • an appointment on no listed calendar — which is most of this tenant's
 *     real bookings; the audit screenshot shows fourteen calendars all
 *     reading "0 events" beside a populated month — vanished the moment any
 *     single unrelated calendar was switched off.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  OTHER_CALENDAR_ID,
  allVisibleCalendarIds,
  eventCalendarKey,
  isEventVisible,
  knownCalendarIds,
  summariseOverlay,
} from './calendarVisibility.pure';

// Colour deliberately absent: the visibility rule never reads it, and a hex
// literal in a fixture is one more place the style audit has to excuse.
const CALENDARS = [
  { id: 'cal-discovery', name: 'Discovery Call' },
  { id: 'cal-strategy', name: 'Strategy Call Calendar' },
  { id: 'cal-onboarding', name: 'Step 1: Onboarding' },
];

/** The auditor's month: real bookings on ids the list does not carry. */
const EVENTS = [
  { id: 'e1', calendarId: 'cal-discovery' },
  { id: 'e2', calendarId: 'cal-discovery' },
  { id: 'e3', calendarId: 'deleted-calendar' },
  { id: 'e4', calendarId: '' },
  { id: 'e5', calendarId: undefined },
];

const known = knownCalendarIds(CALENDARS);

describe('every appointment belongs to exactly one row', () => {
  it('a listed calendar claims its own', () => {
    expect(eventCalendarKey('cal-discovery', known)).toBe('cal-discovery');
  });

  it('everything else is Other — deleted calendars, empty ids, missing ids', () => {
    expect(eventCalendarKey('deleted-calendar', known)).toBe(OTHER_CALENDAR_ID);
    expect(eventCalendarKey('', known)).toBe(OTHER_CALENDAR_ID);
    expect(eventCalendarKey(undefined, known)).toBe(OTHER_CALENDAR_ID);
    expect(eventCalendarKey(null, known)).toBe(OTHER_CALENDAR_ID);
  });

  it('a real calendar id cannot collide with the synthetic row', () => {
    expect(CALENDARS.some((c) => c.id === OTHER_CALENDAR_ID)).toBe(false);
    expect(OTHER_CALENDAR_ID).toMatch(/^__/);
  });
});

describe('none means none, and one toggle touches one row', () => {
  it('an empty set hides every appointment', () => {
    // The old guard bypassed the filter at exactly this point, and "Hide all"
    // showed everything while the panel read "0 events shown".
    for (const event of EVENTS) {
      expect(isEventVisible(event.calendarId, new Set(), known)).toBe(false);
    }
  });

  it('switching one calendar off leaves the Other appointments standing', () => {
    // The reported month: toggle Strategy off, and e3/e4/e5 — bookings on no
    // listed calendar — used to vanish with it.
    const visible = allVisibleCalendarIds(CALENDARS);
    visible.delete('cal-strategy');
    expect(isEventVisible('deleted-calendar', visible, known)).toBe(true);
    expect(isEventVisible('', visible, known)).toBe(true);
    expect(isEventVisible('cal-discovery', visible, known)).toBe(true);
  });

  it('the Other row has its own toggle', () => {
    const visible = allVisibleCalendarIds(CALENDARS);
    visible.delete(OTHER_CALENDAR_ID);
    expect(isEventVisible('deleted-calendar', visible, known)).toBe(false);
    expect(isEventVisible('cal-discovery', visible, known)).toBe(true);
  });

  it('show-all includes the Other row', () => {
    expect(allVisibleCalendarIds(CALENDARS).has(OTHER_CALENDAR_ID)).toBe(true);
  });
});

describe('the panel reads from the same rule the grid draws by', () => {
  it('rows with appointments come first, busiest first, Other among them', () => {
    const summary = summariseOverlay(EVENTS, CALENDARS, allVisibleCalendarIds(CALENDARS));
    expect(summary.active.map((r) => r.name)).toEqual(['Other appointments', 'Discovery Call']);
    expect(summary.active[0].count).toBe(3);
    expect(summary.empty.map((r) => r.id)).toEqual(['cal-strategy', 'cal-onboarding']);
  });

  it('shown and hidden always sum to the total', () => {
    const visible = allVisibleCalendarIds(CALENDARS);
    visible.delete(OTHER_CALENDAR_ID);
    const summary = summariseOverlay(EVENTS, CALENDARS, visible);
    expect(summary.shown).toBe(2);
    expect(summary.hidden).toBe(3);
    expect(summary.shown + summary.hidden).toBe(summary.total);
  });

  it('with nothing orphaned there is no Other row to toggle', () => {
    const summary = summariseOverlay(
      [{ id: 'e1', calendarId: 'cal-discovery' }],
      CALENDARS,
      allVisibleCalendarIds(CALENDARS),
    );
    expect(summary.active.some((r) => r.isOther)).toBe(false);
    expect(summary.empty.some((r) => r.isOther)).toBe(false);
  });
});

describe('the calendar page goes through it', () => {
  const page = readFileSync(resolve(__dirname, '../../pages/Calendar.tsx'), 'utf8');

  it('filters by membership through the rule, never between the extremes', () => {
    expect(page).toMatch(/isEventVisible\(event\.calendarId, visibleCalendars, knownIds\)/);
    // The bypass that made "Hide all" show everything.
    expect(page).not.toContain('visibleCalendars.size > 0 && visibleCalendars.size < calendars.length');
  });

  it('initialises once, by ref — a background refresh must not undo Hide all', () => {
    expect(page).toContain('overlayInitialisedRef');
    expect(page).not.toMatch(/calendars\.length > 0 && visibleCalendars\.size === 0/);
  });

  it('show-all and initialisation both include the Other row', () => {
    expect(page.match(/allVisibleCalendarIds\(calendars\)/g) ?? []).toHaveLength(2);
  });
});

describe('the panel says what it does', () => {
  const panel = readFileSync(
    resolve(__dirname, '../../components/calendar/MultiCalendarOverlay.tsx'),
    'utf8',
  );

  it('leads with its purpose and states the outcome', () => {
    expect(panel).toContain('draw their appointments on the grid');
    expect(panel).toMatch(/summariseOverlay\(/);
    expect(panel).toContain('hidden');
  });

  it('no longer carries the unlabelled chip strip or the dead view mode', () => {
    expect(panel).not.toContain('Quick toggle by clicking colors');
    expect(panel).not.toContain("useState<'list' | 'compact'>");
  });
});
