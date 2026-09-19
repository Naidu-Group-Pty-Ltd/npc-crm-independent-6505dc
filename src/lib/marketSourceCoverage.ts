import type { MarketIngestMode, MarketShadowSourceMetric, MarketSource } from '@/types/marketUpdates';

/**
 * Source coverage — turning the registry into something a reader can account for.
 *
 * The workspace previously showed a single "N/M sources live" number, which hid
 * the more useful fact: every canonical source is in one of three states, and the
 * two non-live states mean different things. A shadow source is being measured; a
 * held source cannot be fetched at all. Collapsing them into "not live" made a
 * licensing blocker look identical to a source that is quietly proving itself.
 */

export const INGEST_MODES: MarketIngestMode[] = ['live', 'shadow', 'disabled'];

export interface IngestModeDescriptor {
  id: MarketIngestMode;
  label: string;
  /** One line a non-engineer can act on. */
  description: string;
}

export const INGEST_MODE_DESCRIPTORS: Record<MarketIngestMode, IngestModeDescriptor> = {
  live: {
    id: 'live',
    label: 'Live',
    description: 'Fetched every cycle. Anything that clears the publication bar appears in the feed.',
  },
  shadow: {
    id: 'shadow',
    label: 'Shadow',
    description: 'Fetched and classified exactly like a live source, but nothing it produces reaches the feed — it is being measured before promotion.',
  },
  disabled: {
    id: 'disabled',
    label: 'Held',
    description: 'Not fetched. There is no endpoint to call until a licence, a feed or a server-rendered page exists.',
  },
};

/**
 * `ingest_mode` is a newer column than `enabled`, and a client can be deployed
 * ahead of the read contract that returns it. Falling back to `enabled` keeps the
 * panel truthful in that window: a shadow source reads as held, which understates
 * it, rather than the page rendering an empty state.
 */
export function resolveIngestMode(source: Pick<MarketSource, 'ingest_mode' | 'enabled'>): MarketIngestMode {
  const declared = source.ingest_mode;
  if (declared === 'live' || declared === 'shadow' || declared === 'disabled') return declared;
  return source.enabled ? 'live' : 'disabled';
}

export interface SourceCoverageSummary {
  total: number;
  live: number;
  shadow: number;
  held: number;
  /** Live sources currently reporting healthy — the number that governs feed volume. */
  liveHealthy: number;
  /** Live sources that have failed enough consecutive fetches to need attention. */
  liveFailing: number;
  byMode: Record<MarketIngestMode, MarketSource[]>;
}

const isFailing = (source: MarketSource) =>
  source.health_status === 'failed' || Number(source.consecutive_failures ?? 0) >= 3;

export function summariseSourceCoverage(sources: MarketSource[]): SourceCoverageSummary {
  const byMode: Record<MarketIngestMode, MarketSource[]> = { live: [], shadow: [], disabled: [] };
  for (const source of sources) byMode[resolveIngestMode(source)].push(source);
  return {
    total: sources.length,
    live: byMode.live.length,
    shadow: byMode.shadow.length,
    held: byMode.disabled.length,
    liveHealthy: byMode.live.filter((source) => source.health_status === 'healthy').length,
    liveFailing: byMode.live.filter(isFailing).length,
    byMode,
  };
}

/**
 * Sort within a mode so the rows that need a decision surface first: failing
 * before degraded before healthy, then by name for a stable order.
 */
const HEALTH_RANK: Record<string, number> = { failed: 0, degraded: 1, healthy: 2, disabled: 3 };

export function orderSourcesForDisplay(sources: MarketSource[]): MarketSource[] {
  return [...sources].sort((a, b) => {
    const rank = (HEALTH_RANK[a.health_status ?? 'disabled'] ?? 4) - (HEALTH_RANK[b.health_status ?? 'disabled'] ?? 4);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The one number that decides whether a shadow source has earned promotion: of
 * everything it produced, how much would have been published. Null while the
 * source has produced nothing, so the UI can say "no evidence yet" instead of
 * showing a misleading 0%.
 */
export function wouldPublishRate(metric: Pick<MarketShadowSourceMetric, 'shadow_items' | 'would_publish'>): number | null {
  const items = Number(metric.shadow_items ?? 0);
  if (!Number.isFinite(items) || items <= 0) return null;
  return Math.round((Number(metric.would_publish ?? 0) / items) * 100);
}

export function shadowMetricFor(
  metrics: MarketShadowSourceMetric[] | undefined,
  sourceId: string,
): MarketShadowSourceMetric | null {
  if (!Array.isArray(metrics)) return null;
  return metrics.find((metric) => metric.source_id === sourceId) ?? null;
}

/**
 * Why a source is not live, in the operator's own words where the registry has
 * them. `disabled_reason` records the blocker and `shadow_promotion_notes`
 * records what would clear it; either alone is only half the story.
 */
export function heldExplanation(source: MarketSource): string | null {
  const blocker = source.disabled_reason?.trim();
  const promotion = source.shadow_promotion_notes?.trim();
  if (blocker && promotion) return `${blocker} ${promotion}`;
  return blocker || promotion || null;
}
