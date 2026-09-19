import { format } from 'date-fns';
import { AlertTriangle, ArrowRight, Building, Calculator, CheckCircle2, FileText, Home, MapPin, ReceiptText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { BuildType, InvestmentGrade, InvestmentReport } from './types';
import { resolveCashFlowFinancialSummary } from './financialSummary';

interface CashFlowReportCardProps {
  report: InvestmentReport;
  buildType: BuildType;
  gradeInfo: InvestmentGrade | null;
  isOpening: boolean;
  onViewReport: (report: InvestmentReport) => void;
  onOpenCashFlow: (report: InvestmentReport) => void;
}

export function CashFlowReportCard({ report, buildType, gradeInfo, isOpening, onViewReport, onOpenCashFlow }: CashFlowReportCardProps) {
  const { purchasePrice, weeklyRent } = resolveCashFlowFinancialSummary(report);
  const isNewBuild = buildType === 'new_build';
  const isLandOnly = buildType === 'land_only';

  return (
    <Card className="group flex h-full flex-col overflow-hidden border-border/70 bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={isNewBuild ? "default" : isLandOnly ? "outline" : "secondary"}
              className="text-xs font-medium"
            >
              {isNewBuild ? (
                <><Building className="h-3 w-3 mr-1" />New Build</>
              ) : isLandOnly ? (
                <><MapPin className="h-3 w-3 mr-1" />Land Only</>
              ) : (
                <><Home className="h-3 w-3 mr-1" />Existing</>
              )}
            </Badge>
            {gradeInfo && (
              <Badge className={`${gradeInfo.color} text-foreground dark:text-white`}>
                {gradeInfo.grade}
              </Badge>
            )}
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {format(new Date(report.created_at), 'dd MMM yyyy')}
          </span>
        </div>

        <div className="space-y-2.5">
          <CardTitle className="line-clamp-2 font-heading text-base font-semibold leading-snug tracking-tight md:text-lg">
            {report.property_address}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="border-success/30 bg-success/10 text-success hover:bg-success/10">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Ready for cash-flow analysis
            </Badge>
            {weeklyRent === null && (
              <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning hover:bg-warning/10">
                <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                Rent review needed
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        <div className="grid grid-cols-2 gap-2.5 text-sm">
          <MetricTile
            label="Purchase Price"
            value={purchasePrice !== null ? formatCurrency(purchasePrice) : 'Not set'}
            hint="Contract value"
            muted={purchasePrice === null}
          />
          <MetricTile
            label="Weekly Rent"
            value={weeklyRent !== null ? formatCurrency(weeklyRent) : 'Not set'}
            hint={weeklyRent !== null ? 'Per week' : 'Awaiting review'}
            warning={weeklyRent === null}
          />
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
            <ReceiptText className="h-3.5 w-3.5 text-primary" />
            Analysis inputs
          </div>
          Uses configured manual overrides first, then report financial calculations where available.
        </div>
      </CardContent>

      <CardFooter className="flex flex-col-reverse gap-2 border-t border-border/60 bg-muted/20 p-4 sm:flex-row">
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:flex-1"
          onClick={() => onViewReport(report)}
        >
          <FileText className="h-4 w-4 mr-1" />
          View Report
        </Button>
        <Button
          size="sm"
          className="w-full sm:flex-1"
          onClick={() => onOpenCashFlow(report)}
          disabled={isOpening}
        >
          <Calculator className="h-4 w-4 mr-1" />
          {isOpening ? 'Loading...' : 'Open Cash Flow'}
          {!isOpening && <ArrowRight className="h-3 w-3 ml-1 transition-transform group-hover:translate-x-0.5" />}
        </Button>
      </CardFooter>
    </Card>
  );
}

const AUD_CURRENCY = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return AUD_CURRENCY.format(value);
}

function MetricTile({
  label,
  value,
  hint,
  warning = false,
  muted = false,
}: { label: string; value: string; hint?: string; warning?: boolean; muted?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        warning ? 'border-warning/30 bg-warning/10' : 'border-border/60 bg-muted/30'
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-semibold tabular-nums ${
          warning ? 'text-warning' : muted ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

