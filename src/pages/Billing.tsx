import { useSearchParams } from "react-router-dom";
import { DashboardThemeFrame } from "@/components/layout/DashboardThemeFrame";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TokenUsagePanel } from "@/components/billing/TokenUsagePanel";
import { TransactionsPanel } from "@/components/billing/TransactionsPanel";
import { PaymentMethodsPanel } from "@/components/billing/PaymentMethodsPanel";
import { InvoicesPanel } from "@/components/billing/InvoicesPanel";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { usePermissions } from "@/hooks/usePermissions";
import {
  AURIXA_PRICING_URL,
  openMissionControlWithAttribution,
} from "@/lib/missionControl";
import { cn } from "@/lib/utils";
import {
  Activity, Coins, CreditCard, ExternalLink, ReceiptText, ShoppingCart, Wallet,
} from "lucide-react";

const TABS = [
  { value: "usage", label: "Usage", icon: Activity },
  { value: "transactions", label: "Transactions", icon: ShoppingCart },
  { value: "payment-methods", label: "Payment methods", icon: CreditCard },
  { value: "invoices", label: "Invoices", icon: ReceiptText },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function isTabValue(v: string | null): v is TabValue {
  return TABS.some((t) => t.value === v);
}

/**
 * Consolidated Billing & Usage page: token usage audit, attributed purchase
 * transactions, saved payment methods and Stripe invoices — one home for
 * everything money-related in this workspace.
 */
export default function Billing() {
  const { isAdmin, isSuperadmin } = usePermissions();
  const canViewBillingDetails = isAdmin || isSuperadmin;
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const requestedTab: TabValue = isTabValue(tabParam) ? tabParam : "usage";
  const tab: TabValue = canViewBillingDetails ? requestedTab : "usage";
  const visibleTabs = canViewBillingDetails ? TABS : TABS.slice(0, 1);
  const { balance, loading, lowBalance, criticalBalance } = useTokenBalance();

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const stats = [
    {
      label: "Available",
      value: balance ? balance.available.toLocaleString('en-AU') : "—",
      className: criticalBalance
        ? "text-destructive"
        : lowBalance
          ? "text-warning"
          : "text-primary",
    },
    {
      label: balance && balance.allowance > 0 ? "Allowance" : "Plan",
      value: balance
        ? balance.allowance > 0
          ? balance.allowance.toLocaleString('en-AU')
          : balance.exempt
            ? "Exempt"
            : (balance.planName ?? "Top-up credits")
        : "—",
      className: "text-foreground",
    },
    {
      label: "Reserved",
      value: balance ? balance.reserved.toLocaleString('en-AU') : "—",
      className: "text-brand-700 dark:text-brand-300",
    },
    {
      label: "Lifetime used",
      value: balance ? balance.used.toLocaleString('en-AU') : "—",
      className: "text-success dark:text-success",
    },
  ];

  return (
    <DashboardThemeFrame
      variant="page"
      className="min-h-[calc(100vh-5rem)] min-w-0 space-y-7 overflow-x-hidden p-3 sm:p-5 lg:p-6"
    >
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="flex min-w-0 flex-col gap-6 border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_34%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--background))_55%,hsl(var(--primary)/0.10))] p-5 sm:p-6 lg:p-7"
      >
        <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="relative shrink-0 rounded-2xl border border-primary/25 bg-primary/10 p-3 text-primary shadow-[0_14px_35px_hsl(var(--primary)/0.16)]">
              <Wallet className="h-7 w-7" />
              <span
                className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-card bg-success"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Coins className="h-3.5 w-3.5" />
                Workspace billing
              </div>
              <div className="min-w-0">
                <h1 className="min-w-0 truncate text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Billing &amp; Usage
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Token usage, transactions, saved payment methods and invoices — everything in
                  one place.
                </p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="min-h-10 rounded-xl border-primary/25 bg-background/85 px-4"
              onClick={() => void openMissionControlWithAttribution("topup", AURIXA_PRICING_URL)}
            >
              <Coins className="mr-2 h-4 w-4" />
              Top up credits
            </Button>
            <Button
              className="min-h-10 rounded-xl px-4"
              onClick={() => void openMissionControlWithAttribution("seat_plan", AURIXA_PRICING_URL)}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Manage plan
            </Button>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="min-w-0 rounded-2xl border border-border/60 bg-background/60 px-4 py-3 shadow-sm"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {s.label}
              </p>
              {loading && !balance ? (
                <Skeleton className="mt-1.5 h-7 w-20 rounded-lg" />
              ) : (
                <p
                  className={cn(
                    "mt-1 truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl",
                    s.className,
                  )}
                  title={s.value}
                >
                  {s.value}
                </p>
              )}
            </div>
          ))}
        </div>
      </DashboardThemeFrame>

      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <div className="min-w-0 overflow-x-auto pb-1">
          <TabsList className={cn(
            "grid h-auto w-full rounded-2xl border border-border/60 bg-background/70 p-1 shadow-inner sm:w-auto sm:min-w-0",
            canViewBillingDetails ? "min-w-[560px] grid-cols-4" : "grid-cols-1",
          )}>
            {visibleTabs.map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="min-w-0 gap-2 rounded-xl px-3 py-2.5 text-muted-foreground transition-all duration-200 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/35 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_10px_24px_hsl(var(--primary)/0.18)]"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="usage" className="mt-5 min-w-0">
          {tab === "usage" && <TokenUsagePanel />}
        </TabsContent>
        <TabsContent value="transactions" className="mt-5 min-w-0">
          {tab === "transactions" && <TransactionsPanel />}
        </TabsContent>
        <TabsContent value="payment-methods" className="mt-5 min-w-0">
          {tab === "payment-methods" && <PaymentMethodsPanel />}
        </TabsContent>
        <TabsContent value="invoices" className="mt-5 min-w-0">
          {tab === "invoices" && <InvoicesPanel />}
        </TabsContent>
      </Tabs>
    </DashboardThemeFrame>
  );
}
