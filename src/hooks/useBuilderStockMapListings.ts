import { useMemo } from 'react';
import { useMarketplaceBuilderStock } from '@/lib/marketplaceBuilderStock';
import { useBuilderStockMarketplaceFlag } from '@/hooks/useBuilderStockMarketplaceFlag';
import { builderStockMapListings } from '@/lib/builderStockMapPoint';
import type { PropertyListing } from '@/lib/airtable';

/**
 * Builder stock, ready to hand to the marketplace map.
 *
 * The map is written against `PropertyListing`, so this fetches the published
 * stock and projects it — see `builderStockMapPoint.ts` for why projecting is
 * preferred over teaching the map a second record type.
 *
 * Three things it deliberately does NOT do.
 *
 * It does not fetch when the flag is off. `builder_stock_marketplace` is what
 * decides whether this deployment has builder stock at all, and the tab it
 * gates is already absent; a map layer that silently queried a disabled
 * feature would be spending requests on a surface nobody can reach.
 *
 * It does not carry the tab's own filters. The map layer answers "where is the
 * builder stock", and a reader who has filtered the LISTINGS grid to Brisbane
 * has said nothing about which builder stock they want to see. The tab keeps
 * its filters; this asks for the published set.
 *
 * And it never fails the map. Builder stock is additive: if this query errors
 * the map still draws every listing, because losing the whole marketplace map
 * to a secondary layer's outage is a much worse failure than a missing layer.
 */

/**
 * The map's own ceiling. `list_stock` is paginated and the map is a visual
 * summary rather than a register — past a few hundred pins the cluster tree is
 * the only thing a reader sees anyway, and the tab is where an exhaustive list
 * belongs.
 */
const MAP_PAGE_SIZE = 250;

export interface BuilderStockMapLayer {
  listings: PropertyListing[];
  isLoading: boolean;
  /** True when the layer could not be read; the map draws listings regardless. */
  failed: boolean;
  /** Published items that carry nothing to geocode, so cannot be plotted. */
  unplottable: number;
}

export function useBuilderStockMapListings(enabled: boolean): BuilderStockMapLayer {
  const { enabled: flagEnabled } = useBuilderStockMarketplaceFlag();
  const active = enabled && flagEnabled;

  const query = useMarketplaceBuilderStock(
    {
      search: '',
      organisationId: '',
      availability: '',
      state: '',
      page: 1,
      pageSize: MAP_PAGE_SIZE,
    },
    active,
  );

  const records = useMemo(() => query.data?.records ?? [], [query.data]);
  const listings = useMemo(
    () => (active ? builderStockMapListings(records) : []),
    [active, records],
  );

  return {
    listings,
    isLoading: active && query.isLoading,
    failed: active && Boolean(query.error),
    unplottable: active ? Math.max(0, records.length - listings.length) : 0,
  };
}
