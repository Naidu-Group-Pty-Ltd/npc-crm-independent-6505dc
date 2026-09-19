import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Building2,
  Home,
  RefreshCw,
  Trash2,
  ChevronDown,
  CalendarClock,
  DollarSign,
  FileText,
  ShieldAlert,
  UserRoundCheck,
  MessageSquareText,
  Sparkles,
  MapPin,
  Route,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Deal, RiskStatus, RISK_STATUS_CONFIG, DEAL_TYPE_LABELS } from './types';
import { deriveDealJourney } from '@/lib/deals/dealJourney.pure';
import { DealJourneyStrip } from '@/components/deals/journey/DealJourneyStrip';
import { DealStageTimeline } from './DealStageTimeline';
import { BuildPaymentTracker } from './BuildPaymentTracker';
import { DealFinancialControls } from './DealFinancialControls';
import { DealCriticalDates } from './DealCriticalDates';
import { useDealActions } from './useDealActions';
import { TeamUserSelect } from '@/components/ui/TeamUserSelect';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useAuth } from '@/hooks/useAuth';
import { LenderSubmissionsPanel } from '@/components/lenders/LenderSubmissionsPanel';
import { LenderComparisonSheets } from '@/components/lenders/LenderComparisonSheets';
import { ComplianceTab } from '@/components/compliance/ComplianceTab';
import { DocumentsTab } from '@/components/documents/DocumentsTab';
import {
  agentFeeEntry,
  agentFeeReceiptPatch,
  commissionModelFor,
  hasTrailAndClawback,
} from '@/lib/deals/commissionModel.pure';
import { formatCurrency } from '@/lib/legalMatters';


const detailShellClass = cn(
  'relative rounded-[1.75rem] border border-brand-200/20',
  'bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_34%),linear-gradient(180deg,rgba(24,24,27,0.96),rgba(9,9,11,0.94))]',
  'p-3 shadow-[0_24px_80px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-5'
);

const sectionCardClass =
  'overflow-hidden rounded-2xl border border-brand-200/15 bg-background/25 dark:bg-black/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]';

function DetailSection({
  title,
  description,
  icon,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(sectionCardClass, className)}>
      <div className="border-b border-brand-200/10 bg-white/[0.035] px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-200/20 bg-brand-400/10 text-brand-200">
            {icon}
          </div>
          <div className="min-w-0">
            <h4 className="break-words text-sm font-semibold tracking-[-0.01em] text-foreground">{title}</h4>
            {description && <p className="mt-0.5 break-words text-[11px] leading-4 text-muted-foreground">{description}</p>}
          </div>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function FieldTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border dark:border-white/10 bg-background/45 dark:bg-background/45 p-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <div className="min-w-0 break-words text-sm font-medium leading-5 text-foreground">{value || '—'}</div>
    </div>
  );
}

function ResponsiblePersonSelect({ deal, onUpdate }: { deal: Deal; onUpdate: (data: Partial<Deal>) => void }) {
  const { addNotification } = useNotifications();
  const { user } = useAuth();

  const handleChange = (value: string) => {
    const newUserId = value === 'unassigned' ? null : value;
    const oldUserId = deal.responsible_person;
    if (newUserId === oldUserId) return;
    onUpdate({ responsible_person: newUserId } as any);
    if (newUserId && newUserId !== user?.id) {
      addNotification({
        type: 'deal_assigned',
        title: 'Deal Reassigned to You',
        message: `You are now responsible for the ${deal.property_address || DEAL_TYPE_LABELS[deal.deal_type]} deal`,
        entityId: deal.id,
        targetUserId: newUserId,
      });
    }
  };

  return (
    <TeamUserSelect
      value={deal.responsible_person || 'unassigned'}
      onValueChange={handleChange}
      placeholder="Responsible"
      className="h-8 text-xs w-full sm:w-[160px]"
    />
  );
}
interface DealDetailViewProps {
  deal: Deal;
  clientId: string;
  onBack: () => void;
}

export function DealDetailView({ deal, clientId, onBack }: DealDetailViewProps) {
  const { updateDeal, updateStage, updateBuildPayment, deleteDeal } = useDealActions(clientId);
  const [openSections, setOpenSections] = useState({
    stages: true,
    financial: true,
    dates: true,
    build: true,
    lenders: false,
    compliance: false,
    documents: false,
    notes: false,
  });

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDealUpdate = (data: Partial<Deal>) => {
    updateDeal.mutate({ dealId: deal.id, data });
  };

  const isHnL = deal.deal_type === 'house_and_land';
  const isRefinance = deal.deal_type === 'refinance';
  // How this deal earns a commission at all — see `commissionModel.pure`.
  const commissionModel = commissionModelFor(deal.deal_type);
  // The single agent fee, where there is one. Null on a house-and-land deal,
  // whose commission is counted per build payment instead.
  const agentFee = agentFeeEntry(deal);
  const riskConfig = RISK_STATUS_CONFIG[deal.risk_status];

  // One derivation of "where is this deal" — the same rule the pipeline
  // board and the client portal read, so the three surfaces tell one story.
  const journey = useMemo(() => deriveDealJourney(deal), [deal]);
  const completedStages = journey.completedStages;
  const totalStages = journey.totalStages;

  const getDealIcon = () => {
    if (isRefinance) return <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />;
    if (isHnL) return <Home className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />;
    return <Building2 className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />;
  };

  const getStagesLabel = () => {
    if (isRefinance) return 'Refinance Lifecycle Stages';
    if (isHnL) return 'Land Acquisition Stages';
    return 'Property Acquisition Stages';
  };

  return (
    <div className={detailShellClass}>
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/70 to-transparent" />
      <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-brand-400/10 blur-3xl" />
      <div className="relative space-y-4">
        {/* Header */}
        <div className="overflow-hidden rounded-[1.5rem] border border-brand-200/20 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(245,158,11,0.08)_38%,rgba(0,0,0,0.28))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <Button variant="ghost" size="sm" onClick={onBack} className="h-8 rounded-full border border-brand-200/15 bg-background/20 dark:bg-black/20 px-3 text-xs hover:border-brand-200/35 hover:bg-brand-400/10">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to deals
              </Button>
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-brand-200/25 bg-brand-400/10 text-brand-200 shadow-[0_12px_30px_rgba(245,158,11,0.16)]">
                  {getDealIcon()}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.28em] text-brand-200/85">
                    <Sparkles className="h-3 w-3" /> Transaction case file
                  </p>
                  <h3 className="mt-1 break-words text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-3xl">
                    {DEAL_TYPE_LABELS[deal.deal_type]} Deal
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="max-w-full gap-1.5 break-words border-brand-200/25 bg-brand-400/10 text-[10px] text-brand-100 sm:text-xs">
                      {journey.stageNumber ? `S${journey.stageNumber}: ` : ''}{journey.stageLabel}
                    </Badge>
                    <Badge variant="outline" className="max-w-full gap-1.5 break-words text-[10px] sm:text-xs">
                      <MapPin className="h-3 w-3 shrink-0" /> {deal.property_address || 'Address not recorded'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row lg:justify-end">
              <Select
                value={deal.risk_status}
                onValueChange={(v) => handleDealUpdate({ risk_status: v as RiskStatus })}
              >
                <SelectTrigger className={cn('h-9 w-full rounded-full border bg-background/60 dark:bg-background/60 text-xs shadow-inner sm:w-[190px]', riskConfig.color)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RISK_STATUS_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {cfg.emoji} {cfg.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <ResponsiblePersonSelect deal={deal} onUpdate={handleDealUpdate} />

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 shrink-0 rounded-full border border-destructive/20 px-3 text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="w-[calc(100vw-24px)] rounded-2xl border-brand-200/15 sm:max-w-md">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the deal, all stages, build payments, and invoices. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => { deleteDeal.mutate(deal.id); onBack(); }}
                      className="rounded-full bg-destructive text-destructive-foreground"
                    >
                      Delete Deal
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>

        <DetailSection
          title="Where this deal is"
          description="The journey at a glance — the full stage controls stay below."
          icon={<Route className="h-4 w-4" />}
        >
          <div className="space-y-3">
            <DealJourneyStrip phases={journey.phases} />
            {journey.isSettled ? (
              <p className="rounded-xl border border-success/25 bg-success/10 p-3 text-sm text-success">
                Settled — every stage of this deal is complete.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <FieldTile
                  label="Now"
                  value={
                    <span>
                      {journey.stageLabel}
                      {journey.stageNumber != null && totalStages > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          S{journey.stageNumber} of {totalStages}
                        </span>
                      )}
                    </span>
                  }
                />
                {journey.currentStage ? (
                  <>
                    <FieldTile
                      label="Our next step"
                      value={
                        <span>
                          {journey.currentStage.internal_action || '—'}
                          {journey.currentStage.responsible && (
                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                              {journey.currentStage.responsible}
                            </span>
                          )}
                        </span>
                      }
                    />
                    <FieldTile label="What the client does" value={journey.currentStage.client_action || '—'} />
                    <FieldTile
                      label="Key date"
                      value={journey.currentStage.key_date ? format(new Date(journey.currentStage.key_date), 'dd MMM yyyy') : '—'}
                    />
                  </>
                ) : (
                  journey.build && (
                    <FieldTile label="Build progress" value={`${journey.build.paid}/${journey.build.total} payments made`} />
                  )
                )}
              </div>
            )}
            {journey.nextStage && (
              <p className="text-xs text-muted-foreground">
                Then: <span className="font-medium text-foreground">{journey.nextStage.stage_name}</span>
              </p>
            )}
          </div>
        </DetailSection>

        <DetailSection title="Deal overview" description="Client/deal identity, address and lifecycle progress." icon={<Building2 className="h-4 w-4" />}>
          <div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="space-y-2">
              <Label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Property Address</Label>
              <Input
                key={deal.id + '-property-address'}
                defaultValue={deal.property_address || ''}
                onBlur={(e) => {
                  if (e.target.value !== (deal.property_address || '')) {
                    handleDealUpdate({ property_address: e.target.value });
                  }
                }}
                placeholder="Enter property address..."
                className="h-10 rounded-xl border-brand-200/15 bg-background/55 dark:bg-background/55 text-sm shadow-inner"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{completedStages}/{totalStages} stages</span>
                <span>{totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0}% complete</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-300 to-primary transition-all"
                  style={{ width: totalStages > 0 ? `${(completedStages / totalStages) * 100}%` : '0%' }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <FieldTile label="Deal type" value={DEAL_TYPE_LABELS[deal.deal_type]} />
                <FieldTile label="Current stage" value={journey.stageNumber != null ? `S${journey.stageNumber}` : journey.phase.label} />
              </div>
            </div>
          </div>
        </DetailSection>

        <DetailSection title="Stage and next action" description="Milestones and action buttons preserve the existing stage update workflow." icon={<CalendarClock className="h-4 w-4" />}>
          <Collapsible open={openSections.stages} onOpenChange={() => toggleSection('stages')}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="mb-3 h-10 w-full justify-between rounded-xl border border-border dark:border-white/10 bg-background/35 dark:bg-background/35 text-sm font-medium hover:bg-brand-400/10">
                {getStagesLabel()}
                <ChevronDown className={cn('h-4 w-4 transition-transform', openSections.stages && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1">
              <DealStageTimeline
                stages={deal.stages || []}
                onUpdateStage={(stageId, data) => {
                  updateStage.mutate({ stageId, data });
                  // Heal the stored stage after EVERY status change — it used
                  // to move only when a stage was set in-progress, so a deal
                  // whose operator only ever ticked "Completed" wore a stale
                  // badge on every surface that read the stored copy.
                  if (data.status) {
                    const nextStages = (deal.stages || []).map(s => (s.id === stageId ? { ...s, ...data } : s));
                    const healed = deriveDealJourney({ ...deal, stages: nextStages });
                    const target = healed.currentStage
                      ?? (healed.stagesComplete ? nextStages.filter(s => s.status === 'complete').sort((a, b) => a.display_order - b.display_order).at(-1) : null);
                    if (target && (deal.current_stage !== target.stage_name || deal.current_stage_number !== target.stage_number)) {
                      handleDealUpdate({
                        current_stage: target.stage_name,
                        current_stage_number: target.stage_number,
                      });
                    }
                  }
                }}
              />
            </CollapsibleContent>
          </Collapsible>
        </DetailSection>

        <div className="grid gap-4 xl:grid-cols-2">
          <DetailSection title="Finance / settlement" description="Critical dates, financial controls and linked lender artefacts." icon={<DollarSign className="h-4 w-4" />}>
            <div className="space-y-3">
              <Collapsible open={openSections.dates} onOpenChange={() => toggleSection('dates')}>
                <CollapsibleTrigger asChild><Button variant="ghost" className="h-10 w-full justify-between rounded-xl border border-border dark:border-white/10 bg-background/35 dark:bg-background/35 text-sm font-medium">Critical Dates<ChevronDown className={cn('h-4 w-4 transition-transform', openSections.dates && 'rotate-180')} /></Button></CollapsibleTrigger>
                <CollapsibleContent className="pt-3"><DealCriticalDates deal={deal} onUpdate={handleDealUpdate} /></CollapsibleContent>
              </Collapsible>
              <Collapsible open={openSections.financial} onOpenChange={() => toggleSection('financial')}>
                <CollapsibleTrigger asChild><Button variant="ghost" className="h-10 w-full justify-between rounded-xl border border-border dark:border-white/10 bg-background/35 dark:bg-background/35 text-sm font-medium">Financial Controls<ChevronDown className={cn('h-4 w-4 transition-transform', openSections.financial && 'rotate-180')} /></Button></CollapsibleTrigger>
                <CollapsibleContent className="pt-3"><DealFinancialControls deal={deal} onUpdate={handleDealUpdate} /></CollapsibleContent>
              </Collapsible>
              <Collapsible open={openSections.lenders} onOpenChange={() => toggleSection('lenders')}>
                <CollapsibleTrigger asChild><Button variant="ghost" className="h-10 w-full justify-between rounded-xl border border-border dark:border-white/10 bg-background/35 dark:bg-background/35 text-sm font-medium">Lender Submissions & Comparison<ChevronDown className={cn('h-4 w-4 transition-transform', openSections.lenders && 'rotate-180')} /></Button></CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3"><LenderSubmissionsPanel clientId={clientId} dealId={deal.id} /><LenderComparisonSheets clientId={clientId} dealId={deal.id} /></CollapsibleContent>
              </Collapsible>
            </div>
          </DetailSection>

          <DetailSection title="Commission / invoice" description="Build progress payments, generated documents and invoice-adjacent files." icon={<FileText className="h-4 w-4" />}>
            <div className="space-y-3">
              {isHnL && (
                <Collapsible open={openSections.build} onOpenChange={() => toggleSection('build')}>
                  <CollapsibleTrigger asChild><Button variant="ghost" className="h-10 w-full justify-between rounded-xl border border-border dark:border-white/10 bg-background/35 dark:bg-background/35 text-sm font-medium">Build Progress Payments<ChevronDown className={cn('h-4 w-4 transition-transform', openSections.build && 'rotate-180')} /></Button></CollapsibleTrigger>
                  <CollapsibleContent className="pt-3"><BuildPaymentTracker payments={deal.buildPayments || []} buildPrice={deal.build_price} onUpdatePayment={(paymentId, data) => updateBuildPayment.mutate({ paymentId, data })} /></CollapsibleContent>
                </Collapsible>
              )}
              <Collapsible open={openSections.documents} onOpenChange={() => toggleSection('documents')}>
                <CollapsibleTrigger asChild><Button variant="ghost" className="h-10 w-full justify-between rounded-xl border border-border dark:border-white/10 bg-background/35 dark:bg-background/35 text-sm font-medium">Generated Documents<ChevronDown className={cn('h-4 w-4 transition-transform', openSections.documents && 'rotate-180')} /></Button></CollapsibleTrigger>
                <CollapsibleContent className="pt-3"><DocumentsTab clientId={clientId} dealId={deal.id} /></CollapsibleContent>
              </Collapsible>
              {/* A deal that earns an agent fee shows it HERE, in the section
                  named for commission. This used to be the sentence "No build
                  progress payment schedule applies to this deal type" — true,
                  and a dead end: an existing-property purchase does earn a
                  fee, and the figure was sitting in a different column under
                  Financial Controls, which is why the audit reported the
                  section as having no commission tracking at all. */}
              {agentFee && (
                <div className="space-y-2 rounded-xl border border-border bg-background/35 p-3 dark:border-white/10 dark:bg-background/35">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {agentFee.label}
                    </span>
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {agentFee.amount !== null
                        ? formatCurrency(agentFee.amount)
                        : <span className="font-sans text-xs font-normal text-muted-foreground">Not recorded</span>}
                    </span>
                  </div>
                  {hasTrailAndClawback(deal.deal_type) && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-5">
                      <dt className="text-muted-foreground">Trail (annual)</dt>
                      <dd className="text-right font-mono text-foreground">
                        {formatCurrency(deal.trail_commission)}
                      </dd>
                      <dt className="text-muted-foreground">Clawback window</dt>
                      <dd className="text-right font-mono text-foreground">
                        {typeof deal.clawback_period_months === 'number'
                          ? `${deal.clawback_period_months} months`
                          : '—'}
                      </dd>
                    </dl>
                  )}
                  {/* The receipt. A house-and-land deal marks this per build
                      payment; this deal type had no payment to hang it off and
                      so had no way to record the fee arriving at all — which
                      is the half of "no agent fee tracking" that a display
                      alone does not answer. */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 dark:border-white/10">
                    <Checkbox
                      id={`agent-fee-received-${deal.id}`}
                      checked={agentFee.received}
                      onCheckedChange={(checked) =>
                        handleDealUpdate(agentFeeReceiptPatch(!!checked, format(new Date(), 'yyyy-MM-dd')))
                      }
                    />
                    <Label
                      htmlFor={`agent-fee-received-${deal.id}`}
                      className="cursor-pointer text-[11px] font-medium text-foreground"
                    >
                      Commission received
                    </Label>
                    {agentFee.received ? (
                      <Badge variant="outline" className="border-success/30 text-[10px] text-success">
                        {agentFee.receivedDate
                          ? `Received ${format(new Date(agentFee.receivedDate), 'd MMM yyyy')}`
                          : 'Received'}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-brand-500/30 text-[10px] text-brand-600">Due</Badge>
                    )}
                  </div>
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    {/* Named rather than implied: a reader who wants to change
                        the figure should not have to hunt for where. */}
                    The amount is recorded under Financial Controls. This deal type is
                    paid once rather than stage by stage, so there is no build payment
                    schedule.
                  </p>
                </div>
              )}
              {commissionModel === 'none' && <p className="rounded-xl border border-border dark:border-white/10 bg-background/35 dark:bg-background/35 p-3 text-xs leading-5 text-muted-foreground">No build progress payment schedule applies to this deal type.</p>}
            </div>
          </DetailSection>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <DetailSection title="Risk / clawback" description="Risk posture and compliance controls remain editable through the same permissions." icon={<ShieldAlert className="h-4 w-4" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldTile label="Current risk" value={`${riskConfig.emoji} ${riskConfig.label}`} />
              <FieldTile label="Compliance" value="Records attached below" />
            </div>
            <Collapsible open={openSections.compliance} onOpenChange={() => toggleSection('compliance')}>
              <CollapsibleTrigger asChild><Button variant="ghost" className="mt-3 h-10 w-full justify-between rounded-xl border border-border dark:border-white/10 bg-background/35 dark:bg-background/35 text-sm font-medium">Compliance Records<ChevronDown className={cn('h-4 w-4 transition-transform', openSections.compliance && 'rotate-180')} /></Button></CollapsibleTrigger>
              <CollapsibleContent className="pt-3"><ComplianceTab clientId={clientId} dealId={deal.id} /></CollapsibleContent>
            </Collapsible>
          </DetailSection>

          <DetailSection title="Responsible person / team" description="Ownership changes still trigger the existing reassignment notification." icon={<UserRoundCheck className="h-4 w-4" />}>
            <div className="space-y-3">
              <ResponsiblePersonSelect deal={deal} onUpdate={handleDealUpdate} />
              <FieldTile label="Ownership" value={deal.responsible_person ? 'Assigned' : 'Unassigned'} />
            </div>
          </DetailSection>
        </div>

        <DetailSection title="Notes / actions" description="Internal notes keep the existing save-on-blur update behaviour." icon={<MessageSquareText className="h-4 w-4" />}>
          <Collapsible open={openSections.notes} onOpenChange={() => toggleSection('notes')}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="mb-3 h-10 w-full justify-between rounded-xl border border-border dark:border-white/10 bg-background/35 dark:bg-background/35 text-sm font-medium">
                Notes
                <ChevronDown className={cn('h-4 w-4 transition-transform', openSections.notes && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1">
              <Textarea
                key={deal.id + '-notes'}
                defaultValue={deal.notes || ''}
                onBlur={(e) => {
                  if (e.target.value !== (deal.notes || '')) {
                    handleDealUpdate({ notes: e.target.value });
                  }
                }}
                placeholder="Add deal notes..."
                rows={4}
                className="min-h-[112px] rounded-xl border-brand-200/15 bg-background/55 dark:bg-background/55 text-sm leading-6 shadow-inner"
              />
            </CollapsibleContent>
          </Collapsible>
        </DetailSection>
      </div>
    </div>
  );
}
