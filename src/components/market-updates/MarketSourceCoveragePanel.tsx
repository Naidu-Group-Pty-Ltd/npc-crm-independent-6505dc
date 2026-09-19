import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, CircleSlash, Eye, Loader2, Radio, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fetchMarketSources } from '@/services/marketUpdatesService';
import {
  INGEST_MODE_DESCRIPTORS,
  INGEST_MODES,
  heldExplanation,
  orderSourcesForDisplay,
  resolveIngestMode,
  shadowMetricFor,
  summariseSourceCoverage,
  wouldPublishRate,
} from '@/lib/marketSourceCoverage';
import type { MarketIngestMode, MarketShadowSourceMetric, MarketSource } from '@/types/marketUpdates';

/**
 * Every canonical source, grouped by what the pipeline actually does with it.
 *
 * The header previously said "30/43 sources live" and stopped there, which left
 * the other thirteen unexplained — a reader could not tell a source being
 * validated from one blocked on a licence. This panel accounts for all of them
 * and, for shadow sources, shows the evidence that would justify promotion.
 */

const MODE_ICON: Record<MarketIngestMode, typeof Radio> = {
  live: Radio,
  shadow: Eye,
  disabled: CircleSlash,
};

const MODE_ACCENT: Record<MarketIngestMode, string> = {
  live: 'border-success/40 bg-success/10 text-success',
  shadow: 'border-info/40 bg-info/10 text-[hsl(var(--info))]',
  disabled: 'border-border bg-muted text-muted-foreground',
};

const HEALTH_DOT: Record<string, string> = {
  healthy: 'bg-success',
  degraded: 'bg-warning',
  failed: 'bg-destructive',
  disabled: 'bg-muted-foreground/40',
};

const titleCase = (value: string) => value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
const dateLabel = (value?: string | null) =>
  value ? new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';

function SourceRow({ source, metric }: { source: MarketSource; metric: MarketShadowSourceMetric | null }) {
  const mode = resolveIngestMode(source);
  const rate = metric ? wouldPublishRate(metric) : null;
  const explanation = mode === 'live' ? null : heldExplanation(source);

  return (
    <li className="rounded-lg border border-border/60 bg-background/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span
              aria-hidden
              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', HEALTH_DOT[source.health_status ?? 'disabled'] ?? 'bg-muted-foreground/40')}
            />
            <span className="truncate">{source.name}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {source.source_authority ? titleCase(source.source_authority) : titleCase(source.reliability_tier)}
            {source.adapter_type ? ` · ${source.adapter_type.replace(/_/g, ' ')}` : ''}
          </p>
          <p className="mt-1 min-w-0 whitespace-normal break-words text-[11px] text-muted-foreground" title={source.geography}>
            <span className="font-medium text-foreground/80">Geography:</span> {source.geography || 'Australia'}
          </p>
        </div>
        {mode === 'live' && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {source.last_items_published ?? 0} published · {source.last_items_discovered ?? 0} found
          </span>
        )}
        {mode === 'shadow' && metric && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {rate === null
              ? 'No evidence yet'
              : `${rate}% would publish · ${metric.shadow_items} sampled`}
          </span>
        )}
      </div>

      {mode === 'live' && source.last_error && (
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-destructive">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span className="min-w-0 break-words">{source.last_error}</span>
        </p>
      )}
      {explanation && <p className="mt-1.5 break-words text-[11px] leading-relaxed text-muted-foreground">{explanation}</p>}
      {mode === 'shadow' && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          In shadow since {dateLabel(source.shadow_since)} · last fetched {dateLabel(source.last_fetched_at)}
        </p>
      )}
    </li>
  );
}

export function MarketSourceCoveragePanel({ shadowMetrics }: { shadowMetrics?: MarketShadowSourceMetric[] }) {
  const [sources, setSources] = useState<MarketSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setSources(await fetchMarketSources());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Source coverage could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const coverage = useMemo(() => summariseSourceCoverage(sources), [sources]);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Source coverage</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Every approved source in the registry, and what the pipeline does with it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={load} disabled={loading} aria-label="Reload source coverage">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              disabled={!sources.length}
            >
              {expanded ? 'Hide sources' : `Show all ${coverage.total} sources`}
              <ChevronDown className={cn('ml-1.5 h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {INGEST_MODES.map((mode) => {
            const descriptor = INGEST_MODE_DESCRIPTORS[mode];
            const Icon = MODE_ICON[mode];
            const count = coverage.byMode[mode].length;
            return (
              <div key={mode} className={cn('flex items-center gap-3 rounded-xl border p-2', MODE_ACCENT[mode])}>
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border', MODE_ACCENT[mode])}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-semibold tabular-nums leading-none text-foreground">{count}</p>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{descriptor.label}</p>
                </div>
              </div>
            );
          })}
        </div>

        {coverage.live > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{coverage.liveHealthy}/{coverage.live} live sources healthy</Badge>
            {coverage.liveFailing > 0 && (
              <Badge variant="outline" className="text-destructive">
                <AlertTriangle className="mr-1 h-3 w-3" />{coverage.liveFailing} live failing
              </Badge>
            )}
            {coverage.shadow > 0 && <Badge variant="outline">{coverage.shadow} in validation — nothing they produce reaches the feed</Badge>}
          </div>
        )}

        {expanded && (
          <div className="min-h-[28rem] max-h-[70dvh] overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border border-border/60 bg-background/20 p-3 pb-6" tabIndex={0} aria-label="Expanded source coverage">
          <div className="grid gap-4 xl:grid-cols-3">
            {INGEST_MODES.map((mode) => (
              <section key={mode} className="min-w-0 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {INGEST_MODE_DESCRIPTORS[mode].label} · {coverage.byMode[mode].length}
                </h4>
                {coverage.byMode[mode].length ? (
                  <ul className="space-y-2">
                    {orderSourcesForDisplay(coverage.byMode[mode]).map((source) => (
                      <SourceRow key={source.id} source={source} metric={shadowMetricFor(shadowMetrics, source.id)} />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                    No sources in this state.
                  </p>
                )}
              </section>
            ))}
          </div>
          </div>
        )}

        {loading && !sources.length && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading the source registry…
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default MarketSourceCoveragePanel;
