import { CardContent } from '@/components/ui/card';
import { BarChart3, PieChart, TrendingUp, FileText } from 'lucide-react';
import type { ChartData } from './ChartCard';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface ChartStatsProps {
  charts: ChartData[];
}

export function ChartStats({ charts }: ChartStatsProps) {
  const typeBreakdown = charts.reduce<Record<string, number>>((acc, c) => {
    acc[c.chart_type] = (acc[c.chart_type] || 0) + 1;
    return acc;
  }, {});

  const uniqueReports = new Set(charts.map(c => c.report_id).filter(Boolean)).size;
  const dominantType = Object.entries(typeBreakdown).sort((a, b) => b[1] - a[1])[0];

  const stats = [
    {
      label: 'Total Charts',
      value: charts.length,
      icon: BarChart3,
      color: 'text-info',
      iconChrome: 'from-info/25 via-info/10 to-primary/10 ring-info/25',
      edge: 'from-info/0 via-info/70 to-info/0',
    },
    {
      label: 'Chart Types',
      value: Object.keys(typeBreakdown).length,
      icon: PieChart,
      color: 'text-success',
      iconChrome: 'from-success/25 via-success/10 to-primary/10 ring-success/25',
      edge: 'from-success/0 via-success/70 to-success/0',
    },
    {
      label: 'Linked Reports',
      value: uniqueReports,
      icon: FileText,
      color: 'text-accent',
      iconChrome: 'from-accent/25 via-accent/10 to-primary/10 ring-accent/25',
      edge: 'from-accent/0 via-accent/70 to-accent/0',
      connected: true,
    },
    {
      label: 'Most Common',
      value: dominantType ? `${dominantType[0]} (${dominantType[1]})` : '—',
      icon: TrendingUp,
      color: 'text-brand-200',
      iconChrome: 'from-brand-300/35 via-primary/15 to-brand-600/10 ring-brand-200/35',
      edge: 'from-brand-300/0 via-brand-200/90 to-brand-300/0',
      insight: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map(s => (
        <DashboardThemeFrame
          key={s.label}
          variant="premiumCard"
          className={`relative rounded-3xl bg-gradient-to-br ${s.insight ? 'from-primary/16 via-card/95 to-brand-950/10 border-primary/25' : 'from-card/95 via-card/90 to-card dark:to-background/5'} shadow-xl shadow-sm dark:shadow-black/10 backdrop-blur hover:border-brand-300/65 hover:ring-1 hover:ring-brand-300/30 hover:shadow-[0_24px_70px_hsl(43_74%_49%/0.18),0_0_0_1px_hsl(43_96%_56%/0.14)] focus-within:border-brand-300/65 focus-within:ring-2 focus-within:ring-brand-300/25 dark:shadow-black/25`}
        >
          <div className={`pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r ${s.edge} opacity-70 transition-opacity duration-300 group-hover:opacity-100`} />
          <div className="pointer-events-none absolute -right-12 -top-16 h-36 w-36 rounded-full bg-primary/10 blur-3xl transition-opacity duration-300 group-hover:opacity-80" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-brand-200/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

          <CardContent className="relative flex min-h-[150px] flex-col justify-between gap-5 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <p className="truncate text-[11px] font-bold uppercase leading-none tracking-[0.22em] text-muted-foreground/90">
                  {s.label}
                </p>
                <div className="h-px w-12 bg-gradient-to-r from-brand-300/70 via-brand-100/25 to-transparent" />
              </div>
              <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border dark:border-white/10 bg-gradient-to-br ${s.iconChrome} shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_14px_32px_rgba(0,0,0,0.16)] ring-1 ${s.color}`}>
                {s.connected && (
                  <span className="absolute -left-2 top-1/2 h-px w-2 bg-gradient-to-l from-accent/70 to-transparent" />
                )}
                <s.icon className="h-5 w-5 drop-shadow-sm" />
              </div>
            </div>

            <div className="space-y-2">
              <p className={`${s.insight ? 'text-2xl sm:text-[1.7rem]' : 'text-3xl'} truncate font-black leading-none tracking-tight text-foreground drop-shadow-sm`}>
                {s.value}
              </p>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/75">
                <span className={`h-1.5 w-1.5 rounded-full ${s.insight ? 'bg-brand-300 shadow-[0_0_16px_rgba(252,211,77,0.75)]' : s.connected ? 'bg-accent/30 shadow-[0_0_14px_rgba(196,181,253,0.55)]' : 'bg-primary/70'}`} />
                <span>{s.insight ? 'Insight metric' : s.connected ? 'Connected data' : 'Analytics metric'}</span>
              </div>
            </div>
          </CardContent>
        </DashboardThemeFrame>
      ))}
    </div>
  );
}
