/**
 * BorrowingCapacitySegmentCard
 *
 * Phase 3 presentational card — surfaces the hybrid segment breakdown produced
 * by the BC engine's portfolio reconciler. Renders only when the engine
 * reports more than one asset-class contribution (i.e. at least one commercial
 * or industrial property is linked to the client). Residential-only clients
 * see no change.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Building2, Factory, Home, Layers, Info, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

type AssetClass = 'residential' | 'commercial' | 'industrial';

interface SegmentContribution {
  assetClass: AssetClass;
  propertyId?: string;
  address?: string;
  propertyValue?: number;
  loanBalance?: number;
  lvr?: number;
  shadedAnnualIncome?: number;
  annualDebtService?: number;
  icr?: number | null;
  dscr?: number | null;
  maxLoanByIcr?: number | null;
  maxLoanByDscr?: number | null;
  headroom?: number;
  warnings?: string[];
  assumptions?: string[];
}

interface SegmentReconciliation {
  enabled?: boolean;
  triggered?: boolean;
  segmentBreakdown: SegmentContribution[];
  totals?: {
    additionalAnnualNoi?: number;
    additionalAnnualDebtService?: number;
    additionalHeadroom?: number;
  };
  overlays?: {
    extraMonthlyCommitments?: number;
    extraShadedAnnualIncome?: number;
    extraDtiDenominator?: number;
    portfolioCapacityDelta?: number;
  };
  warnings?: string[];
}

interface Props {
  reconciliation: SegmentReconciliation | null | undefined;
  residentialCapacity: number;
  portfolioCapacity: number | null | undefined;
}

const formatCurrency = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatRatio = (value: number | null | undefined, suffix = 'x') => {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}${suffix}`;
};

const classMeta: Record<AssetClass, { label: string; Icon: typeof Home; tone: string }> = {
  residential: { label: 'Residential', Icon: Home, tone: 'bg-primary/10 text-primary border-primary/20' },
  commercial: { label: 'Commercial', Icon: Building2, tone: 'bg-accent/10 text-accent-foreground border-accent/20' },
  industrial: { label: 'Industrial', Icon: Factory, tone: 'bg-warning/10 text-warning border-warning/20' },
};

export function BorrowingCapacitySegmentCard({
  reconciliation,
  residentialCapacity,
  portfolioCapacity,
}: Props) {
  if (!reconciliation || !reconciliation.triggered) return null;
  const segments = reconciliation.segmentBreakdown || [];
  if (segments.length === 0) return null;

  const delta = reconciliation.overlays?.portfolioCapacityDelta ?? 0;
  const portfolio = portfolioCapacity ?? residentialCapacity + delta;
  const deltaPositive = delta >= 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Portfolio Capacity Breakdown
          </CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Hybrid view combining residential serviceability with commercial &
                industrial ICR/DSCR contributions. Each segment is assessed
                independently then reconciled into a single portfolio capacity.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Totals strip */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-secondary/50">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Residential</p>
            <p className="text-sm font-semibold">{formatCurrency(residentialCapacity)}</p>
          </div>
          <div className="p-2 rounded-lg bg-secondary/50">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Δ Portfolio</p>
            <p
              className={`text-sm font-semibold flex items-center justify-center gap-1 ${
                deltaPositive ? 'text-success' : 'text-destructive'
              }`}
            >
              {deltaPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {formatCurrency(Math.abs(delta))}
            </p>
          </div>
          <div className="p-2 rounded-lg bg-primary/10">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Hybrid Total</p>
            <p className="text-sm font-semibold text-primary">{formatCurrency(portfolio)}</p>
          </div>
        </div>

        {/* Segment rows */}
        <div className="space-y-2">
          {segments.map((seg, idx) => {
            const meta = classMeta[seg.assetClass] || classMeta.residential;
            const Icon = meta.Icon;
            const icrAlert = seg.icr != null && seg.icr < 1;
            return (
              <div
                key={`${seg.assetClass}-${seg.propertyId || idx}`}
                className="rounded-lg border border-border/60 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className={`${meta.tone} gap-1`}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground truncate" title={seg.address || ''}>
                      {seg.address || 'Unlinked property'}
                    </span>
                  </div>
                  {icrAlert && (
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      ICR &lt; 1
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <Metric label="Value" value={formatCurrency(seg.propertyValue)} />
                  <Metric label="Loan" value={formatCurrency(seg.loanBalance)} />
                  <Metric label="ICR" value={formatRatio(seg.icr)} tone={icrAlert ? 'text-destructive' : undefined} />
                  <Metric label="DSCR" value={formatRatio(seg.dscr)} />
                  <Metric label="NOI / Shaded Inc." value={formatCurrency(seg.shadedAnnualIncome)} />
                  <Metric label="Debt Service" value={formatCurrency(seg.annualDebtService)} />
                  <Metric label="Max Loan (ICR)" value={formatCurrency(seg.maxLoanByIcr)} />
                  <Metric
                    label="Headroom"
                    value={formatCurrency(seg.headroom)}
                    tone={(seg.headroom ?? 0) >= 0 ? 'text-success' : 'text-destructive'}
                  />
                </div>
                {(seg.warnings?.length || 0) > 0 && (
                  <ul className="text-[11px] text-warning space-y-0.5">
                    {seg.warnings!.map((w, i) => (
                      <li key={i} className="flex gap-1">
                        <AlertTriangle className="h-3 w-3 mt-[1px] shrink-0" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {(reconciliation.warnings?.length || 0) > 0 && (
          <div className="text-[11px] text-warning space-y-1 pt-1 border-t border-border/60">
            {reconciliation.warnings!.map((w, i) => (
              <p key={i} className="flex gap-1">
                <AlertTriangle className="h-3 w-3 mt-[1px] shrink-0" />
                <span>{w}</span>
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`font-medium ${tone || 'text-foreground'}`}>{value}</span>
    </div>
  );
}
