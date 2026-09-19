import { describe, expect, it } from 'vitest';
import type { BuilderStockItem } from '@/lib/builderStock';
import {
  BUILDER_STOCK_MAP_PREFIX,
  builderStockIdFromMapId,
  builderStockMapId,
  builderStockMapListings,
  builderStockTitle,
  builderStockToMapListing,
  isBuilderStockMapId,
  isPlottableBuilderStock,
} from '@/lib/builderStockMapPoint';

function item(overrides: Partial<BuilderStockItem> = {}): BuilderStockItem {
  return {
    id: 'a69ffa37-1236-4993-942e-edb03c86df34',
    organisation_id: 'org-1',
    upload_id: null,
    first_upload_id: null,
    created_by_builder_user_id: null,
    builder_project_id: null,
    builder_unit_id: null,
    external_reference: null,
    development_name: 'Verve Estate',
    project_name: null,
    address_line: null,
    suburb: 'Clyde',
    state: null,
    postcode: null,
    lot_number: null,
    unit_number: null,
    bedrooms: 4,
    bathrooms: 2,
    car_spaces: 2,
    property_type: null,
    land_size_sqm: 350,
    building_size_sqm: null,
    price: 821150,
    price_display: null,
    availability_status: 'available',
    expected_completion: null,
    description: null,
    lifecycle_status: 'active',
    enrichment_status: 'pending',
    enriched_at: null,
    primary_image_id: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    last_seen_at: '2026-09-01T00:00:00Z',
    ...overrides,
  } as BuilderStockItem;
}

describe('builder stock map ids', () => {
  it('round-trips an id through the prefix', () => {
    const mapId = builderStockMapId('abc-123');
    expect(mapId).toBe(`${BUILDER_STOCK_MAP_PREFIX}abc-123`);
    expect(builderStockIdFromMapId(mapId)).toBe('abc-123');
    expect(isBuilderStockMapId(mapId)).toBe(true);
  });

  it('never claims an Airtable record id', () => {
    // The two id spaces share one marker index once both are on the map, so a
    // false positive here shows the wrong property behind a pin.
    expect(isBuilderStockMapId('rec9UvkksQMIoKa0c')).toBe(false);
    expect(builderStockIdFromMapId('rec9UvkksQMIoKa0c')).toBeNull();
    expect(builderStockIdFromMapId('')).toBeNull();
  });

  it('gives builder stock and listings disjoint ids', () => {
    const mapped = builderStockToMapListing(item());
    expect(mapped.id).not.toBe(item().id);
    expect(isBuilderStockMapId(mapped.id)).toBe(true);
  });
});

describe('isPlottableBuilderStock', () => {
  it('plots an active item that carries any geography', () => {
    expect(isPlottableBuilderStock(item({ suburb: 'Clyde' }))).toBe(true);
    expect(isPlottableBuilderStock(item({ suburb: null, address_line: '12 Foo St' }))).toBe(true);
    expect(isPlottableBuilderStock(item({ suburb: null, postcode: '3978' }))).toBe(true);
  });

  it('refuses staged and archived items, which the marketplace does not publish', () => {
    expect(isPlottableBuilderStock(item({ lifecycle_status: 'staged' }))).toBe(false);
    expect(isPlottableBuilderStock(item({ lifecycle_status: 'archived' }))).toBe(false);
  });

  it('refuses an item with nothing to geocode', () => {
    expect(
      isPlottableBuilderStock(
        item({ suburb: null, address_line: null, postcode: null }),
      ),
    ).toBe(false);
    // Whitespace is not geography.
    expect(
      isPlottableBuilderStock(
        item({ suburb: '   ', address_line: '', postcode: '  ' }),
      ),
    ).toBe(false);
  });
});

describe('builderStockTitle', () => {
  it('leads with the development, which is how builder stock is known', () => {
    expect(builderStockTitle(item())).toBe('Verve Estate');
  });

  it('qualifies the development with the lot or unit when there is one', () => {
    expect(builderStockTitle(item({ lot_number: '412' }))).toBe('Verve Estate — Lot 412');
    expect(builderStockTitle(item({ unit_number: '7' }))).toBe('Verve Estate — Unit 7');
  });

  it('falls back through project, address and suburb rather than inventing one', () => {
    expect(builderStockTitle(item({ development_name: null, project_name: 'Stage 3' })))
      .toBe('Stage 3');
    expect(
      builderStockTitle(
        item({ development_name: null, project_name: null, address_line: '9 Kerr St' }),
      ),
    ).toBe('9 Kerr St');
    expect(
      builderStockTitle(
        item({ development_name: null, project_name: null, address_line: null }),
      ),
    ).toBe('Clyde');
  });
});

describe('builderStockToMapListing', () => {
  it('carries the geography the geocoder needs and no coordinates', () => {
    const mapped = builderStockToMapListing(
      item({ address_line: '12 Kerr St', suburb: 'Clyde', state: 'VIC', postcode: '3978' }),
    );
    // The street line is PARSED now, and a bare leading number on builder
    // stock is a lot rather than a street number — measured: of the 44 live
    // rows that open with a number and also carry a `lot_number`, it equals
    // the lot in all 44. So `12` is lot 12 on Kerr Street, and the geocoder is
    // asked for the street rather than for a house that may belong to someone
    // else. See builderStockAddress.pure.ts.
    expect(mapped.address).toBe('Kerr Street');
    expect(mapped.lotNumber).toBe('12');
    expect(mapped.suburb).toBe('Clyde');
    expect(mapped.state).toBe('VIC');
    expect(mapped.zipCode).toBe('3978');
    // builder_stock_items has no latitude/longitude columns at all, so the
    // projection must not pretend otherwise — it arrives exactly as a listing
    // with no coordinates does, and the same resolver earns them.
    expect(mapped.latitude).toBeNull();
    expect(mapped.longitude).toBeNull();
  });

  it('marks its source so the map can tell the two tables apart', () => {
    expect(builderStockToMapListing(item()).source).toBe('builder_stock');
  });

  it('never invents a field the record does not carry', () => {
    const mapped = builderStockToMapListing(
      item({ address_line: null, state: null, postcode: null, property_type: null }),
    );
    // 'Unknown Address' and friends are not falsy, which is why every
    // "is this missing?" check downstream once silently answered no.
    expect(mapped.address).toBeUndefined();
    expect(mapped.state).toBeUndefined();
    expect(mapped.zipCode).toBeUndefined();
    expect(mapped.propertyType).toBeNull();
    expect(JSON.stringify(mapped)).not.toMatch(/Unknown/i);
  });

  it('treats a zero or negative price as no price', () => {
    expect(builderStockToMapListing(item({ price: 0 })).price).toBeNull();
    expect(builderStockToMapListing(item({ price: -1 })).price).toBeNull();
    expect(builderStockToMapListing(item({ price: 821150 })).price).toBe(821150);
  });

  it('carries the builder’s own availability word as the status', () => {
    expect(builderStockToMapListing(item({ availability_status: 'sold' })).listingStatus)
      .toBe('sold');
  });
});

describe('builderStockMapListings', () => {
  it('projects only what the marketplace publishes', () => {
    const rows = builderStockMapListings([
      item({ id: 'a', lifecycle_status: 'active' }),
      item({ id: 'b', lifecycle_status: 'staged' }),
      item({ id: 'c', lifecycle_status: 'archived' }),
      item({ id: 'd', lifecycle_status: 'active', suburb: null, address_line: null, postcode: null }),
    ]);
    expect(rows.map((r) => r.id)).toEqual([builderStockMapId('a')]);
  });

  it('survives an empty list', () => {
    expect(builderStockMapListings([])).toEqual([]);
  });
});
