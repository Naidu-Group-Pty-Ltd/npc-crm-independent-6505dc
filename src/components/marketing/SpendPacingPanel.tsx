import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Gauge, AlertTriangle, Calendar } from 'lucide-react';
import { differenceInDays, parseISO, addDays, format } from 'date-fns';
import { cn } from '@/lib/utils';

interface SpendPacingPanelProps {
  campaigns: any[];
  insights: any[];
  datePreset: string;
  loading: boolean;
}

function formatCurrency(val: number) {
  return `$${val.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getDateRangeDays(datePreset: string): number {
  switch (datePreset) {
    case 'today': return 1;
    case 'yesterday': return 1;
    case 'last_7d': return 7;
    case 'last_14d': return 14;
    case 'last_30d': return 30;
    case 'this_month': return new Date().getDate();
    case 'last_month': return 30;
    case 'last_90d': return 90;
    default: return 30;
  }
}

function getDaysLeftInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return differenceInDays(lastDay, now);
}

export function SpendPacingPanel({ campaigns, insights, datePreset, loading }: SpendPacingPanelProps) {
  if (loading || !campaigns || campaigns.length === 0) return null;

  const rangeDays = getDateRangeDays(datePreset);
  const daysLeft = getDaysLeftInMonth();

  // Calculate pacing for each campaign with a budget
  const pacingData = campaigns
    .filter((c: any) => c.daily_budget || c.lifetime_budget)
    .map((campaign: any) => {
      const insight = insights.find((i: any) => i.campaign_id === campaign.id);
      const spent = insight ? Number(insight.spend || 0) : 0;

      const dailyBudget = campaign.daily_budget ? Number(campaign.daily_budget) / 100 : 0; // Meta returns cents
      const lifetimeBudget = campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : 0;

      let budget = 0;
      let budgetType = '';
      let expectedSpend = 0;

      if (dailyBudget > 0) {
        budget = dailyBudget * 30; // Monthly projection
        budgetType = 'daily';
        expectedSpend = dailyBudget * rangeDays;
      } else if (lifetimeBudget > 0) {
        budget = lifetimeBudget;
        budgetType = 'lifetime';
        // Calculate expected by looking at campaign duration
        const startDate = campaign.start_time ? parseISO(campaign.start_time) : new Date();
        const endDate = campaign.stop_time ? parseISO(campaign.stop_time) : addDays(new Date(), 30);
        const totalDays = Math.max(1, differenceInDays(endDate, startDate));
        const elapsedDays = Math.max(1, differenceInDays(new Date(), startDate));
        expectedSpend = (lifetimeBudget / totalDays) * Math.min(elapsedDays, totalDays);
      }

      const pacingPercent = expectedSpend > 0 ? (spent / expectedSpend) * 100 : 0;
      const dailyRate = rangeDays > 0 ? spent / rangeDays : 0;
      const projectedMonthly = dailyRate * 30;
      const projectedExhaustDate = budget > 0 && dailyRate > 0
        ? addDays(new Date(), Math.ceil((budget - spent) / dailyRate))
        : null;

      let status: 'on_track' | 'underspend' | 'overspend' = 'on_track';
      if (pacingPercent > 115) status = 'overspend';
      else if (pacingPercent < 75) status = 'underspend';

      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        budgetType,
        budget,
        dailyBudget,
        spent,
        expectedSpend,
        pacingPercent,
        dailyRate,
        projectedMonthly,
        projectedExhaustDate,
        pacingStatus: status,
      };
    })
    .filter((p: any) => p.budget > 0)
    .sort((a: any, b: any) => b.spent - a.spent);

  if (pacingData.length === 0) return null;

  const overSpending = pacingData.filter(p => p.pacingStatus === 'overspend').length;
  const underSpending = pacingData.filter(p => p.pacingStatus === 'underspend').length;

  return (
    <Card className="overflow-hidden border-border/70 bg-card/90 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                <Gauge className="h-5 w-5 text-primary" />
              </span>
              <span className="truncate">Budget Pacing & Spend Rate</span>
            </CardTitle>
            <CardDescription className="mt-1">
              Real-time budget consumption across campaigns · {daysLeft} days left this month
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {overSpending > 0 && (
              <Badge variant="destructive" className="rounded-full text-[10px]">
                {overSpending} overspending
              </Badge>
            )}
            {underSpending > 0 && (
              <Badge className="rounded-full border-brand-500/30 bg-brand-500/15 text-[10px] text-brand-600 dark:text-brand-400">
                {underSpending} underspending
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {pacingData.map((pacing) => {
            const barWidth = Math.min(pacing.pacingPercent, 150);
            const barColor = pacing.pacingStatus === 'overspend'
              ? 'bg-destructive'
              : pacing.pacingStatus === 'underspend'
                ? 'bg-brand-500'
                : 'bg-success';

            return (
              <div key={pacing.id} className="space-y-3 rounded-2xl border border-border/60 bg-background/40 p-3 shadow-sm transition-colors hover:border-primary/25 hover:bg-background/55">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground sm:max-w-[22rem]" title={pacing.name}>{pacing.name}</span>
                    <Badge variant="outline" className="shrink-0 rounded-full border-primary/20 bg-primary/5 text-[9px]">
                      {pacing.budgetType === 'daily' ? `${formatCurrency(pacing.dailyBudget)}/day` : `${formatCurrency(pacing.budget)} lifetime`}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn('rounded-full border bg-background/60 px-2 py-1 text-sm font-mono font-semibold', 
                      pacing.pacingStatus === 'overspend' ? 'text-destructive dark:text-destructive' :
                      pacing.pacingStatus === 'underspend' ? 'text-brand-600 dark:text-brand-400' :
                      'text-success dark:text-success'
                    )}>
                      {pacing.pacingPercent.toFixed(0)}%
                    </span>
                    {pacing.pacingStatus === 'overspend' && (
                      <Tooltip>
                        <TooltipTrigger>
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                        </TooltipTrigger>
                        <TooltipContent>
                          Spending faster than expected. Projected to exhaust budget early.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="relative h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${Math.min(barWidth, 100)}%` }}
                  />
                  {/* Expected marker */}
                  <div
                    className="absolute inset-y-0 w-0.5 bg-foreground/30"
                    style={{ left: '100%' }}
                  />
                </div>

                {/* Details */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                  <span>Spent: <span className="font-mono text-foreground">{formatCurrency(pacing.spent)}</span></span>
                  <span className="rounded-full border border-border/60 bg-background/55 px-2 py-0.5">Daily rate: <span className="font-mono text-foreground">{formatCurrency(pacing.dailyRate)}</span>/day</span>
                  {pacing.projectedExhaustDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Exhausts: <span className="font-mono text-foreground">{format(pacing.projectedExhaustDate, 'MMM d')}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
