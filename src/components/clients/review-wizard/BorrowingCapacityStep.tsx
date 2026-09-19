import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Calculator, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Info,
  RefreshCw,
  DollarSign,
  PiggyBank,
  CreditCard,
  Target
} from 'lucide-react';
import { useBorrowingCapacity } from '@/hooks/useBorrowingCapacity';
import { getServiceabilityBandColor, formatCapacity } from '@/utils/borrowingCapacityCalculations';

interface BorrowingCapacityStepProps {
  clientId: string;
  clientName: string;
}

export function BorrowingCapacityStep({ clientId, clientName }: BorrowingCapacityStepProps) {
  const { 
    latestAssessment, 
    isLoading, 
    calculate, 
    isCalculating,
    getDisplayResult 
  } = useBorrowingCapacity({ clientId, autoFetch: true });

  const displayResult = getDisplayResult();
  const bandColor = displayResult?.band 
    ? getServiceabilityBandColor(displayResult.band)
    : null;

  const handleRecalculate = () => {
    calculate({});
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!latestAssessment) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Borrowing Capacity Assessment
          </CardTitle>
          <CardDescription>
            No borrowing capacity assessment found for {clientName}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Calculate the client's borrowing capacity to understand their serviceability 
            and ability to take on additional investment debt.
          </p>
          <Button onClick={handleRecalculate} disabled={isCalculating}>
            {isCalculating ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Calculating...
              </>
            ) : (
              <>
                <Calculator className="h-4 w-4 mr-2" />
                Calculate Now
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Recalculate */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Borrowing Capacity Assessment
          </h3>
          <p className="text-sm text-muted-foreground">
            Last calculated: {new Date(latestAssessment.created_at).toLocaleDateString('en-AU')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRecalculate} disabled={isCalculating} className="self-start sm:self-auto">
          {isCalculating ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Recalculate
            </>
          )}
        </Button>
      </div>

      {/* Main Results Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Borrowing Capacity Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4" />
              Maximum Borrowing Capacity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              {formatCapacity(displayResult?.capacity || 0)}
            </div>
            {displayResult?.stressTested && displayResult.stressTested > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Stress-tested: {formatCapacity(displayResult.stressTested)}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Serviceability Band */}
        <Card className={bandColor ? `border-2 ${bandColor.border}` : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Serviceability Band</CardTitle>
          </CardHeader>
          <CardContent>
            {bandColor && (
              <div className="space-y-2">
                <Badge className={`${bandColor.bg} ${bandColor.text} text-lg px-4 py-1`}>
                  {bandColor.label}
                </Badge>
                <p className="text-xs text-muted-foreground">{bandColor.description}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Financial Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Financial Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <DollarSign className="h-3 w-3" />
                Gross Income
              </div>
              <p className="font-semibold">
                ${(latestAssessment.gross_annual_income || 0).toLocaleString('en-AU')}/yr
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                Shaded Income
              </div>
              <p className="font-semibold">
                ${(latestAssessment.shaded_annual_income || 0).toLocaleString('en-AU')}/yr
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <PiggyBank className="h-3 w-3" />
                Living Expenses
              </div>
              <p className="font-semibold">
                ${(latestAssessment.living_expenses_monthly || 0).toLocaleString('en-AU')}/mo
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <CreditCard className="h-3 w-3" />
                Commitments
              </div>
              <p className="font-semibold">
                ${(latestAssessment.existing_commitments_monthly || 0).toLocaleString('en-AU')}/mo
              </p>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Monthly Surplus</p>
              <p className="text-xs text-muted-foreground">Available for loan servicing</p>
            </div>
            <p className={`text-xl font-bold ${(latestAssessment.monthly_surplus || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
              ${(latestAssessment.monthly_surplus || 0).toLocaleString('en-AU')}
            </p>
          </div>

          {latestAssessment.dti_ratio && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Debt-to-Income Ratio</span>
                  <span className="font-semibold">{latestAssessment.dti_ratio.toFixed(1)}x</span>
                </div>
                <Progress 
                  value={Math.min((latestAssessment.dti_ratio / 8) * 100, 100)} 
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {latestAssessment.dti_ratio <= 6 ? 'Healthy DTI ratio' : 
                   latestAssessment.dti_ratio <= 7 ? 'Moderate DTI - some lenders may have concerns' :
                   'High DTI - may limit lending options'}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Warnings */}
      {latestAssessment.warnings && (latestAssessment.warnings as string[]).length > 0 && (
        <Card className="border-brand-200 bg-brand-50/50 dark:bg-brand-950/20 dark:border-brand-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-brand-700 dark:text-brand-400">
              <AlertTriangle className="h-4 w-4" />
              Warnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {(latestAssessment.warnings as string[]).map((warning, idx) => (
                <li key={idx} className="text-sm text-brand-700 dark:text-brand-400 flex items-start gap-2">
                  <span>•</span>
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      {latestAssessment.recommendations && (latestAssessment.recommendations as any[]).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {(latestAssessment.recommendations as any[]).map((rec, idx) => (
                <li key={idx} className="text-sm flex items-start gap-2">
                  <Badge variant="outline" className="text-xs shrink-0">
                    {rec.priority || 'info'}
                  </Badge>
                  <span>{rec.text || rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Assumptions */}
      <Card className="bg-muted/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
            <Info className="h-4 w-4" />
            Calculation Assumptions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-muted-foreground">
            <div>
              <p className="font-medium">Interest Rate</p>
              <p>{latestAssessment.interest_rate_used || 6.5}%</p>
            </div>
            <div>
              <p className="font-medium">Buffer Rate</p>
              <p>{latestAssessment.buffer_rate || 3}%</p>
            </div>
            <div>
              <p className="font-medium">Loan Term</p>
              <p>{latestAssessment.loan_term_years || 30} years</p>
            </div>
            <div>
              <p className="font-medium">Expense Method</p>
              <p>{latestAssessment.expense_method || 'HEM'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
