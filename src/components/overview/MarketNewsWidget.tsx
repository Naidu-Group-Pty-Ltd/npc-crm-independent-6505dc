import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, Newspaper } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchMarketUpdates } from '@/services/marketUpdatesService';

const IMPACT_TONE: Record<string, string> = {
  high: 'border-warning/40 bg-warning/10 text-warning',
  critical: 'border-destructive/40 bg-destructive/10 text-destructive',
};

/**
 * Compact Market News Feed digest for the Overview.
 *
 * Mounted ONLY when `module.market_news_feed` resolves enabled — the parent
 * gates it, so this component can assume entitlement and simply read. It
 * reads the already-published feed (no ingestion is triggered from the
 * Overview) and links to the full module rather than reproducing it.
 */
export function MarketNewsWidget() {
  const navigate = useNavigate();

  const { data: updates, isLoading } = useQuery({
    queryKey: ['overview-market-news'],
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchMarketUpdates({ limit: 12 }),
  });

  const latest = (updates ?? []).slice(0, 5);

  return (
    <Card className="overview-premium-card rounded-2xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold md:text-base">
          <Newspaper className="h-4 w-4 text-primary" aria-hidden="true" />
          Latest market developments
        </CardTitle>
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate('/market-updates')}>
          Open feed
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}

        {!isLoading && latest.length === 0 && (
          <p className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
            Your Market News Feed is ready. Select the markets, regions and property categories you
            want to follow.
          </p>
        )}

        {latest.map((update) => (
          <button
            key={update.id}
            type="button"
            onClick={() => navigate('/market-updates')}
            className="flex w-full items-start justify-between gap-3 rounded-xl border border-border/60 bg-background/60 p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{update.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {update.source_name}
                {update.source_published_at &&
                  ` · ${formatDistanceToNow(new Date(update.source_published_at), { addSuffix: true })}`}
              </span>
            </span>
            {update.impact_level && IMPACT_TONE[update.impact_level] && (
              <Badge variant="outline" className={`shrink-0 text-[10px] uppercase ${IMPACT_TONE[update.impact_level]}`}>
                {update.impact_level}
              </Badge>
            )}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
