/**
 * Command Centre — Builder Stock query layer for the Property Marketplace.
 *
 * Every call goes through `invokeSecureFunction`, which carries the internal
 * HttpOnly session cookie and the CSRF-safe carriers the rest of the dashboard
 * uses. Nothing here reads `builder_stock_*` directly: those tables have no
 * `authenticated` policy, on purpose — the module permission and the feature
 * flag are both enforced inside the edge function, and a direct client read
 * would bypass both.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { BuilderStockItem, BuilderStockSelection } from '@/lib/builderStock';
import type { MirrorSource } from '../../supabase/functions/_shared/builderStock/mirrorAvailability.pure';

export const marketplaceStockKeys = {
  root: () => ['marketplace', 'builder-stock'] as const,
  items: (filters: MarketplaceStockFilters) =>
    ['marketplace', 'builder-stock', 'items', filters] as const,
  builders: () => ['marketplace', 'builder-stock', 'builders'] as const,
  selections: (clientId: string) =>
    ['marketplace', 'builder-stock', 'selections', clientId] as const,
  clientSearch: (search: string) =>
    ['marketplace', 'builder-stock', 'client-search', search] as const,
};

export interface MarketplaceStockFilters {
  search: string;
  organisationId: string;
  availability: string;
  state: string;
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  records: T[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
  /**
   * What the workspace can say about the Builders Network link this mirror is
   * fed by. Absent on a deployment running ahead of the function, which
   * `readStockEmptyState` reads as `unknown` rather than as "no link".
   */
  source?: MirrorSource;
  /** Organisations holding a disclosed commercial placement on this result set. */
  promoted_organisations?: string[];
  /**
   * Whether this page is ordered by merit.
   *
   * `false` means the ranking migration has not reached this deployment, so
   * the list is real and its ORDER carries no information. Absent means a
   * deployment running ahead of the function, which the surface reads as
   * "say nothing" rather than as unranked.
   */
  ranked?: boolean;
}

export interface MarketplaceBuilder {
  id: string;
  legal_name: string;
  trading_name: string | null;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>('builder-stock-marketplace', body);
  const message = error?.message || (data as { error?: string } | null)?.error;
  if (message) {
    const failure = new Error(message) as Error & { code?: string };
    failure.code = (data as { code?: string } | null)?.code;
    throw failure;
  }
  return data as T;
}

export function useMarketplaceBuilderStock(
  filters: MarketplaceStockFilters,
  enabled: boolean,
) {
  return useQuery({
    queryKey: marketplaceStockKeys.items(filters),
    enabled,
    queryFn: () => invoke<Paginated<BuilderStockItem>>({
      operation: 'list_stock',
      search: filters.search,
      organisation_id: filters.organisationId,
      availability_status: filters.availability,
      state: filters.state,
      page: filters.page,
      page_size: filters.pageSize,
    }),
  });
}

export function useMarketplaceBuilders(enabled: boolean) {
  return useQuery({
    queryKey: marketplaceStockKeys.builders(),
    enabled,
    queryFn: () => invoke<{ records: MarketplaceBuilder[] }>({ operation: 'list_builders' }),
  });
}

export interface MarketplaceClientOption {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
}

export function useMarketplaceClientSearch(search: string, enabled: boolean) {
  return useQuery({
    queryKey: marketplaceStockKeys.clientSearch(search),
    enabled,
    queryFn: () => invoke<{ records: MarketplaceClientOption[] }>({
      operation: 'search_clients', search,
    }),
  });
}

export function useMarketplaceStockSelections(clientId: string, enabled: boolean) {
  return useQuery({
    queryKey: marketplaceStockKeys.selections(clientId),
    enabled,
    queryFn: () => invoke<Paginated<BuilderStockSelection>>({
      operation: 'list_selections', client_id: clientId, page: 1, page_size: 50,
    }),
  });
}

/**
 * Select a builder property for a client.
 *
 * The request names only the property and the client. Which builder supplied
 * it and by which of their users are resolved server-side from the property's
 * own mirror row — the two-way link is a set of foreign keys the browser
 * never gets to choose.
 *
 * Supplying a picture on the builder's behalf used to live beside this and is
 * gone with the portal's image pipeline (network extraction Phase 7): imagery
 * is managed on the Builders Network, and the marketplace serves what the
 * network delivers.
 */
export function useSelectBuilderStockForClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { stockItemId: string; clientId: string; notes?: string }) =>
      invoke<{ record: BuilderStockSelection; already_selected?: boolean }>({
        operation: 'select_for_client',
        stock_item_id: input.stockItemId,
        client_id: input.clientId,
        notes: input.notes,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketplaceStockKeys.root() });
    },
  });
}

export function useSetStockSelectionStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { selectionId: string; status: string }) =>
      invoke<{ record: BuilderStockSelection }>({
        operation: 'set_selection_status',
        selection_id: input.selectionId,
        status: input.status,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketplaceStockKeys.root() });
    },
  });
}

/** A short-lived signed URL for one stored builder-stock image. */
export async function marketplaceStockImageUrl(imageId: string): Promise<string | null> {
  try {
    const result = await invoke<{ url?: string }>({ operation: 'image_url', image_id: imageId });
    return result.url ?? null;
  } catch {
    return null;
  }
}
