import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CalendarClock, CheckCircle2, Clock, Loader2, TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { MATTER_STATUS_LABELS } from '@/lib/legalMatters';
import {
  RISK_LEVEL_CLASSES, RISK_LEVEL_LABELS, fetchAtRiskMatters, fetchPortfolioKpis,
  formatCompactCurrency, type AtRiskRecord, type PortfolioKpis,
} from '@/lib/solicitorIntelligence';

/**
 * Portfolio KPIs + at-risk detection for the solicitor dashboard (Phase 7).
 *
 * All numbers come from the deterministic risk engine in the edge function —
 * no AI is involved, so a practitioner can trace every flag back to a date or a
 * stage dwell time on the matter itself.
 */
export function PortfolioInsightsPanel() {
  const [kpis, setKpis] = useState<PortfolioKpis | null>(null);
  const [atRisk, setAtRisk] = useState<AtRiskRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [kpiRes, riskRes] = await Promise.all([
      fetchPortfolioKpis(),
      fetchAtRiskMatters(8),
    ]);
    if (!kpiRes.error) setKpis((kpiRes.data?.kpis ?? null) as PortfolioKpis | null);
    if (!riskRes.error) setAtRisk((riskRes.data?.records ?? []) as AtRiskRecord[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!kpis) return null;

  const tiles = [
    {
      label: 'Pipeline value',
      value: formatCompactCurrency(kpis.total_pipeline_value),
      hint: `${kpis.active} active matter${kpis.active === 1 ? '' : 's'}`,
      icon: TrendingUp,
    },
    {
      label: 'Settling this week',
      value: String(kpis.settling_7d),
      hint: `${kpis.settling_30d} within 30 days`,
      icon: CalendarClock,
    },
    {
      label: 'Avg days to settle',
      value: kpis.avg_days_to_settle === null ? '—' : String(kpis.avg_days_to_settle),
      hint: `${kpis.settled_90d} settled in 90 days`,
      icon: CheckCircle2,
    },
    {
      label: 'Avg days in stage',
      value: kpis.avg_days_in_stage === null ? '—' : String(kpis.avg_days_in_stage),
      hint: `${kpis.stalled} stalled`,
      icon: Clock,
    },
    {
      label: 'Needs attention',
      value: String(kpis.at_risk),
      hint: `${kpis.critical} critical · ${kpis.overdue_settlements} overdue`,
      icon: AlertTriangle,
    },
  ];

  const stageMix = Object.entries(kpis.by_status)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map(({ label, value, hint, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-4 w-4 text-primary" aria-hidden />
                <span className="text-xs">{label}</span>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden /> At risk &amp; stuck matters
            </CardTitle>
            <CardDescription>
              Ranked by severity from dates, stage dwell time and recent activity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {atRisk.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                Nothing is overdue or stalled. Every matter is tracking to plan.
              </p>
            ) : atRisk.map((record) => (
              <Link
                key={record.matter_id}
                to={`/solicitor/matters/${record.matter_id}`}
                className="block rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {record.matter?.title || 'Matter'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {record.matter?.status ? MATTER_STATUS_LABELS[record.matter.status] : ''}
                      {record.days_in_stage !== null ? ` · ${record.days_in_stage} days in stage` : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn(RISK_LEVEL_CLASSES[record.level])}>
                    {RISK_LEVEL_LABELS[record.level]}
                  </Badge>
                </div>
                <ul className="mt-2 space-y-1">
                  {record.signals.slice(0, 3).map((s) => (
                    <li key={s.code} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{s.label}:</span> {s.detail}
                    </li>
                  ))}
                </ul>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" aria-hidden /> Stage mix
            </CardTitle>
            <CardDescription>Where the book is sitting right now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {stageMix.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matters yet.</p>
            ) : stageMix.map(([status, count]) => {
              const pct = kpis.total ? Math.round((count / kpis.total) * 100) : 0;
              return (
                <div key={status}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground">
                      {MATTER_STATUS_LABELS[status as keyof typeof MATTER_STATUS_LABELS] ?? status}
                    </span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
