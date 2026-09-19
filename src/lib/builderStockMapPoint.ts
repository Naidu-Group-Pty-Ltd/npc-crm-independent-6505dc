import type { BuilderStockItem } from '@/lib/builderStock';
import { builderStockAddress } from '../../supabase/functions/_shared/builderStockAddress.pure';
import type { PropertyListing } from '@/lib/airtable';

/**
 * Builder stock, projected into the shape the marketplace map already plots.
 *
 * The map's whole apparatus — the server-side geocoder restricted to
 * `country:AU`, the Australian sanity gate, the suburb consensus, the cluster
 * anchoring, the price banding, the results panel — is written against
 * `PropertyListing`. Builder stock is a different table with a different shape
 * and, critically, **no coordinates at all**: `builder_stock_items` carries
 * `address_line`, `suburb`, `state` and `postcode` and has never had a
 * latitude or longitude column.
 *
 * So the choice is between teaching the map a second record type — a second
 * geocoding path, a second gate, a second cluster tree, and two implementations
 * of "where is this property" that will disagree the first time one is edited —
 * or projecting one type onto the other and getting all of it for free. This is
 * the projection. Builder stock reaches the map with no coordinates, which is
 * exactly the state an ordinary listing arrives in, and the same resolver
 * geocodes it under the same restriction and the same checks.
 *
 * Three rules hold it.
 *
 * **The id is prefixed and reversible.** A builder stock id and an Airtable
 * record id share one namespace once both are on the map — the marker index,
 * the selection, the in-view panel and the position cache are all keyed by
 * `listing.id` — and a collision would silently show the wrong property. The
 * prefix makes them disjoint and `builderStockIdFromMapId` reads it back, so a
 * click can still reach the real record.
 *
 * **Nothing is invented.** A field builder stock does not carry is null, never
 * a placeholder: this repo has already been bitten by `'Unknown Address'`,
 * which is not falsy and so answered "no" to every "is this missing?" check
 * downstream. `price_display` is preferred over a formatted number because it
 * is what the builder actually published.
 *
 * **An archived or staged item is never projected.** `staged` is imported but
 * not published, `archived` is withdrawn; the marketplace shows neither, and a
 * map that disagreed with the list beside it would be worse than no map.
 */

/** Marks a map id as belonging to builder stock rather than to Airtable. */
export const BUILDER_STOCK_MAP_PREFIX = 'bstock:';

export function builderStockMapId(itemId: string): string {
  return `${BUILDER_STOCK_MAP_PREFIX}${itemId}`;
}

/** The inverse. Returns null for anything that is not a builder stock map id. */
export function builderStockIdFromMapId(mapId: string): string | null {
  return mapId.startsWith(BUILDER_STOCK_MAP_PREFIX)
    ? mapId.slice(BUILDER_STOCK_MAP_PREFIX.length)
    : null;
}

export function isBuilderStockMapId(mapId: string): boolean {
  return mapId.startsWith(BUILDER_STOCK_MAP_PREFIX);
}

/** Only what the marketplace publishes may be plotted. */
export function isPlottableBuilderStock(item: BuilderStockItem): boolean {
  if (item.lifecycle_status !== 'active') return false;
  // Something to geocode. Suburb alone is enough — an estate's suburb is a
  // real answer to "where is this" — but nothing at all is not.
  return Boolean(
    (item.address_line && item.address_line.trim()) ||
      (item.suburb && item.suburb.trim()) ||
      (item.postcode && item.postcode.trim()),
  );
}

/**
 * The title a pin and its card carry. A builder's stock is identified by its
 * development far more usefully than by a lot number, so the development leads
 * and the lot/unit qualifies it.
 */
export function builderStockTitle(item: BuilderStockItem): string {
  const unit = [
    item.lot_number ? `Lot ${item.lot_number}` : null,
    item.unit_number ? `Unit ${item.unit_number}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const development = item.development_name || item.project_name || null;
  if (development && unit) return `${development} — ${unit}`;
  if (development) return development;
  if (unit) return unit;
  return item.address_line || item.suburb || 'Builder stock';
}

const trimmed = (value: string | null | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const out = value.trim();
  return out.length > 0 ? out : undefined;
};

export function builderStockToMapListing(item: BuilderStockItem): PropertyListing {
  const title = builderStockTitle(item);
  /**
   * The address, taken apart before it is asked of anyone.
   *
   * `address_line` was handed to the geocoder whole — lot prefix, estate name
   * and `[Stradbroke 180]` design suffix included — which is not a question a
   * provider can answer at street level, so every lot in a release landed on
   * its suburb's centroid and stacked on one pin. See builderStockAddress.
   */
  const composed = builderStockAddress(item);
  return {
    id: builderStockMapId(item.id),
    title,
    price: typeof item.price === 'number' && item.price > 0 ? item.price : null,
    location: trimmed(item.suburb) ?? null,
    bedrooms: item.bedrooms ?? null,
    bathrooms: item.bathrooms ?? null,
    propertyType: trimmed(item.property_type) ?? null,
    listingDate: item.created_at,
    // The builder's own availability word is the status a reader wants.
    status: trimmed(item.availability_status) ?? null,
    confidence: null,
    source: 'builder_stock',
    description: trimmed(item.description) ?? '',
    images: [],
    agent: null,
    features: [],
    // Geography — the only part the map strictly needs. No coordinates exist
    // on this table, so they are deliberately absent and the resolver earns
    // them the same way it does for a listing with none.
    // The parsed street line, not the raw list entry. `address` is what the
    // resolver geocodes, so this is the whole of the fix.
    // Every parsed value goes back through `trimmed` so an absent field stays
    // `undefined` rather than becoming `null`: the projection's own rule is
    // that a missing field must not be a value, and the two are distinguished
    // by callers.
    address: trimmed(composed.street) ?? trimmed(item.address_line),
    addressPrecision: composed.precision,
    suburb: trimmed(composed.parsed.suburb) ?? trimmed(item.suburb),
    state: trimmed(composed.parsed.state) ?? trimmed(item.state),
    // 93 of 124 rows carry a postcode inside the text and 2 have it in the
    // column. The postcode is what stops `Donnybrook` resolving to WA.
    zipCode: trimmed(item.postcode) ?? trimmed(composed.parsed.postcode),
    streetNumber: trimmed(composed.parsed.streetNumber),
    streetName: trimmed(composed.parsed.streetName),
    streetType: trimmed(composed.parsed.streetType),
    latitude: null,
    longitude: null,
    beds: item.bedrooms ?? null,
    baths: item.bathrooms ?? null,
    carSpaces: item.car_spaces ?? null,
    landSizeSqm: item.land_size_sqm ?? null,
    lotNumber: trimmed(item.lot_number) ?? trimmed(composed.parsed.lotNumber),
    /** The estate's marketing name — shown to a reader, never geocoded. */
    estateName: trimmed(composed.parsed.estate),
    listingStatus: trimmed(item.availability_status),
    createdAt: item.created_at,
  } as PropertyListing;
}

export function builderStockMapListings(items: BuilderStockItem[]): PropertyListing[] {
  return items.filter(isPlottableBuilderStock).map(builderStockToMapListing);
}
