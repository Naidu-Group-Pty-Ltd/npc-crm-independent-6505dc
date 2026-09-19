import type { MarketSource, NormalisedMarketSourceItem } from '@/types/marketUpdates';
/** Browser fetching is deliberately disabled: third-party acquisition only runs in Supabase Edge Functions. */
export async function fetchSourceItems(_source: MarketSource): Promise<NormalisedMarketSourceItem[]> { throw new Error('Market source acquisition is server-side only.'); }
