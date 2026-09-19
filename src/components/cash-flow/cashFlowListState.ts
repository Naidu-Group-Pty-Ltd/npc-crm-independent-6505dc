import type { BuildTypeFilter, DateRangeFilter } from './types';

/**
 * What the Cash Flow Analysis property list remembers across a drill-down.
 *
 * Both actions on a card now leave the page — "View Report" routes to the
 * investment report, "Open Cash Flow" routes to the property's workspace — so
 * coming back has to land the adviser where they left rather than at the top
 * of a freshly filtered, freshly paginated list. React Router unmounts the
 * page on navigation, so none of this survives in component state; it is
 * written to `sessionStorage`, which is per-tab and dies with the tab.
 *
 * `loadedPages` rather than a row count: the list pages the backend 50 at a
 * time and `hasMore` is derived from a full page, so restoring whole pages is
 * the only shape that leaves the pagination footer telling the truth.
 */
export interface CashFlowListState {
  searchQuery: string;
  buildTypeFilter: BuildTypeFilter;
  dateRange: DateRangeFilter;
  loadedPages: number;
  scrollTop: number;
}

const STORAGE_KEY = 'npc:cash-flow-analysis:list-state:v1';

/** Restoring more than this many pages on return costs more than it returns. */
export const MAX_RESTORED_PAGES = 6;

const BUILD_TYPES: BuildTypeFilter[] = ['all', 'new_build', 'existing_property', 'land_only'];
const DATE_RANGES: DateRangeFilter[] = ['30', '90', '180', '365', 'all'];

function safeSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    // Private-mode Safari and locked-down enterprise profiles throw on access.
    return null;
  }
}

export function readCashFlowListState(): CashFlowListState | null {
  const store = safeSessionStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CashFlowListState>;
    // A stored shape that no longer parses is discarded rather than trusted —
    // a bad filter here silently hides every property from the adviser.
    const buildTypeFilter = BUILD_TYPES.includes(parsed.buildTypeFilter as BuildTypeFilter)
      ? (parsed.buildTypeFilter as BuildTypeFilter)
      : 'all';
    const dateRange = DATE_RANGES.includes(parsed.dateRange as DateRangeFilter)
      ? (parsed.dateRange as DateRangeFilter)
      : '30';
    return {
      searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
      buildTypeFilter,
      dateRange,
      loadedPages: clampPages(parsed.loadedPages),
      scrollTop: Number.isFinite(parsed.scrollTop) ? Math.max(0, Number(parsed.scrollTop)) : 0,
    };
  } catch {
    return null;
  }
}

export function saveCashFlowListState(state: CashFlowListState): void {
  const store = safeSessionStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...state, loadedPages: clampPages(state.loadedPages) }));
  } catch {
    // Quota or a disabled store — losing the restore point is not worth an error.
  }
}

export function clearCashFlowListState(): void {
  const store = safeSessionStorage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* see saveCashFlowListState */
  }
}

function clampPages(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_RESTORED_PAGES, Math.floor(n));
}

/**
 * The dashboard scrolls in one of two places: the window on desktop, and the
 * `<main>` element on mobile/tablet, where the shell is a fixed-height flex
 * column. Read whichever is actually scrolling rather than assuming.
 */
export function getCashFlowScrollElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const mains = document.querySelectorAll<HTMLElement>('main.dashboard-main');
  for (const main of mains) {
    const overflowY = window.getComputedStyle(main).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return main;
  }
  return null;
}

export function getCashFlowScrollTop(): number {
  if (typeof window === 'undefined') return 0;
  const el = getCashFlowScrollElement();
  return el ? el.scrollTop : window.scrollY;
}

export function setCashFlowScrollTop(top: number): void {
  if (typeof window === 'undefined') return;
  const el = getCashFlowScrollElement();
  if (el) {
    el.scrollTo({ top, behavior: 'auto' });
  } else {
    window.scrollTo({ top, behavior: 'auto' });
  }
}
