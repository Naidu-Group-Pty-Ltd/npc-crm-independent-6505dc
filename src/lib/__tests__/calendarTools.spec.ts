import { describe, expect, it } from 'vitest';
import { calendarToolsPreferenceKey, orderCalendarTools, sanitizePinnedCalendarToolIds } from '@/lib/calendarTools';

const tools = [
  { id: 'calendar', defaultOrder: 0 },
  { id: 'email', defaultOrder: 1 },
  { id: 'notifications', defaultOrder: 2 },
];

describe('orderCalendarTools', () => {
  it('puts the most recently pinned IDs first without duplicating tools', () => {
    expect(orderCalendarTools(tools, ['email', 'notifications']).map((tool) => tool.id)).toEqual([
      'email', 'notifications', 'calendar',
    ]);
  });

  it('returns an unpinned tool to its canonical position', () => {
    expect(orderCalendarTools(tools, ['email']).map((tool) => tool.id)).toEqual([
      'email', 'calendar', 'notifications',
    ]);
  });

  it('ignores stale and duplicate IDs safely', () => {
    const ids = sanitizePinnedCalendarToolIds(['notifications', 'deleted', 'notifications'], new Set(tools.map((tool) => tool.id)));
    expect(ids).toEqual(['notifications']);
    expect(orderCalendarTools(tools, ids).map((tool) => tool.id)).toEqual([
      'notifications', 'calendar', 'email',
    ]);
  });

  it('uses a distinct Command Centre preference key for each user', () => {
    expect(calendarToolsPreferenceKey('user-a')).not.toBe(calendarToolsPreferenceKey('user-b'));
    expect(calendarToolsPreferenceKey('user-a')).toContain('command-centre');
  });
});
