/**
 * Audit item 16 — "93 Bimbadeen Avenue" appeared five times in the cash-flow
 * comparison picker while every other address appeared once.
 *
 * The reporter's reading was that the list captures every report kind rather
 * than the Compass one, and the rows bear it out exactly: that address has one
 * completed report of each variant — snapshot, briefing, strategic, financial,
 * compass.
 *
 * Filtering by variant fixes neither half. Measured over `investment_reports`
 * on 2026-08-31:
 *
 *   listed by the picker today        1,169
 *   …carrying financial_calculations    185
 *   …distinct properties among those     98
 *   compass reports, completed        1,106  (963 carry NO figures)
 *   compass reports, 10 Chester St       20
 *
 * So a variant filter would still show one address twenty times, and would
 * drop the single property whose only report with figures is not a Compass.
 */
import { describe, expect, it } from 'vitest';

import {
  COMPARISON_CANDIDATE_PAGE_LIMIT,
  COMPARISON_CANDIDATE_PAGE_SIZE,
  COMPARISON_TOTAL_REPORTS,
  MAX_COMPARISON_PEERS,
  comparisonCandidates,
  dedupeByProperty,
  hasComparableFigures,
  propertyKey,
} from '../comparisonCandidates.pure';

const report = (
  id: string,
  address: string | null,
  financial_calculations: unknown = { annualCashFlow: -1000 },
) => ({ id, property_address: address, financial_calculations });

describe('a comparison needs figures', () => {
  it.each([
    ['an object with keys', { annualCashFlow: -1000 }, true],
    ['an empty object', {}, false],
    ['null', null, false],
    ['undefined', undefined, false],
    ['a string', 'not figures', false],
    ['an empty array', [], false],
  ])('%s → %s', (_label, figures, expected) => {
    // Built inline rather than through the helper: passing `undefined` to a
    // parameter with a default gets the default, which would quietly test the
    // wrong thing.
    expect(hasComparableFigures({
      id: 'a',
      property_address: '1 Test St',
      financial_calculations: figures,
    })).toBe(expected);
  });

  it('treats an absent key the same as an undefined one', () => {
    expect(hasComparableFigures({ id: 'a', property_address: '1 Test St' })).toBe(false);
  });

  it('drops the 984 entries that cannot be compared against', () => {
    // The row looks identical to a usable one, and choosing it compares
    // against nothing: `financial_calculations || {}` at the two consuming
    // call sites is exactly how that stayed invisible.
    const fetched = [
      report('compass-with', '10 Chester Street'),
      report('compass-without', '99 Empty Road', {}),
      report('never-generated', '98 Null Road', null),
    ];
    expect(comparisonCandidates(fetched).map((r) => r.id)).toEqual(['compass-with']);
  });
});

describe('it is a property picker, not a report picker', () => {
  it('shows 93 Bimbadeen Avenue once, not five times', () => {
    const address = '93 Bimbadeen Avenue, Banora Point NSW 2486';
    const fetched = [
      report('snapshot', address),
      report('briefing', address),
      report('strategic', address),
      report('financial', address),
      report('compass', address),
      report('other', '28 Bligh Street, Muswellbrook NSW 2333'),
    ];
    const offered = comparisonCandidates(fetched);
    expect(offered).toHaveLength(2);
    expect(offered.map((r) => r.property_address)).toEqual([
      address,
      '28 Bligh Street, Muswellbrook NSW 2333',
    ]);
  });

  it('keeps the newest, because the caller fetches newest first', () => {
    // Ordering is `created_at` descending in the query, and dedupe preserves
    // input order — so "most recent" is a property of the fetch rather than a
    // second sort here.
    const fetched = [
      report('newest', '10 Chester Street'),
      report('older', '10 Chester Street'),
      report('oldest', '10 Chester Street'),
    ];
    expect(comparisonCandidates(fetched).map((r) => r.id)).toEqual(['newest']);
  });

  it('treats spacing and case as the same property', () => {
    expect(propertyKey('  10  Chester   Street ')).toBe(propertyKey('10 Chester Street'));
    expect(propertyKey('10 CHESTER STREET')).toBe(propertyKey('10 chester street'));
    const fetched = [report('a', '10 Chester Street'), report('b', '10 CHESTER  STREET')];
    expect(dedupeByProperty(fetched)).toHaveLength(1);
  });

  it('offers no row it could not label', () => {
    // An address-less report draws a blank entry and cannot be grouped.
    expect(dedupeByProperty([report('a', null), report('b', '  ')])).toHaveLength(0);
  });
});

describe('what it must not do', () => {
  it('never filters on report variant', () => {
    // 98 distinct properties have figures; only 97 of them via a Compass
    // report. Filtering on the variant loses one property that has perfectly
    // good numbers, and leaves the twenty-rows-per-address case untouched.
    const fetched = [
      report('snapshot-only', '5 Whistlesong Court', { annualCashFlow: 1 }),
    ];
    expect(comparisonCandidates(fetched).map((r) => r.id)).toEqual(['snapshot-only']);
  });

  it('excludes the report already open, and only that one', () => {
    const fetched = [report('open', '1 A St'), report('other', '2 B St')];
    expect(comparisonCandidates(fetched, 'open').map((r) => r.id)).toEqual(['other']);
    expect(comparisonCandidates(fetched, null)).toHaveLength(2);
  });

  it('never mutates what it was given', () => {
    const fetched = [report('b', '2 B St'), report('a', '1 A St')];
    const before = fetched.map((r) => r.id);
    comparisonCandidates(fetched);
    expect(fetched.map((r) => r.id)).toEqual(before);
  });
});

/**
 * The picker read "No properties found." on a library of 1,169 completed
 * reports, and this is why.
 *
 * `get-investment-reports` declares `listOptions.select` "deprecated and
 * deliberately ignored — callers cannot define database projections", so the
 * picker's request for `financial_calculations` got the DEFAULT `library`
 * projection, which does not select that column. `hasComparableFigures` tested
 * a field the response could never contain and rejected every row, which looks
 * exactly like a workspace with nothing to compare.
 *
 * The projection built for cash-flow surfaces is `cashFlowLibrary`: it resolves
 * the two headline figures server-side into scalars and deletes the source
 * blob. So the rule has to hold for both shapes of the same report.
 */
describe('the shape the list endpoint actually returns', () => {
  const libraryRow = (id: string, address: string, over: Record<string, unknown> = {}) => ({
    id,
    property_address: address,
    // Exactly what `cashFlowLibrary` publishes: no `financial_calculations`
    // key at all, because `toLibraryFinancialSummary` deletes it.
    cash_flow_purchase_price: 800_000,
    cash_flow_weekly_rent: 700,
    ...over,
  });

  it('accepts a row carrying only the resolved scalars', () => {
    expect(hasComparableFigures(libraryRow('a', '10 Chester Street'))).toBe(true);
  });

  it('accepts a price with no rent, and a rent with no price', () => {
    // Either figure alone is something a projection can be drawn from; the
    // engine defaults the other, and the card says which one is missing.
    expect(hasComparableFigures(libraryRow('a', '1 St', { cash_flow_weekly_rent: null }))).toBe(true);
    expect(hasComparableFigures(libraryRow('a', '1 St', { cash_flow_purchase_price: null }))).toBe(true);
  });

  it('still rejects a row with neither figure and no source blob', () => {
    expect(hasComparableFigures(libraryRow('a', '1 St', {
      cash_flow_purchase_price: null,
      cash_flow_weekly_rent: null,
    }))).toBe(false);
  });

  it('offers the library rows the popover used to reject wholesale', () => {
    const fetched = [
      libraryRow('chester', '10 Chester Street, Newcastle NSW 2300'),
      libraryRow('bligh', '28 Bligh Street, Muswellbrook NSW 2333'),
      libraryRow('empty', '99 Empty Road', {
        cash_flow_purchase_price: null,
        cash_flow_weekly_rent: null,
      }),
    ];
    expect(comparisonCandidates(fetched).map((r) => r.id)).toEqual(['chester', 'bligh']);
  });

  it('reads a manual override the same way the cash-flow engine does', () => {
    expect(hasComparableFigures({
      id: 'a',
      property_address: '1 St',
      manual_overrides: { weeklyRent: 650 },
    })).toBe(true);
  });
});

describe('a comparison holds five reports', () => {
  it('names the ceiling once, as a total and as peers', () => {
    // Three surfaces state it — the toggle's ceiling, the picker's counter and
    // the "maximum reached" message — and three literals is how a picker comes
    // to offer a fifth peer the handler then refuses.
    expect(COMPARISON_TOTAL_REPORTS).toBe(5);
    expect(MAX_COMPARISON_PEERS).toBe(COMPARISON_TOTAL_REPORTS - 1);
  });

  it('walks the library in pages the endpoint accepts', () => {
    // 200 is `get-investment-reports`' maximum; the default of 50 is what made
    // the picker show a handful of addresses out of ~98 properties.
    expect(COMPARISON_CANDIDATE_PAGE_SIZE).toBe(200);
    expect(COMPARISON_CANDIDATE_PAGE_SIZE).toBeLessThanOrEqual(200);
    expect(COMPARISON_CANDIDATE_PAGE_LIMIT).toBeGreaterThanOrEqual(6);
  });
});

describe('the property being analysed is not offered as its own peer', () => {
  const open = { id: 'open-report', property_address: '48 Budgeree Street, Tea Gardens NSW 2324' };
  const sibling = {
    id: 'sibling-report',
    property_address: '48 Budgeree Street, Tea Gardens NSW 2324',
    cash_flow_purchase_price: 1_190_000,
  };
  const other = {
    id: 'other',
    property_address: '10 Chester Street, Newcastle NSW 2300',
    cash_flow_purchase_price: 845_000,
  };

  it('drops the sibling reports of the property already open', () => {
    // One property has up to twenty completed reports, so excluding the open
    // report by id alone left its own address one row below itself.
    const offered = comparisonCandidates([sibling, other], open.id, open.property_address);
    expect(offered.map((r) => r.id)).toEqual(['other']);
  });

  it('matches the property across case and spacing', () => {
    const shouty = { ...sibling, property_address: '48 BUDGEREE  STREET, TEA GARDENS NSW 2324' };
    expect(comparisonCandidates([shouty, other], open.id, open.property_address).map((r) => r.id))
      .toEqual(['other']);
  });

  it('still excludes by id when the open report has no address', () => {
    const openRow = { ...sibling, id: open.id };
    expect(comparisonCandidates([openRow, other], open.id, null).map((r) => r.id)).toEqual(['other']);
  });

  it('offers everything when no exclusion is given', () => {
    expect(comparisonCandidates([sibling, other]).map((r) => r.id)).toEqual(['sibling-report', 'other']);
  });
});
