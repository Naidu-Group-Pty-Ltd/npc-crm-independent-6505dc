/**
 * Pure filtering and sorting for the Template Library browse grid.
 *
 * Kept out of the component so the matching rules are unit-testable and so the
 * grid stays a rendering concern. Filtering is client-side: the catalogue is
 * tens of entries, not thousands, and the list payload is scalar metadata only,
 * so a round-trip per keystroke would be slower and no more correct. If the
 * catalogue ever outgrows that, this is the single function to move server-side.
 */
import { effectiveGround } from './entryDesign';
import type { TemplateLibraryFilters, TemplateLibraryListEntry } from './types';

export type TemplateLibrarySort =
  | 'recent'
  | 'name_asc'
  | 'name_desc'
  | 'popular'
  | 'pages_asc'
  | 'pages_desc';

export const EMPTY_FILTERS: TemplateLibraryFilters = {
  search: '',
  categories: [],
  reportTypes: [],
  industries: [],
  styles: [],
  orientations: [],
  productionReadyOnly: false,
  families: [],
  ground: 'all',
  useBuckets: [],
  densities: [],
};

export function hasActiveFilters(filters: TemplateLibraryFilters): boolean {
  return (
    filters.search.trim() !== ''
    || filters.categories.length > 0
    || filters.reportTypes.length > 0
    || filters.industries.length > 0
    || filters.styles.length > 0
    || filters.orientations.length > 0
    || filters.productionReadyOnly
    || filters.families.length > 0
    || filters.ground !== 'all'
    || filters.useBuckets.length > 0
    || filters.densities.length > 0
  );
}

/** Case-insensitive match across the fields a user would reasonably search. */
function matchesSearch(entry: TemplateLibraryListEntry, query: string): boolean {
  if (!query) return true;
  const haystack = [
    entry.name,
    entry.description ?? '',
    entry.category,
    entry.reportType ?? '',
    entry.style ?? '',
    ...(entry.tags ?? []),
    ...(entry.industry ?? []),
  ].join(' ').toLowerCase();
  // Every whitespace-separated term must appear, so "suburb compass" narrows
  // rather than widening the way an OR match would.
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

/**
 * Filters compose as AND across axes and OR within one axis: picking two
 * categories widens, adding a style narrows. That is what a user means when
 * they tick two boxes in one group and one in another.
 */
export function filterLibraryEntries(
  entries: TemplateLibraryListEntry[],
  filters: TemplateLibraryFilters,
  /**
   * Colourway currently selected per entry id. The Light/Dark filter reads the
   * SELECTED palette's ground, not the template's declared one — a Chancery
   * shown in Obsidian Reverse is a dark document, and filtering it into the
   * light bucket would contradict the sheet the user is looking at.
   */
  selectedColourways: Record<string, string> = {},
): TemplateLibraryListEntry[] {
  const query = filters.search.trim();
  return entries.filter((entry) => {
    if (!matchesSearch(entry, query)) return false;
    if (filters.families.length) {
      const key = entry.designMeta?.familyKey;
      if (!key || !filters.families.includes(key)) return false;
    }
    if (filters.ground !== 'all') {
      // A non-family entry has no colourway and therefore no ground to filter
      // on. Excluding it is the honest answer: the user asked for dark
      // documents, and "we do not know" is not one.
      if (effectiveGround(entry, selectedColourways[entry.id]) !== filters.ground) return false;
    }
    if (filters.useBuckets.length) {
      const bucket = entry.designMeta?.useBucket;
      if (!bucket || !filters.useBuckets.includes(bucket)) return false;
    }
    if (filters.densities.length) {
      const density = entry.designMeta?.density;
      if (!density || !filters.densities.includes(density)) return false;
    }
    if (filters.categories.length && !filters.categories.includes(entry.category)) return false;
    if (filters.reportTypes.length && !filters.reportTypes.includes(entry.reportType ?? '')) return false;
    if (filters.styles.length && !filters.styles.includes(entry.style as never)) return false;
    if (filters.orientations.length && !filters.orientations.includes(entry.orientation)) return false;
    if (filters.industries.length) {
      const industries = entry.industry ?? [];
      if (!filters.industries.some((i) => industries.includes(i))) return false;
    }
    if (filters.productionReadyOnly && !entry.compatibility?.productionReady) return false;
    return true;
  });
}

export function sortLibraryEntries(
  entries: TemplateLibraryListEntry[],
  sort: TemplateLibrarySort,
): TemplateLibraryListEntry[] {
  const out = [...entries];
  switch (sort) {
    case 'name_asc':
      return out.sort((a, b) => a.name.localeCompare(b.name));
    case 'name_desc':
      return out.sort((a, b) => b.name.localeCompare(a.name));
    case 'popular':
      return out.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.name.localeCompare(b.name));
    case 'pages_asc':
      return out.sort((a, b) => (a.pageCount ?? 0) - (b.pageCount ?? 0) || a.name.localeCompare(b.name));
    case 'pages_desc':
      return out.sort((a, b) => (b.pageCount ?? 0) - (a.pageCount ?? 0) || a.name.localeCompare(b.name));
    case 'recent':
    default:
      return out.sort(
        (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
      );
  }
}

/** The report types actually present in the catalogue, for the filter chips. */
export function availableReportTypes(entries: TemplateLibraryListEntry[]): string[] {
  return [...new Set(entries.map((e) => e.reportType).filter((t): t is string => !!t))].sort();
}

/**
 * The design families present, for the family chips.
 *
 * Derived from the entries rather than from the family registry so a chip
 * cannot offer a family the database has no rows for — which is exactly the
 * state the remaining nine families are in during this pilot.
 */
export function availableFamilies(
  entries: TemplateLibraryListEntry[],
): Array<{ key: string; name: string; count: number }> {
  const seen = new Map<string, { key: string; name: string; count: number }>();
  for (const entry of entries) {
    const meta = entry.designMeta;
    if (!meta?.familyKey) continue;
    const existing = seen.get(meta.familyKey);
    if (existing) existing.count += 1;
    else seen.set(meta.familyKey, { key: meta.familyKey, name: meta.familyName, count: 1 });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The recommended-use buckets present, for the use chips. */
export function availableUseBuckets(entries: TemplateLibraryListEntry[]): string[] {
  return [...new Set(
    entries.map((e) => e.designMeta?.useBucket).filter((b): b is string => !!b),
  )].sort();
}

/** The density steps present, in their natural order rather than alphabetical. */
export function availableDensities(entries: TemplateLibraryListEntry[]): string[] {
  const order = ['compact', 'balanced', 'spacious'];
  const present = new Set<string>();
  for (const entry of entries) {
    const density = entry.designMeta?.density;
    if (density) present.add(density);
  }
  return order.filter((d) => present.has(d));
}
