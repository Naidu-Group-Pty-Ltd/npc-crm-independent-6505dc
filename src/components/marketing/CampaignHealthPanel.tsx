import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HealthFactor {
  ctr_score: number;
  cpl_score: number;
  frequency_score: number;
  efficiency_score: number;
  volume_score: number;
}

interface HealthScore {
  campaign_id: string;
  campaign_name: string;
  score: number;
  status: 'healthy' | 'watch' | 'action_needed';
  factors: HealthFactor;
  recommendations: string[];
}

const statusConfig = {
  healthy: {
    label: 'Healthy',
    color: 'bg-success',
    textColor: 'text-success dark:text-success',
    bgColor: 'bg-success/10',
    borderColor: 'border-success/20',
    emoji: '🟢',
  },
  watch: {
    label: 'Watch',
    color: 'bg-brand-500',
    textColor: 'text-brand-600 dark:text-brand-400',
    bgColor: 'bg-brand-500/10',
    borderColor: 'border-brand-500/20',
    emoji: '🟡',
  },
  action_needed: {
    label: 'Action Needed',
    color: 'bg-destructive',
    textColor: 'text-destructive dark:text-destructive',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/20',
    emoji: '🔴',
  },
};

const factorLabels: Record<keyof HealthFactor, string> = {
  ctr_score: 'CTR',
  cpl_score: 'CPL',
  frequency_score: 'Frequency',
  efficiency_score: 'Efficiency',
  volume_score: 'Volume',
};

interface CampaignHealthPanelProps {
  healthScores: HealthScore[];
  loading?: boolean;
}

export function CampaignHealthPanel({ healthScores, loading }: CampaignHealthPanelProps) {
  if (loading) {
    return (
      <Card className="overflow-hidden border-border/70 bg-card/90 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <Activity className="h-4 w-4 text-primary" />
            </span>
            Campaign Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const avgScore = healthScores.length > 0
    ? Math.round(healthScores.reduce((s, h) => s + h.score, 0) / healthScores.length)
    : 0;

  const sorted = [...healthScores].sort((a, b) => a.score - b.score);

  return (
    <Card className="overflow-hidden border-border/70 bg-card/90 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <Activity className="h-4 w-4 text-primary" />
            </span>
            <span className="truncate">Campaign Health</span>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-background/55 px-2.5 py-1.5">
            <span className="text-xs text-muted-foreground">Avg Score</span>
            <Badge
              variant="outline"
              className={`rounded-full font-mono text-xs ${
                avgScore >= 60 ? 'border-success/30 text-success dark:text-success' :
                avgScore >= 35 ? 'border-brand-500/30 text-brand-600 dark:text-brand-400' :
                'border-destructive/30 text-destructive dark:text-destructive'
              }`}
            >
              {avgScore}/100
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {healthScores.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/45 py-7 text-center text-muted-foreground">
            <Activity className="mx-auto mb-2 h-8 w-8 text-primary/35" />
            <p className="text-sm font-medium">No campaign data to score</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[340px]">
            <div className="space-y-2.5">
              {sorted.map(health => {
                const config = statusConfig[health.status];
                return (
                  <Tooltip key={health.campaign_id}>
                    <TooltipTrigger asChild>
                      <div className={cn('cursor-default rounded-2xl border bg-background/35 p-3 shadow-sm transition-all hover:border-primary/25 hover:bg-background/55', config.borderColor)}>
                        <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="text-sm">{config.emoji}</span>
                            <span className="truncate text-sm font-medium" title={health.campaign_name}>{health.campaign_name}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className={`text-sm font-bold font-mono ${config.textColor}`}>
                              {health.score}
                            </span>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </div>
                        <Progress
                          value={health.score}
                          className="h-1.5"
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {Object.entries(health.factors).map(([key, value]) => (
                            <div key={key} className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground">
                                {factorLabels[key as keyof HealthFactor]}
                              </span>
                              <span className={`text-[10px] font-mono font-medium ${
                                value >= 60 ? 'text-success dark:text-success' :
                                value >= 35 ? 'text-brand-600 dark:text-brand-400' :
                                'text-destructive dark:text-destructive'
                              }`}>
                                {value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs break-words">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">{health.campaign_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {config.label} — Score: {health.score}/100
                        </p>
                        {health.recommendations.map((rec, i) => (
                          <p key={i} className="text-xs flex items-start gap-1">
                            <span className="shrink-0">→</span>
                            {rec}
                          </p>
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
