import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp,
  DollarSign,
  FileText,
  LayoutDashboard,
  Kanban,
  BarChart3,
  CalendarDays,
  ShieldAlert,
  Edit3,
} from "lucide-react";
import { useAllDeals } from "@/hooks/useAllDeals";
import { usePipelineMutations } from "@/hooks/usePipelineMutations";
import { usePipelineFilters } from "@/hooks/usePipelineFilters";
import {
  PipelineToolbar,
  DEFAULT_FILTERS,
} from "@/components/deals/PipelineToolbar";
import type { PipelineFilters } from "@/components/deals/PipelineToolbar";
import { DealExecutiveSummary } from "@/components/deals/DealExecutiveSummary";
import { CommissionDashboard } from "@/components/deals/CommissionDashboard";
import { BuilderInvoiceLog } from "@/components/deals/BuilderInvoiceLog";
import { PipelineKanbanBoard } from "@/components/deals/PipelineKanbanBoard";
import { PipelineAnalytics } from "@/components/deals/PipelineAnalytics";
import { PipelineTimeline } from "@/components/deals/PipelineTimeline";
import { ClawbackRiskMonitor } from "@/components/deals/ClawbackRiskMonitor";
import { DealManagement } from "@/components/deals/DealManagement";
import { PipelineValueSummaryBar } from "@/components/deals/PipelineValueSummaryBar";
import { SettlementCountdownCards } from "@/components/deals/SettlementCountdownCards";
import { CommissionForecastWidget } from "@/components/deals/CommissionForecastWidget";
import { AtRiskDealsPanel } from "@/components/deals/AtRiskDealsPanel";
import { LinkedFinanceFilesPanel } from "@/components/deals/LinkedFinanceFilesPanel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DealErrorState } from "@/components/deals/DealStatePresentation";
import { DashboardThemeFrame } from "@/components/layout/DashboardThemeFrame";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import type { DealWithClient } from "@/hooks/useAllDeals";

const pipelineTabTriggerClass = cn(
  "group relative flex h-11 min-w-11 flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[1rem] px-3.5 text-[13px] font-normal text-muted-foreground dark:text-foreground/82 transition-all duration-200",
  "border border-transparent hover:-translate-y-0.5 hover:border-brand-300/40 dark:hover:border-brand-200/20 hover:bg-brand-50/60 dark:hover:bg-white/[0.075] hover:text-brand-800 dark:hover:text-brand-100 hover:shadow-[0_14px_30px_rgba(0,0,0,0.22)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:focus-visible:ring-offset-background",
  "data-[state=active]:border-brand-100/60 data-[state=active]:bg-[linear-gradient(135deg,#fde68a,#f59e0b_58%,#b45309)] data-[state=active]:font-medium data-[state=active]:text-brand-950",
  "data-[state=active]:shadow-[0_16px_36px_rgba(245,158,11,0.32),inset_0_1px_0_rgba(255,255,255,0.55)] data-[state=active]:hover:text-brand-950 sm:h-12 sm:px-4 sm:text-sm",
);

const pipelineTabIconClass =
  "h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110 group-data-[state=active]:drop-shadow-[0_1px_8px_rgba(120,53,15,0.28)] sm:h-[18px] sm:w-[18px]";

const premiumScrollbarClass =
  "[scrollbar-color:rgba(245,158,11,0.46)_rgba(24,24,27,0.78)] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border [&::-webkit-scrollbar-thumb]:border-border/80 [&::-webkit-scrollbar-thumb]:bg-brand-300/45 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-background/75";

const dealPipelineTabs = [
  {
    id: "summary",
    label: "Summary",
    desktopPrefix: "Executive ",
    icon: LayoutDashboard,
  },
  { id: "kanban", label: "Board", desktopPrefix: "Pipeline ", icon: Kanban },
  { id: "commissions", label: "Commissions", desktopPrefix: undefined, icon: DollarSign },
  { id: "analytics", label: "Analytics", desktopPrefix: undefined, icon: BarChart3 },
  { id: "timeline", label: "Timeline", desktopPrefix: undefined, icon: CalendarDays },
  { id: "clawback", label: "Clawback", desktopPrefix: undefined, icon: ShieldAlert },
  { id: "manage", label: "Manage", desktopPrefix: undefined, icon: Edit3 },
  {
    id: "invoices",
    label: "Invoices",
    desktopPrefix: "Builder ",
    icon: FileText,
  },
] as const;

const pipelineTabContentClass = cn(
  "mt-4 rounded-[1.25rem] border border-border dark:border-white/10 bg-card dark:bg-background/35 p-2 shadow-inner sm:p-4",
  "data-[state=active]:flex data-[state=active]:flex-col",
  premiumScrollbarClass,
);

export default function DealPipeline() {
  const { data: deals = [], isLoading, error } = useAllDeals();
  const { updateBuildPayment, updateDeal, updateDealStage } =
    usePipelineMutations();
  const [activeTab, setActiveTab] = useState("summary");
  const [filters, setFilters] = useState<PipelineFilters>(DEFAULT_FILTERS);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const navigate = useNavigate();
  const { canEdit: canEditDeals } = useModulePermissions("deal_pipeline");

  // Apply global filters to deals
  const filteredDeals = usePipelineFilters(deals, filters);

  const handleDealClick = (deal: DealWithClient) => {
    navigate(`/clients?clientId=${deal.client_id}&tab=deals&dealId=${deal.id}`);
    toast.info(`Opening ${deal.client_name}'s deal`);
  };

  const handleUpdatePayment = (
    paymentId: string,
    clientId: string,
    data: any,
  ) => {
    if (!canEditDeals) {
      toast.error("You do not have edit permission for deals");
      return;
    }
    updateBuildPayment.mutate({ paymentId, clientId, data });
  };

  const handleUpdateDeal = (dealId: string, clientId: string, data: any) => {
    if (!canEditDeals) {
      toast.error("You do not have edit permission for deals");
      return;
    }
    updateDeal.mutate({ dealId, clientId, data });
  };

  const handleUpdateStage = (
    stageId: string,
    clientId: string,
    data: any,
    dealId?: string,
    allStages?: any[],
  ) => {
    if (!canEditDeals) {
      toast.error("You do not have edit permission for deals");
      return;
    }
    updateDealStage.mutate({ stageId, clientId, data, dealId, allStages });
  };

  if (error) {
    return (
      <DashboardThemeFrame variant="page" className="space-y-4 p-3 sm:p-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <TrendingUp className="h-5 w-5 shrink-0 text-brand-300 sm:h-6 sm:w-6" />
          <h1 className="text-lg sm:text-2xl font-bold tracking-tight">
            Deal Pipeline
          </h1>
        </div>
        <DealErrorState
          message={error instanceof Error
            ? error.message
            : "Please try refreshing the page or logging in again."}
          onRetry={() => window.location.reload()}
        />
      </DashboardThemeFrame>
    );
  }

  return (
    <DashboardThemeFrame variant="page" className={cn("deal-pipeline-polish relative flex flex-col space-y-5 rounded-[2rem] border-primary/15 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_32%),linear-gradient(180deg,hsl(var(--background)/0.96),hsl(var(--card)/0.92)_42%,hsl(var(--background)/0.98))] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.34)] sm:space-y-6 sm:p-6", premiumScrollbarClass)}>
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/70 to-transparent" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -left-24 top-40 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />

      <DashboardThemeFrame as="header" variant="hero" aria-labelledby="deal-pipeline-title" className="border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.92),hsl(var(--primary)/0.085)_34%,hsl(var(--background)/0.84))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_22px_60px_rgba(0,0,0,0.28)] sm:p-6">
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/75 to-transparent" />
        <div className="pointer-events-none absolute -right-14 -top-20 h-40 w-40 rounded-full bg-brand-300/10 blur-3xl" />
        <div className="absolute inset-y-5 left-0 w-1 rounded-r-full bg-gradient-to-b from-brand-100 via-brand-400 to-brand-700 shadow-[0_0_24px_rgba(245,158,11,0.35)]" />
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.25rem] border border-brand-100/40 bg-[radial-gradient(circle_at_30%_20%,rgba(254,243,199,0.24),rgba(245,158,11,0.12)_42%,rgba(0,0,0,0.32))] shadow-[0_16px_38px_rgba(245,158,11,0.18),inset_0_1px_0_rgba(255,255,255,0.14)] sm:h-16 sm:w-16">
            <div className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-brand-100/60 bg-brand-300 text-[11px] font-bold text-brand-950 shadow-[0_8px_18px_rgba(245,158,11,0.28)]">
              $
            </div>
            <TrendingUp className="h-6 w-6 text-brand-100 drop-shadow-[0_0_16px_rgba(251,191,36,0.45)] sm:h-7 sm:w-7" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-brand-200/80">
              Deal command centre
            </p>
            <h1 id="deal-pipeline-title" className="mt-1 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
              Deal Pipeline
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
              Cross-client deal tracking, commission monitoring, and builder
              invoice management.
            </p>
          </div>
        </div>
      </DashboardThemeFrame>

      {/* Pipeline Value Summary Bar */}
      <PipelineValueSummaryBar deals={deals} />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="deal-pipeline-module-board relative flex flex-col gap-4 rounded-[1.5rem] border border-border dark:border-white/10 bg-[linear-gradient(180deg,hsl(var(--card)/0.95),hsl(var(--muted)/0.55))] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(0,0,0,0.34))] p-2 shadow-[0_22px_70px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.45)] dark:shadow-[0_22px_70px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur sm:p-3"
      >
        <TabsList aria-label="Deal Pipeline sections" className={cn("relative inline-flex h-auto w-full shrink-0 justify-start gap-1.5 overflow-x-auto rounded-[1.35rem] border border-brand-300/30 dark:border-brand-100/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.95),hsl(var(--muted)/0.55)_40%,hsl(var(--background)/0.85))] dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.085),rgba(24,24,27,0.82)_40%,rgba(0,0,0,0.72))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_18px_46px_rgba(15,23,42,0.10)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-18px_34px_rgba(0,0,0,0.24),0_18px_46px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:gap-2 sm:p-2.5", premiumScrollbarClass)}>
          {dealPipelineTabs.map(({ id, label, desktopPrefix, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className={pipelineTabTriggerClass}>
              <Icon className={pipelineTabIconClass} />
              {desktopPrefix ? <span className="hidden sm:inline">{desktopPrefix}</span> : null}
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <section className="deal-pipeline-active-content mt-5 w-full overflow-visible">
          {/* Global Pipeline Toolbar */}
          <DashboardThemeFrame as="section" variant="toolbar" className="overflow-hidden rounded-[1.35rem] border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.75),hsl(var(--background)/0.82)_48%,hsl(var(--background)/0.68))] p-3 shadow-[0_18px_55px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.07)]">
            <PipelineToolbar
              deals={deals}
              filters={filters}
              onFiltersChange={setFilters}
              filteredCount={filteredDeals.length}
              isExpanded={filtersExpanded}
              onExpandedChange={setFiltersExpanded}
            />
          </DashboardThemeFrame>

        <TabsContent
          value="summary"
          className={pipelineTabContentClass}
        >
          <DealExecutiveSummary
            deals={filteredDeals}
            allDeals={deals}
            isLoading={isLoading}
            onDealClick={handleDealClick}
          />

          {/* Settlement Countdown */}
          <DashboardThemeFrame as="section" variant="section" className="p-3">
            <SettlementCountdownCards
              deals={filteredDeals}
              onDealClick={handleDealClick}
            />
          </DashboardThemeFrame>
          {/* Commission Forecast */}
          <DashboardThemeFrame as="section" variant="section" className="p-3">
            <CommissionForecastWidget deals={deals} />
          </DashboardThemeFrame>
          {/* Linked Finance Files */}
          <DashboardThemeFrame as="section" variant="section" className="p-3">
            <LinkedFinanceFilesPanel deals={filteredDeals} />
          </DashboardThemeFrame>
          {/* Risk Control */}
          <DashboardThemeFrame as="section" variant="section" className="p-3">
            <AtRiskDealsPanel deals={filteredDeals} onDealClick={handleDealClick} />
          </DashboardThemeFrame>
        </TabsContent>

        <TabsContent
          value="kanban"
          className={pipelineTabContentClass}
        >
          <PipelineKanbanBoard
            deals={filteredDeals}
            isLoading={isLoading}
            onDealClick={handleDealClick}
          />
        </TabsContent>

        <TabsContent
          value="commissions"
          className={pipelineTabContentClass}
        >
          <CommissionDashboard
            deals={filteredDeals}
            isLoading={isLoading}
            onUpdatePayment={handleUpdatePayment}
            onUpdateDeal={handleUpdateDeal}
          />
        </TabsContent>

        <TabsContent
          value="analytics"
          className={pipelineTabContentClass}
        >
          <PipelineAnalytics deals={filteredDeals} isLoading={isLoading} />
        </TabsContent>

        <TabsContent
          value="timeline"
          className={pipelineTabContentClass}
        >
          <PipelineTimeline
            deals={filteredDeals}
            isLoading={isLoading}
            onDealClick={handleDealClick}
          />
        </TabsContent>

        <TabsContent
          value="clawback"
          className={pipelineTabContentClass}
        >
          <ClawbackRiskMonitor
            deals={filteredDeals}
            isLoading={isLoading}
            onDealClick={handleDealClick}
          />
        </TabsContent>

        <TabsContent
          value="manage"
          className={pipelineTabContentClass}
        >
          <DealManagement
            deals={filteredDeals}
            isLoading={isLoading}
            onDealClick={handleDealClick}
            onUpdateDeal={handleUpdateDeal}
            onUpdateStage={handleUpdateStage}
          />
        </TabsContent>

        <TabsContent
          value="invoices"
          className={pipelineTabContentClass}
        >
          <BuilderInvoiceLog
            deals={filteredDeals}
            isLoading={isLoading}
            onUpdatePayment={handleUpdatePayment}
            onUpdateDeal={handleUpdateDeal}
          />
        </TabsContent>
        </section>
      </Tabs>
    </DashboardThemeFrame>
  );
}
