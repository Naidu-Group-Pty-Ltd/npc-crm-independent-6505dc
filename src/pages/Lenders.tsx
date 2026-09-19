import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import { Star, Bell, RefreshCw, TrendingDown, Pin, PinOff } from 'lucide-react';
import { useBankLendingRates } from '@/hooks/useBankLendingRates';
import { useLenderFavourites } from '@/hooks/useLenderFavourites';
import { LenderRateAlertManager } from '@/components/lenders/LenderRateAlertManager';
import { useLenderRateAlerts } from '@/hooks/useLenderRateAlerts';
import { cn } from '@/lib/utils';

export default function Lenders() {
  const [search, setSearch] = useState('');
  const { ratesSummary, isLoadingSummary, refreshAll, isRefreshing } = useBankLendingRates();
  const { favourites, add, remove, isFavourite } = useLenderFavourites();
  const { alerts } = useLenderRateAlerts();

  const filtered = useMemo(() => {
    const list = ratesSummary ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(s => s.lenderName.toLowerCase().includes(q));
  }, [ratesSummary, search]);

  const sortedByRate = useMemo(() => {
    return [...filtered].sort((a, b) => (a.lowestRate ?? Infinity) - (b.lowestRate ?? Infinity));
  }, [filtered]);

  const favouriteSummaries = useMemo(() => {
    if (!ratesSummary) return [];
    return favourites
      .map(f => ratesSummary.find(s => s.lenderId === f.lender_id))
      .filter(Boolean) as typeof ratesSummary;
  }, [favourites, ratesSummary]);

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Lenders</h1>
          <p className="text-sm text-muted-foreground">
            Live CDR rates, favourites, and rate alerts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1"><Star className="h-3 w-3" /> {favourites.length} pinned</Badge>
          <Badge variant="outline" className="gap-1"><Bell className="h-3 w-3" /> {alerts.filter(a => a.is_enabled).length} active alerts</Badge>
          <Button variant="outline" size="sm" onClick={() => refreshAll()} disabled={isRefreshing}>
            <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
            Refresh rates
          </Button>
        </div>
      </div>

      <Tabs defaultValue="leaderboard">
        <TabsList>
          <TabsTrigger value="leaderboard">Best rates</TabsTrigger>
          <TabsTrigger value="favourites">Favourites</TabsTrigger>
          <TabsTrigger value="alerts">Rate alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboard" className="space-y-4">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search lenders..."
            containerClassName="max-w-md"
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-success" />
                Lowest rate per lender
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingSummary ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : sortedByRate.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No lender rate data cached. Click "Refresh rates" to fetch from CDR.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {sortedByRate.map((s) => (
                    <div key={s.lenderId} className="flex items-center justify-between p-3 hover:bg-muted/30">
                      <div className="flex items-center gap-3 min-w-0">
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => isFavourite(s.lenderId)
                            ? remove(s.lenderId)
                            : add({ lender_id: s.lenderId, lender_name: s.lenderName })}
                        >
                          {isFavourite(s.lenderId)
                            ? <Pin className="h-4 w-4 text-primary fill-current" />
                            : <PinOff className="h-4 w-4 text-muted-foreground" />}
                        </Button>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{s.lenderName}</div>
                          <div className="text-xs text-muted-foreground">
                            {s.rateCount} products · refreshed {new Date(s.fetchedAt).toLocaleDateString('en-AU')}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-lg font-semibold tabular-nums">
                          {s.lowestRate != null ? `${s.lowestRate.toFixed(2)}%` : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">lowest p.a.</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="favourites">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pinned lenders</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {favouriteSummaries.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Pin lenders from the Best rates tab to see them here.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {favouriteSummaries.map((s) => (
                    <div key={s.lenderId} className="flex items-center justify-between p-3">
                      <div>
                        <div className="font-medium">{s.lenderName}</div>
                        <div className="text-xs text-muted-foreground">{s.rateCount} products</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-lg font-semibold tabular-nums">
                            {s.lowestRate != null ? `${s.lowestRate.toFixed(2)}%` : '—'}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => remove(s.lenderId)}>
                          <PinOff className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <LenderRateAlertManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
