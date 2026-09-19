/**
 * Is the Builder Stock tab available in the Property Marketplace?
 *
 * READ THROUGH THE SERVER, NOT THE TABLE. `feature_flags` grants SELECT to
 * `authenticated`, and the Command Centre's browser client is anon-only — its
 * identity is the custom HttpOnly cookie session, which never becomes a GoTrue
 * `authenticated` role (see `src/integrations/supabase/client.ts`). A direct
 * `from('feature_flags')` read from the page therefore returns nothing, and the
 * flag would read as off however it was set. `builder-stock-marketplace`
 * answers `feature_state` with the service role after checking the caller
 * against the `listings` module.
 *
 * Fails CLOSED: an unreadable state hides the tab.
 *
 * PRESENTATION GATING ONLY. The same function re-reads the same flag before
 * every other operation and refuses when it is off, so this hook decides what a
 * user SEES and never what they may reach. Hiding a tab whose endpoint still
 * answers is not a switch.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export const BUILDER_STOCK_FLAG_KEY = 'builder_stock_marketplace';

const flagQueryKey = ['feature-flag', BUILDER_STOCK_FLAG_KEY] as const;

/** `true`, `"true"` and `{ enabled: true }` all mean on. Everything else is off. */
export function coerceFlagEnabled(value: unknown): boolean {
  return value === true || value === 'true'
    || (typeof value === 'object' && value !== null
      && (value as { enabled?: unknown }).enabled === true);
}

async function readFlag(): Promise<boolean> {
  try {
    const { data, error } = await invokeSecureFunction<{ enabled?: boolean }>(
      'builder-stock-marketplace', { operation: 'feature_state' },
    );
    if (error) return false;
    return data?.enabled === true;
  } catch {
    return false;
  }
}

export function useBuilderStockMarketplaceFlag(): { loading: boolean; enabled: boolean } {
  const query = useQuery({
    queryKey: flagQueryKey,
    queryFn: readFlag,
    staleTime: 60_000,
  });
  return { loading: query.isLoading, enabled: query.data === true };
}

/** Let the Settings toggle refresh every surface that read the flag. */
export function useInvalidateBuilderStockFlag(): () => void {
  const queryClient = useQueryClient();
  return () => { void queryClient.invalidateQueries({ queryKey: flagQueryKey }); };
}
