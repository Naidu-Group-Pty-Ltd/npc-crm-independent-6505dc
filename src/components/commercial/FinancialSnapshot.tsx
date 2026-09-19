import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCommercialLeases } from '@/hooks/useCommercialProperties';
import {
  calculateNoi, calculateYields, calculateCoverage, calculateCommercialGst
} from '@/utils/commercial';
import type { CommercialProperty } from '@/hooks/useCommercialProperties';

interface Props { property: CommercialProperty; }

function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number) { return `${n.toFixed(2)}%`; }

export function FinancialSnapshot({ property }: Props) {
  const { leases } = useCommercialLeases(property.id);

  const snapshot = useMemo(() => {
    const grossRent = leases.reduce((a, l) => a + (Number(l.base_rent_pa) || 0), 0);
    const outgoingsObj = (property.outgoings_recoverable ?? {}) as Record<string, number>;
    const outgoingsTotal = Object.values(outgoingsObj).reduce((a, b) => a + (Number(b) || 0), 0);
    // Estimate recovered outgoings as weighted recovery % across tenants
    const weightedRecoveryPct = grossRent > 0
      ? leases.reduce((a, l) => a + ((Number(l.outgoings_recovery_pct) || 0) * (Number(l.base_rent_pa) || 0)), 0) / grossRent
      : 0;
    const recovered = outgoingsTotal * (weightedRecoveryPct / 100);

    const noi = calculateNoi({
      grossRentalIncome: grossRent,
      recoveredOutgoings: recovered,
      vacancyAllowancePct: 5,
      outgoings: outgoingsObj as any,
    });

    const price = Number(property.purchase_price) || Number(property.valuation) || 0;
    const yields = price > 0 ? calculateYields({ passingNoi: noi.noi, marketNoi: noi.noi, price }) : null;

    const gst = price > 0 ? calculateCommercialGst({
      purchasePrice: price,
      treatment: property.gst_treatment,
    }) : null;

    // Indicative coverage assuming 65% LVR at 7%
    const indicativeLoan = price * 0.65;
    const coverage = price > 0 ? calculateCoverage({
      noi: noi.noi,
      loanAmount: indicativeLoan,
      interestRatePct: 7,
      loanTermYears: 25,
    }) : null;

    return { grossRent, outgoingsTotal, recovered, noi, yields, gst, coverage, indicativeLoan };
  }, [leases, property]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Income & NOI</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Gross Rental Income (PA)" value={fmtMoney(snapshot.grossRent)} />
          <Row label="Total Outgoings" value={fmtMoney(snapshot.outgoingsTotal)} />
          <Row label="Recovered from Tenants" value={fmtMoney(snapshot.recovered)} />
          <Row label="Vacancy Allowance" value="5.00%" muted />
          <Row label="Effective Gross Income" value={fmtMoney(snapshot.noi.effectiveGrossIncome)} />
          <Row label="Net Operating Income" value={fmtMoney(snapshot.noi.noi)} bold />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Yield & Valuation</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Purchase / Valuation" value={fmtMoney(Number(property.purchase_price) || Number(property.valuation) || 0)} />
          <Row label="Passing Yield" value={snapshot.yields ? fmtPct(snapshot.yields.passingYield) : '—'} bold />
          <Row label="GST Treatment" value={snapshot.gst?.treatment.replace('_', ' ') ?? '—'} muted />
          <Row label="GST Amount" value={snapshot.gst ? fmtMoney(snapshot.gst.gstAmount) : '—'} />
          <Row label="GST Claimable" value={snapshot.gst ? fmtMoney(snapshot.gst.gstClaimable) : '—'} />
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Indicative Debt Serviceability</CardTitle>
          <p className="text-xs text-muted-foreground">Modelled at 65% LVR, 7.00% rate, 25-year P&amp;I — for guidance only.</p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Indicative Loan" value={fmtMoney(snapshot.indicativeLoan)} />
          <Stat label="Annual Interest" value={snapshot.coverage ? fmtMoney(snapshot.coverage.annualInterest) : '—'} />
          <Stat label="ICR" value={snapshot.coverage ? `${snapshot.coverage.icr}x` : '—'} highlight={snapshot.coverage ? snapshot.coverage.icr >= 1.5 ? 'success' : 'warning' : undefined} />
          <Stat label="DSCR" value={snapshot.coverage ? `${snapshot.coverage.dscr}x` : '—'} highlight={snapshot.coverage ? snapshot.coverage.dscr >= 1.25 ? 'success' : 'warning' : undefined} />
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
