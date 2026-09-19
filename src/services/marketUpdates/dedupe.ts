import type { NormalisedMarketSourceItem } from '@/types/marketUpdates';
function stableHash(value: string): string { let h = 2166136261; for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
export function createMarketUpdateDedupeHash(item: NormalisedMarketSourceItem): string { const key = [item.source_url, item.title, item.source_name, item.source_published_at ?? ''].map(v => (v ?? '').trim().toLowerCase()).join('|'); return stableHash(key); }
