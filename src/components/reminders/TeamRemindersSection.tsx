import { useMemo, useState } from 'react';
import { format, isPast, isToday, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  REMINDER_TIME_BUCKETS,
  countByBucket,
  matchesTimeBucket,
  type ReminderTimeBucket,
} from '@/lib/reminders/timeBucket.pure';
import {
  Bell,
  Plus,
  Check,
  Clock,
  Calendar as CalendarIcon,
  Users,
  Loader2,
  X,
  Pencil,
  UserCircle,
  AlarmClock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { MultiTeamUserSelect } from '@/components/ui/MultiTeamUserSelect';
import { ClientSearchSelect } from '@/components/ui/ClientSearchSelect';
import { useTeamUsers } from '@/hooks/useTeamUsers';
import {
  useTeamReminders,
  useCreateTeamReminder,
  useCompleteTeamReminder,
  useDeleteTeamReminder,
} from '@/hooks/useTeamReminders';
import { useUpdateReminder, useSnoozeReminder, type SnoozeDuration } from '@/hooks/useUpdateReminder';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { VoiceToTextButton } from '@/components/ui/VoiceToTextButton';

const priorityColors: Record<string, string> = {
  low: 'bg-success/10 text-success border-success/30 shadow-[0_0_14px_rgba(16,185,129,0.10)]',
  medium: 'bg-brand-500/15 text-brand-200 border-brand-300/35 shadow-[0_0_14px_rgba(245,158,11,0.12)]',
  high: 'bg-warning/15 text-warning border-warning/35 shadow-[0_0_14px_rgba(249,115,22,0.12)]',
  urgent: 'bg-destructive/15 text-destructive border-destructive/40 shadow-[0_0_14px_rgba(248,113,113,0.14)]',
};


const premiumTeamPanel = 'relative overflow-hidden rounded-[1.5rem] border border-brand-300/15 bg-[linear-gradient(135deg,rgba(15,23,42,0.84),rgba(2,6,23,0.94))] shadow-[0_22px_70px_rgba(0,0,0,0.32)] backdrop-blur';
const premiumTeamInput = 'rounded-xl border-brand-300/15 bg-background dark:bg-black/40 text-foreground dark:text-foreground placeholder:text-muted-foreground shadow-inner transition-all duration-200 hover:border-brand-300/35 focus-visible:border-brand-300/60 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black';

const reminderTypes = [
  { value: 'task', label: 'Task' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'admin', label: 'Admin' },
  { value: 'other', label: 'Other' },
];

export function TeamRemindersSection() {
  const { data: reminders = [], isLoading } = useTeamReminders();
  const { data: teamUsers = [] } = useTeamUsers();
  const createMutation = useCreateTeamReminder();
  const completeMutation = useCompleteTeamReminder();
  const deleteMutation = useDeleteTeamReminder();
  const updateMutation = useUpdateReminder();
  const snoozeMutation = useSnoozeReminder();
  const { user } = useAuth();

  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<string>('medium');
  const [reminderType, setReminderType] = useState('task');
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);

  // Edit state — full parity with the client reminder editor: title,
  // priority, assignees, AND the due date/time and notes.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editAssigned, setEditAssigned] = useState<string[]>([]);
  const [editDueDate, setEditDueDate] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Filters — the client tab has a filter bar and this tab had none.
  const [filterSearch, setFilterSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  // The chip row the client tab leads with. Its absence is what the audit
  // reported twice: this tab draws "Overdue" in red on its own rows and had no
  // way to show only those.
  const [filterTime, setFilterTime] = useState<ReminderTimeBucket>('all');

  // Snooze state
  const [snoozeId, setSnoozeId] = useState<string | null>(null);
  const [customSnoozeDate, setCustomSnoozeDate] = useState<Date | undefined>();

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDueDate('');
    setPriority('medium');
    setReminderType('task');
    setAssignedTo([]);
    setClientId(null);
    setShowAdd(false);
  };

  const handleCreate = () => {
    createMutation.mutate(
      {
        title,
        description: description || undefined,
        due_date: new Date(dueDate).toISOString(),
        priority,
        reminder_type: reminderType,
        assigned_to: assignedTo,
        created_by: user?.id,
      },
      {
        onSuccess: () => {
          toast.success('Team reminder created');
          resetForm();
        },
        onError: (err: any) => toast.error('Failed: ' + err.message),
      }
    );
  };

  const startEdit = (reminder: any) => {
    setEditingId(reminder.id);
    setEditTitle(reminder.title);
    setEditPriority(reminder.priority || 'medium');
    setEditAssigned(reminder.assigned_to || []);
    setEditDueDate(reminder.due_date ? format(new Date(reminder.due_date), "yyyy-MM-dd'T'HH:mm") : '');
    setEditDescription(reminder.description || '');
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    updateMutation.mutate(
      {
        id: editingId,
        title: editTitle,
        priority: editPriority,
        assigned_to: editAssigned,
        ...(editDueDate ? { due_date: new Date(editDueDate).toISOString() } : {}),
        description: editDescription.trim() || undefined,
      },
      {
        onSuccess: () => { toast.success('Reminder updated'); setEditingId(null); },
        onError: (err: any) => toast.error(err.message),
      },
    );
  };

  // One clock for the whole render, so a chip's count and the list it filters
  // to cannot be computed a millisecond either side of midnight.
  const filterNow = useMemo(() => new Date(), [reminders]);
  const bucketCounts = useMemo(
    () => countByBucket(reminders.map((r) => new Date(r.due_date)), filterNow),
    [reminders, filterNow],
  );

  const visibleReminders = reminders.filter((r) => {
    if (!matchesTimeBucket(new Date(r.due_date), filterTime, filterNow)) return false;
    if (filterPriority !== 'all' && (r.priority || 'medium') !== filterPriority) return false;
    if (filterType !== 'all' && r.reminder_type !== filterType) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      const inTitle = r.title?.toLowerCase().includes(q);
      const inDescription = r.description?.toLowerCase().includes(q);
      if (!inTitle && !inDescription) return false;
    }
    return true;
  });

  const handleSnooze = (id: string, duration: SnoozeDuration, customDate?: Date) => {
    snoozeMutation.mutate(
      { id, duration, customDate },
      {
        onSuccess: () => {
          const labels: Record<string, string> = {
            '1h': '1 hour', '1d': 'tomorrow', '3d': '3 days', '1w': '1 week',
            custom: customDate ? format(customDate, 'MMM d') : 'custom date',
          };
          toast.success(`Snoozed until ${labels[duration]}`);
          setSnoozeId(null);
          setCustomSnoozeDate(undefined);
        },
        onError: (err: any) => toast.error(err.message),
      },
    );
  };

  const getDueStatus = (date: string) => {
    const d = new Date(date);
    if (isPast(d) && !isToday(d)) return { label: 'Overdue', className: 'text-destructive' };
    if (isToday(d)) return { label: 'Today', className: 'text-brand-200' };
    return { label: formatDistanceToNow(d, { addSuffix: true }), className: 'text-muted-foreground dark:text-muted-foreground' };
  };

  const getAssigneeNames = (ids: string[] | null) => {
    if (!ids || ids.length === 0) return 'Unassigned';
    return ids
      .map(id => teamUsers.find(u => u.id === id)?.username || 'Unknown')
      .join(', ');
  };

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden text-foreground dark:text-foreground">
      {/* Add Button / Form */}
      {showAdd ? (
        <Card className={cn(premiumTeamPanel, 'border-brand-300/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(2,6,23,0.92)_42%,rgba(0,0,0,0.72))]')}>
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/65 to-transparent" />
          <div className="pointer-events-none absolute -right-14 -top-20 h-40 w-40 rounded-full bg-brand-300/10 blur-3xl" />
          <CardHeader className="relative pb-3">
            <CardTitle className="flex items-center gap-3 text-sm font-semibold text-foreground dark:text-foreground">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-400/10 text-brand-100 shadow-[0_0_26px_rgba(245,158,11,0.14)]">
                <Users className="h-4 w-4" />
              </span>
              New Team Reminder
            </CardTitle>
          </CardHeader>
          <CardContent className="relative space-y-3">
            <Input
              placeholder="Reminder title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={cn("h-11", premiumTeamInput)}
            />
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted-foreground dark:text-muted-foreground font-medium">Description</label>
              <VoiceToTextButton
                size="sm"
                onTranscript={(text) => setDescription(prev => prev ? `${prev} ${text}` : text)}
              />
            </div>
            <Textarea
              placeholder="Description (optional)..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={cn("min-h-[82px]", premiumTeamInput)}
            />

            {/* Optional client link */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground dark:text-muted-foreground font-medium">Link to Client (optional)</label>
              <ClientSearchSelect
                value={clientId}
                onValueChange={(id) => setClientId(id)}
                placeholder="Search and link a client..."
                allowNone
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground dark:text-muted-foreground">Due Date</label>
                <Input
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={cn("h-11", premiumTeamInput)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground dark:text-muted-foreground">Type</label>
                <Select value={reminderType} onValueChange={setReminderType}>
                  <SelectTrigger className={cn("h-11", premiumTeamInput)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reminderTypes.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground dark:text-muted-foreground">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className={cn("h-11", premiumTeamInput)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground dark:text-muted-foreground">Assign To</label>
              <MultiTeamUserSelect
                value={assignedTo}
                onValueChange={setAssignedTo}
                placeholder="Select team members..."
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                onClick={handleCreate}
                disabled={!title.trim() || !dueDate || createMutation.isPending}
                className="h-11 flex-1 rounded-xl border border-brand-200/40 bg-[linear-gradient(135deg,#fbbf24,#d97706)] font-semibold text-black shadow-[0_0_30px_rgba(245,158,11,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_42px_rgba(245,158,11,0.36)] disabled:translate-y-0 disabled:opacity-60"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Team Reminder
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={resetForm} className="h-11 rounded-xl border-border/70 bg-background dark:bg-black/25 px-5 font-semibold text-foreground dark:text-foreground transition-all duration-200 hover:border-brand-300/35 hover:bg-brand-400/10 hover:text-brand-100 sm:w-auto">Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button
            aria-label="Add a new team reminder"
            onClick={() => setShowAdd(true)}
            variant="outline"
            className="group h-11 w-full shrink-0 gap-2 rounded-xl border-brand-300/40 bg-brand-400/10 px-4 text-sm font-semibold text-brand-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all duration-200 hover:border-brand-200/60 hover:bg-brand-400/18 hover:text-brand-50 hover:shadow-[0_0_24px_rgba(245,158,11,0.18)] focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:h-12 sm:w-auto"
          >
            <Plus className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90" />
            <span>New Team Reminder</span>
          </Button>
        </div>
      )}




      {/* Filters — mirrors the client tab's bar */}
      {!isLoading && reminders.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-brand-300/15 bg-background/60 p-2.5 dark:bg-black/30">
          {/* The time buckets, drawn from the same list and judged by the same
              predicate as the client tab — see `timeBucket.pure`. A count is
              shown only where there is something to see, so an empty bucket
              reads as empty rather than as a nought nobody asked for. */}
          <div
            role="group"
            aria-label="Filter team reminders by when they are due"
            className="flex min-w-0 flex-wrap items-center gap-1.5"
          >
            {REMINDER_TIME_BUCKETS.map((bucket) => {
              const active = filterTime === bucket.value;
              const count = bucketCounts[bucket.value];
              return (
                <Button
                  key={bucket.value}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={active}
                  onClick={() => setFilterTime(bucket.value)}
                  className={cn(
                    'h-9 shrink-0 gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-all',
                    active
                      ? 'border-brand-300/45 bg-brand-400/15 text-brand-100'
                      : 'border-brand-400/15 bg-background/40 text-muted-foreground hover:border-brand-300/30 hover:bg-brand-400/10 hover:text-brand-100 dark:bg-black/30',
                  )}
                >
                  {bucket.label}
                  {count > 0 && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-4 rounded-full px-1 text-[9px] font-semibold',
                        bucket.value === 'overdue'
                          ? 'border-destructive/35 text-destructive'
                          : 'border-brand-300/30 text-brand-100',
                      )}
                    >
                      {count}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Search team reminders..."
            aria-label="Search team reminders"
            className={cn('h-10 flex-1', premiumTeamInput)}
          />
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger aria-label="Filter team reminders by priority" className={cn('h-10 w-full sm:w-[150px]', premiumTeamInput)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger aria-label="Filter team reminders by type" className={cn('h-10 w-full sm:w-[150px]', premiumTeamInput)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {reminderTypes.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <Card className="relative overflow-hidden rounded-[1.5rem] border border-brand-300/15 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(2,6,23,0.84)_46%,rgba(0,0,0,0.62))] shadow-[0_22px_70px_rgba(0,0,0,0.30)]">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
          <CardContent className="relative flex items-center justify-center gap-3 px-5 py-10 text-center sm:py-12">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-400/10 text-brand-100 shadow-[0_0_28px_rgba(245,158,11,0.14)]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-foreground dark:text-foreground">Loading team reminders</p>
              <p className="text-xs text-muted-foreground">Checking internal tasks and team coordination items.</p>
            </div>
          </CardContent>
        </Card>
      ) : reminders.length === 0 ? (
        <Card className="relative overflow-hidden rounded-[1.5rem] border-dashed border-brand-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(2,6,23,0.84)_46%,rgba(0,0,0,0.62))] shadow-[0_22px_70px_rgba(0,0,0,0.30)]">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
          <div className="pointer-events-none absolute -right-12 -top-16 h-36 w-36 rounded-full bg-brand-300/8 blur-3xl" />
          <div className="pointer-events-none absolute -left-12 bottom-0 h-32 w-32 rounded-full bg-success/6 blur-3xl" />
          <CardContent className="relative flex flex-col items-center justify-center px-5 py-12 text-center sm:px-8 sm:py-14">
            <div className="mb-4 rounded-[1.4rem] border border-border dark:border-white/10 bg-background dark:bg-black/20 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(16,185,129,0.08))] text-brand-100 shadow-[0_0_32px_rgba(245,158,11,0.14)]">
                <Users className="h-7 w-7" />
              </div>
            </div>
            <div className="max-w-md space-y-2">
              <p className="text-base font-semibold tracking-tight text-foreground dark:text-foreground sm:text-lg">No team reminders yet</p>
              <p className="text-xs leading-5 text-muted-foreground sm:text-sm">Create reminders for internal tasks and team coordination</p>
            </div>
          </CardContent>
        </Card>
      ) : visibleReminders.length === 0 ? (
        <Card className="relative overflow-hidden rounded-[1.5rem] border-dashed border-brand-300/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),rgba(2,6,23,0.84)_46%,rgba(0,0,0,0.62))] shadow-[0_22px_70px_rgba(0,0,0,0.30)]">
          <CardContent className="relative px-5 py-10 text-center text-sm text-muted-foreground">
            No team reminders match the current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="min-w-0 space-y-1.5">
          {visibleReminders.map(reminder => {
            const dueStatus = getDueStatus(reminder.due_date);
            const isOverdue = isPast(new Date(reminder.due_date)) && !isToday(new Date(reminder.due_date));
            const isEditing = editingId === reminder.id;
            const isSnoozing = snoozeId === reminder.id;

            return (
              <Card
                key={reminder.id}
                className={cn(
                  premiumTeamPanel,
                  'group ring-1 ring-border dark:ring-white/[0.025] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/30 hover:bg-brand-400/[0.04] hover:shadow-[0_20px_50px_rgba(245,158,11,0.11),0_14px_34px_rgba(0,0,0,0.28)] focus-within:border-brand-300/40',
                  isOverdue && 'border-destructive/35 bg-[linear-gradient(135deg,rgba(127,29,29,0.20),rgba(2,6,23,0.88))]',
                  isToday(new Date(reminder.due_date)) && !isOverdue && 'border-brand-300/35 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(2,6,23,0.88))]',
                )}
              >
                <div className={cn("pointer-events-none absolute inset-y-0 left-0 w-1 transition-all duration-200", isOverdue ? "bg-destructive/55 group-hover:bg-destructive/30" : isToday(new Date(reminder.due_date)) ? "bg-brand-300/55 group-hover:bg-brand-300" : "bg-brand-300/0 group-hover:bg-brand-300/80")} />
                <CardContent className="relative p-3.5 sm:p-4">
                  <div className="flex items-start gap-2.5">
                    <div className={cn(
                      'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border dark:border-white/10 shadow-inner ring-1 ring-border dark:ring-white/5 transition-all duration-200 group-hover:scale-105 group-hover:border-brand-300/35 group-hover:bg-brand-400/10 group-hover:shadow-[0_0_22px_rgba(245,158,11,0.16)]',
                      isOverdue ? 'bg-destructive/15 text-destructive' : isToday(new Date(reminder.due_date)) ? 'bg-brand-400/15 text-brand-200' : 'bg-card/5 dark:bg-white/5 text-brand-100'
                    )}>
                      <Users className="h-3.5 w-3.5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground transition-colors duration-200 group-hover:text-white sm:text-base">{reminder.title}</span>
                        <Badge className={cn('h-6 shrink-0 rounded-full border px-2.5 py-0 text-[10px] font-semibold uppercase tracking-[0.12em]', priorityColors[reminder.priority] || '')}>
                          {reminder.priority}
                        </Badge>
                      </div>
                      {reminder.description && (
                        <p className="text-[10px] text-muted-foreground dark:text-muted-foreground mt-0.5 truncate">{reminder.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <div className="flex items-center gap-1">
                          <CalendarIcon className="h-3 w-3 text-muted-foreground dark:text-muted-foreground" />
                          <span className={cn('text-[10px]', dueStatus.className)}>
                            {format(new Date(reminder.due_date), 'MMM d, yyyy h:mm a')} · {dueStatus.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <UserCircle className="h-3 w-3 text-muted-foreground dark:text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground dark:text-muted-foreground">
                            {getAssigneeNames(reminder.assigned_to)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action buttons — always visible on mobile, hover on desktop */}
                    <div className="flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg hover:bg-brand-400/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                        title="Snooze"
                        onClick={() => setSnoozeId(isSnoozing ? null : reminder.id)}
                      >
                        <AlarmClock className="h-3.5 w-3.5 text-muted-foreground dark:text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg hover:bg-brand-400/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                        title="Edit"
                        onClick={() => isEditing ? setEditingId(null) : startEdit(reminder)}
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground dark:text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg hover:bg-brand-400/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                        title="Complete"
                        disabled={completeMutation.isPending}
                        onClick={() => {
                          completeMutation.mutate(reminder.id, {
                            onSuccess: () => toast.success('Reminder completed'),
                            onError: (err: any) => toast.error(err.message),
                          });
                        }}
                      >
                        {completeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-success" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg hover:bg-brand-400/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                        title="Delete"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          deleteMutation.mutate(reminder.id, {
                            onSuccess: () => toast.success('Reminder deleted'),
                            onError: (err: any) => toast.error(err.message),
                          });
                        }}
                      >
                        {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5 text-destructive" />}
                      </Button>
                    </div>
                  </div>

                  {/* Inline Edit Panel */}
                  {isEditing && (
                    <div className="mt-3 space-y-2 rounded-2xl border border-brand-300/15 bg-background dark:bg-black/35 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className={cn("h-9 text-sm", premiumTeamInput)}
                        placeholder="Reminder title"
                      />
                      <Textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={2}
                        className={cn('min-h-[64px] text-sm', premiumTeamInput)}
                        placeholder="Notes (optional)..."
                        aria-label="Edit reminder notes"
                      />
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">Due date &amp; time</label>
                        <Input
                          type="datetime-local"
                          value={editDueDate}
                          onChange={(e) => setEditDueDate(e.target.value)}
                          className={cn('h-9 text-sm', premiumTeamInput)}
                          aria-label="Edit reminder due date and time"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Select value={editPriority} onValueChange={setEditPriority}>
                          <SelectTrigger className={cn("h-9 text-xs", premiumTeamInput)}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                        <MultiTeamUserSelect
                          value={editAssigned}
                          onValueChange={setEditAssigned}
                          placeholder="Assign..."
                        />
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" className="h-8 flex-1 rounded-lg bg-brand-400 text-xs font-semibold text-black hover:bg-brand-300" onClick={handleSaveEdit} disabled={!editTitle.trim() || updateMutation.isPending}>
                          {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 rounded-lg border-border/70 bg-background dark:bg-black/25 text-xs text-foreground dark:text-foreground hover:border-brand-300/35 hover:bg-brand-400/10 hover:text-brand-100" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {/* Inline Snooze Panel */}
                  {isSnoozing && (
                    <div className="mt-3 space-y-2 rounded-2xl border border-brand-300/15 bg-background dark:bg-black/35 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <p className="text-xs font-medium text-muted-foreground dark:text-muted-foreground flex items-center gap-1.5">
                        <AlarmClock className="h-3.5 w-3.5" />
                        Snooze until...
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {([
                          { d: '1h' as SnoozeDuration, label: '+1 Hour' },
                          { d: '1d' as SnoozeDuration, label: 'Tomorrow' },
                          { d: '3d' as SnoozeDuration, label: '+3 Days' },
                          { d: '1w' as SnoozeDuration, label: '+1 Week' },
                        ]).map(({ d, label }) => (
                          <Button
                            key={d}
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg border-brand-300/15 bg-background dark:bg-black/25 text-xs text-foreground dark:text-foreground hover:border-brand-300/35 hover:bg-brand-400/10 hover:text-brand-100"
                            disabled={snoozeMutation.isPending}
                            onClick={() => handleSnooze(reminder.id, d)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 flex-1 justify-start gap-1.5 rounded-lg border-brand-300/15 bg-background dark:bg-black/25 text-xs text-foreground dark:text-foreground hover:border-brand-300/35 hover:bg-brand-400/10 hover:text-brand-100">
                              <CalendarIcon className="h-3 w-3" />
                              {customSnoozeDate ? format(customSnoozeDate, 'MMM d, yyyy') : 'Custom date...'}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto rounded-xl border-brand-300/20 bg-background dark:bg-background/95 p-0 text-foreground dark:text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45)]" align="start">
                            <Calendar
                              mode="single"
                              selected={customSnoozeDate}
                              onSelect={setCustomSnoozeDate}
                              disabled={(date) => date < new Date()}
                              initialFocus
                              className={cn("p-3 pointer-events-auto")}
                            />
                          </PopoverContent>
                        </Popover>
                        {customSnoozeDate && (
                          <Button
                            size="sm"
                            className="h-8 rounded-lg border-brand-300/15 bg-background dark:bg-black/25 text-xs text-foreground dark:text-foreground hover:border-brand-300/35 hover:bg-brand-400/10 hover:text-brand-100"
                            disabled={snoozeMutation.isPending}
                            onClick={() => handleSnooze(reminder.id, 'custom', customSnoozeDate)}
                          >
                            {snoozeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Set'}
                          </Button>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-full rounded-lg text-[10px] text-muted-foreground dark:text-muted-foreground hover:bg-brand-400/10 hover:text-brand-100"
                        onClick={() => { setSnoozeId(null); setCustomSnoozeDate(undefined); }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
