export interface CalendarTool<TId extends string = string> {
  id: TId;
  defaultOrder: number;
}

export interface CalendarToolsPreference {
  pinnedToolIds: string[];
  version: 1;
}

export const CALENDAR_TOOLS_PREFERENCE_VERSION = 1 as const;

/**
 * Produces the sidebar order without changing the canonical tool definitions.
 * Pinned IDs retain their explicit order; every remaining tool returns to its
 * canonical `defaultOrder` position.
 */
export function orderCalendarTools<T extends CalendarTool>(
  tools: readonly T[],
  pinnedToolIds: readonly string[],
): T[] {
  const toolsById = new Map(tools.map((tool) => [tool.id, tool]));
  const seen = new Set<string>();
  const pinnedTools: T[] = [];

  for (const id of pinnedToolIds) {
    const tool = toolsById.get(id);
    if (tool && !seen.has(id)) {
      pinnedTools.push(tool);
      seen.add(id);
    }
  }

  return [
    ...pinnedTools,
    ...tools
      .filter((tool) => !seen.has(tool.id))
      .slice()
      .sort((left, right) => left.defaultOrder - right.defaultOrder),
  ];
}

export function sanitizePinnedCalendarToolIds(
  pinnedToolIds: unknown,
  availableToolIds: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(pinnedToolIds)) return [];

  const seen = new Set<string>();
  return pinnedToolIds.filter((id): id is string => {
    if (typeof id !== 'string' || !availableToolIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function calendarToolsPreferenceKey(userId: string): string {
  // Calendar is currently Command Centre-only. Include the portal name so a
  // future portal implementation cannot accidentally share this layout.
  return `calendar_tools_pinned:v${CALENDAR_TOOLS_PREFERENCE_VERSION}:${userId}:command-centre`;
}

export function loadCalendarToolsPreference(
  userId: string,
  availableToolIds: ReadonlySet<string>,
): string[] | null {
  const raw = window.localStorage.getItem(calendarToolsPreferenceKey(userId));
  if (!raw) return null;

  try {
    const preference = JSON.parse(raw) as Partial<CalendarToolsPreference>;
    if (preference.version !== CALENDAR_TOOLS_PREFERENCE_VERSION) return null;
    return sanitizePinnedCalendarToolIds(preference.pinnedToolIds, availableToolIds);
  } catch {
    return null;
  }
}

export function saveCalendarToolsPreference(userId: string, pinnedToolIds: string[]): void {
  const preference: CalendarToolsPreference = {
    pinnedToolIds,
    version: CALENDAR_TOOLS_PREFERENCE_VERSION,
  };
  window.localStorage.setItem(calendarToolsPreferenceKey(userId), JSON.stringify(preference));
}
