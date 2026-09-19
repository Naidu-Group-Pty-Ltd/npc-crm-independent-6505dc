/**
 * Performance at catalogue scale.
 *
 * The library filters client-side because the catalogue is tens of entries and
 * the list payload is scalar metadata — a round-trip per keystroke would be
 * slower and no more correct. That is a defensible choice only while filtering
 * a full catalogue stays imperceptible, so these tests pin it.
 *
 * The budgets are deliberately loose. They exist to catch an accidental O(n²)
 * or a per-entry JSON parse creeping into the filter path, not to police
 * microseconds on a shared CI box.
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS, availableReportTypes, filterLibraryEntries, sortLibraryEntries,
} from '../filterEntries';
import { LIST_COLUMNS } from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import type { TemplateLibraryCategory, TemplateLibraryListEntry } from '../types';

const CATEGORIES: TemplateLibraryCategory[] = [
  'investment', 'suburb', 'postcode', 'statewide',
  'comparison', 'cash_flow', 'client_form', 'compliance',
];
const STYLES = ['corporate', 'editorial', 'minimal', 'luxury', 'technical'] as const;
const REPORT_TYPES = ['investment', 'suburb', 'postcode', 'statewide', 'comparison', 'cashflow'];

/** A catalogue of `count` entries with realistic field spread. */
function makeCatalogue(count: number): TemplateLibraryListEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `entry-${i}`,
    familyId: `family-${i}`,
    slug: `template-${i}`,
    version: 1,
    name: `Template ${i} ${['Compass', 'Brief', 'Snapshot', 'Matrix', 'Review'][i % 5]}`,
    description: `A ${STYLES[i % STYLES.length]} report covering ${CATEGORIES[i % CATEGORIES.length]} analysis with charts and tables.`,
    longDescription: 'x'.repeat(400),
    category: CATEGORIES[i % CATEGORIES.length],
    reportType: REPORT_TYPES[i % REPORT_TYPES.length],
    tier: ['compass', 'executive', 'snapshot'][i % 3],
    variant: null,
    industry: [['property'], ['finance'], ['property', 'finance'], ['legal']][i % 4],
    tags: [`tag-${i % 7}`, `tag-${i % 11}`, 'shared'],
    style: STYLES[i % STYLES.length],
    orientation: i % 9 === 0 ? 'landscape' : 'portrait',
    pageSize: 'A4',
    pageCount: 2 + (i % 12),
    status: 'published',
    accessTier: (['standard', 'premium', 'enterprise'] as const)[i % 3],
    visibility: 'global',
    compatibility: {
      productionReady: i % 3 === 0,
      supportedModules: ['cover', 'kpi-grid', 'data-table', 'chart-bar'],
      requiredBindings: ['property.address', 'client.name', 'financials.weeklyRent'],
      brandSafe: true,
      compatibilityVersion: 1,
      engine: 'weasyprint',
    },
    designMeta: null,
    thumbnailPath: null,
    previewImagePaths: [],
    sourceTemplateId: null,
    createdByUserId: null,
    createdAt: `2026-0${(i % 9) + 1}-01T00:00:00Z`,
    updatedAt: `2026-0${(i % 9) + 1}-15T00:00:00Z`,
    publishedAt: null,
    deprecatedAt: null,
    usageCount: (i * 7) % 43,
    lastUsedAt: null,
    // Roughly the size of a trimmed page-1 schema.
    previewSchema: {
      version: 1,
      tokens: { colors: { primary: 'token', bg: 'token' } },
      pages: [{
        id: 'p', name: 'Cover', size: { width: 595, height: 842 }, background: {},
        blocks: Array.from({ length: 8 }, (_, b) => ({
          id: `b${b}`, type: 'cover', props: { x: 42, y: b * 60, width: 511, height: 48 }, overlays: [],
        })),
      }],
    },
  }));
}

function millis(fn: () => void, runs = 20): number {
  // Warm up so the first run's JIT cost is not the measurement.
  fn();
  const start = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - start) / runs;
}

describe('catalogue scale', () => {
  const at40 = makeCatalogue(40);
  const at400 = makeCatalogue(400);

  it('filters 40 entries well inside a keystroke', () => {
    const ms = millis(() => filterLibraryEntries(at40, { ...EMPTY_FILTERS, search: 'compass report' }));
    expect(ms).toBeLessThan(5);
  });

  it('applies every filter axis at once on 40 entries', () => {
    const ms = millis(() => filterLibraryEntries(at40, {
      search: 'report',
      categories: ['investment', 'suburb', 'compliance'],
      reportTypes: ['investment', 'suburb'],
      industries: ['property', 'finance'],
      styles: ['corporate', 'technical'],
      orientations: ['portrait'],
      productionReadyOnly: true,
      families: [],
      ground: 'all',
      useBuckets: [],
      densities: [],
    }));
    expect(ms).toBeLessThan(5);
  });

  it('sorts 40 entries by every mode without cost', () => {
    for (const sort of ['recent', 'name_asc', 'name_desc', 'popular', 'pages_asc', 'pages_desc'] as const) {
      expect(millis(() => sortLibraryEntries(at40, sort))).toBeLessThan(5);
    }
  });

  it('scales roughly linearly to 400 entries', () => {
    // 10× the entries should not be anywhere near 100× the time. A quadratic
    // filter would blow this budget long before it blew a user's patience.
    const ms = millis(() => filterLibraryEntries(at400, { ...EMPTY_FILTERS, search: 'compass' }));
    expect(ms).toBeLessThan(30);
  });

  it('derives the report-type filter options cheaply', () => {
    expect(millis(() => availableReportTypes(at400))).toBeLessThan(15);
  });

  it('does not mutate the catalogue while filtering or sorting', () => {
    const before = at40.map((e) => e.id);
    filterLibraryEntries(at40, { ...EMPTY_FILTERS, search: 'x' });
    sortLibraryEntries(at40, 'name_asc');
    expect(at40.map((e) => e.id)).toEqual(before);
  });
});

describe('list payload size', () => {
  it('keeps a 40-entry list payload small enough to fetch on tab open', () => {
    // The wire shape is the LIST_COLUMNS projection, so measure that rather
    // than the camelCase view model.
    const rows = makeCatalogue(40).map((e) => {
      const row: Record<string, unknown> = {};
      for (const col of LIST_COLUMNS) {
        row[col] = col === 'preview_schema' ? e.previewSchema : (e as never)[col] ?? null;
      }
      return row;
    });
    const kb = JSON.stringify(rows).length / 1024;
    // Comfortably inside a single response; the heavy `schema` is excluded by
    // construction, which is what keeps this true as templates get richer.
    expect(kb).toBeLessThan(400);
  });

  it('excludes the fields that make a payload unbounded', () => {
    for (const col of ['schema', 'config', 'custom_css', 'long_description']) {
      expect(LIST_COLUMNS).not.toContain(col);
    }
  });
});
