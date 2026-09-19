import { describe, expect, it } from 'vitest';
import { buildChartReportOptions } from './chartReportLabels';

describe('buildChartReportOptions', () => {
  it('deduplicates report records by stable ID rather than title', () => {
    const options = buildChartReportOptions([
      { id: 'report-1', title: 'Property Listings Report', created_at: '2025-09-12T10:00:00Z' },
      { id: 'report-1', title: 'Property Listings Report', created_at: '2025-09-12T10:00:00Z' },
      { id: 'report-2', title: 'Property Listings Report', created_at: '2025-09-07T10:00:00Z' },
    ]);

    expect(options).toHaveLength(2);
    expect(options.map(option => option.id)).toEqual(['report-1', 'report-2']);
    expect(options.map(option => option.label)).toEqual([
      'Property Listings Report — 12 Sep 2025',
      'Property Listings Report — 7 Sep 2025',
    ]);
  });

  it('does not include listing counts in report labels', () => {
    const [option] = buildChartReportOptions([
      { id: 'report-1', title: 'Property Listings Report', created_at: '2025-09-03T10:00:00Z' },
    ]);

    expect(option.label).toBe('Property Listings Report — 3 Sep 2025');
    expect(option.label).not.toMatch(/\d+ listings?/i);
  });

  it('provides a safe title when report metadata has no usable title', () => {
    const [option] = buildChartReportOptions([
      { id: 'report-1', title: '   ', created_at: 'invalid-date' },
    ]);

    expect(option.label).toBe('Untitled report');
  });
});
