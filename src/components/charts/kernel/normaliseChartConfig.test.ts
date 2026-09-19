import { describe, expect, it } from 'vitest';
import { normaliseChartConfig } from './normaliseChartConfig';

describe('normaliseChartConfig', () => {
  it.each([
    { data: [null] },
    { points: [null] },
    { points: [{ label: 'Valid', value: 1 }, null] },
  ])('returns null for malformed inline points without throwing', (chart_config) => {
    expect(normaliseChartConfig({ chart_config })).toBeNull();
  });

  it('normalises valid inline points', () => {
    const model = normaliseChartConfig({
      title: 'Occupancy',
      chart_config: {
        data: [{ label: 'Occupied', value: 12, color: '#123456' }],
      },
    });

    expect(model).toMatchObject({
      title: 'Occupancy',
      data: [{ name: 'Occupied', s_occupancy_0: 12 }],
      pieSlices: undefined,
    });
  });
});
