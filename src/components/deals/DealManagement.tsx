import { useMemo, useState, useCallback } from 'react';
import { format, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Building2,
  Home,
  RefreshCw,
  User,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  SkipForward,
  Play,
  Eye,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
  Edit3,
  ArrowRight,
  Settings2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RISK_STATUS_CONFIG } from '@/components/clients/deal-tracker/types';
import { smartCapitalize } from '@/utils/nameFormatting';
import { useTeamUsers, type TeamUser } from '@/hooks/useTeamUsers';
import type { DealWithClient } from '@/hooks/useAllDeals';
import { deriveDealJourney } from '@/lib/deals/dealJourney.pure';

const UNASSIGNED_SENTINEL = '__unassigned__';

interface Props {
  deals: DealWithClient[];
  isLoading: boolean;
  onDealClick?: (deal: DealWithClient) => void;
  onUpdateDeal?: (dealId: string, clientId: string, data: any) => void;
  onUpdateStage?: (stageId: string, clientId: string, data: any, dealId?: string, allStages?: any[]) => void;
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);

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

const STAGE_STATUS_ICONS: Record<string, React.ReactNode> = {
  complete: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
  in_progress: <Play className="h-3.5 w-3.5 text-primary" />,
  pending: <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />,
  skipped: <SkipForward className="h-3.5 w-3.5 text-muted-foreground/30" />,
};

// ─── Inline Editable Field (defaultValue + onBlur pattern) ───
/**
 * How a deal's `responsible_person` reads.
 *
 * The column holds a `custom_users.id` — that is what the table's picker
 * writes — but the expanded row rendered the raw value in a free-text box, so
 * an assigned deal showed `2d7ea1e8-f3e2-4e38-a7f3-7d1146ced85b` where it
 * should show a name. Two controls for one field, disagreeing about what the
 * field contains; the 19 Sep 2026 clone audit saw the one that was wrong.
 *
 * Legacy rows hold a typed name rather than an id, so an unmatched value is
 * shown as itself — it is still the answer somebody recorded, just not a
 * reference. A raw UUID is never shown: it means nothing to a reader, and
 * database vocabulary does not reach the operator.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function responsiblePersonLabel(
  value: string | null | undefined,
  teamUsers: readonly { id: string; username?: string | null; email?: string | null }[],
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const match = teamUsers.find((u) => u.id === trimmed);
  if (match) return smartCapitalize(match.username || match.email || 'Unknown');
  // An id we cannot resolve names a user this list does not carry. Printing it
  // tells the reader nothing; saying so tells them what they are looking at.
  if (UUID_SHAPE.test(trimmed)) return 'Unknown user';
  return smartCapitalize(trimmed);
}

function InlineEditField({
  defaultValue,
  onSave,
  placeholder,
  type = 'text',
}: {
  defaultValue: string;
  onSave: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'textarea';
}) {
  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newVal = e.target.value.trim();
    if (newVal !== defaultValue) {
      onSave(newVal);
    }
  }, [defaultValue, onSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && type === 'text') {
      e.currentTarget.blur();
    }
  }, [type]);

  if (type === 'textarea') {
    return (
      <Textarea
        key={defaultValue}
        defaultValue={defaultValue}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="min-h-[84px] resize-none rounded-xl border-brand-200/15 bg-background/55 dark:bg-background/55 text-xs leading-5 text-foreground shadow-inner transition-all placeholder:text-muted-foreground/55 focus-visible:border-brand-300/70 focus-visible:ring-2 focus-visible:ring-brand-300/35 focus-visible:ring-offset-0"
      />
    );
  }

  return (
    <Input
      key={defaultValue}
      defaultValue={defaultValue}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className="h-9 rounded-xl border-brand-200/15 bg-background/55 dark:bg-background/55 text-xs text-foreground shadow-inner transition-all placeholder:text-muted-foreground/55 focus-visible:border-brand-300/70 focus-visible:ring-2 focus-visible:ring-brand-300/35 focus-visible:ring-offset-0"
    />
  );
}

// ─── Stage Quick Actions ───
function StageActions({
  stage,
  clientId,
  dealId,
  allStages,
  onUpdateStage,
}: {
  stage: any;
  clientId: string;
  dealId: string;
  allStages: any[];
  onUpdateStage?: (stageId: string, clientId: string, data: any, dealId?: string, allStages?: any[]) => void;
}) {
  if (!onUpdateStage) return null;

  const actions: { label: string; status: string; icon: React.ReactNode; variant: any }[] = [];

  if (stage.status === 'pending') {
    actions.push({ label: 'Start', status: 'in_progress', icon: <Play className="h-2.5 w-2.5" />, variant: 'default' });
    actions.push({ label: 'Skip', status: 'skipped', icon: <SkipForward className="h-2.5 w-2.5" />, variant: 'ghost' });
  } else if (stage.status === 'in_progress') {
    actions.push({ label: 'Complete', status: 'complete', icon: <CheckCircle2 className="h-2.5 w-2.5" />, variant: 'default' });
    actions.push({ label: 'Skip', status: 'skipped', icon: <SkipForward className="h-2.5 w-2.5" />, variant: 'ghost' });
  } else if (stage.status === 'skipped') {
    actions.push({ label: 'Reopen', status: 'pending', icon: <Circle className="h-2.5 w-2.5" />, variant: 'outline' });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {actions.map(a => (
        <TooltipProvider key={a.status}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={a.variant}
                size="sm"
                className="h-7 rounded-full px-2 text-[10px] gap-1 border-brand-200/20 bg-background/30 dark:bg-black/30 hover:border-brand-300/45 hover:bg-brand-400/10 focus-visible:ring-brand-300/50"
                onClick={() => {
                  const data: any = { status: a.status };
                  if (a.status === 'complete') data.completed_at = new Date().toISOString();
                  if (a.status === 'pending' || a.status === 'skipped') data.completed_at = null;
                  onUpdateStage(stage.id, clientId, data, dealId, allStages);
                }}
              >
                {a.icon}
                {a.label}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px]">
              Mark as {a.status.replace('_', ' ')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}

// ─── Expanded Stage Detail (rendered as a separate <tr>) ───
function DealExpandedRow({
  deal,
  teamUsers,
  onUpdateDeal,
  onUpdateStage,
}: {
  deal: DealWithClient;
  teamUsers: TeamUser[];
  onUpdateDeal?: (dealId: string, clientId: string, data: any) => void;
  onUpdateStage?: (stageId: string, clientId: string, data: any, dealId?: string, allStages?: any[]) => void;
}) {
  const stages = deal.stages || [];

  const handleUpdateField = useCallback((field: string, value: any) => {
    onUpdateDeal?.(deal.id, deal.client_id, { [field]: value });
  }, [deal.id, deal.client_id, onUpdateDeal]);

  return (
    <TableRow className="border-brand-200/10">
      <TableCell colSpan={8} className="bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.10),transparent_34%),linear-gradient(180deg,rgba(24,24,27,0.92),rgba(9,9,11,0.82))] p-0">
        <div className="space-y-5 p-4 sm:p-5">
          {/* Stage timeline */}
          <section className="rounded-2xl border border-brand-200/15 bg-background/25 dark:bg-black/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-brand-200/85">
                  <Settings2 className="h-3 w-3" /> Stage Management
                </p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Advance, skip or reopen milestones without leaving the management console.</p>
              </div>
            </div>
            <div className="grid gap-2">
              {stages.map((stage, i) => (
                <div
                  key={stage.id || i}
                  className={cn(
                    'flex flex-col gap-2 rounded-xl border px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:gap-3',
                    stage.status === 'complete' && 'bg-success/5 border-success/20',
                    stage.status === 'in_progress' && 'bg-primary/5 border-primary/20',
                    stage.status === 'skipped' && 'bg-muted/50 border-border/30 opacity-60',
                    stage.status === 'pending' && 'border-border/50',
                  )}
                >
                  <span className="shrink-0">{STAGE_STATUS_ICONS[stage.status] || <Circle className="h-3.5 w-3.5" />}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[8px] px-1 h-3.5 shrink-0">S{stage.stage_number}</Badge>
                      <span className={cn('break-words text-xs font-semibold leading-5', stage.status === 'skipped' && 'line-through')}>{stage.stage_name}</span>
                    </div>
                    {stage.internal_action && (
                      <p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">{stage.internal_action}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {stage.completed_at && (
                      <span className="text-[10px] text-muted-foreground">{format(new Date(stage.completed_at), 'dd MMM')}</span>
                    )}
                    <StageActions stage={stage} clientId={deal.client_id} dealId={deal.id} allStages={stages} onUpdateStage={onUpdateStage} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Inline notes editor */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-brand-200/15 bg-background/25 dark:bg-black/25 p-4">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-brand-200/85">
                <MessageSquare className="h-3 w-3" /> Deal Notes
              </p>
              <p className="mb-3 text-[11px] leading-4 text-muted-foreground">Internal comments save on blur and wrap for long handover notes.</p>
              <InlineEditField
                key={`${deal.id}-notes`}
                defaultValue={deal.notes || ''}
                onSave={(val) => handleUpdateField('notes', val || null)}
                placeholder="Add notes about this deal..."
                type="textarea"
              />
            </div>
            <div className="space-y-4 rounded-2xl border border-brand-200/15 bg-background/25 dark:bg-black/25 p-4">
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-brand-200/85">
                  <User className="h-3 w-3" /> Responsible Person
                </p>
                <p className="mb-3 text-[11px] leading-4 text-muted-foreground">Assign ownership for follow-up and operational accountability.</p>
                {/*
                  The same picker the table row uses, over the same list. This
                  was a free-text box showing `deal.responsible_person` raw —
                  and that column holds a user id, so an assigned deal printed
                  a UUID. Two controls for one field is how they disagreed.
                */}
                <Select
                  key={`${deal.id}-responsible-input`}
                  value={deal.responsible_person || UNASSIGNED_SENTINEL}
                  onValueChange={(v) => handleUpdateField('responsible_person', v === UNASSIGNED_SENTINEL ? null : v)}
                >
                  <SelectTrigger className="h-8 w-full rounded-xl border-brand-200/15 bg-background/60 text-xs shadow-inner focus:ring-brand-300/40">
                    <SelectValue placeholder="Assign..." />
                  </SelectTrigger>
                  <SelectContent className="border-brand-200/15 bg-background dark:bg-background">
                    <SelectItem value={UNASSIGNED_SENTINEL} className="text-xs italic">Unassigned</SelectItem>
                    {teamUsers.map(u => (
                      <SelectItem key={u.id} value={u.id} className="text-xs">
                        {smartCapitalize(u.username || u.email || 'Unknown')}
                      </SelectItem>
                    ))}
                    {deal.responsible_person && !teamUsers.some(u => u.id === deal.responsible_person) && (
                      <SelectItem value={deal.responsible_person} className="text-xs text-muted-foreground">
                        {responsiblePersonLabel(deal.responsible_person, teamUsers)}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Deal Value</p>
                  <p className="break-words text-sm font-semibold text-foreground">{deal.total_contract_price ? formatCurrency(deal.total_contract_price) : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Settlement</p>
                  <p className="break-words text-sm font-semibold text-foreground">{deal.settlement_date ? format(new Date(deal.settlement_date), 'dd MMM yyyy') : '—'}</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Deal Management Row ───
function DealManageRow({
  deal,
  teamUsers,
  onDealClick,
  onUpdateDeal,
  onUpdateStage,
}: {
  deal: DealWithClient;
  teamUsers: TeamUser[];
  onDealClick?: () => void;
  onUpdateDeal?: (dealId: string, clientId: string, data: any) => void;
  onUpdateStage?: (stageId: string, clientId: string, data: any, dealId?: string, allStages?: any[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const riskCfg = RISK_STATUS_CONFIG[deal.risk_status];
  const stages = deal.stages || [];
  const completedStages = stages.filter(s => s.status === 'complete').length;
  const totalStages = stages.length;
  const progressPct = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0;

  const nextStage = stages.find(s => s.status === 'in_progress') || stages.find(s => s.status === 'pending');
  const ageInDays = differenceInDays(new Date(), new Date(deal.created_at));

  const handleUpdateField = useCallback((field: string, value: any) => {
    onUpdateDeal?.(deal.id, deal.client_id, { [field]: value });
  }, [deal.id, deal.client_id, onUpdateDeal]);

  const displayName = smartCapitalize(deal.client_name || 'Unknown');

  return (
    <>
      <TableRow className="group border-brand-100/10 transition-colors hover:bg-brand-400/[0.045]">
        {/* Expand */}
        <TableCell className="w-8 px-2">
          <Button variant="ghost" size="sm" className="h-7 w-7 rounded-full border border-transparent p-0 text-muted-foreground hover:border-brand-200/30 hover:bg-brand-400/10 hover:text-brand-100 focus-visible:ring-brand-300/50" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </TableCell>

        {/* Client */}
        <TableCell className="min-w-[180px] cursor-pointer align-middle" onClick={onDealClick}>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-muted-foreground">{getDealTypeIcon(deal.deal_type)}</span>
            <span className="break-words text-xs font-semibold leading-5 text-foreground">{displayName}</span>
          </div>
          <span className="mt-0.5 block break-all text-[11px] text-muted-foreground">{getDealTypeLabel(deal.deal_type)} · {ageInDays}d old</span>
        </TableCell>

        {/* Current Stage */}
        <TableCell>
          <div className="flex max-w-[190px] items-start gap-1.5">
            {(() => {
              const journey = deriveDealJourney(deal);
              return (
                <>
                  {journey.stageNumber != null && (
                    <Badge variant="outline" className="h-5 shrink-0 border-brand-200/25 bg-brand-400/10 px-1.5 text-[10px] text-brand-100">S{journey.stageNumber}</Badge>
                  )}
                  <span className="break-words text-xs leading-4 text-muted-foreground">{journey.stageLabel}</span>
                </>
              );
            })()}
          </div>
        </TableCell>

        {/* Progress */}
        <TableCell className="hidden sm:table-cell w-[100px]">
          <div className="space-y-0.5">
            <Progress value={progressPct} className="h-1.5" />
            <span className="text-[11px] text-muted-foreground">{completedStages}/{totalStages} · {progressPct}%</span>
          </div>
        </TableCell>

        {/* Responsible (inline edit) */}
        <TableCell className="hidden md:table-cell w-[160px]">
          <Select
            key={`${deal.id}-responsible`}
            defaultValue={deal.responsible_person || UNASSIGNED_SENTINEL}
            onValueChange={(v) => handleUpdateField('responsible_person', v === UNASSIGNED_SENTINEL ? null : v)}
          >
            <SelectTrigger className="h-8 w-full rounded-xl border-brand-200/15 bg-background/60 dark:bg-background/60 text-xs shadow-inner focus:ring-brand-300/40">
              <SelectValue placeholder="Assign..." />
            </SelectTrigger>
            <SelectContent className="border-brand-200/15 bg-background dark:bg-background">
              <SelectItem value={UNASSIGNED_SENTINEL} className="text-xs italic">Unassigned</SelectItem>
              {teamUsers.map(u => (
                <SelectItem key={u.id} value={u.id} className="text-xs">
                  {smartCapitalize(u.username || u.email || 'Unknown')}
                </SelectItem>
              ))}
              {deal.responsible_person && !teamUsers.some(u => u.id === deal.responsible_person) && (
                <SelectItem value={deal.responsible_person} className="text-xs text-muted-foreground">
                  {responsiblePersonLabel(deal.responsible_person, teamUsers)}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </TableCell>

        {/* Risk (inline edit) */}
        <TableCell className="hidden lg:table-cell min-w-[160px]">
          <Select
            key={`${deal.id}-risk`}
            defaultValue={deal.risk_status}
            onValueChange={(v) => handleUpdateField('risk_status', v)}
          >
            <SelectTrigger className={cn('h-8 w-full min-w-[140px] rounded-xl border bg-background/60 dark:bg-background/60 text-xs shadow-inner focus:ring-brand-300/40', riskCfg?.color)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-brand-200/15 bg-background dark:bg-background">
              {Object.entries(RISK_STATUS_CONFIG).map(([key, cfg]) => (
                <SelectItem key={key} value={key} className="text-xs">
                  {cfg.emoji} {cfg.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>

        {/* Next Action */}
        <TableCell className="hidden xl:table-cell">
          {nextStage ? (
            <div className="flex max-w-[220px] items-start gap-1.5">
              <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-brand-300" />
              <span className="break-words text-xs leading-4 text-muted-foreground">
                {nextStage.internal_action || nextStage.stage_name}
              </span>
            </div>
          ) : (
            <span className="text-xs text-success font-medium">All complete</span>
          )}
        </TableCell>

        {/* Quick actions */}
        <TableCell className="w-20">
          <div className="flex flex-wrap items-center gap-1.5">
            {nextStage && nextStage.status === 'in_progress' && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 rounded-full px-2 text-[10px] gap-1 border-brand-200/20 bg-background/30 dark:bg-black/30 hover:border-brand-300/45 hover:bg-brand-400/10 focus-visible:ring-brand-300/50"
                      onClick={() => onUpdateStage?.(nextStage.id, deal.client_id, { status: 'complete', completed_at: new Date().toISOString() }, deal.id, stages)}
                    >
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Done
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[10px]">Complete current stage</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {nextStage && nextStage.status === 'pending' && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-2 text-[10px] gap-1 border-brand-200/20 bg-background/30 dark:bg-black/30 hover:border-brand-300/45 hover:bg-brand-400/10 focus-visible:ring-brand-300/50"
                      onClick={() => onUpdateStage?.(nextStage.id, deal.client_id, { status: 'in_progress' }, deal.id, stages)}
                    >
                      <Play className="h-2.5 w-2.5" />
                      Start
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[10px]">Start next stage</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 rounded-full border border-transparent p-0 opacity-100 hover:border-brand-200/30 hover:bg-brand-400/10 md:opacity-0 md:group-hover:opacity-100" onClick={onDealClick}>
              <Eye className="h-3 w-3 text-primary" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded: Stage timeline + notes editor — plain <tr> avoids invalid DOM */}
      {expanded && (
        <DealExpandedRow
          deal={deal}
          teamUsers={teamUsers}
          onUpdateDeal={onUpdateDeal}
          onUpdateStage={onUpdateStage}
        />
      )}
    </>
  );
}

// ─── MAIN COMPONENT ───
export function DealManagement({ deals, isLoading, onDealClick, onUpdateDeal, onUpdateStage }: Props) {
  const { data: teamUsers = [] } = useTeamUsers();

  // Summary stats
  const stats = useMemo(() => {
    const actionable = deals.filter(d => {
      const stages = d.stages || [];
      return stages.some(s => s.status === 'in_progress');
    }).length;
    const unassigned = deals.filter(d => !d.responsible_person).length;
    const urgent = deals.filter(d => d.risk_status === 'urgent').length;
    return { actionable, unassigned, urgent };
  }, [deals]);

  if (isLoading) {
    return (
      <div className="space-y-4 rounded-[1.5rem] border border-brand-200/15 bg-background/25 dark:bg-black/25 p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl bg-brand-200/10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48 bg-brand-200/10" />
            <Skeleton className="h-3 w-72 max-w-full bg-card/10 dark:bg-white/10" />
          </div>
        </div>
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-2xl bg-card/10 dark:bg-white/10" />)}
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <Card className="overflow-hidden rounded-[1.5rem] border-brand-200/15 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_42%),rgba(9,9,11,0.72)] shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
        <CardContent className="py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-200/25 bg-brand-400/10">
            <Edit3 className="h-7 w-7 text-brand-200" />
          </div>
          <p className="text-sm font-semibold text-foreground">No deals to manage</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Create or filter in deals to start managing ownership, stage movement, notes and risk controls.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden rounded-[1.5rem] border-brand-200/15 bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(24,24,27,0.76)_44%,rgba(0,0,0,0.72))] shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
        <CardHeader className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-brand-200/85">
                <Sparkles className="h-3.5 w-3.5" /> Transaction control room
              </p>
              <CardTitle className="mt-2 break-words text-xl font-semibold tracking-[-0.02em] text-foreground">Manage deal execution</CardTitle>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Review active stages, assign responsibility, update risk posture and capture internal notes. Inline edits retain the existing save-on-blur workflow.</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
        <Badge variant="outline" className="text-[10px] gap-1">
          <Play className="h-3 w-3 text-primary" />
          {stats.actionable} in progress
        </Badge>
        {stats.unassigned > 0 && (
          <Badge variant="outline" className="text-[10px] gap-1 border-warning/40 text-warning">
            <User className="h-3 w-3" />
            {stats.unassigned} unassigned
          </Badge>
        )}
        {stats.urgent > 0 && (
          <Badge variant="destructive" className="text-[10px] gap-1">
            <AlertTriangle className="h-3 w-3" />
            {stats.urgent} urgent
          </Badge>
        )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="flex items-center gap-2 rounded-2xl border border-brand-200/10 bg-background/25 dark:bg-black/25 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0 text-brand-200" />
        <span className="break-words">Click a row to expand stage management · Edits save on blur · Destructive deal actions remain governed in the existing client deal workflow.</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden rounded-[1.5rem] border-brand-200/15 bg-background/60 dark:bg-background/60 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
        <CardContent className="p-0">
          <div className="max-w-full overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-brand-200/10 bg-white/[0.035] hover:bg-white/[0.035]">
                  <TableHead className="w-8 px-2" />
                  <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Client</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Stage</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground hidden sm:table-cell">Progress</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground hidden md:table-cell">Responsible</TableHead>
                  <TableHead className="min-w-[160px] whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground hidden lg:table-cell">Risk</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground hidden xl:table-cell">Next Action</TableHead>
                  <TableHead className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deals.map(deal => (
                  <DealManageRow
                    key={deal.id}
                    deal={deal}
                    teamUsers={teamUsers}
                    onDealClick={() => onDealClick?.(deal)}
                    onUpdateDeal={onUpdateDeal}
                    onUpdateStage={onUpdateStage}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
