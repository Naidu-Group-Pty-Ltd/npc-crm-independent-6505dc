/**
 * One development, however many times the register was asked about it.
 *
 * ## What this replaces
 *
 * Classifying by `ApplicationType` stopped a modification being ADDED to the
 * headline (`daModificationDoubleCount.spec.ts`). It did nothing about the
 * LIST, which ranked ROWS. On the rendered Investment Compass for 18 Annabelle
 * Crescent, three of the five largest "projects" were:
 *
 * | council number | determined | stated cost | address |
 * | --- | --- | ---: | --- |
 * | `1382/2025/JP/A` | 7 May 2026 | $93,180,778 | 3 Brookhollow Avenue, Norwest |
 * | `1382/2025/JP/B` | 2 Jul 2026 | $93,180,778 | 3 Brookhollow Avenue, Norwest |
 * | `1382/2025/JP/C` | 30 Jul 2026 | $93,180,778 | 3 Brookhollow Avenue, Norwest |
 *
 * One data centre, modified three times, printed three times. A reader saw
 * $279m of data centres where there is $93m of one.
 *
 * ## The parent is read, not guessed
 *
 * Measured live from the production egress on 17 September 2026 over the whole
 * six-month window for The Hills Shire Council — all 655 rows (pg_net request
 * ids 270152, 270164–270169):
 *
 * | the register's own `ApplicationType` | segments in `CouncilApplicationNumber` | rows |
 * | --- | ---: | ---: |
 * | Development Application | 3 (`1472/2026/JP`) | 471 |
 * | Modification Application | 4 (`1382/2025/JP/A`) | 172 |
 * | Review of determination | 4 | 12 |
 *
 * The two signals agree on 655 of 655 rows. 655 rows are 631 developments; 20
 * carry more than one row, and 160 groups hold no new application at all
 * because the development was approved before the window opened.
 */
import { describe, expect, it } from 'vitest';
import {
  parentApplicationKey, summariseDaRows,
} from '../../../../supabase/functions/_shared/planning/developmentActivity.pure';

const row = (over: Record<string, unknown>) => ({
  ApplicationStatus: 'Determined',
  ApplicationType: 'Development Application',
  Council: { CouncilName: 'The Hills Shire Council' },
  DevelopmentType: [{ DevelopmentType: 'Data centre' }],
  Location: [{ Suburb: 'NORWEST', FullAddress: '3 BROOKHOLLOW AVENUE NORWEST 2153' }],
  ...over,
});

/** The three Norwest rows and the Box Hill original, as the register returned them. */
const MEASURED = [
  row({
    CouncilApplicationNumber: '1382/2025/JP/A', ApplicationType: 'Modification Application',
    LodgementDate: '2026-03-19', DeterminationDate: '2026-05-07', CostOfDevelopment: 93_180_778,
  }),
  row({
    CouncilApplicationNumber: '1382/2025/JP/B', ApplicationType: 'Modification Application',
    LodgementDate: '2026-05-20', DeterminationDate: '2026-07-02', CostOfDevelopment: 93_180_778,
  }),
  row({
    CouncilApplicationNumber: '1382/2025/JP/C', ApplicationType: 'Modification Application',
    LodgementDate: '2026-06-05', DeterminationDate: '2026-07-30', CostOfDevelopment: 93_180_778,
  }),
  row({
    CouncilApplicationNumber: '1472/2026/JP', LodgementDate: '2026-05-22', DeterminationDate: '2026-08-19',
    CostOfDevelopment: 251_357_061,
    Location: [{ Suburb: 'BOX HILL', FullAddress: '747 Windsor Road Box Hill' }],
    DevelopmentType: [{ DevelopmentType: 'Erection of a new structure' }],
  }),
];

describe('the parent an application belongs to', () => {
  it('drops the amendment segment, and only for an amendment', () => {
    expect(parentApplicationKey('1382/2025/JP/A', 'amendment')).toBe('1382/2025/JP');
    expect(parentApplicationKey('945/2016/JP/H', 'amendment')).toBe('945/2016/JP');
    expect(parentApplicationKey('1472/2026/JP', 'new')).toBe('1472/2026/JP');
  });

  it('never merges two new applications, whatever they are numbered', () => {
    // The conservative direction. Merging two real developments understates
    // the area; failing to merge is today's behaviour. A council that numbers
    // differently therefore keeps one entry per row.
    expect(parentApplicationKey('1382/2025/JP/A', 'new')).toBe('1382/2025/JP/A');
    expect(parentApplicationKey('1382/2025/JP/B', 'unclassified')).toBe('1382/2025/JP/B');
    expect(parentApplicationKey('1382/2025/JP/A', 'new'))
      .not.toBe(parentApplicationKey('1382/2025/JP/B', 'new'));
  });

  it('keeps a one-segment number whole rather than collapsing it to nothing', () => {
    // Otherwise every such row lands in one group keyed on the empty string.
    expect(parentApplicationKey('DA2026', 'amendment')).toBe('DA2026');
    expect(parentApplicationKey('   ', 'new')).toBeNull();
    expect(parentApplicationKey(undefined, 'new')).toBeNull();
  });
});

describe('the largest developments', () => {
  const summary = summariseDaRows(MEASURED, 'The Hills Shire Council', '2026-03-18', '2026-09-17', 655);

  it('prints one data centre once, not three times', () => {
    expect(summary.largestDevelopments).toHaveLength(2);
    const norwest = summary.largestDevelopments.find((d) => d.reference === '1382/2025/JP');
    expect(norwest?.statedCost).toBe(93_180_778);
    expect(norwest?.rowsInWindow).toBe(3);
    expect(norwest?.amendmentsInWindow).toBe(3);
    // Sums to $344,537,839 across the two developments, not $530,899,173
    // across the four rows.
    expect(summary.largestDevelopments.reduce((n, d) => n + (d.statedCost ?? 0), 0)).toBe(344_537_839);
  });

  it('takes the register\'s most recent statement about a development', () => {
    // An amendment restates the WHOLE cost rather than a delta, so the newest
    // row is what the register currently says and an older one is a
    // superseded copy of it.
    const norwest = summary.largestDevelopments.find((d) => d.reference === '1382/2025/JP');
    expect(norwest?.latestDate).toBe('2026-07-30');
    expect(norwest?.latestDateKind).toBe('determined');
  });

  it('says a development was approved before the window rather than calling it new', () => {
    const norwest = summary.largestDevelopments.find((d) => d.reference === '1382/2025/JP');
    const boxHill = summary.largestDevelopments.find((d) => d.reference === '1472/2026/JP');
    expect(norwest?.parentOutsideWindow).toBe(true);
    expect(boxHill?.parentOutsideWindow).toBe(false);
    expect(boxHill?.amendmentsInWindow).toBe(0);
  });

  it('carries an identity a reader can look the development up by', () => {
    const norwest = summary.largestDevelopments.find((d) => d.reference === '1382/2025/JP');
    expect(norwest?.address).toBe('3 BROOKHOLLOW AVENUE NORWEST 2153');
    expect(norwest?.suburb).toBe('NORWEST');
  });

  it('leaves the class totals alone — grouping answers a different question', () => {
    // Summing the groups gives what is being BUILT; the class totals give what
    // was newly PROPOSED in the window. Three amendments of a development
    // approved earlier belong to the first and to neither of the second.
    expect(summary.newApplications.rows).toBe(1);
    expect(summary.newApplications.statedCostTotal).toBe(251_357_061);
    expect(summary.amendments.rows).toBe(3);
    expect(summary.amendments.statedCostTotal).toBe(279_542_334);
  });
});

describe('a development is never grouped by its address', () => {
  it('keeps two developments at one address apart', () => {
    // Measured in the same window: 4 Garthowen Crescent, Castle Hill carries
    // 366/2025/JP ($181,934,581) and 323/2027/JP ($87,582,584).
    const at = (ref: string, cost: number, type: string) => row({
      CouncilApplicationNumber: ref, ApplicationType: type, CostOfDevelopment: cost,
      LodgementDate: '2026-06-29', DeterminationDate: '2026-07-07',
      Location: [{ Suburb: 'CASTLE HILL', FullAddress: '4 GARTHOWEN CRESCENT CASTLE HILL 2154' }],
    });
    const summary = summariseDaRows([
      at('366/2025/JP/A', 181_934_581, 'Modification Application'),
      at('323/2027/JP', 87_582_584, 'Development Application'),
    ], 'The Hills Shire Council', '2026-03-18', '2026-09-17', 655);
    expect(summary.largestDevelopments.map((d) => d.reference)).toEqual(['366/2025/JP', '323/2027/JP']);
  });
});
