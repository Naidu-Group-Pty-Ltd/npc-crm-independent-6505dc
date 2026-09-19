/**
 * The comparison picker's list logic.
 *
 * The picker exists because choosing which four completed reports a client's
 * decision gets argued from was a 380px popover of addresses — no figures, no
 * order, one line per property. Everything asserted here is derived from the
 * candidate row; nothing in the module fetches, filters for comparability, or
 * decides anything the server decides.
 */
import { describe, expect, it } from 'vitest';

import {
  canAddMore,
  grossYield,
  matchesQuery,
  selectionSummary,
  sortRows,
  toPickerRow,
  visibleRows,
  type PickerRow,
} from '../comparisonPicker.pure';

const row = (over: Partial<PickerRow> = {}): PickerRow => ({
  id: 'a',
  address: '10 Chester Street, Newcastle NSW 2300',
  purchasePrice: 800_000,
  weeklyRent: 700,
  grossYield: grossYield(800_000, 700),
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

describe('gross yield', () => {
  it('annualises the weekly rent at 52 weeks', () => {
    // 700 × 52 = 36,400 on 800,000 → 4.55%
    expect(grossYield(800_000, 700)).toBeCloseTo(4.55, 2);
  });

  it.each([
    ['no price', null, 700],
    ['no rent', 800_000, null],
    ['a zero price', 0, 700],
    ['a zero rent', 800_000, 0],
    ['a negative price', -1, 700],
    ['a non-finite price', Number.NaN, 700],
  ])('is unknown with %s', (_label, price, rent) => {
    // Not 0%. A property whose rent was never recorded has an unknown yield,
    // and 0% is a claim about the property rather than about the record.
    expect(grossYield(price as number | null, rent as number | null)).toBeNull();
  });
});

describe('projecting a candidate', () => {
  it('reads the figures the list projection publishes', () => {
    // `cashFlowLibrary` resolves the two headline figures server-side and
    // deletes the source blob, so these scalars are all the picker ever gets.
    const projected = toPickerRow({
      id: 'library-row',
      property_address: '28 Bligh Street, Muswellbrook NSW 2333',
      cash_flow_purchase_price: 640_000,
      cash_flow_weekly_rent: 620,
      created_at: '2026-07-14T09:00:00.000Z',
    });
    expect(projected.purchasePrice).toBe(640_000);
    expect(projected.weeklyRent).toBe(620);
    expect(projected.grossYield).toBeCloseTo(5.04, 2);
  });

  it('reads the figures the comparison projection carries', () => {
    const projected = toPickerRow({
      id: 'source-row',
      property_address: '10 Chester Street',
      financial_calculations: { initialCosts: { propertyValue: 800_000 }, income: { weeklyRent: 700 } },
    });
    expect(projected.purchasePrice).toBe(800_000);
    expect(projected.weeklyRent).toBe(700);
  });

  it('lets a manual override win, as the cash-flow engine does', () => {
    const projected = toPickerRow({
      id: 'overridden',
      property_address: '10 Chester Street',
      manual_overrides: { purchasePrice: 950_000 },
      financial_calculations: { initialCosts: { propertyValue: 800_000 } },
    });
    expect(projected.purchasePrice).toBe(950_000);
  });

  it('does not invent an address', () => {
    expect(toPickerRow({ id: 'x', property_address: null }).address).toBe('');
  });
});

describe('search', () => {
  it('requires every word, so the suburb narrows the street', () => {
    const chesterNsw = row({ address: '10 Chester Street, Newcastle NSW 2300' });
    const chesterVic = row({ address: '10 Chester Street, Geelong VIC 3220' });
    expect(matchesQuery(chesterNsw, 'chester nsw')).toBe(true);
    expect(matchesQuery(chesterVic, 'chester nsw')).toBe(false);
  });

  it('matches words that are not adjacent in the address', () => {
    // A single substring test cannot do this, which is the whole reason the
    // rule is per-word.
    expect(matchesQuery(row(), 'chester 2300')).toBe(true);
  });

  it('ignores case and stray spacing, and an empty query matches everything', () => {
    expect(matchesQuery(row(), '  CHESTER   newcastle ')).toBe(true);
    expect(matchesQuery(row(), '')).toBe(true);
    expect(matchesQuery(row(), '   ')).toBe(true);
  });
});

describe('ordering', () => {
  const cheap = row({ id: 'cheap', address: 'A Street', purchasePrice: 400_000, weeklyRent: 500, grossYield: grossYield(400_000, 500) });
  const dear = row({ id: 'dear', address: 'C Street', purchasePrice: 1_200_000, weeklyRent: 800, grossYield: grossYield(1_200_000, 800) });
  const unpriced = row({ id: 'unpriced', address: 'B Street', purchasePrice: null, weeklyRent: null, grossYield: null });

  it('leaves the fetch order alone by default', () => {
    // The query returns newest first and dedupe preserves input order, so
    // "most recent" is a property of the fetch rather than a second sort.
    expect(sortRows([dear, cheap, unpriced], 'recent').map((r) => r.id)).toEqual(['dear', 'cheap', 'unpriced']);
  });

  it('puts an unpriced record last rather than first', () => {
    // A record with no price is not the cheapest property, and sorting it as
    // zero would put every incomplete row at the top of "highest price".
    expect(sortRows([cheap, unpriced, dear], 'price_desc').map((r) => r.id)).toEqual(['dear', 'cheap', 'unpriced']);
    expect(sortRows([cheap, unpriced, dear], 'yield_desc').map((r) => r.id)).toEqual(['cheap', 'dear', 'unpriced']);
  });

  it('sorts by address alphabetically', () => {
    expect(sortRows([dear, unpriced, cheap], 'address').map((r) => r.id)).toEqual(['cheap', 'unpriced', 'dear']);
  });

  it('does not mutate the list it was given', () => {
    const input = [dear, cheap];
    sortRows(input, 'address');
    expect(input.map((r) => r.id)).toEqual(['dear', 'cheap']);
  });

  it('searches before it sorts', () => {
    const shown = visibleRows([cheap, dear, unpriced], 'street', 'price_desc');
    expect(shown.map((r) => r.id)).toEqual(['dear', 'cheap', 'unpriced']);
  });
});

describe('the counter', () => {
  it('counts reports compared, including the one already open', () => {
    // The ceiling is five reports, not five peers, and the heading says five —
    // a counter reading "2 of 4" beside it is two ways of saying one thing.
    expect(selectionSummary(0, 5)).toBe('Comparing 1 of 5 reports');
    expect(selectionSummary(4, 5)).toBe('Comparing 5 of 5 reports');
  });

  it('stops offering more at four peers', () => {
    expect(canAddMore(3, 4)).toBe(true);
    expect(canAddMore(4, 4)).toBe(false);
  });
});
