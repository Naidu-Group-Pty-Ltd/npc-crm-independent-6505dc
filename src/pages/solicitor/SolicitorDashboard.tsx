import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Briefcase, CalendarClock, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { smartCapitalize } from '@/lib/nameUtils';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';
import { SolicitorPortalShell } from '@/components/solicitor-portal/SolicitorPortalShell';
import { PortfolioInsightsPanel } from '@/components/solicitor-portal/PortfolioInsightsPanel';
import {
  MATTER_STATUS_CLASSES, MATTER_STATUS_LABELS, countdownLabel, formatMatterDate,
  formatPropertyAddress, daysUntil, type LegalMatter,
} from '@/lib/legalMatters';

interface MatterStats {
  total: number;
  by_status: Record<string, number>;
  settling_30d: number;
  at_risk: number;
}

export default function SolicitorDashboard() {
  const { user, loading: authLoading } = useSolicitorPortalAuth();
  const [matters, setMatters] = useState<LegalMatter[]>([]);
  const [flagged, setFlagged] = useState<LegalMatter[]>([]);
  const [stats, setStats] = useState<MatterStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // The flagged strip is its own read. `list_matters` no longer carries
    // `risk_notes` — it is the minimal list projection now — so the note that
    // explains a flag comes from `list_flagged_matters`, which returns it for
    // flagged matters only. Three calls in the same round trip rather than two.
    const [list, stat, flaggedList] = await Promise.all([
      invokeSolicitorFunction('solicitor-portal-matters', { operation: 'list_matters' }),
      invokeSolicitorFunction('solicitor-portal-matters', { operation: 'matter_stats' }),
      invokeSolicitorFunction('solicitor-portal-matters', { operation: 'list_flagged_matters', limit: 5 }),
    ]);
    if (!list.error) setMatters((list.data?.records || []) as LegalMatter[]);
    if (!stat.error) setStats((stat.data?.stats as MatterStats) ?? null);
    if (!flaggedList.error) setFlagged((flaggedList.data?.records || []) as LegalMatter[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const upcoming = useMemo(
    () => matters
      .filter((m) => {
        const d = daysUntil(m.settlement_date);
        return d !== null && d >= -7 && d <= 45;
      })
      .sort((a, b) => (a.settlement_date || '').localeCompare(b.settlement_date || ''))
      .slice(0, 6),
    [matters],
  );

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card/70 px-6 py-7 shadow-lg shadow-primary/5">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  const tiles = [
    { label: 'Active matters', value: stats?.total ?? matters.length, icon: Briefcase },
    { label: 'Settling in 30 days', value: stats?.settling_30d ?? 0, icon: CalendarClock },
    { label: 'Flagged at risk', value: stats?.at_risk ?? 0, icon: AlertTriangle },
  ];

  return (
    <SolicitorPortalShell
      eyebrow="Welcome back"
      title={smartCapitalize(user?.name) || 'Solicitor'}
      description="Your conveyancing workload across every NPC client shared with your practice."
      actions={
        <Button asChild size="sm">
          <Link to="/solicitor/matters">
            Open matters <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="solicitor-portal-stat-card">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                <Icon className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <PortfolioInsightsPanel />



      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Settlement runway</CardTitle>
            <CardDescription>Matters settling in the next 45 days, soonest first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : upcoming.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                Nothing settling in the next 45 days.
              </div>
            ) : upcoming.map((m) => {
              const countdown = countdownLabel(m.settlement_date);
              return (
                <Link
                  key={m.id}
                  to={`/solicitor/matters/${m.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{m.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{formatPropertyAddress(m)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge variant="outline" className={cn('mb-1 font-medium', MATTER_STATUS_CLASSES[m.status])}>
                      {MATTER_STATUS_LABELS[m.status]}
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      {formatMatterDate(m.settlement_date)}
                      {countdown ? ` · ${countdown}` : ''}
                    </p>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden /> Needs attention
            </CardTitle>
            <CardDescription>Matters NPC has flagged as at risk.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {flagged.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                No matters are flagged right now.
              </p>
            ) : flagged.map((m) => (
              <Link
                key={m.id}
                to={`/solicitor/matters/${m.id}`}
                className="block rounded-lg border border-destructive/30 bg-destructive/5 p-3 transition-colors hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="truncate text-sm font-medium text-foreground">{m.title}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{m.risk_notes || 'Flagged by NPC.'}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </SolicitorPortalShell>
  );
}
