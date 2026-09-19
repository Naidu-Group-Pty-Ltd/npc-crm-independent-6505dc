import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowUpCircle, ArrowDownCircle, PauseCircle, Repeat, DollarSign, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { AgentMessageRenderer } from '@/components/agent/AgentMessageRenderer';
import { cn } from '@/lib/utils';

interface BudgetRecommendation {
  type: 'increase' | 'decrease' | 'pause' | 'reallocate';
  priority: 'high' | 'medium' | 'low';
  campaign_id: string;
  campaign_name: string;
  current_spend: number;
  suggested_change: number;
  suggested_spend: number;
  reason: string;
  projected_impact: string;
}

const typeConfig = {
  increase: { icon: ArrowUpCircle, color: 'text-success dark:text-success', bg: 'bg-success/5', border: 'border-success/20', label: 'Scale Up' },
  decrease: { icon: ArrowDownCircle, color: 'text-brand-600 dark:text-brand-400', bg: 'bg-brand-500/5', border: 'border-brand-500/20', label: 'Reduce' },
  pause: { icon: PauseCircle, color: 'text-destructive dark:text-destructive', bg: 'bg-destructive/5', border: 'border-destructive/20', label: 'Pause' },
  reallocate: { icon: Repeat, color: 'text-info dark:text-info', bg: 'bg-info/5', border: 'border-info/20', label: 'Reallocate' },
};

const priorityBadge = {
  high: 'bg-destructive/10 text-destructive dark:text-destructive border-destructive/20',
  medium: 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20',
  low: 'bg-info/10 text-info dark:text-info border-info/20',
};

interface BudgetAdvisorPanelProps {
  recommendations: BudgetRecommendation[];
  aiAnalysis: string;
  aiError?: string;
  loading?: boolean;
  summary?: { totalRecommendations: number; highPriority: number; potentialSavings: number };
}

export function BudgetAdvisorPanel({ recommendations, aiAnalysis, aiError, loading, summary }: BudgetAdvisorPanelProps) {
  const [showAI, setShowAI] = useState(true);

  if (loading) {
    return (
      <Card className="overflow-hidden border-primary/25 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.78)_60%,hsl(var(--primary)/0.08))] shadow-xl shadow-sm dark:shadow-black/5 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <DollarSign className="h-4 w-4 text-primary" />
            </span>
            Budget Reallocation Advisor
            <Badge variant="secondary" className="animate-pulse border-primary/20 bg-primary/10 text-[10px] text-primary">Analyzing...</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-primary/25 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.78)_60%,hsl(var(--primary)/0.08))] shadow-xl shadow-sm dark:shadow-black/5 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex min-w-0 items-center gap-2 text-base">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                <DollarSign className="h-4 w-4 text-primary" />
              </span>
              <span className="truncate">Budget Reallocation Advisor</span>
            </CardTitle>
            {summary && (
              <CardDescription className="mt-1">
                {summary.totalRecommendations} recommendation{summary.totalRecommendations !== 1 ? 's' : ''}
                {summary.potentialSavings > 0 && ` · $${summary.potentialSavings.toFixed(0)} potential savings`}
              </CardDescription>
            )}
          </div>
          {summary && summary.highPriority > 0 && (
            <Badge variant="destructive" className="shrink-0 rounded-full text-[10px]">{summary.highPriority} High Priority</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* AI Strategic Analysis */}
        {(aiAnalysis || aiError) && (
          <div className="overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.04] p-3">
            <button
              onClick={() => setShowAI(!showAI)}
              className="flex w-full items-center justify-between gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate text-xs font-semibold text-foreground">AI Strategic Analysis</span>
                <Badge variant="secondary" className="shrink-0 border-primary/20 bg-background/60 text-[9px]">Gemini 3 Flash</Badge>
              </div>
              {showAI ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </button>
            {showAI && (
              <div className="mt-3 min-w-0 overflow-hidden rounded-2xl border border-border/50 bg-background/50 p-3 [overflow-wrap:anywhere]">
                {aiError ? (
                  <p className="text-xs text-destructive break-words">{aiError}</p>
                ) : (
                  <AgentMessageRenderer content={aiAnalysis} />
                )}
              </div>
            )}
          </div>
        )}

        {/* Recommendation Cards */}
        {recommendations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-primary/25 bg-background/45 py-7 text-center text-muted-foreground">
            <DollarSign className="mx-auto mb-2 h-8 w-8 text-primary/35" />
            <p className="text-sm font-medium">No budget recommendations available</p>
            <p className="text-xs mt-1">Need at least 2 campaigns with data</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2.5">
              {recommendations.map((rec, i) => {
                const config = typeConfig[rec.type];
                const Icon = config.icon;
                return (
                  <div key={`${rec.campaign_id}-${i}`} className={cn('rounded-2xl border p-3 shadow-sm transition-colors hover:bg-background/45', config.bg, config.border)}>
                    <div className="flex items-start gap-2.5">
                      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${config.color}`} />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
                          <span className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground" title={rec.campaign_name}>{rec.campaign_name}</span>
                          <Badge variant="outline" className={`shrink-0 rounded-full text-[9px] ${priorityBadge[rec.priority]}`}>
                            {rec.priority}
                          </Badge>
                          <Badge variant="outline" className={`shrink-0 rounded-full text-[9px] ${config.color}`}>
                            {config.label}
                          </Badge>
                        </div>
                        <p className="break-words text-xs leading-relaxed text-muted-foreground">{rec.reason}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                          <div className="text-[11px]">
                            <span className="text-muted-foreground">Current: </span>
                            <span className="font-mono font-medium">${rec.current_spend.toFixed(0)}</span>
                          </div>
                          {rec.type !== 'reallocate' && (
                            <>
                              <span className="text-muted-foreground">→</span>
                              <div className="text-[11px]">
                                <span className="text-muted-foreground">Suggested: </span>
                                <span className={`font-mono font-semibold ${config.color}`}>${rec.suggested_spend.toFixed(0)}</span>
                              </div>
                            </>
                          )}
                        </div>
                        <p className="mt-1.5 break-words text-[11px] font-medium text-primary">📈 {rec.projected_impact}</p>
                      </div>
                    </div>
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
