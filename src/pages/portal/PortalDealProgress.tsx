import { useMemo } from 'react';
import { usePortalDealProgressData } from '@/hooks/usePortalData';
import { deriveDealJourney } from '@/lib/deals/dealJourney.pure';
import { DealJourneyStrip } from '@/components/deals/journey/DealJourneyStrip';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PortalEmptyState } from '@/components/finance-portal/PortalEmptyState';
import {
  Loader2, Building2, CheckCircle2, Circle, Clock,
  TrendingUp, CalendarDays, DollarSign, Home, RefreshCw,
  HardHat, SkipForward
} from 'lucide-react';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortalDealStage {
  id: string;
  deal_id: string;
  stage_number: number;
  stage_name: string;
  stage_category: string | null;
  status: 'pending' | 'in_progress' | 'complete' | 'skipped';
  /** The one stage field written in the client's language ("Sign contract"). */
  client_action?: string | null;
  completed_at: string | null;
  display_order: number;
}

interface PortalBuildPayment {
  id: string;
  deal_id: string;
  stage_number: number;
  stage_name: string;
  percentage: number;
  amount: number | null;
  paid_to_builder: boolean;
  paid_to_builder_date: string | null;
  display_order: number;
}

interface PortalDeal {
  id: string;
  deal_type: 'existing_property' | 'house_and_land' | 'refinance';
  property_address: string | null;
  current_stage: string;
  current_stage_number: number;
  total_contract_price: number | null;
  land_price: number | null;
  build_price: number | null;
  loan_amount: number | null;
  existing_loan_amount: number | null;
  new_loan_amount: number | null;
  equity_released: number | null;
  finance_clause_expiry: string | null;
  settlement_date: string | null;
  land_settlement_date: string | null;
  expected_build_start: string | null;
  estimated_completion: string | null;
  created_at: string;
  stages?: PortalDealStage[];
  buildPayments?: PortalBuildPayment[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEAL_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; gradient: string }> = {
  existing_property: { label: 'Existing Property', icon: Building2, gradient: 'from-primary/8 to-transparent' },
  house_and_land: { label: 'House & Land', icon: Home, gradient: 'from-primary/10 via-primary/5 to-transparent' },
  refinance: { label: 'Refinance', icon: RefreshCw, gradient: 'from-primary/12 via-primary/5 to-transparent' },
};

function formatCurrency(val?: number | null): string {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0 }).format(val);
}

function formatDate(val?: string | null): string {
  if (!val) return '—';
  try { return format(new Date(val), 'dd MMM yyyy'); } catch { return '—'; }
}

// ─── Stage Timeline (Read-Only) ───────────────────────────────────────────────

function PortalStageTimeline({ stages }: { stages: PortalDealStage[] }) {
  const sorted = [...stages].sort((a, b) => a.display_order - b.display_order);

  return (
    <div className="space-y-0.5">
      {sorted.map((stage, idx) => {
        const isCompleted = stage.status === 'complete';
        const isCurrent = stage.status === 'in_progress';
        const isSkipped = stage.status === 'skipped';
        const isLast = idx === sorted.length - 1;

        return (
          <div key={stage.id} className="flex gap-3">
            {/* Timeline connector */}
            <div className="flex flex-col items-center">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
                isCompleted
                  ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                  : isCurrent
                    ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30 ring-4 ring-primary/10'
                    : isSkipped
                      ? 'bg-muted/50 text-muted-foreground/30'
                      : 'bg-muted text-muted-foreground/50'
              }`}>
                {isCompleted ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : isCurrent ? (
                  <Clock className="h-4 w-4 animate-pulse" />
                ) : isSkipped ? (
                  <SkipForward className="h-3.5 w-3.5" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
              </div>
              {!isLast && (
                <div className={`w-0.5 flex-1 min-h-[12px] ${isCompleted ? 'bg-primary/50' : 'bg-border'}`} />
              )}
            </div>

            {/* Stage info */}
            <div className={`flex-1 pb-3 pt-1 ${isSkipped ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-medium ${
                  isCurrent ? 'text-foreground' : isCompleted ? 'text-muted-foreground' : 'text-muted-foreground/60'
                }`}>
                  {stage.stage_name}
                </span>
                {stage.stage_category && (
                  <Badge variant="outline" className="text-[10px] h-5 font-normal">
                    {stage.stage_category}
                  </Badge>
                )}
              </div>
              {isCurrent && (
                <p className="text-xs text-primary mt-0.5 font-medium">
                  Current stage
                  {stage.client_action ? ` — we need you to: ${stage.client_action}` : ''}
                </p>
              )}
              {isCompleted && stage.completed_at && (
                  <p className="mt-0.5 text-xs text-primary">
                  Completed {formatDate(stage.completed_at)}
                </p>
              )}
              {isSkipped && (
                <p className="text-xs text-muted-foreground/50 mt-0.5">Skipped</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Build Progress (Simplified Read-Only) ────────────────────────────────────

function PortalBuildProgress({ payments }: { payments: PortalBuildPayment[] }) {
  const sorted = [...payments].sort((a, b) => a.display_order - b.display_order);
  const completedCount = sorted.filter(p => p.paid_to_builder).length;
  const progress = sorted.length > 0 ? Math.round((completedCount / sorted.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardHat className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Build Progress</span>
        </div>
        <span className="text-xs text-muted-foreground font-medium">{completedCount}/{sorted.length} stages</span>
      </div>

      <div className="flex items-center gap-3">
        <Progress value={progress} className="h-2 flex-1" />
        <span className="text-xs font-semibold text-foreground">{progress}%</span>
      </div>

      <div className="space-y-1.5">
        {sorted.map((payment) => {
          const isComplete = payment.paid_to_builder;

          return (
            <div
              key={payment.id}
              className={`flex items-center gap-3 rounded-lg border p-2.5 transition-colors ${
                isComplete
                  ? 'border-primary/20 bg-primary/5'
                  : 'border-border/50 bg-muted/30'
              }`}
            >
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                isComplete ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground/50'
              }`}>
                {isComplete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${isComplete ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {payment.stage_name}
                </p>
                {isComplete && payment.paid_to_builder_date && (
                  <p className="text-xs text-primary">Completed {formatDate(payment.paid_to_builder_date)}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <Badge variant={isComplete ? 'default' : 'secondary'} className="text-[10px]">
                  {payment.percentage}%
                </Badge>
                {payment.amount != null && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">{formatCurrency(payment.amount)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Key Dates ────────────────────────────────────────────────────────────────

function KeyDatesGrid({ deal }: { deal: PortalDeal }) {
  const dates: { label: string; value: string | null }[] = [];

  if (deal.deal_type === 'existing_property' || deal.deal_type === 'house_and_land') {
    if (deal.finance_clause_expiry) dates.push({ label: 'Finance Clause Expiry', value: deal.finance_clause_expiry });
    if (deal.settlement_date) dates.push({ label: 'Settlement Date', value: deal.settlement_date });
  }
  if (deal.deal_type === 'house_and_land') {
    if (deal.land_settlement_date) dates.push({ label: 'Land Settlement', value: deal.land_settlement_date });
    if (deal.expected_build_start) dates.push({ label: 'Expected Build Start', value: deal.expected_build_start });
    if (deal.estimated_completion) dates.push({ label: 'Estimated Completion', value: deal.estimated_completion });
  }
  if (deal.deal_type === 'refinance') {
    if (deal.settlement_date) dates.push({ label: 'Settlement Date', value: deal.settlement_date });
  }

  if (dates.length === 0) return null;

  return (
    <>
      <Separator />
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" /> Key Dates
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {dates.map((d) => (
            <div key={d.label} className="p-2.5 rounded-xl bg-muted/30 border border-border/50">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{d.label}</p>
              <p className="text-sm font-bold text-foreground mt-1">{formatDate(d.value)}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Financial Summary ────────────────────────────────────────────────────────

function FinancialSummary({ deal }: { deal: PortalDeal }) {
  const items: { label: string; value: string }[] = [];

  if (deal.deal_type === 'existing_property') {
    if (deal.total_contract_price) items.push({ label: 'Contract Price', value: formatCurrency(deal.total_contract_price) });
    if (deal.loan_amount) items.push({ label: 'Loan Amount', value: formatCurrency(deal.loan_amount) });
  } else if (deal.deal_type === 'house_and_land') {
    if (deal.total_contract_price) items.push({ label: 'Total Contract', value: formatCurrency(deal.total_contract_price) });
    if (deal.land_price) items.push({ label: 'Land', value: formatCurrency(deal.land_price) });
    if (deal.build_price) items.push({ label: 'Build', value: formatCurrency(deal.build_price) });
    if (deal.loan_amount) items.push({ label: 'Loan Amount', value: formatCurrency(deal.loan_amount) });
  } else if (deal.deal_type === 'refinance') {
    if (deal.existing_loan_amount) items.push({ label: 'Existing Loan', value: formatCurrency(deal.existing_loan_amount) });
    if (deal.new_loan_amount) items.push({ label: 'New Loan', value: formatCurrency(deal.new_loan_amount) });
    if (deal.equity_released) items.push({ label: 'Equity Released', value: formatCurrency(deal.equity_released) });
  }

  if (items.length === 0) return null;

  return (
    <>
      <Separator />
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5" /> Financial Summary
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {items.map((item) => (
            <div key={item.label} className="p-2.5 rounded-xl bg-muted/30 border border-border/50">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{item.label}</p>
              <p className="text-sm font-bold text-foreground mt-1">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Deal Card ────────────────────────────────────────────────────────────────

function DealProgressCard({ deal }: { deal: PortalDeal }) {
  const stages = (deal.stages || []).sort((a, b) => a.display_order - b.display_order);
  const buildPayments = (deal.buildPayments || []).sort((a, b) => a.display_order - b.display_order);
  const hasBuildProgress = deal.deal_type === 'house_and_land' && buildPayments.length > 0;

  // The same derivation the team's board and deal view read — the client
  // sees the deal in the same place staff do, in their own language.
  const journey = useMemo(() => deriveDealJourney(deal), [deal]);
  const completedStages = journey.completedStages;
  const totalStages = journey.totalStages;
  const stageProgress = journey.progressPct;

  const config = DEAL_TYPE_CONFIG[deal.deal_type] || DEAL_TYPE_CONFIG.existing_property;
  const DealIcon = config.icon;

  return (
    <Card className="client-portal-soft-panel overflow-hidden shadow-lg shadow-primary/5">
      <CardHeader className={`border-b border-border/50 bg-gradient-to-r ${config.gradient} pb-4`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 shadow-sm shadow-primary/10">
              <DealIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{deal.property_address || config.label}</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {config.label}
                {deal.loan_amount && ` • ${formatCurrency(deal.loan_amount)}`}
              </CardDescription>
            </div>
          </div>
          <Badge variant="secondary" className="border-primary/20 bg-primary/10 text-xs text-primary">
            {journey.stageLabel}
          </Badge>
        </div>

        {totalStages > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>{hasBuildProgress ? 'Acquisition Progress' : 'Progress'}</span>
              <span className="font-semibold text-foreground">{completedStages}/{totalStages} stages</span>
            </div>
            <Progress value={stageProgress} className="h-2" />
          </div>
        )}
      </CardHeader>

      <CardContent className="pt-6 space-y-5">
        {/* The journey, and what is happening right now */}
        <div className="space-y-3">
          <DealJourneyStrip phases={journey.phases} />
          {journey.isSettled ? (
            <div className="rounded-xl border border-success/25 bg-success/10 p-3.5">
              <p className="text-sm font-semibold text-success">This deal is complete — every stage has settled.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Right now</p>
              <p className="text-sm font-semibold text-foreground">{journey.stageLabel}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">What we need from you:</span>{' '}
                {journey.currentStage?.client_action
                  || (journey.phaseId === 'construction'
                    ? 'Nothing right now — the build team progresses this and we track each payment stage for you.'
                    : "Nothing right now — we'll let you know when something needs your attention.")}
              </p>
              {journey.nextStage && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Up next:</span> {journey.nextStage.stage_name}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Stages & Build in tabs for H&L, or just stages otherwise */}
        {hasBuildProgress ? (
          <Tabs defaultValue="stages" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2 bg-muted/50">
              <TabsTrigger value="stages" className="text-xs">
                Acquisition Stages
              </TabsTrigger>
              <TabsTrigger value="build" className="text-xs">
                Build Progress
              </TabsTrigger>
            </TabsList>
            <TabsContent value="stages">
              {stages.length > 0 ? (
                <PortalStageTimeline stages={stages} />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No stages configured yet.</p>
              )}
            </TabsContent>
            <TabsContent value="build">
              <PortalBuildProgress payments={buildPayments} />
            </TabsContent>
          </Tabs>
        ) : (
          stages.length > 0 ? (
            <PortalStageTimeline stages={stages} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No stages configured yet.</p>
          )
        )}

        <FinancialSummary deal={deal} />
        <KeyDatesGrid deal={deal} />
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PortalDealProgress() {
  const { data, isLoading, error } = usePortalDealProgressData();
  const deals: PortalDeal[] = data?.deals || [];

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading deal progress...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="client-portal-page-header">
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-primary" />
          Deal Progress
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Track the progress of your property deals in real-time
        </p>
      </div>

      {deals.length === 0 ? (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<Building2 className="h-8 w-8" />}
          title="No active deals"
          description="When you have active property deals, their progress will appear here."
        />
      ) : (
        <div className="space-y-4">
          {deals.map((deal) => (
            <DealProgressCard key={deal.id} deal={deal} />
          ))}
        </div>
      )}
    </div>
  );
}