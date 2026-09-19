/**
 * The Property Identity table was blank on reports whose operator had typed
 * the numbers in.
 *
 * Measured over all 1,199 stored reports: `property_specs` carries nine
 * attributes and six have never held a value — `parking`, `year_built`,
 * `building_size_sqm`, `land_size_sqm`, `council_area`, `zoning`. The binding
 * projection publishes all nine, so `property.landArea`, `property.buildingArea`
 * and the car count in `property.configuration` rendered as absent on every
 * document the product has ever issued.
 *
 * Four of those six were never actually missing. Operators enter them in the
 * manual inputs panel and they land in `manual_overrides` under different
 * spellings from the ones `property_specs` uses:
 *
 *   land size        150 reports   `landSizeSqm` / `landSize`
 *   build size       145 reports   `buildSizeSqm` / `buildSize`
 *   car spaces       155 reports   `carSpaces`
 *   construction year 29 reports   `constructionYear`
 *
 * Nothing ever copied them across. The repair is on the READ path — the same
 * treatment `reconcileStoredFinancials` gives the financial fold — so no stored
 * row is rewritten and every report already issued gains the figure its
 * operator supplied.
 *
 * The fixtures below are real production rows, verbatim.
 */
import { describe, expect, it } from 'vitest';
import { projectInvestmentReport } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';

/** Production row 6d1157e0 — 28 Bligh Street, Muswellbrook NSW 2333. */
const BLIGH = {
  property_address: '28 Bligh Street, Muswellbrook NSW 2333',
  property_specs: {
    zoning: null, parking: null, bedrooms: null, bathrooms: null,
    year_built: null, council_area: null, land_size_sqm: null,
    property_type: 'Residential Property', building_size_sqm: null,
  },
  manual_overrides: { landSizeSqm: 771 },
};

/** Production row c15ce1b0 — 6 Acer Court. */
const ACER = {
  property_address: '6 Acer Court',
  property_specs: {
    zoning: null, parking: null, bedrooms: null, bathrooms: null,
    year_built: null, council_area: null, land_size_sqm: null,
    property_type: 'Residential Property', building_size_sqm: null,
  },
  manual_overrides: { landSizeSqm: 1922, buildSizeSqm: 253, carSpaces: 2 },
};

describe('an operator-entered attribute reaches the document', () => {
  it('publishes the land size the operator typed', () => {
    expect(projectInvestmentReport(BLIGH as never).property.landArea).toBe(771);
    expect(projectInvestmentReport(ACER as never).property.landArea).toBe(1922);
  });

  it('publishes build size and the car count', () => {
    const p = projectInvestmentReport(ACER as never).property;
    expect(p.buildingArea).toBe(253);
    expect(p.configuration).toBe('2 car');
  });

  it('accepts the alternate spellings production also stores', () => {
    const p = projectInvestmentReport({
      property_specs: {},
      manual_overrides: { landSize: 640, buildSize: 180, constructionYear: 2019 },
    } as never).property;
    expect(p.landArea).toBe(640);
    expect(p.buildingArea).toBe(180);
    expect(p.yearBuilt).toBe(2019);
  });
});

describe('the repair never overrides a real stored value', () => {
  it('a stored spec wins over an operator entry for the same attribute', () => {
    const p = projectInvestmentReport({
      property_specs: { land_size_sqm: 500 },
      manual_overrides: { landSizeSqm: 9999 },
    } as never).property;
    expect(p.landArea).toBe(500);
  });

  it('precedence is by SOURCE, not by key — a stored spec beats an alias in a later source', () => {
    // `land_size_sqm` and `landSizeSqm` are the same attribute spelled two
    // ways. Checking key-by-key instead of source-by-source would let the
    // override win simply because its spelling was listed first.
    const p = projectInvestmentReport({
      property_specs: { land_size_sqm: 500 },
      manual_overrides: { landSize: 9999, landSizeSqm: 8888 },
    } as never).property;
    expect(p.landArea).toBe(500);
  });

  it('treats an empty string as absent rather than as a value', () => {
    const p = projectInvestmentReport({
      property_specs: { land_size_sqm: '' },
      manual_overrides: { landSizeSqm: 771 },
    } as never).property;
    expect(p.landArea).toBe(771);
  });
});

describe('what no source has stays absent', () => {
  it('does not invent zoning or council', () => {
    // Neither specs nor overrides carry them on any of the 1,199 reports, and
    // no table in the schema has them. A labelled row is a promise that a
    // figure follows it, so the projection publishes nothing.
    const p = projectInvestmentReport(ACER as never).property;
    expect(p.zoning).toBeUndefined();
    expect(p.council).toBeUndefined();
  });

  it('omits configuration entirely when nothing is known', () => {
    const p = projectInvestmentReport({ property_specs: {}, manual_overrides: {} } as never).property;
    expect(p.configuration).toBeUndefined();
    expect(p.landArea).toBeUndefined();
  });
});
