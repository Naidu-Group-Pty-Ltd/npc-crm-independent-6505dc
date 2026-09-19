import type { MarketSourceSeed, MarketSourceType } from '@/types/marketUpdates';
import { marketSourceSeeds } from './sourceSeeds';
export const supportedMarketSourceTypes: MarketSourceType[] = ['rss','atom','official_api','html_listing','licensed_partner_feed','manual','feed_with_html_fallback','rss_with_html_fallback','rss_multi','html_listing_or_licensed_feed'];
export function getSeedMarketSources(): MarketSourceSeed[] { return marketSourceSeeds; }
export function isSupportedMarketSourceType(type: string): type is MarketSourceType { return supportedMarketSourceTypes.includes(type as MarketSourceType); }
