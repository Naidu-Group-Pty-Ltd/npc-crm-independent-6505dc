/**
 * Industrial Portfolio KPI Widget — overview tile.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Factory, ArrowRight, AlertTriangle, BadgeCheck, Gauge, ShieldCheck, Plus } from 'lucide-react';
import {
  industrialApi,
  type IndustrialProperty,
  type IndustrialTenancy,
} from '@/hooks/useIndustrialProperties';
import { calculateIndustrialNoi, calculateIndustrialWale } from '@/utils/industrial';
import { cn } from '@/lib/utils';

const fmtAud = (n: number) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
    notation: n >= 1_000_000 ? 'compact' : 'standard',
  }).format(n || 0);

interface PortfolioMetrics {
  count: number;
  totalValuation: number;
  totalGla: number;
  totalRent: number;
  totalNoi: number;
  weightedYieldPct: number;
  waleYears: number;
  occupancyPct: number;
  upcomingExpiries12m: number;
}

const EMPTY: PortfolioMetrics = {
  count: 0, totalValuation: 0, totalGla: 0, totalRent: 0, totalNoi: 0,
  weightedYieldPct: 0, waleYears: 0, occupancyPct: 0, upcomingExpiries12m: 0,
};

export function IndustrialPortfolioWidget() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PortfolioMetrics>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const propsRes = await industrialApi.listProperties();
      const props = propsRes.data || [];
      if (props.length === 0) {
        if (!cancelled) { setMetrics(EMPTY); setLoading(false); }
        return;
      }
      const tenancyLists = await Promise.all(
        props.map(p => industrialApi.listTenancies(p.id).then(r => r.data || []))
      );
      if (cancelled) return;
      setMetrics(aggregate(props, tenancyLists));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const tiles = useMemo(() => ([
    { label: 'Assets', value: metrics.count.toString(), raw: metrics.count, cue: metrics.count === 1 ? 'asset on book' : 'assets on book' },
    { label: 'Total Value', value: fmtAud(metrics.totalValuation), raw: metrics.totalValuation, cue: 'portfolio valuation' },
    { label: 'Total GLA', value: `${metrics.totalGla.toLocaleString('en-AU')} m²`, raw: metrics.totalGla, cue: 'gross lettable area' },
    { label: 'Passing Rent', value: `${fmtAud(metrics.totalRent)} pa`, raw: metrics.totalRent, cue: 'contracted income' },
    { label: 'NOI (est.)', value: `${fmtAud(metrics.totalNoi)} pa`, raw: metrics.totalNoi, cue: 'after standard allowances' },
    { label: 'Weighted Yield', value: `${metrics.weightedYieldPct.toFixed(2)}%`, raw: metrics.weightedYieldPct, cue: metrics.weightedYieldPct === 0 ? 'yield visible at zero' : 'income weighted' },
    { label: 'WALE (income)', value: `${metrics.waleYears.toFixed(1)} yrs`, raw: metrics.waleYears, cue: metrics.waleYears === 0 ? 'no income-weighted term' : 'income-weighted term' },
    { label: 'Occupancy', value: `${metrics.occupancyPct.toFixed(1)}%`, raw: metrics.occupancyPct, cue: metrics.occupancyPct === 0 ? 'vacancy visible at zero' : 'by leased area' },
  ]), [metrics]);

  return (
    <Card className="hover-scale overflow-hidden border-border/70 bg-gradient-to-br from-card via-card to-muted/20 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border/60 bg-muted/15 pb-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] dashboard-luxury-kicker">
            <ShieldCheck className="h-3.5 w-3.5" />
            Executive asset summary
          </div>
          <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl dashboard-luxury-icon-tile">
              <Factory className="h-5 w-5" />
            </span>
            Industrial Portfolio
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Core valuation, floor area, income, lease and occupancy indicators for owned industrial assets.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="dashboard-luxury-primary-cta min-h-10 shrink-0 rounded-full px-4 font-semibold transition-all duration-200 active:translate-y-0"
          onClick={() => navigate('/industrial')}
        >
          View <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="p-4 md:p-5">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : metrics.count === 0 ? (
          <div className="relative overflow-hidden rounded-2xl dashboard-luxury-empty-state border border-dashed px-5 py-8 text-center shadow-inner">
            <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--dashboard-primary-strong)/0.30)] to-transparent" />
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl dashboard-luxury-icon-tile shadow-sm">
              <Factory className="h-8 w-8" />
            </div>
            <div className="mx-auto max-w-md space-y-2">
              <p className="text-base font-semibold text-foreground">No industrial assets yet.</p>
              <p className="text-sm leading-6 text-muted-foreground">Add an industrial property to activate portfolio valuation, GLA, rent, NOI, WALE and occupancy metrics.</p>
            </div>
            <div className="mt-5">
              <Button
                size="sm"
                className="dashboard-luxury-primary-cta min-h-10 rounded-full px-4 font-semibold transition-all duration-200 active:translate-y-0"
                onClick={() => navigate('/industrial')}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add your first industrial property
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tiles.map(t => {
                const isZero = t.raw === 0;
                const isNegative = t.raw < 0;
                return (
                  <div
                    key={t.label}
                    className={cn(
                      'group rounded-2xl border bg-background/70 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-background hover:shadow-md',
                      isZero && 'border-dashed bg-muted/20',
                      isNegative && 'border-destructive/30 bg-destructive/5'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {t.label}
                      </div>
                      {isNegative ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                      ) : (
                        <Gauge className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-[hsl(var(--dashboard-primary-strong))]" />
                      )}
                    </div>
                    <div
                      className={cn(
                        'mt-3 break-words text-2xl font-bold leading-none tracking-tight text-foreground tabular-nums md:text-[1.65rem]',
                        isZero && 'text-muted-foreground',
                        isNegative && 'text-destructive'
                      )}
                    >
                      {t.value}
                    </div>
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {isZero ? <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" /> : <BadgeCheck className="h-3.5 w-3.5 dashboard-luxury-inline-accent" />}
                      <span>{isNegative ? 'negative value shown' : t.cue}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {metrics.upcomingExpiries12m > 0 && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                {metrics.upcomingExpiries12m} tenancy{metrics.upcomingExpiries12m === 1 ? '' : 'ies'} expiring in the next 12 months.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

}

function aggregate(props: IndustrialProperty[], tenancyLists: IndustrialTenancy[][]): PortfolioMetrics {
  let totalValuation = 0;
  let totalRent = 0;
  let totalNoi = 0;
  let totalGla = 0;
  let occupiedGla = 0;
  let upcomingExpiries = 0;
  const waleTenancies: IndustrialTenancy[] = [];
  const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
  const horizon = Date.now() + oneYearMs;

  props.forEach((p, idx) => {
    const tenancies = tenancyLists[idx] || [];
    const grossRent = tenancies.reduce((s, t) => s + (Number(t.base_rent_pa) || 0), 0);
    const noi = calculateIndustrialNoi({
      grossRentalIncome: grossRent,
      vacancyAllowancePct: 4,
      outgoings: { management: grossRent * 0.025 },
    });
    totalRent += grossRent;
    totalNoi += noi.noi;
    totalValuation += Number(p.current_valuation) || Number(p.purchase_price) || 0;
    totalGla += Number(p.gla_sqm) || 0;

    tenancies.forEach(t => {
      const area = Number(t.gla_sqm) || 0;
      occupiedGla += area;
      waleTenancies.push(t);
      if (t.lease_end) {
        const ts = new Date(t.lease_end).getTime();
        if (!isNaN(ts) && ts > Date.now() && ts <= horizon) upcomingExpiries++;
      }
    });
  });

  const weightedYieldPct = totalValuation > 0 ? (totalNoi / totalValuation) * 100 : 0;
  const wale = calculateIndustrialWale(waleTenancies.map(t => ({
    base_rent_pa: Number(t.base_rent_pa) || 0,
    gla_sqm: Number(t.gla_sqm) || 0,
    lease_end: t.lease_end || null,
  })));
  const occupancyPct = totalGla > 0 ? Math.min(100, (occupiedGla / totalGla) * 100) : 0;

  return {
    count: props.length,
    totalValuation,
    totalGla,
    totalRent,
    totalNoi,
    weightedYieldPct,
    waleYears: wale.waleByIncome,
    occupancyPct,
    upcomingExpiries12m: upcomingExpiries,
  };
}
