import { describe, expect, it } from 'vitest';
import {
  heldExplanation,
  orderSourcesForDisplay,
  resolveIngestMode,
  shadowMetricFor,
  summariseSourceCoverage,
  wouldPublishRate,
} from './marketSourceCoverage';
import type { MarketShadowSourceMetric, MarketSource } from '@/types/marketUpdates';

const source = (patch: Partial<MarketSource> & { name: string }): MarketSource => ({
  id: patch.name,
  name: patch.name,
  source_type: 'rss',
  url: 'https://example.com',
  category: 'finance',
  geography: 'Australia',
  reliability_tier: 'industry',
  enabled: false,
  refresh_frequency_hours: 24,
  refresh_frequency_minutes: 60,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...patch,
});

describe('resolveIngestMode', () => {
  it('uses the declared mode when the read contract supplies one', () => {
    expect(resolveIngestMode(source({ name: 'a', ingest_mode: 'shadow', enabled: false }))).toBe('shadow');
    expect(resolveIngestMode(source({ name: 'b', ingest_mode: 'live', enabled: true }))).toBe('live');
    expect(resolveIngestMode(source({ name: 'c', ingest_mode: 'disabled', enabled: false }))).toBe('disabled');
  });

  it('falls back to enabled when the mode is absent, so an older read contract still renders', () => {
    expect(resolveIngestMode(source({ name: 'd', enabled: true }))).toBe('live');
    expect(resolveIngestMode(source({ name: 'e', enabled: false }))).toBe('disabled');
    expect(resolveIngestMode(source({ name: 'f', ingest_mode: null, enabled: true }))).toBe('live');
  });

  it('ignores an unrecognised mode rather than trusting it', () => {
    expect(resolveIngestMode({ ingest_mode: 'archived' as never, enabled: true })).toBe('live');
  });
});

describe('summariseSourceCoverage', () => {
  const registry = [
    source({ name: 'live-healthy', ingest_mode: 'live', enabled: true, health_status: 'healthy' }),
    source({ name: 'live-degraded', ingest_mode: 'live', enabled: true, health_status: 'degraded' }),
    source({ name: 'live-failed', ingest_mode: 'live', enabled: true, health_status: 'failed' }),
    source({ name: 'shadow-one', ingest_mode: 'shadow' }),
    source({ name: 'shadow-two', ingest_mode: 'shadow' }),
    source({ name: 'held', ingest_mode: 'disabled' }),
  ];

  it('accounts for every source exactly once', () => {
    const summary = summariseSourceCoverage(registry);
    expect(summary.total).toBe(6);
    expect(summary.live + summary.shadow + summary.held).toBe(summary.total);
    expect(summary).toMatchObject({ live: 3, shadow: 2, held: 1 });
  });

  it('reports live health separately from the mode split', () => {
    const summary = summariseSourceCoverage(registry);
    expect(summary.liveHealthy).toBe(1);
    expect(summary.liveFailing).toBe(1);
  });

  it('counts a source with three consecutive failures as failing even if health_status lags', () => {
    const summary = summariseSourceCoverage([
      source({ name: 'stale', ingest_mode: 'live', enabled: true, health_status: 'degraded', consecutive_failures: 3 }),
    ]);
    expect(summary.liveFailing).toBe(1);
  });

  it('does not count shadow failures against live health', () => {
    const summary = summariseSourceCoverage([
      source({ name: 'blocked', ingest_mode: 'shadow', health_status: 'failed', consecutive_failures: 9 }),
    ]);
    expect(summary.liveFailing).toBe(0);
    expect(summary.shadow).toBe(1);
  });

  it('handles an empty registry', () => {
    expect(summariseSourceCoverage([])).toMatchObject({ total: 0, live: 0, shadow: 0, held: 0 });
  });
});

describe('orderSourcesForDisplay', () => {
  it('surfaces the sources needing attention first, then sorts by name', () => {
    const ordered = orderSourcesForDisplay([
      source({ name: 'zeta', health_status: 'healthy' }),
      source({ name: 'alpha', health_status: 'healthy' }),
      source({ name: 'broken', health_status: 'failed' }),
      source({ name: 'wobbly', health_status: 'degraded' }),
    ]).map((s) => s.name);
    expect(ordered).toEqual(['broken', 'wobbly', 'alpha', 'zeta']);
  });

  it('leaves the input array untouched', () => {
    const input = [source({ name: 'b', health_status: 'healthy' }), source({ name: 'a', health_status: 'failed' })];
    orderSourcesForDisplay(input);
    expect(input.map((s) => s.name)).toEqual(['b', 'a']);
  });
});

describe('wouldPublishRate', () => {
  it('reports the share of shadow items that would have been published', () => {
    expect(wouldPublishRate({ shadow_items: 40, would_publish: 10 })).toBe(25);
    expect(wouldPublishRate({ shadow_items: 3, would_publish: 3 })).toBe(100);
  });

  it('returns null rather than 0% when the source has produced no evidence', () => {
    expect(wouldPublishRate({ shadow_items: 0, would_publish: 0 })).toBeNull();
  });
});

describe('shadowMetricFor', () => {
  const metrics = [{ source_id: 'rba', name: 'RBA', ingest_mode: 'shadow', shadow_items: 5, would_publish: 2, below_relevance: 1, rejected: 0 }] as MarketShadowSourceMetric[];

  it('finds the metric for a source and returns null otherwise', () => {
    expect(shadowMetricFor(metrics, 'rba')?.name).toBe('RBA');
    expect(shadowMetricFor(metrics, 'afca')).toBeNull();
    expect(shadowMetricFor(undefined, 'rba')).toBeNull();
  });
});

describe('heldExplanation', () => {
  it('combines the blocker with what would clear it', () => {
    expect(heldExplanation(source({ name: 'x', disabled_reason: 'Licence pending.', shadow_promotion_notes: 'Configure credentials.' })))
      .toBe('Licence pending. Configure credentials.');
  });

  it('falls back to whichever half exists', () => {
    expect(heldExplanation(source({ name: 'x', disabled_reason: 'HTTP 403.' }))).toBe('HTTP 403.');
    expect(heldExplanation(source({ name: 'x', shadow_promotion_notes: 'Promote on 200.' }))).toBe('Promote on 200.');
    expect(heldExplanation(source({ name: 'x' }))).toBeNull();
  });

  it('treats whitespace-only registry text as absent', () => {
    expect(heldExplanation(source({ name: 'x', disabled_reason: '   ', shadow_promotion_notes: '  ' }))).toBeNull();
  });
});
