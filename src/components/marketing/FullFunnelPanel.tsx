import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Funnel, ArrowDown } from 'lucide-react';

function formatNum(val: number) {
  return val.toLocaleString('en-AU');
}

function formatPct(val: number, total: number) {
  if (total === 0) return '0%';
  return `${((val / total) * 100).toFixed(1)}%`;
}

export function FullFunnelPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['meta-ads-funnel'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('analyze-meta-ads-phase5', {
        action: 'funnel',
      });
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const funnel = data?.funnel;
  const stages = funnel?.stages || [];
  const byCampaign = funnel?.byCampaign || [];
  const maxValue = stages.length > 0 ? stages[0].value : 1;

  return (
    <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.82)_60%,hsl(var(--primary)/0.08))] shadow-xl shadow-sm dark:shadow-black/5 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <Funnel className="h-5 w-5 text-primary" />
          </span>
          <span className="truncate">Full-Funnel Visualization</span>
        </CardTitle>
        <CardDescription>Meta Ads → CRM Pipeline conversion funnel</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center rounded-2xl border border-border/60 bg-background/45 py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Building funnel...</span>
          </div>
        ) : stages.length === 0 || maxValue === 0 ? (
          <div className="rounded-2xl border border-dashed border-primary/25 bg-background/45 py-12 text-center text-sm text-muted-foreground">
            <Funnel className="h-10 w-10 mx-auto mb-2 text-primary/35" />
            No attributed leads found. Ensure lead attribution is configured.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Funnel chart */}
            <div className="space-y-1 rounded-2xl border border-border/60 bg-background/40 p-3">
              {stages.map((stage: any, idx: number) => {
                const widthPct = maxValue > 0 ? Math.max((stage.value / maxValue) * 100, 8) : 8;
                const conversionFromPrev = idx > 0 && stages[idx - 1].value > 0
                  ? ((stage.value / stages[idx - 1].value) * 100).toFixed(1)
                  : null;

                return (
                  <div key={stage.name} className="flex flex-col items-center">
                    {idx > 0 && (
                      /* The arrow is centred on its own; the conversion pill
                         hangs off it absolutely. Centring the pair shoved
                         the arrow off the funnel's centre line wherever a
                         pill existed, so only the first arrow looked wrong. */
                      <div className="relative flex w-full items-center justify-center py-1">
                        <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                        {conversionFromPrev && (
                          <span className="absolute left-1/2 ml-4 whitespace-nowrap rounded-full border border-border/50 bg-background/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                            {conversionFromPrev}% conversion
                          </span>
                        )}
                      </div>
                    )}
                    <div
                      className="relative mx-auto overflow-hidden rounded-2xl shadow-lg shadow-sm dark:shadow-black/10 transition-all duration-500"
                      style={{
                        width: `${widthPct}%`,
                        minWidth: '180px',
                        backgroundColor: stage.color,
                      }}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
                        <span className="truncate text-sm font-medium text-foreground dark:text-white" title={stage.name}>{stage.name}</span>
                        <span className="text-lg font-bold text-foreground dark:text-white font-mono">{formatNum(stage.value)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Overall conversion rate */}
            {stages.length >= 2 && stages[0].value > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Badge variant="outline" className="gap-1 rounded-full border-primary/20 bg-background/60 text-xs">
                  Lead → Deal: <span className="font-mono font-semibold">{formatPct(stages[1].value, stages[0].value)}</span>
                </Badge>
                {stages[4]?.value > 0 && (
                  <Badge variant="outline" className="gap-1 rounded-full border-success/30 bg-success/10 text-xs text-success dark:text-success">
                    Lead → Settled: <span className="font-mono font-semibold">{formatPct(stages[4].value, stages[0].value)}</span>
                  </Badge>
                )}
              </div>
            )}

            {/* By Campaign Breakdown */}
            {byCampaign.length > 0 && (
              <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                <p className="text-sm font-medium text-foreground mb-2">By Campaign</p>
                <div className="overflow-x-auto rounded-2xl border border-border/50 bg-background/45">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[180px]">Campaign</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead className="text-right">Deals</TableHead>
                        <TableHead className="text-right">Qualified</TableHead>
                        <TableHead className="text-right">Approved</TableHead>
                        <TableHead className="text-right">Settled</TableHead>
                        <TableHead className="text-right">Conv. Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byCampaign.map((row: any) => (
                        <TableRow key={row.campaign_id} className="transition-colors hover:bg-primary/5">
                          <TableCell className="max-w-[240px] truncate text-sm font-medium" title={row.campaign_name}>{row.campaign_name}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatNum(row.leads)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatNum(row.deals)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatNum(row.qualified)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatNum(row.approved)}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold">{formatNum(row.settled)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {row.leads > 0 ? formatPct(row.deals, row.leads) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
