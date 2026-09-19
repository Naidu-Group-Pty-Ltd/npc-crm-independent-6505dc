import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import {
  format,
  isToday,
  isTomorrow,
  isPast,
  differenceInDays,
  startOfDay,
  endOfDay,
  addDays,
  endOfWeek,
  endOfMonth,
} from 'date-fns';
import { matchesTimeBucket, type ReminderTimeBucket } from '@/lib/reminders/timeBucket.pure';
import { cn } from '@/lib/utils';
import {
  Bell,
  Plus,
  CalendarDays,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Users,
  TrendingUp,
  Building2,
  ChevronRight,
  Filter,
  Sparkles,
  Loader2,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAllReminders, type UnifiedReminder } from '@/hooks/useAllReminders';
import { TeamRemindersSection } from '@/components/reminders/TeamRemindersSection';
import { CreateReminderForm } from '@/components/reminders/CreateReminderForm';
import { ReminderActions } from '@/components/reminders/ReminderActions';
import { toast } from 'sonner';

type ReminderTab = 'client' | 'team';
// The buckets and the predicate are `lib/reminders/timeBucket.pure` now, so
// the team tab can offer the same chips without a second copy of the rule.
type TimeFilter = ReminderTimeBucket;
type SourceFilter = 'all' | 'client_reminder' | 'follow_up' | 'deal_milestone';
type PriorityFilter = 'all' | 'high' | 'medium' | 'low';

const PRIORITY_CONFIG = {
  high: { label: 'High', color: 'bg-destructive/15 text-destructive border-destructive/40 shadow-[0_0_18px_rgba(248,113,113,0.14)]' },
  medium: { label: 'Medium', color: 'bg-brand-500/15 text-brand-200 border-brand-300/35 shadow-[0_0_18px_rgba(245,158,11,0.12)]' },
  low: { label: 'Low', color: 'bg-success/10 text-success border-success/30 shadow-[0_0_18px_rgba(16,185,129,0.10)]' },
};

const SOURCE_ICONS = {
  client_reminder: <Bell className="h-3.5 w-3.5" />,
  follow_up: <Users className="h-3.5 w-3.5" />,
  deal_milestone: <TrendingUp className="h-3.5 w-3.5" />,
};

const SOURCE_COLORS = {
  client_reminder: 'text-brand-200',
  follow_up: 'text-warning',
  deal_milestone: 'text-success',
};

const premiumPanel = 'border border-brand-400/12 bg-[linear-gradient(135deg,rgba(15,23,42,0.82),rgba(2,6,23,0.94))] shadow-[0_18px_55px_rgba(0,0,0,0.36)] backdrop-blur';
const interactivePanel = 'motion-safe:transition-all motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 hover:border-brand-300/30 hover:shadow-[0_20px_50px_rgba(245,158,11,0.11),0_14px_34px_rgba(0,0,0,0.28)] focus-within:border-brand-300/35 focus-within:shadow-[0_0_0_1px_rgba(245,158,11,0.14),0_18px_45px_rgba(245,158,11,0.10)]';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  settlement: <Building2 className="h-3.5 w-3.5" />,
  finance: <TrendingUp className="h-3.5 w-3.5" />,
  clawback: <AlertTriangle className="h-3.5 w-3.5" />,
  construction: <Building2 className="h-3.5 w-3.5" />,
  /* AML/CTF obligations, written by the compliance module. A scheduled
     ongoing-CDD review used to appear on one card at the foot of one case
     stage and on no reminder list in the product — the one obligation with
     a statutory character and a multi-year horizon was the one nobody would
     see coming. They read as compliance work here rather than as
     indistinguishable "client reminders". */
  aml_periodic_review: <ShieldCheck className="h-3.5 w-3.5" />,
  aml_trigger_review: <ShieldAlert className="h-3.5 w-3.5" />,
  aml_passport_issued: <ShieldCheck className="h-3.5 w-3.5" />,
};

/** What an AML reminder is called on screen, where the type alone is a slug. */
const AML_REMINDER_LABELS: Record<string, string> = {
  aml_periodic_review: 'AML/CTF review',
  aml_trigger_review: 'AML/CTF trigger review',
  aml_passport_issued: 'Compliance Passport',
};

export default function RemindersHub() {
  const { canEdit: canEditReminders, canDelete: canDeleteReminders } = useModulePermissions('reminders');
  const { data: reminders = [], isLoading } = useAllReminders();
  const navigate = useNavigate();

  const [reminderTab, setReminderTab] = useState<ReminderTab>('client');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const monthEnd = endOfMonth(now);

  // Stats
  const stats = useMemo(() => {
    const overdue = reminders.filter(r => isPast(new Date(r.due_date)) && !isToday(new Date(r.due_date))).length;
    const today = reminders.filter(r => isToday(new Date(r.due_date))).length;
    const thisWeek = reminders.filter(r => {
      const d = new Date(r.due_date);
      return d >= todayStart && d <= weekEnd;
    }).length;
    const highPriority = reminders.filter(r => r.priority === 'high').length;
    return { overdue, today, thisWeek, total: reminders.length, highPriority };
  }, [reminders]);

  // Morning Briefing
  const briefing = useMemo(() => {
    const parts: string[] = [];
    if (stats.overdue > 0) parts.push(`${stats.overdue} overdue item${stats.overdue > 1 ? 's' : ''} need${stats.overdue === 1 ? 's' : ''} attention`);
    if (stats.today > 0) parts.push(`${stats.today} item${stats.today > 1 ? 's' : ''} due today`);

    const settlementsThisWeek = reminders.filter(r =>
      r.reminder_type === 'settlement' &&
      new Date(r.due_date) >= todayStart &&
      new Date(r.due_date) <= weekEnd
    ).length;
    if (settlementsThisWeek > 0) parts.push(`${settlementsThisWeek} settlement${settlementsThisWeek > 1 ? 's' : ''} this week`);

    const followUps = reminders.filter(r => r.source === 'follow_up' && new Date(r.due_date) <= todayEnd).length;
    if (followUps > 0) parts.push(`${followUps} client follow-up${followUps > 1 ? 's' : ''} pending`);

    if (parts.length === 0) return "You're all clear — no urgent items right now. 🎉";
    return parts.join(' · ');
  }, [reminders, stats]);

  // Filtered results
  const filtered = useMemo(() => {
    let result = [...reminders];

    // Source filter
    if (sourceFilter !== 'all') {
      result = result.filter(r => r.source === sourceFilter);
    }

    // Priority filter
    if (priorityFilter !== 'all') {
      result = result.filter(r => r.priority === priorityFilter);
    }

    // Time filter — one rule, shared with the team tab.
    if (timeFilter !== 'all') {
      result = result.filter(r => matchesTimeBucket(new Date(r.due_date), timeFilter, now));
    }

    return result;
  }, [reminders, timeFilter, sourceFilter, priorityFilter, now]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: Record<string, UnifiedReminder[]> = {};
    for (const r of filtered) {
      const d = new Date(r.due_date);
      let key: string;
      if (isPast(d) && !isToday(d)) {
        key = '⚠️ Overdue';
      } else if (isToday(d)) {
        key = '📌 Today';
      } else if (isTomorrow(d)) {
        key = '📅 Tomorrow';
      } else if (d <= weekEnd) {
        key = '🗓️ This Week';
      } else if (d <= monthEnd) {
        key = '📆 This Month';
      } else {
        key = '🔮 Later';
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return groups;
  }, [filtered]);

  const groupOrder = ['⚠️ Overdue', '📌 Today', '📅 Tomorrow', '🗓️ This Week', '📆 This Month', '🔮 Later'];

  const handleReminderClick = (reminder: UnifiedReminder) => {
    if (reminder.client_id) {
      if (reminder.deal_id) {
        navigate(`/clients?clientId=${reminder.client_id}&tab=deals&dealId=${reminder.deal_id}`);
      } else {
        navigate(`/clients?clientId=${reminder.client_id}&tab=reminders`);
      }
      toast.info(`Opening ${reminder.client_name}`);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.10),transparent_32%),radial-gradient(circle_at_85%_0%,rgba(20,184,166,0.06),transparent_28%),linear-gradient(180deg,#030303_0%,#0f1117_48%,#050507_100%)] p-3 scrollbar-thin scrollbar-track-slate-950 scrollbar-thumb-amber-500/30 sm:p-6">
        <div className="mx-auto min-w-0 max-w-7xl space-y-5 sm:space-y-6">
          <div className="relative overflow-hidden rounded-[1.75rem] border border-brand-400/15 bg-[linear-gradient(135deg,rgba(245,158,11,0.09),rgba(0,0,0,0.72)_34%,rgba(15,23,42,0.58))] p-4 shadow-[0_26px_80px_rgba(0,0,0,0.42)] sm:p-6">
            <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/70 to-transparent" />
            <div className="pointer-events-none absolute -right-16 -top-24 h-44 w-44 rounded-full bg-brand-300/10 blur-3xl" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-2xl bg-brand-300/10 sm:h-14 sm:w-14" />
              <div className="min-w-0 flex-1 space-y-3">
                <Skeleton className="h-5 w-36 rounded-full bg-brand-300/10" />
                <Skeleton className="h-8 w-56 rounded-lg bg-card/10 dark:bg-white/10 sm:h-10" />
                <Skeleton className="h-4 w-full max-w-lg rounded-lg bg-card/10 dark:bg-white/10" />
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[1.5rem] border border-brand-300/15 bg-[linear-gradient(135deg,rgba(15,23,42,0.82),rgba(2,6,23,0.94))] p-4 shadow-[0_18px_55px_rgba(0,0,0,0.36)]">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-300/20 bg-brand-400/10">
                <Loader2 className="h-5 w-5 animate-spin text-brand-200" />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground dark:text-foreground">Loading Reminders Hub</p>
                <p className="text-xs text-muted-foreground">Preparing client follow-ups, team reminders, and milestone timelines.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-24 rounded-2xl border border-brand-400/10 bg-background dark:bg-background/70 shadow-[0_18px_45px_rgba(0,0,0,0.25)]" />
            ))}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-14 rounded-2xl border border-brand-300/10 bg-background dark:bg-background/70" />
            <Skeleton className="h-72 rounded-[1.5rem] border border-brand-300/10 bg-background dark:bg-background/70" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.10),transparent_32%),radial-gradient(circle_at_85%_0%,rgba(20,184,166,0.06),transparent_28%),linear-gradient(180deg,#030303_0%,#0f1117_48%,#050507_100%)] p-3 text-foreground dark:text-foreground scrollbar-thin scrollbar-track-slate-950 scrollbar-thumb-amber-500/30 sm:p-6">
      <div className="mx-auto min-w-0 max-w-7xl space-y-5 sm:space-y-6">
        {/* Page Header */}
        <div className="relative overflow-hidden rounded-[1.75rem] border border-brand-400/15 bg-[linear-gradient(135deg,rgba(245,158,11,0.09),rgba(0,0,0,0.72)_34%,rgba(15,23,42,0.58))] p-4 shadow-[0_26px_80px_rgba(0,0,0,0.42)] backdrop-blur sm:p-6">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/80 to-transparent" />
          <div className="pointer-events-none absolute -right-16 -top-24 h-44 w-44 rounded-full bg-brand-300/10 blur-3xl" />
          <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center sm:gap-4">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-brand-300/30 bg-gradient-to-br from-brand-300/20 via-brand-500/10 to-background dark:to-black/20 shadow-[0_0_34px_rgba(245,158,11,0.22)] sm:h-14 sm:w-14">
              <div className="absolute inset-1 rounded-[1rem] border border-border dark:border-white/5" />
              <Bell className="relative h-5 w-5 text-brand-100 drop-shadow-[0_0_12px_rgba(245,158,11,0.45)] sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-300/20 bg-brand-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-100/90">
                Daily command hub
              </div>
              <h1 className="bg-gradient-to-r from-white via-brand-100 to-brand-300 bg-clip-text text-2xl font-bold tracking-tight text-transparent drop-shadow-[0_0_22px_rgba(245,158,11,0.16)] sm:text-4xl">Reminders Hub</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground dark:text-foreground sm:text-base">
                All reminders, follow-ups, and deal milestones in one place.
              </p>
            </div>
          </div>
        </div>

        {/* Morning Briefing Banner */}
        <Card
          className={cn(
            premiumPanel,
            'relative overflow-hidden rounded-[1.5rem] ring-1 ring-border dark:ring-white/[0.03] transition-all duration-200 hover:border-brand-300/25 hover:shadow-[0_20px_60px_rgba(245,158,11,0.10),0_18px_45px_rgba(0,0,0,0.30)]',
            stats.overdue > 0
              ? 'border-destructive/35 bg-[linear-gradient(135deg,rgba(127,29,29,0.32),rgba(5,5,5,0.92)_48%,rgba(69,10,10,0.20))]'
              : stats.today > 0
                ? 'border-brand-300/35 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(5,5,5,0.92)_48%,rgba(120,53,15,0.18))]'
                : 'border-success/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.16),rgba(5,5,5,0.92)_46%,rgba(245,158,11,0.08))]'
          )}
        >
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/80 to-transparent" />
          <div
            className={cn(
              'pointer-events-none absolute -right-10 -top-16 h-32 w-32 rounded-full blur-3xl',
              stats.overdue > 0 ? 'bg-destructive/10' : stats.today > 0 ? 'bg-brand-400/12' : 'bg-success/12'
            )}
          />
          <CardContent className="relative flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4 sm:p-5">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border shadow-inner',
                stats.overdue > 0
                  ? 'border-destructive/30 bg-destructive/15 text-destructive'
                  : stats.today > 0
                    ? 'border-brand-300/30 bg-brand-400/15 text-brand-200'
                    : 'border-success/25 bg-success/12 text-success'
              )}
            >
              <Sparkles className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground dark:text-muted-foreground">
                {format(now, 'EEEE, dd MMMM yyyy')}
              </p>
              <p className="max-w-5xl whitespace-normal break-words text-sm font-medium leading-6 text-foreground dark:text-foreground sm:text-base sm:leading-7">
                {briefing}
              </p>
            </div>
          </CardContent>
        </Card>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 sm:gap-3">
        <Card className={cn(premiumPanel, interactivePanel, 'group relative overflow-hidden rounded-2xl ring-1 ring-border dark:ring-white/[0.025]', stats.overdue > 0 ? 'border-destructive/35 bg-destructive/15' : 'hover:border-brand-300/30')}>
          <CardContent className="relative p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground">Overdue</p>
              <div className={cn('flex h-8 w-8 items-center justify-center rounded-xl border', stats.overdue > 0 ? 'border-destructive/30 bg-destructive/15 text-destructive' : 'border-border dark:border-white/10 bg-card/5 dark:bg-white/5 text-muted-foreground dark:text-muted-foreground')}>
                <AlertTriangle className="h-4 w-4" />
              </div>
            </div>
            <p className={cn('text-3xl font-bold tracking-tight sm:text-4xl', stats.overdue > 0 ? 'text-destructive' : 'text-foreground dark:text-foreground')}>{stats.overdue}</p>
            <div className={cn('mt-3 h-0.5 rounded-full transition-all duration-200 group-hover:shadow-[0_0_18px_rgba(245,158,11,0.35)]', stats.overdue > 0 ? 'bg-destructive/60' : 'bg-brand-300/25')} />
          </CardContent>
        </Card>
        <Card className={cn(premiumPanel, interactivePanel, 'group relative overflow-hidden rounded-2xl ring-1 ring-border dark:ring-white/[0.025]', stats.today > 0 ? 'border-brand-300/35 bg-brand-950/15' : 'hover:border-brand-300/30')}>
          <CardContent className="relative p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground">Today</p>
              <div className={cn('flex h-8 w-8 items-center justify-center rounded-xl border', stats.today > 0 ? 'border-brand-300/30 bg-brand-400/15 text-brand-200' : 'border-border dark:border-white/10 bg-card/5 dark:bg-white/5 text-muted-foreground dark:text-muted-foreground')}>
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <p className={cn('text-3xl font-bold tracking-tight sm:text-4xl', stats.today > 0 ? 'text-brand-300' : 'text-foreground dark:text-foreground')}>{stats.today}</p>
            <div className="mt-3 h-0.5 rounded-full bg-brand-300/35 transition-all duration-200 group-hover:shadow-[0_0_18px_rgba(245,158,11,0.35)]" />
          </CardContent>
        </Card>
        <Card className={cn(premiumPanel, interactivePanel, 'group relative overflow-hidden rounded-2xl ring-1 ring-border dark:ring-white/[0.025] hover:border-brand-300/30')}>
          <CardContent className="relative p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground">This Week</p>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-brand-300/20 bg-brand-400/10 text-brand-200">
                <CalendarDays className="h-4 w-4" />
              </div>
            </div>
            <p className="text-3xl font-bold tracking-tight text-foreground dark:text-foreground sm:text-4xl">{stats.thisWeek}</p>
            <div className="mt-3 h-0.5 rounded-full bg-brand-300/30 transition-all duration-200 group-hover:shadow-[0_0_18px_rgba(245,158,11,0.35)]" />
          </CardContent>
        </Card>
        <Card className={cn(premiumPanel, interactivePanel, 'group relative overflow-hidden rounded-2xl ring-1 ring-border dark:ring-white/[0.025]', stats.highPriority > 0 ? 'border-destructive/35 bg-destructive/15' : 'hover:border-brand-300/30')}>
          <CardContent className="relative p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground">High Priority</p>
              <div className={cn('flex h-8 w-8 items-center justify-center rounded-xl border', stats.highPriority > 0 ? 'border-destructive/30 bg-destructive/15 text-destructive' : 'border-border dark:border-white/10 bg-card/5 dark:bg-white/5 text-muted-foreground dark:text-muted-foreground')}>
                <Sparkles className="h-4 w-4" />
              </div>
            </div>
            <p className={cn('text-3xl font-bold tracking-tight sm:text-4xl', stats.highPriority > 0 ? 'text-destructive' : 'text-foreground dark:text-foreground')}>{stats.highPriority}</p>
            <div className={cn('mt-3 h-0.5 rounded-full transition-all duration-200 group-hover:shadow-[0_0_18px_rgba(245,158,11,0.35)]', stats.highPriority > 0 ? 'bg-destructive/60' : 'bg-brand-300/25')} />
          </CardContent>
        </Card>
        <Card className={cn(premiumPanel, interactivePanel, 'group relative overflow-hidden rounded-2xl ring-1 ring-border dark:ring-white/[0.025] hover:border-brand-300/30 min-[420px]:col-span-2 md:col-span-1')}>
          <CardContent className="relative p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground">Total Upcoming</p>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-success/20 bg-success/10 text-success">
                <TrendingUp className="h-4 w-4" />
              </div>
            </div>
            <p className="text-3xl font-bold tracking-tight text-foreground dark:text-foreground sm:text-4xl">{stats.total}</p>
            <div className="mt-3 h-0.5 rounded-full bg-success/30 transition-all duration-200 group-hover:shadow-[0_0_18px_rgba(245,158,11,0.35)]" />
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs: Client vs Team */}
      <Tabs value={reminderTab} onValueChange={(v) => setReminderTab(v as ReminderTab)} className="min-w-0 space-y-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList aria-label="Reminder category" className="relative grid h-auto w-full grid-cols-2 gap-1.5 overflow-hidden rounded-2xl border border-brand-300/15 bg-[linear-gradient(135deg,rgba(0,0,0,0.72),rgba(15,23,42,0.78))] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_45px_rgba(0,0,0,0.32)] backdrop-blur sm:inline-grid sm:w-auto sm:min-w-[430px]">
            <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/50 to-transparent" />
            <TabsTrigger
              value="client"
              className="group relative h-11 rounded-xl border border-transparent px-3 text-xs font-semibold text-muted-foreground dark:text-foreground transition-all duration-200 hover:border-brand-300/20 hover:bg-brand-400/10 hover:text-brand-100 motion-safe:hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black data-[state=active]:border-brand-200/45 data-[state=active]:bg-[linear-gradient(135deg,#fbbf24,#d97706)] data-[state=active]:text-black data-[state=active]:shadow-[0_0_28px_rgba(245,158,11,0.28),inset_0_1px_0_rgba(255,255,255,0.45)] sm:h-12 sm:px-5 sm:text-sm"
            >
              <span className="flex min-w-0 items-center justify-center gap-2">
                <Bell className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=active]:scale-105" />
                <span className="truncate">Client Reminders</span>
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="team"
              className="group relative h-11 rounded-xl border border-transparent px-3 text-xs font-semibold text-muted-foreground dark:text-foreground transition-all duration-200 hover:border-brand-300/20 hover:bg-brand-400/10 hover:text-brand-100 motion-safe:hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black data-[state=active]:border-brand-200/45 data-[state=active]:bg-[linear-gradient(135deg,#fbbf24,#d97706)] data-[state=active]:text-black data-[state=active]:shadow-[0_0_28px_rgba(245,158,11,0.28),inset_0_1px_0_rgba(255,255,255,0.45)] sm:h-12 sm:px-5 sm:text-sm"
            >
              <span className="flex min-w-0 items-center justify-center gap-2">
                <Users className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=active]:scale-105" />
                <span className="truncate">Team Reminders</span>
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Create action lives beside the tabs so the gold is an accent, not a slab. */}
          {canEditReminders && reminderTab === 'client' && !showCreateForm && (
            <Button
              aria-label="Create a new reminder"
              onClick={() => setShowCreateForm(true)}
              variant="outline"
              className="group h-11 w-full shrink-0 gap-2 rounded-xl border-brand-300/40 bg-brand-400/10 px-4 text-sm font-semibold text-brand-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all duration-200 hover:border-brand-200/60 hover:bg-brand-400/18 hover:text-brand-50 hover:shadow-[0_0_24px_rgba(245,158,11,0.18)] focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:h-12 sm:w-auto"
            >
              <Plus className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90" />
              <span>New Reminder</span>
            </Button>
          )}
        </div>

        <TabsContent value="client" className="min-w-0 space-y-4">
          {canEditReminders && showCreateForm && (
            <div className="mb-4">
              <CreateReminderForm onClose={() => setShowCreateForm(false)} />
            </div>
          )}


          {/* Time Tabs + Filters Row */}
          <div className={cn(premiumPanel, "flex min-w-0 flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:items-center sm:p-4")}>
            <Tabs value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)} className="min-w-0 flex-1">
              <TabsList aria-label="Reminder timeframe" className="relative inline-flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-brand-300/10 bg-[linear-gradient(135deg,rgba(0,0,0,0.58),rgba(15,23,42,0.58))] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] scrollbar-thin scrollbar-track-slate-950 scrollbar-thumb-amber-500/30">
                <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/45 to-transparent" />
                <TabsTrigger value="all" className="h-9 min-w-16 rounded-xl border border-transparent px-3 text-xs font-semibold text-muted-foreground dark:text-foreground transition-all duration-200 hover:border-brand-300/20 hover:bg-brand-400/10 hover:text-brand-100 motion-safe:hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black data-[state=active]:border-brand-200/45 data-[state=active]:bg-[linear-gradient(135deg,#fbbf24,#d97706)] data-[state=active]:text-black data-[state=active]:shadow-[0_0_22px_rgba(245,158,11,0.22),inset_0_1px_0_rgba(255,255,255,0.35)] sm:h-10 sm:min-w-20 sm:text-sm">All</TabsTrigger>
                <TabsTrigger value="overdue" className="h-9 min-w-24 rounded-xl border border-transparent px-3 text-xs font-semibold text-muted-foreground dark:text-foreground transition-all duration-200 hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive motion-safe:hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black data-[state=active]:border-brand-200/45 data-[state=active]:bg-[linear-gradient(135deg,#fbbf24,#d97706)] data-[state=active]:text-black data-[state=active]:shadow-[0_0_22px_rgba(245,158,11,0.22),inset_0_1px_0_rgba(255,255,255,0.35)] sm:h-10 sm:min-w-28 sm:text-sm">
                  Overdue {stats.overdue > 0 && <Badge variant="destructive" className="ml-1 h-4 px-1 text-[9px] shadow-[0_0_12px_rgba(248,113,113,0.28)]">{stats.overdue}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="today" className="h-9 min-w-20 rounded-xl border border-transparent px-3 text-xs font-semibold text-muted-foreground dark:text-foreground transition-all duration-200 hover:border-brand-300/20 hover:bg-brand-400/10 hover:text-brand-100 motion-safe:hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black data-[state=active]:border-brand-200/45 data-[state=active]:bg-[linear-gradient(135deg,#fbbf24,#d97706)] data-[state=active]:text-black data-[state=active]:shadow-[0_0_22px_rgba(245,158,11,0.22),inset_0_1px_0_rgba(255,255,255,0.35)] sm:h-10 sm:min-w-24 sm:text-sm">Today</TabsTrigger>
                <TabsTrigger value="week" className="h-9 min-w-28 rounded-xl border border-transparent px-3 text-xs font-semibold text-muted-foreground dark:text-foreground transition-all duration-200 hover:border-brand-300/20 hover:bg-brand-400/10 hover:text-brand-100 motion-safe:hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black data-[state=active]:border-brand-200/45 data-[state=active]:bg-[linear-gradient(135deg,#fbbf24,#d97706)] data-[state=active]:text-black data-[state=active]:shadow-[0_0_22px_rgba(245,158,11,0.22),inset_0_1px_0_rgba(255,255,255,0.35)] sm:h-10 sm:min-w-32 sm:text-sm">This Week</TabsTrigger>
                <TabsTrigger value="month" className="h-9 min-w-28 rounded-xl border border-transparent px-3 text-xs font-semibold text-muted-foreground dark:text-foreground transition-all duration-200 hover:border-brand-300/20 hover:bg-brand-400/10 hover:text-brand-100 motion-safe:hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black data-[state=active]:border-brand-200/45 data-[state=active]:bg-[linear-gradient(135deg,#fbbf24,#d97706)] data-[state=active]:text-black data-[state=active]:shadow-[0_0_22px_rgba(245,158,11,0.22),inset_0_1px_0_rgba(255,255,255,0.35)] sm:h-10 sm:min-w-32 sm:text-sm">This Month</TabsTrigger>
                <TabsTrigger value="later" className="h-9 min-w-20 rounded-xl border border-transparent px-3 text-xs font-semibold text-muted-foreground dark:text-foreground transition-all duration-200 hover:border-brand-300/20 hover:bg-brand-400/10 hover:text-brand-100 motion-safe:hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black data-[state=active]:border-brand-200/45 data-[state=active]:bg-[linear-gradient(135deg,#fbbf24,#d97706)] data-[state=active]:text-black data-[state=active]:shadow-[0_0_22px_rgba(245,158,11,0.22),inset_0_1px_0_rgba(255,255,255,0.35)] sm:h-10 sm:min-w-24 sm:text-sm">Later</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="grid w-full min-w-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:w-auto sm:shrink-0">
              <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
                <SelectTrigger
                  aria-label="Filter reminders by source"
                  className={cn(
                    'h-11 min-w-0 w-full rounded-xl border bg-background dark:bg-black/45 px-3 text-xs font-semibold text-foreground dark:text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-200 hover:border-brand-300/35 hover:bg-brand-400/10 hover:text-brand-100 motion-safe:hover:-translate-y-px focus:ring-2 focus:ring-brand-300/70 focus:ring-offset-2 focus:ring-offset-black sm:w-[170px] sm:flex-none',
                    sourceFilter !== 'all'
                      ? 'border-brand-300/45 bg-brand-400/12 text-brand-100 shadow-[0_0_22px_rgba(245,158,11,0.14)]'
                      : 'border-brand-400/15'
                  )}
                >
                  <Filter className="mr-2 h-3.5 w-3.5 shrink-0 text-brand-200/80" />
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-brand-300/20 bg-background dark:bg-background/95 p-1 text-foreground dark:text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur">
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="client_reminder">Client Reminders</SelectItem>
                  <SelectItem value="follow_up">Follow-Ups</SelectItem>
                  <SelectItem value="deal_milestone">Deal Milestones</SelectItem>
                </SelectContent>
              </Select>

              <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as PriorityFilter)}>
                <SelectTrigger
                  aria-label="Filter reminders by priority"
                  className={cn(
                    'h-11 min-w-0 w-full rounded-xl border bg-background dark:bg-black/45 px-3 text-xs font-semibold text-foreground dark:text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-200 hover:border-brand-300/35 hover:bg-brand-400/10 hover:text-brand-100 motion-safe:hover:-translate-y-px focus:ring-2 focus:ring-brand-300/70 focus:ring-offset-2 focus:ring-offset-black sm:w-[150px] sm:flex-none',
                    priorityFilter !== 'all'
                      ? 'border-brand-300/45 bg-brand-400/12 text-brand-100 shadow-[0_0_22px_rgba(245,158,11,0.14)]'
                      : 'border-brand-400/15'
                  )}
                >
                  <Sparkles className="mr-2 h-3.5 w-3.5 shrink-0 text-brand-200/80" />
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-brand-300/20 bg-background dark:bg-background/95 p-1 text-foreground dark:text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur">
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Timeline Groups */}
          {filtered.length === 0 ? (
            <Card
              className={cn(
                premiumPanel,
                "relative overflow-hidden rounded-[1.5rem] border-dashed bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(2,6,23,0.88)_46%,rgba(0,0,0,0.70))] shadow-[0_24px_76px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.04)]",
                timeFilter === 'overdue' || timeFilter === 'today' || timeFilter === 'week' || timeFilter === 'month' ? 'border-success/25' : 'border-brand-300/25'
              )}
            >
              <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
              <div className="pointer-events-none absolute -left-12 bottom-0 h-32 w-32 rounded-full bg-success/6 blur-3xl" />
              <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-brand-300/8 blur-3xl" />
              <CardContent className="relative flex flex-col items-center justify-center px-5 py-14 text-center sm:px-8 sm:py-16">
                <div className="mb-4 rounded-[1.4rem] border border-border dark:border-white/10 bg-background dark:bg-black/20 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-success/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.16),rgba(245,158,11,0.08))] text-success shadow-[0_0_32px_rgba(16,185,129,0.14)]">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                </div>
                <div className="max-w-md space-y-2">
                  <p className="text-base font-semibold tracking-tight text-foreground dark:text-foreground sm:text-lg">No reminders match your filters</p>
                  <p className="text-xs leading-5 text-muted-foreground sm:text-sm">
                    Your selected reminder view is clear. Adjust the timeframe, source, or priority filters to widen the command hub view.
                  </p>
                </div>
                {timeFilter === 'overdue' && (
                  <p className="mt-4 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-xs font-medium text-success/85">No overdue items are waiting for action.</p>
                )}
                {timeFilter === 'today' && (
                  <p className="mt-4 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-xs font-medium text-success/85">No due-today reminders are waiting for action.</p>
                )}
                {timeFilter === 'week' && (
                  <p className="mt-4 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-xs font-medium text-success/85">Your weekly reminder plan is clear for the selected filters.</p>
                )}
                {timeFilter === 'month' && (
                  <p className="mt-4 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-xs font-medium text-success/85">No monthly planning reminders match the selected filters.</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="min-w-0 space-y-5">
              {groupOrder.filter(g => grouped[g]).map(groupLabel => {
                const isOverdueGroup = groupLabel.includes('Overdue');
                const isTodayGroup = groupLabel.includes('Today');
                const isWeekPlanningGroup = timeFilter === 'week' && !isOverdueGroup && !isTodayGroup;
                const isMonthPlanningGroup = timeFilter === 'month' && !isOverdueGroup && !isTodayGroup;

                return (
                <div key={groupLabel}>
                  <div className={cn(
                    'mb-3 flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
                    isOverdueGroup
                      ? 'border-destructive/25 bg-[linear-gradient(135deg,rgba(127,29,29,0.22),rgba(15,23,42,0.42))]'
                      : isTodayGroup
                        ? 'border-brand-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(15,23,42,0.42))]'
                        : isWeekPlanningGroup
                          ? 'border-brand-300/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(15,23,42,0.42))]'
                          : isMonthPlanningGroup
                            ? 'border-success/20 bg-[linear-gradient(135deg,rgba(20,184,166,0.13),rgba(15,23,42,0.42))]'
                      : 'border-brand-400/12 bg-[linear-gradient(135deg,rgba(0,0,0,0.42),rgba(15,23,42,0.42))]'
                  )}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn(
                        'h-2 w-2 rounded-full',
                        isOverdueGroup
                          ? 'bg-destructive/30 shadow-[0_0_12px_rgba(248,113,113,0.45)]'
                          : isTodayGroup
                            ? 'bg-brand-300 shadow-[0_0_14px_rgba(245,158,11,0.65)]'
                            : isWeekPlanningGroup
                              ? 'bg-brand-300 shadow-[0_0_14px_rgba(245,158,11,0.45)]'
                              : isMonthPlanningGroup
                                ? 'bg-success/30 shadow-[0_0_14px_rgba(45,212,191,0.42)]'
                          : 'bg-brand-300 shadow-[0_0_12px_rgba(245,158,11,0.55)]'
                      )} />
                      <h3 className="truncate text-sm font-semibold text-foreground dark:text-foreground">{groupLabel}</h3>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 text-[10px] font-semibold shadow-[0_0_16px_rgba(245,158,11,0.10)]',
                        isOverdueGroup
                          ? 'border-destructive/30 bg-destructive/10 text-destructive'
                          : isTodayGroup
                            ? 'border-brand-200/40 bg-brand-400/15 text-brand-100'
                            : isWeekPlanningGroup
                              ? 'border-brand-300/30 bg-brand-400/10 text-brand-100'
                              : isMonthPlanningGroup
                                ? 'border-success/30 bg-success/10 text-success'
                          : 'border-brand-300/30 bg-brand-400/10 text-brand-100'
                      )}
                    >
                      {grouped[groupLabel].length}
                    </Badge>
                  </div>

                  <div className="min-w-0 space-y-2">
                    {grouped[groupLabel].map(reminder => {
                      const isOverdue = isPast(new Date(reminder.due_date)) && !isToday(new Date(reminder.due_date));
                      const isDueToday = isToday(new Date(reminder.due_date));
                      const isWeekPlanningReminder = timeFilter === 'week' && !isOverdue && !isDueToday;
                      const isMonthPlanningReminder = timeFilter === 'month' && !isOverdue && !isDueToday;
                      const daysUntil = differenceInDays(new Date(reminder.due_date), now);
                      const priorityCfg = PRIORITY_CONFIG[reminder.priority];

                        return (
                          <Card
                            key={reminder.id}
                            className={cn(
                              premiumPanel,
                              interactivePanel,
                              'group relative cursor-pointer overflow-hidden rounded-2xl bg-[linear-gradient(135deg,rgba(15,23,42,0.88),rgba(2,6,23,0.96))] ring-1 ring-border dark:ring-white/[0.025] hover:bg-brand-400/[0.04] hover:ring-1 hover:ring-brand-300/20 focus-within:border-brand-300/40 focus-within:ring-2 focus-within:ring-brand-300/25 focus-within:shadow-[0_0_34px_rgba(245,158,11,0.16)]',
                              isOverdue && 'border-destructive/35 bg-[linear-gradient(135deg,rgba(127,29,29,0.20),rgba(2,6,23,0.88))] hover:bg-destructive/[0.055]',
                              isDueToday && !isOverdue && 'border-brand-300/35 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(2,6,23,0.88))] hover:bg-brand-400/[0.075]',
                              isWeekPlanningReminder && 'border-brand-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(2,6,23,0.90))] hover:bg-brand-400/[0.055]',
                              isMonthPlanningReminder && 'border-success/25 bg-[linear-gradient(135deg,rgba(20,184,166,0.11),rgba(2,6,23,0.88))] hover:bg-success/[0.055]',
                            )}
                            onClick={() => handleReminderClick(reminder)}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleReminderClick(reminder);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label={`Open reminder ${reminder.title} for ${reminder.client_name}`}
                          >
                            <div className={cn(
                              'pointer-events-none absolute inset-y-0 left-0 w-1 transition-all duration-200',
                              isOverdue
                                ? 'bg-destructive/45 group-hover:bg-destructive/90 group-hover:shadow-[0_0_18px_rgba(248,113,113,0.45)]'
                                : isDueToday
                                  ? 'bg-brand-300/55 group-hover:bg-brand-300 group-hover:shadow-[0_0_18px_rgba(245,158,11,0.55)]'
                                  : isWeekPlanningReminder
                                    ? 'bg-brand-300/35 group-hover:bg-brand-300/85 group-hover:shadow-[0_0_18px_rgba(245,158,11,0.38)]'
                                    : isMonthPlanningReminder
                                      ? 'bg-success/35 group-hover:bg-success/85 group-hover:shadow-[0_0_18px_rgba(45,212,191,0.35)]'
                                : 'bg-brand-300/0 group-hover:bg-brand-300/80 group-hover:shadow-[0_0_18px_rgba(245,158,11,0.45)]'
                            )} />
                            <CardContent className="p-3.5 sm:p-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-3">
                                {/* Source Icon */}
                                <div className={cn(
                                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border dark:border-white/10 shadow-inner ring-1 ring-border dark:ring-white/5 transition-all duration-200 group-hover:scale-105 group-hover:border-brand-300/35 group-hover:bg-brand-400/10 group-hover:shadow-[0_0_22px_rgba(245,158,11,0.16)] sm:mt-0.5',
                                  isOverdue ? 'bg-destructive/15 text-destructive' : reminder.status === 'completed' ? 'bg-success/12 text-success' : 'bg-card/5 dark:bg-white/5',
                                  !isOverdue && SOURCE_COLORS[reminder.source]
                                )}>
                                  {TYPE_ICONS[reminder.reminder_type] || SOURCE_ICONS[reminder.source]}
                                </div>

                                {/* Content */}
                                <div className="min-w-0 flex-1 space-y-2">
                                  <div className="flex flex-wrap items-start gap-2">
                                    <span className={cn(
                                      'min-w-0 max-w-full break-words text-[15px] font-semibold leading-5 tracking-[-0.01em] text-foreground transition-colors duration-200 group-hover:text-white sm:text-base sm:leading-6',
                                      reminder.status === 'completed' && 'text-success-foreground'
                                    )}>
                                      {reminder.title}
                                    </span>
                                    <Badge className={cn('h-6 shrink-0 rounded-full border px-2.5 py-0 text-[10px] font-semibold uppercase tracking-[0.12em] transition-all duration-200 group-hover:shadow-[0_0_18px_rgba(245,158,11,0.16)]', priorityCfg.color)}>
                                      {priorityCfg.label}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground dark:text-muted-foreground">
                                    <span className="max-w-full truncate rounded-full border border-border dark:border-white/10 bg-background dark:bg-black/20 px-2 py-0.5 font-medium text-foreground dark:text-foreground sm:max-w-[220px]">{reminder.client_name}</span>
                                    <span className="hidden text-brand-300/35 min-[420px]:inline">•</span>
                                    <span className="inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-full border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:text-foreground">
                                      {TYPE_ICONS[reminder.reminder_type] ?? SOURCE_ICONS[reminder.source]}
                                      <span className="truncate">
                                        {AML_REMINDER_LABELS[reminder.reminder_type] ?? reminder.source_label}
                                      </span>
                                    </span>
                                    {reminder.description && (
                                      <>
                                        <span className="hidden text-brand-300/35 min-[420px]:inline">•</span>
                                        <span className="max-w-full truncate rounded-full border border-brand-300/10 bg-brand-400/[0.04] px-2 py-0.5 text-muted-foreground dark:text-muted-foreground sm:max-w-[320px]">{reminder.description}</span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {/* Date */}
                                <div className={cn(
                                  'flex w-full min-w-0 shrink-0 items-center justify-between gap-3 rounded-2xl border bg-background dark:bg-black/35 px-3 py-2 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_26px_rgba(0,0,0,0.18)] sm:ml-auto sm:block sm:w-auto sm:min-w-[96px] sm:text-right',
                                  isOverdue
                                    ? 'border-destructive/20 bg-destructive/10'
                                    : isDueToday
                                      ? 'border-brand-300/25 bg-brand-400/10'
                                      : isWeekPlanningReminder
                                        ? 'border-brand-300/20 bg-brand-400/10'
                                        : isMonthPlanningReminder
                                          ? 'border-success/20 bg-success/10'
                                      : 'border-border dark:border-white/10'
                                )}>
                                  <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:mb-1">Due</p>
                                  <p className={cn(
                                    'text-[11px] font-semibold sm:text-xs',
                                    isOverdue ? 'text-destructive' : isDueToday ? 'text-brand-200' : reminder.status === 'completed' ? 'text-success' : 'text-muted-foreground dark:text-foreground'
                                  )}>
                                    {isOverdue
                                      ? `${Math.abs(daysUntil)}d overdue`
                                      : isToday(new Date(reminder.due_date))
                                        ? 'Today'
                                        : isTomorrow(new Date(reminder.due_date))
                                          ? 'Tomorrow'
                                          : format(new Date(reminder.due_date), 'dd MMM')
                                    }
                                  </p>
                                  <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                    {format(new Date(reminder.due_date), 'EEE')}
                                  </p>
                                </div>

                                {/* Actions */}
                                <ReminderActions
                                  reminderId={reminder.id}
                                  rawId={reminder.raw_id}
                                  title={reminder.title}
                                  description={reminder.description}
                                  dueDate={reminder.due_date}
                                  priority={reminder.priority}
                                  source={reminder.source}
                                  canEdit={canEditReminders}
                                  canDelete={canDeleteReminders}
                                />
                              </div>
                            </CardContent>
                          </Card>
                        );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="team">
          <TeamRemindersSection />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
