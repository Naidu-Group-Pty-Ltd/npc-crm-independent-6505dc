import { AlertTriangle, AlertCircle, Info, TrendingDown, Zap, DollarSign, Eye, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface Anomaly {
  id: string;
  type: 'critical' | 'warning' | 'info';
  category: string;
  campaign_name: string;
  campaign_id: string;
  title: string;
  description: string;
  metric_value: number;
  threshold_value: number;
}

const categoryIcons: Record<string, React.ReactNode> = {
  cpl_spike: <DollarSign className="h-4 w-4" />,
  ctr_drop: <TrendingDown className="h-4 w-4" />,
  creative_fatigue: <Eye className="h-4 w-4" />,
  budget_drain: <Zap className="h-4 w-4" />,
  zero_conversion: <AlertTriangle className="h-4 w-4" />,
  high_frequency: <Users className="h-4 w-4" />,
  spend_inefficiency: <DollarSign className="h-4 w-4" />,
};

const typeStyles: Record<string, { variant: 'destructive' | 'default'; bg: string; border: string; icon: React.ReactNode }> = {
  critical: {
    variant: 'destructive',
    bg: 'bg-destructive/5 dark:bg-destructive/10',
    border: 'border-destructive/30',
    icon: <AlertTriangle className="h-4 w-4 text-destructive" />,
  },
  warning: {
    variant: 'default',
    bg: 'bg-brand-500/5 dark:bg-brand-500/10',
    border: 'border-brand-500/30',
    icon: <AlertCircle className="h-4 w-4 text-brand-500" />,
  },
  info: {
    variant: 'default',
    bg: 'bg-info/5 dark:bg-info/10',
    border: 'border-info/30',
    icon: <Info className="h-4 w-4 text-info" />,
  },
};

interface AnomalyAlertsPanelProps {
  anomalies: Anomaly[];
  loading?: boolean;
}

export function AnomalyAlertsPanel({ anomalies, loading }: AnomalyAlertsPanelProps) {
  if (loading) {
    return (
      <Card className="overflow-hidden border-border/70 bg-card/90 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10">
              <AlertTriangle className="h-4 w-4 text-brand-500" />
            </span>
            Anomaly Detection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const critical = anomalies.filter(a => a.type === 'critical');
  const warnings = anomalies.filter(a => a.type === 'warning');
  const info = anomalies.filter(a => a.type === 'info');

  return (
    <Card className="overflow-hidden border-border/70 bg-card/90 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
      <CardHeader className="pb-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10">
              <AlertTriangle className="h-4 w-4 text-brand-500" />
            </span>
            <span className="truncate">Anomaly Detection</span>
          </CardTitle>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {critical.length > 0 && (
              <Badge variant="destructive" className="rounded-full text-[10px]">
                {critical.length} Critical
              </Badge>
            )}
            {warnings.length > 0 && (
              <Badge className="rounded-full border-brand-500/30 bg-brand-500/15 text-[10px] text-brand-600 dark:text-brand-400">
                {warnings.length} Warning{warnings.length > 1 ? 's' : ''}
              </Badge>
            )}
            {anomalies.length === 0 && (
              <Badge variant="secondary" className="rounded-full border-success/20 bg-success/10 text-[10px] text-success dark:text-success">
                All Clear
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {anomalies.length === 0 ? (
          <div className="rounded-2xl border border-success/20 bg-success/10 py-7 text-center text-muted-foreground">
            <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-full border border-success/20 bg-success/15 text-success dark:text-success">
              <span className="text-lg">✓</span>
            </div>
            <p className="text-sm font-semibold text-foreground">No anomalies detected</p>
            <p className="text-xs mt-1">All campaigns are operating within normal parameters</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[320px]">
            <div className="space-y-2.5">
              {anomalies.map(anomaly => {
                const style = typeStyles[anomaly.type];
                return (
                  <div
                    key={anomaly.id}
                    className={cn('rounded-2xl border p-3 shadow-sm transition-colors hover:bg-background/45', style.bg, style.border)}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 shrink-0">
                        {style.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-semibold text-foreground" title={anomaly.title}>{anomaly.title}</span>
                          <span className="shrink-0">
                            {categoryIcons[anomaly.category]}
                          </span>
                        </div>
                        <p className="break-words text-xs leading-relaxed text-muted-foreground">{anomaly.description}</p>
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
