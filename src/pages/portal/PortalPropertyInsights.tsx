import { usePortalPropertiesData } from '@/hooks/usePortalData';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { PortalEmptyState } from '@/components/finance-portal/PortalEmptyState';
import {
  Loader2, TrendingUp, TrendingDown, DollarSign,
  Home, PieChart, BarChart3, Percent, Building2
} from 'lucide-react';

function fmt(val?: number | null): string {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0 }).format(val);
}

function pct(val?: number | null): string {
  if (val == null) return '—';
  return `${val.toFixed(1)}%`;
}

export default function PortalPropertyInsights() {
  const { data, isLoading } = usePortalPropertiesData();
  const properties = data?.properties || [];

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading property insights...</p>
      </div>
    );
  }

  const totalValue = properties.reduce((s: number, p: any) => s + (p.value || 0), 0);
  const totalLoan = properties.reduce((s: number, p: any) => s + (p.loan_remaining || 0), 0);
  const totalEquity = totalValue - totalLoan;
  const avgLVR = totalValue > 0 ? (totalLoan / totalValue) * 100 : 0;
  const totalMonthlyRent = properties.reduce((s: number, p: any) => s + (p.monthly_rental_income || 0), 0);
  const totalMonthlyExpenses = properties.reduce((s: number, p: any) => {
    return s + (p.monthly_interest_repayment || 0)
      + (p.monthly_council_rates || 0)
      + (p.monthly_water_rates || 0)
      + (p.monthly_body_corporate || 0)
      + (p.monthly_building_insurance || 0)
      + (p.monthly_landlord_insurance || 0)
      + (p.monthly_property_management || 0)
      + (p.monthly_repairs_maintenance || 0);
  }, 0);
  const netCashflow = totalMonthlyRent - totalMonthlyExpenses;
  const grossYield = totalValue > 0 ? (totalMonthlyRent * 12 / totalValue) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="client-portal-page-header">
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          Property Insights
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Portfolio analytics, equity position, and performance metrics
        </p>
      </div>

      {properties.length === 0 ? (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<PieChart className="h-8 w-8" />}
          title="No property data available"
          description="Insights will appear once properties are added to your portfolio."
        />
      ) : (
        <>
          {/* Portfolio Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Value', value: fmt(totalValue), icon: DollarSign, color: 'text-foreground', gradient: 'from-primary/10 to-primary/5' },
              { label: 'Total Equity', value: fmt(totalEquity), icon: TrendingUp, color: 'text-primary', gradient: 'from-primary/12 to-primary/5' },
              { label: 'Average LVR', value: pct(avgLVR), icon: Percent, color: avgLVR > 80 ? 'text-destructive' : 'text-foreground', gradient: 'from-primary/10 to-primary/5' },
              { label: 'Gross Yield', value: pct(grossYield), icon: BarChart3, color: 'text-primary', gradient: 'from-primary/10 to-primary/5' },
            ].map((stat) => (
              <Card key={stat.label} className="client-portal-stat-card overflow-hidden border-0 shadow-sm">
                <CardContent className="pt-6 relative">
                  <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-50`} />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-1">
                      <stat.icon className="h-4 w-4 text-muted-foreground" />
                      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{stat.label}</p>
                    </div>
                    <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Cash Flow Analysis */}
            <Card className="client-portal-soft-panel shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-primary" />
                Monthly Cash Flow
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Income</p>
                  <p className="mt-1 text-lg font-bold text-primary">{fmt(totalMonthlyRent)}</p>
                </div>
                <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/10 text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Expenses</p>
                  <p className="text-lg font-bold text-destructive mt-1">{fmt(totalMonthlyExpenses)}</p>
                </div>
                <div className={`p-4 rounded-xl border text-center ${
                  netCashflow >= 0 
                    ? 'bg-primary/5 border-primary/20' 
                    : 'bg-destructive/5 border-destructive/10'
                }`}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Net</p>
                  <p className={`mt-1 text-lg font-bold ${netCashflow >= 0 ? 'text-primary' : 'text-destructive'}`}>
                    {fmt(netCashflow)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Per-Property Equity Breakdown */}
          <Card className="client-portal-soft-panel shadow-lg shadow-primary/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Equity Breakdown
              </CardTitle>
              <CardDescription>Loan-to-value ratio per property</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {properties.map((prop: any) => {
                const propValue = prop.value || 0;
                const propLoan = prop.loan_remaining || 0;
                const propEquity = propValue - propLoan;
                const propLVR = propValue > 0 ? (propLoan / propValue) * 100 : 0;

                return (
                  <div key={prop.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Home className="h-4 w-4 text-muted-foreground shrink-0" />
                        <p className="text-sm font-medium text-foreground truncate">{prop.address}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-sm">
                        <span className="font-semibold text-primary">{fmt(propEquity)}</span>
                        <Badge variant={propLVR > 80 ? 'destructive' : 'secondary'} className="text-xs">
                          {pct(propLVR)} LVR
                        </Badge>
                      </div>
                    </div>
                    <Progress value={100 - propLVR} className="h-2" />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>Loan: {fmt(propLoan)}</span>
                      <span>Value: {fmt(propValue)}</span>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
