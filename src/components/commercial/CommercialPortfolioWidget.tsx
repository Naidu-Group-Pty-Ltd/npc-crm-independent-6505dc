/**
 * Commercial Portfolio KPI Widget
 *
 * Pulls every commercial property the user owns, fetches their rent rolls,
 * and surfaces the headline portfolio metrics:
 *   - Asset count
 *   - Total valuation
 *   - Aggregate passing rent / NOI
 *   - Weighted passing yield
 *   - Portfolio WALE (by income)
 *   - Portfolio occupancy (by area)
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, ArrowRight, AlertTriangle, BadgeCheck, Gauge, ShieldCheck } from 'lucide-react';
import {
  commercialApi,
  type CommercialProperty,
  type CommercialLease,
} from '@/hooks/useCommercialProperties';
import { calculateNoi, calculateWale } from '@/utils/commercial';
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
  totalRent: number;
  totalNoi: number;
  weightedYieldPct: number;
  waleYears: number;
  occupancyPct: number;
  upcomingExpiries12m: number;
}

const EMPTY: PortfolioMetrics = {
  count: 0,
  totalValuation: 0,
  totalRent: 0,
  totalNoi: 0,
  weightedYieldPct: 0,
  waleYears: 0,
  occupancyPct: 0,
  upcomingExpiries12m: 0,
};

export function CommercialPortfolioWidget() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PortfolioMetrics>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const propsRes = await commercialApi.listProperties();
      const props = propsRes.data || [];
      if (props.length === 0) {
        if (!cancelled) { setMetrics(EMPTY); setLoading(false); }
        return;
      }
      const leaseLists = await Promise.all(
        props.map(p => commercialApi.listLeases(p.id).then(r => r.data || []))
      );
      if (cancelled) return;
      setMetrics(aggregate(props, leaseLists));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const tiles = useMemo(() => ([
    { label: 'Assets', value: metrics.count.toString(), raw: metrics.count, cue: metrics.count === 1 ? 'asset on book' : 'assets on book' },
    { label: 'Total Value', value: fmtAud(metrics.totalValuation), raw: metrics.totalValuation, cue: 'portfolio valuation' },
    { label: 'Passing Rent', value: `${fmtAud(metrics.totalRent)} pa`, raw: metrics.totalRent, cue: 'contracted income' },
    { label: 'NOI (est.)', value: `${fmtAud(metrics.totalNoi)} pa`, raw: metrics.totalNoi, cue: 'after standard allowances' },
    { label: 'Weighted Yield', value: `${metrics.weightedYieldPct.toFixed(2)}%`, raw: metrics.weightedYieldPct, cue: metrics.weightedYieldPct === 0 ? 'yield visible at zero' : 'income weighted' },
    { label: 'WALE (income)', value: `${metrics.waleYears.toFixed(1)} yrs`, raw: metrics.waleYears, cue: metrics.waleYears === 0 ? 'no income-weighted term' : 'income-weighted term' },
    { label: 'Occupancy', value: `${metrics.occupancyPct.toFixed(1)}%`, raw: metrics.occupancyPct, cue: metrics.occupancyPct === 0 ? 'vacancy visible at zero' : 'by leased area' },
    { label: 'Expiries < 12m', value: metrics.upcomingExpiries12m.toString(), raw: metrics.upcomingExpiries12m, cue: metrics.upcomingExpiries12m === 0 ? 'no near-term expiries' : 'renewal review' },
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
              <Building2 className="h-5 w-5" />
            </span>
            Commercial Portfolio
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Core valuation, income, lease and occupancy indicators for owned commercial assets.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="dashboard-luxury-primary-cta min-h-10 shrink-0 rounded-full px-4 font-semibold transition-all duration-200 active:translate-y-0"
          onClick={() => navigate('/commercial')}
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
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Building2 className="h-10 w-10 mx-auto mb-2 opacity-40" />
            No commercial assets yet.
            <div className="mt-3">
              <Button size="sm" variant="outline" className="dashboard-luxury-primary-cta min-h-10 rounded-full px-4 font-semibold transition-all duration-200 active:translate-y-0" onClick={() => navigate('/commercial')}>
                Add your first commercial property
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
                {metrics.upcomingExpiries12m} lease{metrics.upcomingExpiries12m === 1 ? '' : 's'} expiring in the next 12 months — review renewal strategy.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function aggregate(props: CommercialProperty[], leaseLists: CommercialLease[][]): PortfolioMetrics {
  let totalValuation = 0;
  let totalRent = 0;
  let totalNoi = 0;
  let totalNla = 0;
  let occupiedNla = 0;
  let upcomingExpiries = 0;
  const waleLeases: CommercialLease[] = [];
  const noiByProperty: number[] = [];
  const valByProperty: number[] = [];
  const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
  const horizon = Date.now() + oneYearMs;

  props.forEach((p, idx) => {
    const leases = leaseLists[idx] || [];
    const grossRent = leases.reduce((s, l) => s + (l.base_rent_pa || 0), 0);
    const noiRes = calculateNoi({
      grossRentalIncome: grossRent,
      recoveredOutgoings: 0,
      vacancyAllowancePct: 5,
      outgoings: p.outgoings_recoverable || {},
    });
    totalRent += grossRent;
    totalNoi += noiRes.noi;
    totalValuation += p.valuation || 0;
    valByProperty.push(p.valuation || 0);
    noiByProperty.push(noiRes.noi);

    leases.forEach(l => {
      totalNla += l.nla_sqm || 0;
      if (l.status === 'occupied' || l.status === 'holdover') {
        occupiedNla += l.nla_sqm || 0;
        waleLeases.push(l);
      }
      if (l.lease_end) {
        const t = new Date(l.lease_end).getTime();
        if (!isNaN(t) && t > Date.now() && t <= horizon) upcomingExpiries++;
      }
    });
  });

  const weightedYieldPct = totalValuation > 0 ? (totalNoi / totalValuation) * 100 : 0;
  const wale = calculateWale(waleLeases.map(l => ({
    base_rent_pa: l.base_rent_pa || 0,
    nla_sqm: l.nla_sqm || 0,
    lease_end: l.lease_end || null,
    status: l.status,
  })));
  const occupancyPct = totalNla > 0 ? (occupiedNla / totalNla) * 100 : 0;

  return {
    count: props.length,
    totalValuation,
    totalRent,
    totalNoi,
    weightedYieldPct,
    waleYears: wale.waleByIncome,
    occupancyPct,
    upcomingExpiries12m: upcomingExpiries,
  };
}
