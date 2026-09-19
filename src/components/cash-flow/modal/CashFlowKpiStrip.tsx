import { ArrowDownRight, ArrowUpRight, DollarSign, Home, Landmark, LineChart, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface CashFlowKpiStripProps {
  baseFinancialData: any;
  projections: any[];
  formatCurrency: (value: number) => string;
}

export function CashFlowKpiStrip({ baseFinancialData, projections, formatCurrency }: CashFlowKpiStripProps) {
  const year10 = projections[10];
  const year10Value = year10?.propertyMarketValue || 0;
  const year10CashFlow = year10?.afterTaxCashFlowPA || 0;
  const year10Equity = year10?.equityInProperty || 0;
  const totalAfterTaxCashFlow = projections
    .filter((projection) => projection.year >= 1)
    .reduce((sum, projection) => sum + (projection.afterTaxCashFlowPA || 0), 0);

  return (
    <Card className="overflow-hidden border-border/80 bg-gradient-to-br from-card dark:from-background via-card dark:via-background to-background text-foreground dark:text-white shadow-xl">
      <CardContent className="p-0">
        <div className="border-b border-border dark:border-white/10 bg-white/[0.06] px-4 py-4 md:px-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-brand-200">Executive KPI strip</p>
              <h3 className="text-lg font-semibold tracking-tight md:text-xl">10-year cash-flow snapshot</h3>
            </div>
            <p className="text-xs text-muted-foreground dark:text-foreground">All figures use the current projection values.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-px bg-card/10 dark:bg-white/10 min-[460px]:grid-cols-2 xl:grid-cols-6">
          <KpiTile
            icon={Home}
            label="Current Value"
            sublabel="Current market value"
            value={formatCurrency(baseFinancialData.marketValueNow)}
          />
          <KpiTile
            icon={Landmark}
            label="Purchase Price"
            sublabel="Original purchase basis"
            value={formatCurrency(baseFinancialData.purchasePrice)}
          />
          <KpiTile
            icon={TrendingUp}
            label="Year 10 Value"
            sublabel="Projected property value"
            value={projections.length > 0 ? formatCurrency(year10Value) : '-'}
            tone="positive"
          />
          <KpiTile
            icon={DollarSign}
            label="Year 10 After-Tax Cash Flow"
            sublabel="Annual year-10 position"
            value={projections.length > 0 ? formatCurrency(year10CashFlow) : '-'}
            tone={year10CashFlow < 0 ? 'negative' : 'positive'}
          />
          <KpiTile
            icon={Wallet}
            label="Year 10 Equity"
            sublabel="Projected ownership"
            value={projections.length > 0 ? formatCurrency(year10Equity) : '-'}
            tone="positive"
          />
          <KpiTile
            icon={LineChart}
            label="Total 10-Year After-Tax Cash Flow"
            sublabel="Cumulative years 1-10"
            value={projections.length > 0 ? formatCurrency(totalAfterTaxCashFlow) : '-'}
            tone={totalAfterTaxCashFlow < 0 ? 'negative' : 'positive'}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function KpiTile({ icon: Icon, label, sublabel, value, tone }: {
  icon: typeof Home;
  label: string;
  sublabel: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  const isPositive = tone === 'positive';
  const isNegative = tone === 'negative';

  return (
    <div className="group min-h-[148px] bg-background dark:bg-background/45 p-4 transition-colors hover:bg-background/80 md:min-h-[158px] md:p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <span className="rounded-2xl bg-card/10 dark:bg-white/10 p-2 text-brand-100 shadow-sm ring-1 ring-border dark:ring-white/10">
          <Icon className="h-4 w-4" />
        </span>
        {tone && (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ring-1',
            isPositive && 'bg-success/10 text-success ring-success/15',
            isNegative && 'bg-destructive/10 text-destructive ring-destructive/15'
          )}>
            {isNegative ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
            {isNegative ? 'Negative' : 'Positive'}
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">{label}</p>
        <p className={cn(
          'break-words text-2xl font-bold tracking-tight text-foreground dark:text-white md:text-[1.65rem]',
          isPositive && 'text-success',
          isNegative && 'text-destructive'
        )}>
          {value}
        </p>
        <p className="text-xs leading-5 text-muted-foreground dark:text-muted-foreground">{sublabel}</p>
      </div>
    </div>
  );
}
