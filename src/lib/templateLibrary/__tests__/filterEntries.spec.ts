import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS, availableReportTypes, filterLibraryEntries, hasActiveFilters, sortLibraryEntries,
} from '../filterEntries';
import type { TemplateLibraryListEntry } from '../types';

function entry(over: Partial<TemplateLibraryListEntry> = {}): TemplateLibraryListEntry {
  return {
    id: over.id ?? 'e1',
    familyId: 'f1',
    slug: 'slug',
    version: 1,
    name: 'Investor Compass',
    description: 'Comprehensive investment analysis',
    longDescription: null,
    category: 'investment',
    reportType: 'investment',
    tier: 'compass',
    variant: null,
    industry: ['property'],
    tags: ['premium', 'detailed'],
    style: 'corporate',
    orientation: 'portrait',
    pageSize: 'A4',
    pageCount: 12,
    status: 'published',
    accessTier: 'standard',
    visibility: 'global',
    compatibility: {
      productionReady: true,
      supportedModules: ['cover', 'kpi-grid'],
      requiredBindings: ['property.address'],
      brandSafe: true,
      compatibilityVersion: 1,
      engine: 'weasyprint',
    },
    designMeta: null,
    thumbnailPath: null,
    previewImagePaths: [],
    sourceTemplateId: null,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    publishedAt: null,
    deprecatedAt: null,
    usageCount: 0,
    lastUsedAt: null,
    previewSchema: null,
    ...over,
  };
}

describe('hasActiveFilters', () => {
  it('is false for the empty filter set', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it('ignores whitespace-only search', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: '   ' })).toBe(false);
  });

  it('is true once any axis is set', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, categories: ['suburb'] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, productionReadyOnly: true })).toBe(true);
  });
});

describe('filterLibraryEntries', () => {
  const entries = [
    entry({ id: 'a', name: 'Investor Compass', category: 'investment', reportType: 'investment' }),
    entry({
      id: 'b', name: 'Suburb Snapshot', category: 'suburb', reportType: 'suburb',
      style: 'minimal', tags: ['quick'], industry: ['property'], pageCount: 4,
      compatibility: { ...entry().compatibility, productionReady: false },
    }),
    entry({
      id: 'c', name: 'Lender Pack', category: 'compliance', reportType: 'borrowing_capacity',
      style: 'technical', tags: ['finance'], industry: ['finance'], orientation: 'landscape',
    }),
  ];

  it('returns everything when no filter is set', () => {
    expect(filterLibraryEntries(entries, EMPTY_FILTERS)).toHaveLength(3);
  });

  it('matches name, description and tags case-insensitively', () => {
    expect(filterLibraryEntries(entries, { ...EMPTY_FILTERS, search: 'suburb' }).map((e) => e.id)).toEqual(['b']);
    expect(filterLibraryEntries(entries, { ...EMPTY_FILTERS, search: 'FINANCE' }).map((e) => e.id)).toEqual(['c']);
  });

  it('requires every search term, so extra words narrow the result', () => {
    expect(filterLibraryEntries(entries, { ...EMPTY_FILTERS, search: 'investor compass' })).toHaveLength(1);
    expect(filterLibraryEntries(entries, { ...EMPTY_FILTERS, search: 'investor suburb' })).toHaveLength(0);
  });

  it('ORs within one axis', () => {
    const out = filterLibraryEntries(entries, { ...EMPTY_FILTERS, categories: ['suburb', 'compliance'] });
    expect(out.map((e) => e.id).sort()).toEqual(['b', 'c']);
  });

  it('ANDs across axes', () => {
    const out = filterLibraryEntries(entries, {
      ...EMPTY_FILTERS, categories: ['suburb', 'compliance'], styles: ['technical'],
    });
    expect(out.map((e) => e.id)).toEqual(['c']);
  });

  it('filters by industry membership, not equality', () => {
    const multi = entry({ id: 'd', industry: ['property', 'finance'] });
    const out = filterLibraryEntries([...entries, multi], { ...EMPTY_FILTERS, industries: ['finance'] });
    expect(out.map((e) => e.id).sort()).toEqual(['c', 'd']);
  });

  it('excludes preview-only entries when report-ready is required', () => {
    const out = filterLibraryEntries(entries, { ...EMPTY_FILTERS, productionReadyOnly: true });
    expect(out.map((e) => e.id).sort()).toEqual(['a', 'c']);
  });

  it('filters by orientation', () => {
    expect(filterLibraryEntries(entries, { ...EMPTY_FILTERS, orientations: ['landscape'] }).map((e) => e.id))
      .toEqual(['c']);
  });

  it('returns nothing rather than everything when filters exclude all', () => {
    expect(filterLibraryEntries(entries, { ...EMPTY_FILTERS, categories: ['statewide'] })).toHaveLength(0);
  });
});

describe('sortLibraryEntries', () => {
  const entries = [
    entry({ id: 'a', name: 'Bravo', pageCount: 8, usageCount: 2, updatedAt: '2026-01-01T00:00:00Z' }),
    entry({ id: 'b', name: 'Alpha', pageCount: 20, usageCount: 9, updatedAt: '2026-03-01T00:00:00Z' }),
    entry({ id: 'c', name: 'Charlie', pageCount: 2, usageCount: 5, updatedAt: '2026-02-01T00:00:00Z' }),
  ];

  it('sorts by name in both directions', () => {
    expect(sortLibraryEntries(entries, 'name_asc').map((e) => e.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(sortLibraryEntries(entries, 'name_desc').map((e) => e.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts most-recent first by default', () => {
    expect(sortLibraryEntries(entries, 'recent').map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by usage and by page count', () => {
    expect(sortLibraryEntries(entries, 'popular').map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(sortLibraryEntries(entries, 'pages_asc').map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(sortLibraryEntries(entries, 'pages_desc').map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [...entries];
    sortLibraryEntries(input, 'name_asc');
    expect(input.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('availableReportTypes', () => {
  it('returns the distinct, sorted, non-null report types present', () => {
    const out = availableReportTypes([
      entry({ reportType: 'suburb' }),
      entry({ reportType: 'investment' }),
      entry({ reportType: 'suburb' }),
      entry({ reportType: null }),
    ]);
    expect(out).toEqual(['investment', 'suburb']);
  });
});
