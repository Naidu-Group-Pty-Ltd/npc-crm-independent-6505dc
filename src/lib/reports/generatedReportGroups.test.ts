import { describe, expect, it } from 'vitest';
import type { InvestmentReport } from '@/components/reports/library/types';
import { buildGeneratedReportGroups } from './generatedReportGroups';

const report = (id: string, variant: NonNullable<InvestmentReport['report_variant']>, address: string, key?: string): InvestmentReport => ({
  id,
  property_address: address,
  property_listing_id: null,
  canonical_property_key: key,
  created_at: `2026-07-24T18:3${id}:00.000Z`,
  current_version: 1,
  report_variant: variant,
  report_tier: variant,
  status: 'completed',
});

describe('buildGeneratedReportGroups', () => {
  it('consolidates all report variants under the persisted canonical identity', () => {
    const groups = buildGeneratedReportGroups([
      report('1', 'compass', 'Lot 1128 Holloway Road (Maplewood), MELTON SOUTH, VIC 3338', 'listing:lot-1128'),
      report('2', 'financial', 'LOT 1128 HOLLOWAY ROAD (MAPLEWOOD), MELTON SOUTH, VIC, 3338', 'listing:lot-1128'),
      report('3', 'strategic', 'Lot 1128 Holloway Road (Maplewood), Melton South VIC 3338', 'listing:lot-1128'),
      report('4', 'snapshot', 'Lot 1128 Holloway Road (Maplewood), MELTON SOUTH, VIC 3338', 'listing:lot-1128'),
      report('5', 'briefing', 'Lot 1128 Holloway Road (Maplewood), MELTON SOUTH, VIC 3338', 'listing:lot-1128'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ reportCount: 5, reportTypes: ['compass', 'financial', 'strategic', 'snapshot', 'briefing'] });
  });

  it('uses the conservative address fallback without merging different lots or units', () => {
    const groups = buildGeneratedReportGroups([
      report('1', 'compass', 'Lot 1128 Holloway Road (Maplewood), MELTON SOUTH, VIC 3338'),
      report('2', 'financial', 'LOT 1128 HOLLOWAY ROAD (MAPLEWOOD), MELTON SOUTH, VIC, 3338'),
      report('3', 'compass', 'Lot 1129 Holloway Road (Maplewood), MELTON SOUTH, VIC 3338'),
      report('4', 'compass', 'Unit 2, 12 Holloway Road, MELTON SOUTH, VIC 3338'),
    ]);
    expect(groups).toHaveLength(3);
  });
});
