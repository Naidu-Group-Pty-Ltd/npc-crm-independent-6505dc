import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useIndustrialTenancies, useIndustrialCapex } from '@/hooks/useIndustrialProperties';
import type { IndustrialProperty } from '@/hooks/useIndustrialProperties';
import {
  calculateIndustrialNoi, calculateIndustrialYields, calcSiteMetrics, calculateIndustrialBc,
} from '@/utils/industrial';

interface Props { property: IndustrialProperty; }

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);
const fmtPct = (n: number) => `${(n || 0).toFixed(2)}%`;

export function IndustrialFinancialSnapshot({ property }: Props) {
  const { tenancies } = useIndustrialTenancies(property.id);
  const { items: capexItems } = useIndustrialCapex(property.id);

  const snapshot = useMemo(() => {
    const grossRent = tenancies.reduce((a, t) => a + (Number(t.base_rent_pa) || 0), 0);
    // Reserve = average annual capex over the schedule horizon (next 10y)
    const horizon = new Date().getFullYear() + 10;
    const upcoming = capexItems.filter(i => i.year >= new Date().getFullYear() && i.year <= horizon);
    const capexReservePa = upcoming.length > 0
      ? upcoming.reduce((s, i) => s + Number(i.amount || 0), 0) / Math.max(1, horizon - new Date().getFullYear())
      : 0;

    const noi = calculateIndustrialNoi({
      grossRentalIncome: grossRent,
      vacancyAllowancePct: 4,
      outgoings: { management: grossRent * 0.025 }, // 2.5% mgmt as default owner cost
      capexReservePa,
    });

    const price = Number(property.current_valuation) || Number(property.purchase_price) || 0;
    const yields = price > 0 ? calculateIndustrialYields({ passingNoi: noi.noi, marketNoi: noi.noi, price }) : null;

    const metrics = calcSiteMetrics({
      glaSqm: Number(property.gla_sqm) || 0,
      siteAreaSqm: Number(property.site_area_sqm) || 0,
      hardstandSqm: Number(property.hardstand_sqm) || 0,
      officePct: Number(property.office_pct) || 0,
      price,
    });

    const bc = price > 0 ? calculateIndustrialBc({
      noi: noi.noi,
      propertyValue: price,
      interestRatePct: 7.25,
      bufferPct: 1.0,
      loanTermYears: 20,
      maxLvr: 0.60,
      minIcr: 1.75,
      minDscr: 1.35,
    }) : null;

    return { grossRent, noi, yields, metrics, bc, capexReservePa };
  }, [tenancies, capexItems, property]);

  const bandColor = snapshot.metrics.coverageBand === 'balanced' ? 'default' :
    snapshot.metrics.coverageBand === 'over-developed' ? 'destructive' : 'secondary';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Income & NOI</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Gross Rental Income (PA)" value={fmtMoney(snapshot.grossRent)} />
          <Row label="Vacancy Allowance" value="4.00%" muted />
          <Row label="Effective Gross Income" value={fmtMoney(snapshot.noi.effectiveGrossIncome)} />
          <Row label="Outgoings (owner)" value={`- ${fmtMoney(snapshot.noi.totalOutgoings)}`} />
          <Row label="Capex Reserve (PA)" value={`- ${fmtMoney(snapshot.capexReservePa)}`} muted />
          <Row label="Net Operating Income" value={fmtMoney(snapshot.noi.noi)} bold />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Yield & Site Metrics</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Value (val. or purchase)" value={fmtMoney(Number(property.current_valuation) || Number(property.purchase_price) || 0)} />
          <Row label="Passing Yield" value={snapshot.yields ? fmtPct(snapshot.yields.passingYield) : '—'} bold />
          <Row label="$/m² GLA" value={fmtMoney(snapshot.metrics.pricePerSqmGla)} />
          <Row label="$/m² Site" value={fmtMoney(snapshot.metrics.pricePerSqmSite)} />
          <Row label="Site Cover" value={fmtPct(snapshot.metrics.siteCoverPct)} />
          <Row label="Hardstand Ratio" value={fmtPct(snapshot.metrics.hardstandRatioPct)} muted />
          <div className="flex justify-between items-center">
            <span>Coverage Band</span>
            <Badge variant={bandColor as any} className="capitalize">{snapshot.metrics.coverageBand}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Indicative Industrial Serviceability</CardTitle>
          <p className="text-xs text-muted-foreground">60% LVR, 7.25% rate + 1% buffer, 20y term, ICR ≥ 1.75x, DSCR ≥ 1.35x — for guidance only.</p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Max Loan" value={snapshot.bc ? fmtMoney(snapshot.bc.maxLoan) : '—'} />
          <Stat label="Implied LVR" value={snapshot.bc ? `${(snapshot.bc.impliedLvr * 100).toFixed(1)}%` : '—'} />
          <Stat label="ICR @ Max" value={snapshot.bc ? `${snapshot.bc.coverageAtMax.icr}x` : '—'} highlight={snapshot.bc && snapshot.bc.coverageAtMax.icr >= 1.75 ? 'success' : 'warning'} />
          <Stat label="DSCR @ Max" value={snapshot.bc ? `${snapshot.bc.coverageAtMax.dscr}x` : '—'} highlight={snapshot.bc && snapshot.bc.coverageAtMax.dscr >= 1.35 ? 'success' : 'warning'} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-muted-foreground' : ''}`}>
      <span>{label}</span>
      <span className={bold ? 'font-semibold' : ''}>{value}</span>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: 'success' | 'warning' }) {
  const cls = highlight === 'success' ? 'text-success' : highlight === 'warning' ? 'text-warning' : '';
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}
