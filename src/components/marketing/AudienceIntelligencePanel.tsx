import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users, Star, TrendingDown, Loader2 } from 'lucide-react';

interface AudienceInsight {
  adset_id: string;
  adset_name: string;
  campaign_name: string;
  performance_index: number;
  spend: number;
  leads: number;
  cpl: number;
  ctr: number;
  insight: string;
}

interface AudienceIntelligencePanelProps {
  audienceInsights: AudienceInsight[];
  loading?: boolean;
}

function formatCurrency(val: number) {
  return `$${val.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AudienceIntelligencePanel({ audienceInsights, loading }: AudienceIntelligencePanelProps) {
  if (loading) {
    return (
      <Card className="overflow-hidden border-border/70 bg-card/90 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <Users className="h-4 w-4 text-primary" />
            </span>
            Audience Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  const topPerformers = audienceInsights.filter(a => a.performance_index >= 65);
  const underperformers = audienceInsights.filter(a => a.performance_index < 35);

  return (
    <Card className="overflow-hidden border-border/70 bg-card/90 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex min-w-0 items-center gap-2 text-base">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                <Users className="h-4 w-4 text-primary" />
              </span>
              <span className="truncate">Audience & Creative Intelligence</span>
            </CardTitle>
            <CardDescription className="mt-1">
              {audienceInsights.length} segment{audienceInsights.length !== 1 ? 's' : ''} analysed
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {topPerformers.length > 0 && (
              <Badge className="rounded-full border-success/20 bg-success/10 text-[10px] text-success dark:text-success">
                <Star className="h-3 w-3 mr-1" />
                {topPerformers.length} Top
              </Badge>
            )}
            {underperformers.length > 0 && (
              <Badge className="rounded-full border-destructive/20 bg-destructive/10 text-[10px] text-destructive dark:text-destructive">
                <TrendingDown className="h-3 w-3 mr-1" />
                {underperformers.length} Weak
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {audienceInsights.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-primary/25 bg-background/45 py-7 text-center text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 text-primary/35" />
            <p className="text-sm">No audience data available</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[450px]">
            <div className="space-y-2">
              {audienceInsights.map((audience, i) => {
                const isTop = audience.performance_index >= 65;
                const isWeak = audience.performance_index < 35;
                return (
                  <div
                    key={audience.adset_id || i}
                    className={`rounded-2xl border p-3 shadow-sm transition-colors ${
                      isTop ? 'border-success/20 bg-success/[0.03]' :
                      isWeak ? 'border-destructive/20 bg-destructive/[0.03]' :
                      'border-border'
                    }`}
                  >
                    <div className="mb-1.5 flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 mr-2">
                        <span className="block truncate text-sm font-medium" title={audience.adset_name}>{audience.adset_name}</span>
                        {audience.campaign_name && audience.campaign_name !== audience.adset_name && (
                          <span className="block truncate text-[10px] text-muted-foreground" title={audience.campaign_name}>{audience.campaign_name}</span>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={`font-mono text-[10px] shrink-0 ${
                          isTop ? 'rounded-full border-success/30 text-success dark:text-success' :
                          isWeak ? 'border-destructive/30 text-destructive dark:text-destructive' :
                          'border-border text-muted-foreground'
                        }`}
                      >
                        {audience.performance_index}/100
                      </Badge>
                    </div>
                    <Progress value={audience.performance_index} className="h-1 mb-2" />
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                      <span>Spend: <span className="font-mono font-medium text-foreground">{formatCurrency(audience.spend)}</span></span>
                      <span>Leads: <span className="font-mono font-medium text-foreground">{audience.leads}</span></span>
                      <span>CPL: <span className="font-mono font-medium text-foreground">{audience.cpl > 0 ? formatCurrency(audience.cpl) : '—'}</span></span>
                      <span>CTR: <span className="font-mono font-medium text-foreground">{audience.ctr.toFixed(2)}%</span></span>
                    </div>
                    <p className="break-words text-[11px] text-muted-foreground">{audience.insight}</p>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
