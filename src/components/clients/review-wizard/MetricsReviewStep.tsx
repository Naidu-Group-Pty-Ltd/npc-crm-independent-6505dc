import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Percent,
  Building2,
  Wallet
} from 'lucide-react';
import type { PropertyMetrics } from './types';

interface MetricsReviewStepProps {
  properties: PropertyMetrics[];
  portfolioTotals: {
    totalValue: number;
    totalDebt: number;
    totalEquity: number;
    portfolioLvr: number;
    totalMonthlyCashflow: number;
    averageYield: number;
  };
}

export function MetricsReviewStep({ properties, portfolioTotals }: MetricsReviewStepProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    }
    return `$${value.toLocaleString('en-AU')}`;
  };

  return (
    <div className="space-y-6">
      {/* Portfolio Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Value</span>
            </div>
            <p className="text-2xl font-bold mt-1">{formatCurrency(portfolioTotals.totalValue)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Equity</span>
            </div>
            <p className="text-2xl font-bold mt-1">{formatCurrency(portfolioTotals.totalEquity)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Portfolio LVR</span>
            </div>
            <p className={`text-2xl font-bold mt-1 ${
              portfolioTotals.portfolioLvr > 80 ? 'text-destructive' :
              portfolioTotals.portfolioLvr > 60 ? 'text-warning' :
              'text-success'
            }`}>
              {portfolioTotals.portfolioLvr.toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Debt</span>
            </div>
            <p className="text-2xl font-bold mt-1 text-destructive">{formatCurrency(portfolioTotals.totalDebt)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              {portfolioTotals.totalMonthlyCashflow >= 0 ? (
                <TrendingUp className="h-4 w-4 text-success" />
              ) : (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
              <span className="text-xs text-muted-foreground">Monthly Cash Flow</span>
            </div>
            <p className={`text-2xl font-bold mt-1 ${
              portfolioTotals.totalMonthlyCashflow >= 0 ? 'text-success' : 'text-destructive'
            }`}>
              ${portfolioTotals.totalMonthlyCashflow.toLocaleString('en-AU')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Avg Gross Yield</span>
            </div>
            <p className="text-2xl font-bold mt-1">{portfolioTotals.averageYield.toFixed(2)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Property Details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Property Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-full overflow-x-auto rounded-md border" data-testid="property-metrics-table">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-medium">Property</th>
                  <th className="text-right py-2 font-medium">Value</th>
                  <th className="text-right py-2 font-medium">Loan</th>
                  <th className="text-right py-2 font-medium">LVR</th>
                  <th className="text-right py-2 font-medium">Rent/mth</th>
                  <th className="text-right py-2 font-medium">Net CF</th>
                  <th className="text-right py-2 font-medium">Yield</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((prop) => (
                  <tr key={prop.propertyId} className="border-b last:border-0">
                    <td className="max-w-[280px] py-3 pr-4 whitespace-normal break-words" title={prop.address}>{prop.address}</td>
                    <td className="py-3 text-right">{formatCurrency(prop.value)}</td>
                    <td className="py-3 text-right">{formatCurrency(prop.loanRemaining)}</td>
                    <td className="py-3 text-right">
                      <Badge 
                        variant="outline"
                        className={
                          prop.lvr > 80 ? 'text-destructive border-destructive/30' :
                          prop.lvr > 60 ? 'text-warning border-warning/30' :
                          'text-success border-success/30'
                        }
                      >
                        {prop.lvr.toFixed(1)}%
                      </Badge>
                    </td>
                    <td className="py-3 text-right">${prop.monthlyRentalIncome.toLocaleString('en-AU')}</td>
                    <td className={`py-3 text-right font-medium ${
                      prop.netMonthlyCashflow >= 0 ? 'text-success' : 'text-destructive'
                    }`}>
                      ${prop.netMonthlyCashflow.toLocaleString('en-AU')}
                    </td>
                    <td className="py-3 text-right">{prop.grossYield.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {properties.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p>No properties to display</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
