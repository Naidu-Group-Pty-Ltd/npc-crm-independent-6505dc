/**
 * A comparison property's own inputs and ten-year projection.
 *
 * The property the adviser opened has a full, editable projection table. A peer
 * cannot: the per-year overrides are stored against the open report, so there
 * is nowhere to put an edit made here. Rather than draw an editable table that
 * silently discards changes, this one says it is read-only and means it.
 *
 * The figures are the peer's OWN — the same `readBaseFinancials` reading and
 * the same projection that feeds its line on every chart above, so a number
 * here and a number there cannot disagree.
 */
import { Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  METRICS_UNAVAILABLE_REASON,
  formatBreakEven,
  formatMetricMultiple,
  formatMetricPercent,
  type InvestmentMetrics,
  type MetricsUnavailable,
} from '@/lib/cashFlow/investmentMetrics.pure';
import { AU_LOCALE } from '@/lib/aml/displayDate';
import { PropertySeriesMarker } from '@/components/cash-flow/PropertySeriesMarker';
import type { PropertyLineStyle } from '@/lib/cashFlow/chartTheme';

/** The projection rows this view draws. */
export interface PeerProjectionRow {
  year: number;
  propertyMarketValue: number;
  loanAmount: number;
  equityInProperty: number;
  rentalIncomePA: number;
  grossYield: number;
  netYield: number;
  afterTaxCashFlowPA: number;
}

/** The subset of `readBaseFinancials` this view shows. */
export interface PeerInputs {
  purchasePrice: number;
  depositValue: number;
  loanAmount: number;
  loanToValueRatio: number;
  interestRate: number;
  capitalGrowth: number;
  weeklyRent: number;
  stampDuty: number;
  councilRates: number;
  waterRates: number;
  bodyCorporateFees: number;
  buildingLandlordInsurance: number;
  propertyManagementFees: number;
  repairsMaintenance: number;
  solicitorFees: number;
  lmiAmount: number;
  landTax: number;
  occupancyRate: number;
  cpiGrowthRate: number;
  taxRate: number;
}

export interface CashFlowPeerDetailProps extends Partial<PropertyLineStyle> {
  address: string;
  colour: string;
  inputs: PeerInputs;
  projections: PeerProjectionRow[];
  metrics: InvestmentMetrics | null;
  unavailable: MetricsUnavailable | null;
}

const AUD = new Intl.NumberFormat(AU_LOCALE, {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

const money = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? AUD.format(value) : '—';
const percent = (value: number | null | undefined, digits = 2) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}%` : '—';

export function CashFlowPeerDetail({
  address,
  colour,
  dash,
  linecap,
  name,
  inputs,
  projections,
  metrics,
  unavailable,
}: CashFlowPeerDetailProps) {
  const years = projections.filter((row) => row.year >= 1);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/80">
        <CardHeader className="border-b bg-muted/20 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <PropertySeriesMarker colour={colour} dash={dash} linecap={linecap} name={name ?? 'solid'} />
              {address}
            </CardTitle>
            <Badge variant="outline" className="gap-1.5 rounded-full text-[11px] font-normal">
              <Lock className="h-3 w-3" />
              Read-only comparison basis
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            The assumptions and projection behind this property's line on the charts above. Edits belong
            to the report that owns them — open it from Cash Flow Analysis to change these.
          </p>
        </CardHeader>

        <CardContent className="space-y-5 pt-4">
          <section>
            <div className="mb-3 border-b-2 border-muted pb-2">
              <h4 className="text-center text-sm font-bold tracking-wide">INPUTS</h4>
            </div>
            <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
              <Table>
                <TableBody>
                  <InputRow label="Purchase Price" value={money(inputs.purchasePrice)} />
                  <InputRow label="Deposit Value" value={money(inputs.depositValue)} />
                  <InputRow label="Loan to Value ratio" value={percent(inputs.loanToValueRatio, 0)} />
                  <InputRow label="Interest Rate" value={percent(inputs.interestRate)} />
                  <InputRow label="Capital Growth" value={percent(inputs.capitalGrowth, 0)} />
                  <InputRow label="Weekly Rent" value={money(inputs.weeklyRent)} />
                  <InputRow label="Stamp Duty" value={money(inputs.stampDuty)} />
                  <InputRow label="Solicitor Fees" value={money(inputs.solicitorFees)} />
                  <InputRow label="LMI" value={inputs.lmiAmount > 0 ? money(inputs.lmiAmount) : '—'} />
                  <InputRow label="Land Tax (p.a.)" value={inputs.landTax > 0 ? money(inputs.landTax) : '—'} />
                </TableBody>
              </Table>
              <Table>
                <TableBody>
                  <InputRow label="Loan Amount" value={money(inputs.loanAmount)} />
                  <InputRow label="Council Rate Charges" value={money(inputs.councilRates)} />
                  <InputRow label="Water Rate Charges" value={money(inputs.waterRates)} />
                  <InputRow
                    label="Body Corporate / Strata"
                    value={inputs.bodyCorporateFees > 0 ? money(inputs.bodyCorporateFees) : '—'}
                  />
                  <InputRow label="Building & Landlord Insurance" value={money(inputs.buildingLandlordInsurance)} />
                  <InputRow label="Property Management Fees" value={percent(inputs.propertyManagementFees, 0)} />
                  <InputRow label="Repairs & Maintenance" value={money(inputs.repairsMaintenance)} />
                  <InputRow label="Occupancy Rate" value={`${inputs.occupancyRate} weeks/year`} />
                  <InputRow label="CPI / Expense Growth" value={percent(inputs.cpiGrowthRate, 0)} />
                  <InputRow label="Tax Rate (Marginal)" value={percent(inputs.taxRate, 0)} />
                </TableBody>
              </Table>
            </div>
          </section>

          <section>
            <div className="mb-3 border-b-2 border-muted pb-2">
              <h4 className="text-center text-sm font-bold tracking-wide">TEN-YEAR OUTCOME</h4>
            </div>
            {metrics ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <Outcome label="10-Year ROI" value={formatMetricPercent(metrics.roi)} />
                <Outcome label="Annualised" value={formatMetricPercent(metrics.annualisedRoi, 2)} />
                <Outcome label="Capital committed" value={money(metrics.capitalCommitted)} />
                <Outcome label="Capital gain" value={money(metrics.capitalGain)} />
                <Outcome label="Total cash flow" value={money(metrics.totalCashFlow)} />
                <Outcome label="Break-even" value={formatBreakEven(metrics.breakEvenYear)} />
                <Outcome label="Equity multiple" value={formatMetricMultiple(metrics.equityMultiple)} />
                <Outcome label="Cash-on-cash (Y1)" value={formatMetricPercent(metrics.cashOnCash, 2)} />
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
                {METRICS_UNAVAILABLE_REASON[unavailable ?? 'capital_unknown']}
              </p>
            )}
          </section>

          <section className="space-y-2">
            <div className="mb-1 border-b-2 border-muted pb-2">
              <h4 className="text-center text-sm font-bold tracking-wide">10-YEAR PROJECTION</h4>
            </div>
            <div className="responsive-table-scroll overflow-x-auto rounded-xl border border-border/60">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 min-w-[110px] bg-card">Year</TableHead>
                    <TableHead className="min-w-[110px] text-right">Property Value</TableHead>
                    <TableHead className="min-w-[110px] text-right">Loan Balance</TableHead>
                    <TableHead className="min-w-[110px] text-right">Equity</TableHead>
                    <TableHead className="min-w-[110px] text-right">Rental Income</TableHead>
                    <TableHead className="min-w-[90px] text-right">Gross Yield</TableHead>
                    <TableHead className="min-w-[90px] text-right">Net Yield</TableHead>
                    <TableHead className="min-w-[130px] text-right">After-Tax Cash Flow</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {years.map((row) => (
                    <TableRow key={row.year}>
                      <TableCell className="sticky left-0 z-10 bg-card font-medium">Year {row.year}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.propertyMarketValue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.loanAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-success">{money(row.equityInProperty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.rentalIncomePA)}</TableCell>
                      <TableCell className="text-right tabular-nums">{percent(row.grossYield)}</TableCell>
                      <TableCell className="text-right tabular-nums">{percent(row.netYield)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          row.afterTaxCashFlowPA < 0 ? 'text-destructive' : 'text-success'
                        }`}
                      >
                        {money(row.afterTaxCashFlowPA)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

function InputRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="w-1/2 font-medium">{label}</TableCell>
      <TableCell className="text-right tabular-nums">{value}</TableCell>
    </TableRow>
  );
}

function Outcome({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
