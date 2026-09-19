import { useMemo } from 'react';
import { differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Building2,
  Clock,
  DollarSign,
  Eye,
  Home,
  Megaphone,
  RefreshCw,
  User,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { RISK_STATUS_CONFIG } from '@/components/clients/deal-tracker/types';
import { pipelineBadgeClass } from '@/components/deals/pipelineBadgeStyles';
import { DealLoadingState } from '@/components/deals/DealStatePresentation';
import type { DealWithClient } from '@/hooks/useAllDeals';
import { useUserNames } from '@/hooks/useUserNames';
import {
  JOURNEY_PHASES,
  deriveDealJourney,
  type DealJourney,
  type JourneyPhase,
} from '@/lib/deals/dealJourney.pure';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  deals: DealWithClient[];
  isLoading: boolean;
  onDealClick?: (deal: DealWithClient) => void;
}

/**
 * The board's columns ARE the journey phases — the same `dealJourney.pure`
 * derivation that stamps the card's stage chip decides its column, so the
 * badge and the column can never disagree again (they used to: the chip
 * printed the stored `current_stage` while the column derived position from
 * the stages array). Phases with no deals collapse into slim rails, so the
 * whole journey stays readable left-to-right without a football field of
 * empty columns.
 */

function getDealTypeIcon(type: string) {
  switch (type) {
    case 'house_and_land': return <Home className="h-3 w-3" />;
    case 'refinance': return <RefreshCw className="h-3 w-3" />;
    default: return <Building2 className="h-3 w-3" />;
  }
}

function getDealTypeLabel(type: string) {
  switch (type) {
    case 'house_and_land': return 'H&L';
    case 'refinance': return 'Refi';
    default: return 'Existing';
  }
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);

interface BoardEntry {
  deal: DealWithClient;
  journey: DealJourney;
}

function DealCard({ deal, journey, onClick }: { deal: DealWithClient; journey: DealJourney; onClick?: () => void }) {
  const riskCfg = RISK_STATUS_CONFIG[deal.risk_status];

  // responsible_person stores a custom_users id — resolve it to a name the
  // same way the toolbar's filter chips do, instead of printing the UUID.
  const responsibleIsId = !!deal.responsible_person && UUID_RE.test(deal.responsible_person);
  const { labelFor } = useUserNames(responsibleIsId ? [deal.responsible_person] : []);
  const responsibleLabel = deal.responsible_person
    ? (responsibleIsId ? labelFor(deal.responsible_person) : deal.responsible_person)
    : null;

  const ageInDays = differenceInDays(new Date(), new Date(deal.created_at));

  const inConstruction = journey.phaseId === 'construction' && !!journey.build;
  const nextAction = inConstruction
    ? (journey.build?.currentName ? `Progress the ${journey.build.currentName} build payment` : null)
    : journey.currentStage
      ? journey.currentStage.internal_action || journey.currentStage.stage_name
      : null;

  const settlementDays = deal.settlement_date
    ? differenceInDays(new Date(deal.settlement_date), new Date())
    : null;

  return (
    <Card
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-[1.1rem] border border-border dark:border-white/10 border-l-[5px] bg-[radial-gradient(circle_at_12%_0%,rgba(251,191,36,0.16),transparent_30%),linear-gradient(145deg,rgba(255,255,255,0.09),rgba(24,24,27,0.94)_50%,rgba(0,0,0,0.76))] shadow-[0_14px_36px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.08)] outline-none transition-all duration-300 hover:-translate-y-1 hover:border-brand-200/55 hover:shadow-[0_24px_52px_rgba(0,0,0,0.38),0_0_0_1px_rgba(251,191,36,0.24),0_0_32px_rgba(245,158,11,0.18)] focus-visible:-translate-y-1 focus-visible:border-brand-200/70 focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        deal.risk_status === 'urgent' && 'border-l-destructive',
        deal.risk_status === 'needs_follow_up' && 'border-l-warning',
        deal.risk_status === 'on_track' && 'border-l-success',
      )}
      onClick={onClick}
      tabIndex={0}
      role="button"
      aria-label={`Open deal card for ${deal.client_name}, ${journey.stageLabel}, ${riskCfg.label}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/35 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <CardContent className="space-y-2.5 p-3.5">
        {/* Client name + risk */}
        <div className="flex items-start justify-between gap-2.5">
          <p className="min-w-0 flex-1 line-clamp-2 break-words text-[15px] font-bold leading-snug tracking-[-0.01em] text-foreground dark:text-foreground drop-shadow-sm">{deal.client_name}</p>
          <Badge className={cn(pipelineBadgeClass(deal.risk_status === 'on_track' ? 'success' : deal.risk_status === 'needs_follow_up' ? 'warning' : 'danger'), 'h-6 shrink-0 px-2', riskCfg.color)}>
            <span className="text-xs leading-none">{riskCfg.emoji}</span>
            <span className="sr-only">{riskCfg.label}</span>
          </Badge>
        </div>

        {/* Where the deal is — derived, so it always matches the column */}
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-brand-200/15 bg-brand-300/[0.055] px-2 py-1.5">
            {journey.stageNumber != null && (
              <Badge variant="outline" className={pipelineBadgeClass('gold', true, 'h-5 shrink-0 rounded-md px-1.5 text-[9px]')}>
                S{journey.stageNumber}
              </Badge>
            )}
            <span className="min-w-0 truncate text-[11px] font-semibold text-foreground dark:text-foreground" title={journey.stageLabel}>{journey.stageLabel}</span>
          </div>
          <Badge variant="outline" className={pipelineBadgeClass('neutral', true, 'h-5 shrink-0 text-foreground dark:text-foreground')}>
            <span className="shrink-0 text-brand-200">{getDealTypeIcon(deal.deal_type)}</span>
            <span className="truncate">{getDealTypeLabel(deal.deal_type)}</span>
          </Badge>
        </div>

        {/* Progress — one line; build progress once the land has settled */}
        <div className="flex items-center gap-2">
          <Progress
            value={inConstruction ? journey.build!.pct : journey.progressPct}
            className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-card dark:bg-background/95 shadow-[inset_0_1px_3px_rgba(0,0,0,0.55)] [&>div]:bg-gradient-to-r [&>div]:from-success [&>div]:via-success [&>div]:to-brand-300 [&>div]:shadow-[0_0_14px_rgba(52,211,153,0.45)]"
          />
          <span className="shrink-0 font-mono text-[11px] font-black text-success">
            {inConstruction ? journey.build!.pct : journey.progressPct}%
          </span>
          <span className="shrink-0 text-[9px] text-muted-foreground">
            {inConstruction
              ? `build ${journey.build!.paid}/${journey.build!.total}`
              : `${journey.completedStages}/${journey.totalStages} stages`}
          </span>
        </div>

        {/* Value · settlement · age — one metadata line */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
          {deal.total_contract_price && (
            <span className="flex min-w-0 items-center gap-1">
              <DollarSign className="h-3 w-3 shrink-0 text-brand-200" />
              <span className="truncate font-mono text-[11px] font-black text-foreground dark:text-foreground">{formatCurrency(deal.total_contract_price)}</span>
            </span>
          )}
          {settlementDays !== null && (
            <span className={cn(
              'flex items-center gap-0.5',
              settlementDays < 0 && 'font-semibold text-destructive',
              settlementDays >= 0 && settlementDays <= 7 && 'font-medium text-brand-300',
              settlementDays > 7 && settlementDays <= 14 && 'text-brand-200',
              settlementDays > 14 && 'text-success',
            )}>
              <Clock className="h-2.5 w-2.5" />
              {settlementDays < 0
                ? `${Math.abs(settlementDays)}d overdue`
                : `${settlementDays}d to settle`}
            </span>
          )}
          <span className="ml-auto shrink-0">{ageInDays}d old</span>
        </div>

        {/* Next action */}
        {nextAction && (
          <p className="line-clamp-2 break-words rounded-lg border border-border dark:border-white/10 bg-background dark:bg-black/15 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
            <span className="font-bold text-foreground dark:text-foreground">Next:</span> {nextAction}
          </p>
        )}

        {/* Footer: responsible + lead source */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border dark:border-white/10 pt-2 text-[9px] text-muted-foreground">
          <div className="flex min-w-0 items-center gap-1">
            {deal.responsible_person ? (
              <>
                <User className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate" title={responsibleLabel}>{responsibleLabel}</span>
              </>
            ) : (
              <span className="italic">Unassigned</span>
            )}
          </div>
          <div className="flex min-w-0 max-w-[45%] items-center gap-1 justify-self-end">
            <Megaphone className={cn('h-2.5 w-2.5 shrink-0', deal.leadSource ? 'text-brand-200' : 'text-muted-foreground dark:text-muted-foreground')} />
            <span className={cn('truncate', deal.leadSource ? 'text-brand-100' : 'text-muted-foreground dark:text-muted-foreground')} title={deal.leadSource || undefined}>
              {deal.leadSource || 'No source'}
            </span>
          </div>
        </div>

        {/* Hover reveal */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex justify-end -mt-1">
          <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1.5 gap-0.5 text-primary">
            <Eye className="h-2.5 w-2.5" />
            View
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * An empty phase collapses to a slim rail: the journey keeps its shape —
 * every phase stays visible in order — without empty 320px columns forcing
 * the occupied ones off-screen.
 */
function PhaseRail({ phase }: { phase: JourneyPhase }) {
  return (
    <div
      className={cn(
        'flex h-[340px] w-14 shrink-0 snap-start flex-col items-center rounded-[1.2rem] border border-t-4 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(0,0,0,0.28))] py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors duration-300 hover:border-brand-300/35',
        phase.accent,
      )}
      title={`${phase.label} — no deals in this phase right now. ${phase.blurb}`}
      aria-label={`${phase.label}: no deals in this phase right now`}
    >
      <span className="text-sm" aria-hidden>{phase.icon}</span>
      <span className="mt-2 min-h-0 flex-1 overflow-hidden rotate-180 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground [writing-mode:vertical-rl]">
        {phase.label}
      </span>
      <span className="mt-2 rounded-full border border-border dark:border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">0</span>
    </div>
  );
}

function KanbanColumn({
  phase,
  entries,
  totalValue,
  onDealClick,
}: {
  phase: JourneyPhase;
  entries: BoardEntry[];
  totalValue: number;
  onDealClick?: (deal: DealWithClient) => void;
}) {
  if (entries.length === 0) {
    return <PhaseRail phase={phase} />;
  }

  const urgentCount = entries.filter(e => e.deal.risk_status === 'urgent').length;

  return (
    <div className="group/column flex min-h-0 min-w-[280px] max-w-[280px] shrink-0 snap-start flex-col transition-all duration-300 hover:-translate-y-0.5 xl:min-w-[320px] xl:max-w-[320px]">
      {/* Column header */}
      <div className={cn('relative overflow-hidden rounded-t-[1.2rem] border border-b-0 transition-all duration-300 group-hover/column:border-brand-300/45 group-hover/column:shadow-[0_0_28px_rgba(245,158,11,0.13)] bg-[linear-gradient(145deg,rgba(255,255,255,0.095),rgba(39,39,42,0.88)_44%,rgba(0,0,0,0.72))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] border-t-4', phase.accent)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5" title={phase.blurb}>
            <span className="text-sm">{phase.icon}</span>
            <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-foreground dark:text-foreground">{phase.label}</h3>
          </div>
          <div className="flex items-center gap-1">
            {urgentCount > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Badge variant="outline" className={pipelineBadgeClass('danger', true, 'h-5 px-1.5 shadow-[0_0_18px_rgba(239,68,68,0.18)]')}>
                      <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                      {urgentCount}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {urgentCount} urgent deal{urgentCount !== 1 ? 's' : ''}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <Badge variant="outline" className={pipelineBadgeClass('gold', false, 'h-6 px-2 text-[10px]')}>
              {entries.length}
            </Badge>
          </div>
        </div>
        {totalValue > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1 font-mono">
            {formatCurrency(totalValue)}
          </p>
        )}
      </div>

      {/* Cards container */}
      <div className="min-h-0 flex-1 rounded-b-[1.2rem] border border-t-0 transition-all duration-300 group-hover/column:border-brand-300/30 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(0,0,0,0.22))] shadow-[inset_0_18px_34px_rgba(0,0,0,0.18)]">
        <div className="max-h-[min(58dvh,calc(100dvh-22rem))] min-h-[260px] overflow-y-auto overscroll-contain p-2.5 pr-2 [scrollbar-color:rgba(245,158,11,0.45)_rgba(24,24,27,0.75)] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-brand-300/35 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-background/70">
          <div className="space-y-2.5">
            {entries.map(({ deal, journey }) => (
              <DealCard
                key={deal.id}
                deal={deal}
                journey={journey}
                onClick={() => onDealClick?.(deal)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PipelineKanbanBoard({ deals, isLoading, onDealClick }: Props) {
  const columns = useMemo(() => {
    // Derive each deal's journey ONCE; the column, the stage chip and the
    // "Next:" line all read the same result.
    const grouped: Record<string, BoardEntry[]> = {};
    for (const phase of JOURNEY_PHASES) {
      grouped[phase.id] = [];
    }

    for (const deal of deals) {
      const journey = deriveDealJourney(deal);
      (grouped[journey.phaseId] ?? grouped[JOURNEY_PHASES[0].id]).push({ deal, journey });
    }

    // Sort within each column: urgent first, then by stage number
    for (const colId of Object.keys(grouped)) {
      grouped[colId].sort((a, b) => {
        const riskOrder: Record<string, number> = { urgent: 0, needs_follow_up: 1, on_track: 2 };
        const riskDiff = (riskOrder[a.deal.risk_status] ?? 2) - (riskOrder[b.deal.risk_status] ?? 2);
        if (riskDiff !== 0) return riskDiff;
        return (a.journey.stageNumber ?? a.deal.current_stage_number) - (b.journey.stageNumber ?? b.deal.current_stage_number);
      });
    }

    return grouped;
  }, [deals]);

  // Summary stats
  const stats = useMemo(() => {
    const urgent = deals.filter(d => d.risk_status === 'urgent').length;
    const totalValue = deals.reduce((s, d) => s + (d.total_contract_price || 0), 0);
    const occupied = JOURNEY_PHASES.filter(p => (columns[p.id] || []).length > 0).length;
    return { urgent, totalValue, occupied };
  }, [deals, columns]);

  if (isLoading) {
    return (
      <DealLoadingState title="Loading pipeline board" description="Preparing stage columns and placing each real deal in its current workflow position." />
    );
  }

  return (
    <div className="min-h-0 min-w-0 space-y-3 overflow-hidden">
      {/* Board summary bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-[1.1rem] border border-brand-200/15 bg-[linear-gradient(135deg,rgba(251,191,36,0.10),rgba(255,255,255,0.035)_42%,rgba(0,0,0,0.18))] px-4 py-3 text-xs text-muted-foreground dark:text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <span>{deals.length} deal{deals.length !== 1 ? 's' : ''} in {stats.occupied} of {JOURNEY_PHASES.length} journey phases</span>
        <span className="text-border">|</span>
        <span className="font-mono">{formatCurrency(stats.totalValue)} pipeline value</span>
        {stats.urgent > 0 && (
          <>
            <span className="text-border">|</span>
            <span className="text-destructive font-medium flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {stats.urgent} urgent
            </span>
          </>
        )}
      </div>

      {/* Kanban board - horizontal scroll */}
      <div role="region" aria-label="Pipeline board, horizontally scrollable" tabIndex={0} className="-mx-3 min-w-0 overflow-x-auto overscroll-x-contain px-3 pb-5 [scrollbar-color:rgba(245,158,11,0.50)_rgba(24,24,27,0.85)] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border [&::-webkit-scrollbar-thumb]:border-border [&::-webkit-scrollbar-thumb]:bg-gradient-to-r [&::-webkit-scrollbar-thumb]:from-brand-500/70 [&::-webkit-scrollbar-thumb]:to-brand-200/55 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-background/90 sm:-mx-6 sm:px-6">
        <div className="flex min-w-max snap-x snap-mandatory items-start gap-4">
          {JOURNEY_PHASES.map(phase => (
            <KanbanColumn
              key={phase.id}
              phase={phase}
              entries={columns[phase.id] || []}
              totalValue={(columns[phase.id] || []).reduce((s, e) => s + (e.deal.total_contract_price || 0), 0)}
              onDealClick={onDealClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
