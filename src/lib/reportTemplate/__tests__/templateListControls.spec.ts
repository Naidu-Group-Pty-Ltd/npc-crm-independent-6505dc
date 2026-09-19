import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE_LIST_FILTERS,
  filterAndSortTemplates,
  formatTemplateDate,
  getTemplatePageCount,
  getTemplateReportTypeOptions,
  getTemplateTimestamp,
  isTemplateSortOption,
  isTemplateStatusFilter,
  readTemplateListFiltersFromParams,
  sortTemplateRecords,
  writeTemplateListFiltersToParams,
  type TemplateListRecord,
} from '../templateListControls';

const tpl = (overrides: Partial<TemplateListRecord>): TemplateListRecord => ({
  id: 'template',
  name: 'Template',
  description: null,
  report_type: null,
  tier: null,
  schema: { pages: [] },
  is_active: false,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('template list controls', () => {
  it('validates URL-controlled enum values', () => {
    expect(isTemplateSortOption('name_asc')).toBe(true);
    expect(isTemplateSortOption('unknown')).toBe(false);
    expect(isTemplateStatusFilter('draft')).toBe(true);
    expect(isTemplateStatusFilter('archived')).toBe(false);
  });

  it('reads and writes compact query params', () => {
    const filters = readTemplateListFiltersFromParams(new URLSearchParams('q=rent&type=compass&status=active&sort=name_desc'));

    expect(filters).toEqual({
      search: 'rent',
      reportType: 'compass',
      status: 'active',
      sort: 'name_desc',
    });
    expect(writeTemplateListFiltersToParams(filters).toString()).toBe('q=rent&type=compass&status=active&sort=name_desc');
    expect(writeTemplateListFiltersToParams(DEFAULT_TEMPLATE_LIST_FILTERS).toString()).toBe('');
  });

  it('falls back to default filters for invalid URL values', () => {
    expect(readTemplateListFiltersFromParams(new URLSearchParams('status=archived&sort=oldest'))).toEqual({
      ...DEFAULT_TEMPLATE_LIST_FILTERS,
      search: '',
      reportType: 'all',
    });
  });

  it('deduplicates report type options in first-seen order', () => {
    const templates = [
      tpl({ id: '1', report_type: 'compass' }),
      tpl({ id: '2', report_type: 'portfolio' }),
      tpl({ id: '3', report_type: 'compass' }),
      tpl({ id: '4', report_type: null }),
    ];

    expect(getTemplateReportTypeOptions(templates)).toEqual(['compass', 'portfolio']);
  });

  it('filters across searchable fields and active/draft state before sorting', () => {
    const templates = [
      tpl({ id: '1', name: 'Alpha', report_type: 'compass', tier: 'pro', is_active: true, updated_at: '2024-03-01T00:00:00.000Z' }),
      tpl({ id: '2', name: 'Beta', description: 'Rent roll', report_type: 'portfolio', is_active: false, updated_at: '2024-02-01T00:00:00.000Z' }),
      tpl({ id: '3', name: 'Gamma', report_type: 'compass', is_active: false, updated_at: '2024-01-01T00:00:00.000Z' }),
    ];

    expect(filterAndSortTemplates(templates, {
      search: 'compass',
      reportType: 'compass',
      status: 'draft',
      sort: 'updated_desc',
    }).map((item) => item.id)).toEqual(['3']);
  });

  it('sorts by name, active state, pages, report type, and recency without mutating', () => {
    const templates = [
      tpl({ id: 'b', name: 'Beta', report_type: 'portfolio', is_active: false, schema: { pages: [1] }, updated_at: '2024-01-01T00:00:00.000Z' }),
      tpl({ id: 'a', name: 'Alpha', report_type: 'compass', is_active: true, schema: { pages: [1, 2, 3] }, updated_at: '2024-03-01T00:00:00.000Z' }),
      tpl({ id: 'c', name: 'Charlie', report_type: 'compass', is_active: false, schema: { pages: [1, 2] }, updated_at: '2024-02-01T00:00:00.000Z' }),
    ];

    expect(sortTemplateRecords(templates, 'name_asc').map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(sortTemplateRecords(templates, 'active_first').map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(sortTemplateRecords(templates, 'pages_desc').map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(sortTemplateRecords(templates, 'type').map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(sortTemplateRecords(templates, 'updated_desc').map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(templates.map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('handles invalid dates and page counts safely', () => {
    const invalid = tpl({ updated_at: 'not-a-date', schema: null });

    expect(formatTemplateDate(null)).toBe('Never updated');
    expect(getTemplateTimestamp(invalid)).toBe(0);
    expect(getTemplatePageCount(invalid)).toBe(0);
  });
});
