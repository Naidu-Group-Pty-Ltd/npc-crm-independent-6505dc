import { usePortalFinancesData } from '@/hooks/usePortalData';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Briefcase, TrendingUp, CreditCard, Loader2, PiggyBank, Receipt, MapPin } from 'lucide-react';
import { PortalEmploymentForm } from '@/components/portal/PortalEmploymentForm';
import { PortalIncomeForm } from '@/components/portal/PortalIncomeForm';
import { PortalExpenseForm } from '@/components/portal/PortalExpenseForm';
import { PortalAssetForm } from '@/components/portal/PortalAssetForm';
import { PortalLiabilityForm } from '@/components/portal/PortalLiabilityForm';
import { PortalAddressHistoryForm } from '@/components/portal/PortalAddressHistoryForm';

function fmt(val?: number | null): string {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
}

export default function PortalEmployment() {
  const { data, isLoading, error, refetch } = usePortalFinancesData();

  const client = data?.client;
  const employment = data?.employment || [];
  const income = data?.income || [];
  const expenses = data?.expenses || [];
  const assets = data?.assets || [];
  const liabilities = data?.liabilities || [];
  const addressHistory = data?.addressHistory || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Card><CardContent className="py-8 text-center text-muted-foreground">Unable to load data.</CardContent></Card>
    );
  }

  const totalMonthlyIncome = income.reduce((sum: number, i: any) => sum + (i.gross_annual_amount || 0) / 12, 0);
  const totalMonthlyExpenses = expenses.reduce((sum: number, e: any) => sum + (e.monthly_amount || 0), 0);
  const totalAssets = assets.reduce((sum: number, a: any) => sum + (a.value || 0), 0);
  const totalLiabilities = liabilities.reduce((sum: number, l: any) => sum + (l.current_balance || 0), 0);

  return (
    <div className="space-y-6">
      <div className="client-portal-page-header">
        <h1 className="text-2xl font-bold text-foreground">Employment & Finances</h1>
        <p className="text-muted-foreground mt-1">Manage your employment, income, expenses, assets, and liabilities</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="client-portal-stat-card">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Monthly Income</p>
            <p className="text-xl font-bold text-primary">{fmt(client?.total_monthly_income || totalMonthlyIncome)}</p>
          </CardContent>
        </Card>
        <Card className="client-portal-stat-card">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Monthly Expenses</p>
            <p className="text-xl font-bold text-destructive">{fmt(client?.total_monthly_expenditure || totalMonthlyExpenses)}</p>
          </CardContent>
        </Card>
        <Card className="client-portal-stat-card">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Assets</p>
            <p className="text-xl font-bold text-primary">{fmt(totalAssets)}</p>
          </CardContent>
        </Card>
        <Card className="client-portal-stat-card">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Liabilities</p>
            <p className="text-xl font-bold text-destructive">{fmt(totalLiabilities)}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="employment" className="space-y-4">
        <TabsList className="flex w-full flex-wrap rounded-2xl border border-border/60 bg-card/70 p-1 shadow-lg shadow-primary/5">
          <TabsTrigger value="employment" className="flex-1 gap-1.5 text-xs sm:text-sm">
            <Briefcase className="h-4 w-4" />
            <span className="hidden sm:inline">Employment</span>
            <span className="sm:hidden">Jobs</span>
          </TabsTrigger>
          <TabsTrigger value="address_history" className="flex-1 gap-1.5 text-xs sm:text-sm">
            <MapPin className="h-4 w-4" />
            <span className="hidden sm:inline">Address</span>
            <span className="sm:hidden">Addr.</span>
          </TabsTrigger>
          <TabsTrigger value="income" className="flex-1 gap-1.5 text-xs sm:text-sm">
            <TrendingUp className="h-4 w-4" />
            Income
          </TabsTrigger>
          <TabsTrigger value="expenses" className="flex-1 gap-1.5 text-xs sm:text-sm">
            <Receipt className="h-4 w-4" />
            <span className="hidden sm:inline">Expenses</span>
            <span className="sm:hidden">Exp.</span>
          </TabsTrigger>
          <TabsTrigger value="assets" className="flex-1 gap-1.5 text-xs sm:text-sm">
            <PiggyBank className="h-4 w-4" />
            Assets
          </TabsTrigger>
          <TabsTrigger value="liabilities" className="flex-1 gap-1.5 text-xs sm:text-sm">
            <CreditCard className="h-4 w-4" />
            <span className="hidden sm:inline">Liabilities</span>
            <span className="sm:hidden">Debt</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employment" className="space-y-4">
          <PortalEmploymentForm existingEmployment={employment} onRefresh={refetch} />
        </TabsContent>

        <TabsContent value="address_history" className="space-y-4">
          <PortalAddressHistoryForm existingAddresses={addressHistory} onRefresh={refetch} />
        </TabsContent>

        <TabsContent value="income" className="space-y-4">
          <PortalIncomeForm existingIncome={income} onRefresh={refetch} />
        </TabsContent>

        <TabsContent value="expenses" className="space-y-4">
          <PortalExpenseForm existingExpenses={expenses} onRefresh={refetch} />
        </TabsContent>

        <TabsContent value="assets" className="space-y-4">
          <PortalAssetForm existingAssets={assets} onRefresh={refetch} />
        </TabsContent>

        <TabsContent value="liabilities" className="space-y-4">
          <PortalLiabilityForm existingLiabilities={liabilities} onRefresh={refetch} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
