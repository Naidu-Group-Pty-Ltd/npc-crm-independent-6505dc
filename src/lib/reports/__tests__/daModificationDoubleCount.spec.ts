/**
 * A modification restates the development it modifies. It is never added to it.
 *
 * ## The measurement
 *
 * Taken from the NSW Planning Portal Online DA register on 17 Sep 2026, from
 * the production egress, for The Hills Shire Council — every application
 * lodged 17 Mar – 17 Sep 2026, all 659 rows across all 7 pages:
 *
 * | type | rows | stated cost | new dwellings |
 * | --- | ---: | ---: | ---: |
 * | Development Application | 474 | $1,177,228,202 | 1,412 |
 * | Modification Application | 173 | $1,181,805,735 | 2,028 |
 * | Review of determination | 12 | $7,857,446 | 7 |
 * | **summed, as the report did** | **659** | **$2,366,891,383** | **3,447** |
 *
 * The register carries the WHOLE cost and the WHOLE dwelling count on a
 * modification row, not the delta, so summing every row counts the same
 * building again for each change made to it. The report was stating $2.367bn
 * of development activity where the genuinely new proposals are $1.177bn — a
 * **101% overstatement** — and 3,447 new dwellings against 1,412, which is
 * **144%**. The modifications alone restate more dwellings than every new
 * application put together.
 *
 * Those figures reached two places: the evidence the document renders, and the
 * prompt block the model reads. This holds the arithmetic at the one place it
 * is done.
 */
import { describe, expect, it } from 'vitest';

import {
  classifyApplicationType,
  summariseDaRows,
} from '../../../../supabase/functions/_shared/planning/developmentActivity.pure';

/** The shape and the proportions the live register returned, in miniature. */
const row = (type: string, cost: number, dwellings: number) => ({
  PlanningPortalApplicationNumber: `PAN-${cost}`,
  ApplicationType: type,
  ApplicationStatus: 'Determined',
  CostOfDevelopment: cost,
  NumberOfNewDwellings: dwellings,
  Location: [{ Suburb: 'KELLYVILLE' }],
});

describe('the register’s own application types', () => {
  it('reads the three the register uses', () => {
    expect(classifyApplicationType('Development Application')).toBe('new');
    expect(classifyApplicationType('Modification Application')).toBe('amendment');
    expect(classifyApplicationType('Review of determination')).toBe('amendment');
  });

  it('is not fooled by casing or surrounding space', () => {
    expect(classifyApplicationType('  development application ')).toBe('new');
    expect(classifyApplicationType('MODIFICATION APPLICATION')).toBe('amendment');
  });

  it('refuses to guess anything else, in either direction', () => {
    for (const unknown of ['Concept Application', 'Section 34 Agreement', '', null, undefined, 7]) {
      expect(classifyApplicationType(unknown)).toBe('unclassified');
    }
  });
});

describe('the three classes are never summed', () => {
  const summary = summariseDaRows(
    [
      row('Development Application', 1_177_228_202, 1_412),
      row('Modification Application', 1_181_805_735, 2_028),
      row('Review of determination', 7_857_446, 7),
    ],
    'The Hills Shire Council', '2026-03-17', '2026-09-17', 659,
  );

  it('gives the new proposals alone as the development figure', () => {
    expect(summary.newApplications.statedCostTotal).toBe(1_177_228_202);
    expect(summary.newApplications.newDwellingsTotal).toBe(1_412);
  });

  it('carries the restatements separately, not discarded and not added', () => {
    // A review of a determination is a re-decision of something already
    // counted, so it sits with the modifications.
    expect(summary.amendments.statedCostTotal).toBe(1_181_805_735 + 7_857_446);
    expect(summary.amendments.newDwellingsTotal).toBe(2_028 + 7);
    expect(summary.amendments.rows).toBe(2);
  });

  it('never produces the summed figure the report used to state', () => {
    const everyNumber = JSON.stringify(summary);
    expect(everyNumber).not.toContain('2366891383');
    expect(everyNumber).not.toContain('3447');
  });

  it('and the overstatement it avoids is the one that was measured', () => {
    const summed = 1_177_228_202 + 1_181_805_735 + 7_857_446;
    const overstatement = summed / summary.newApplications.statedCostTotal;
    expect(overstatement).toBeGreaterThan(2);
    const dwellingsOver = 3_447 / summary.newApplications.newDwellingsTotal;
    expect(dwellingsOver).toBeGreaterThan(2.4);
  });
});
