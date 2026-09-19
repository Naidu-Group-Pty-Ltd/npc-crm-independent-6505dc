import { useState, useMemo } from 'react';
import { useAssignedTasks, type AssignedTask } from '@/hooks/useAssignedTasks';
import { Card, CardContent } from '@/components/ui/card';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SearchField } from '@/components/ui/search-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useGamePlanMutations } from '@/hooks/useGamePlans';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { format, isToday, isTomorrow, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  Map,
  Bell,
  ListChecks,
  Filter,
  Loader2,
} from 'lucide-react';

type StatusFilter = 'all' | 'pending' | 'overdue' | 'completed';
type SourceFilter = 'all' | 'game_plan' | 'reminder';

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; badgeClass: string; label: string }> = {
  pending: {
    icon: Clock,
    color: 'text-warning',
    badgeClass: 'border-warning/35 bg-warning/10 text-warning',
    label: 'Pending',
  },
  in_progress: {
    icon: Clock,
    color: 'text-info',
    badgeClass: 'border-info/35 bg-info/10 text-info',
    label: 'In Progress',
  },
  overdue: {
    icon: AlertTriangle,
    color: 'text-destructive',
    badgeClass: 'border-destructive/35 bg-destructive/10 text-destructive',
    label: 'Overdue',
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-success',
    badgeClass: 'border-success/35 bg-success/10 text-success',
    label: 'Completed',
  },
};

const SOURCE_CONFIG: Record<string, { icon: typeof Map; color: string; label: string }> = {
  game_plan: { icon: Map, color: 'bg-primary/10 text-primary border-primary/20', label: 'Game Plan' },
  reminder: { icon: Bell, color: 'bg-warning/10 text-warning border-warning/20', label: 'Reminder' },
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-destructive/10 text-destructive border-destructive/20',
  high: 'bg-warning/10 text-warning border-warning/20',
  medium: 'bg-info/10 text-info border-info/20',
  low: 'bg-muted text-muted-foreground border-border',
};

function formatDueDate(date: string | null) {
  if (!date) return null;
  const d = new Date(date);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  const diff = differenceInDays(d, new Date());
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff <= 7) return `${diff}d left`;
  return format(d, 'dd MMM yyyy');
}

export function AssignedTasksTab() {
  const { data: tasks = [], isLoading, refetch } = useAssignedTasks();
  const { actions: actionMut } = useGamePlanMutations();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let result = [...tasks];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.sourceContext?.toLowerCase().includes(q)
      );
    }
    if (statusFilter === 'pending') result = result.filter((t) => t.status === 'pending' || t.status === 'in_progress');
    else if (statusFilter !== 'all') result = result.filter((t) => t.status === statusFilter);
    if (sourceFilter !== 'all') result = result.filter((t) => t.source === sourceFilter);
    return result;
  }, [tasks, search, statusFilter, sourceFilter]);

  const counts = useMemo(() => {
    const c = { total: tasks.length, pending: 0, overdue: 0, completed: 0 };
    tasks.forEach((t) => {
      if (t.status === 'overdue') c.overdue++;
      else if (t.status === 'completed') c.completed++;
      else c.pending++;
    });
    return c;
  }, [tasks]);

  const handleToggleComplete = async (task: AssignedTask) => {
    const toggleKey = task.id;
    setTogglingIds((prev) => new Set(prev).add(toggleKey));
    try {
      if (task.source === 'game_plan') {
        const rawId = task.rawRecord.id;
        const newDone = !task.rawRecord.is_done;
        await actionMut.update.mutateAsync({
          id: rawId,
          is_done: newDone,
          completed_at: newDone ? new Date().toISOString() : null,
        });
      } else if (task.source === 'reminder') {
        const rawId = task.rawRecord.id;
        const newStatus = task.rawRecord.status === 'completed' ? 'pending' : 'completed';
        await invokeSecureFunction('manage-templates', {
          operation: 'update',
          table: 'client_reminders',
          recordId: rawId,
          data: {
            status: newStatus,
            completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
          },
        });
      }
      toast.success(task.status === 'completed' ? 'Task reopened' : 'Task completed');
      refetch();
    } catch {
      toast.error('Failed to update task');
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(toggleKey);
        return next;
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading assigned tasks">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="overflow-hidden border-primary/10 bg-card/70 shadow-lg shadow-sm dark:shadow-black/5 dark:bg-background/40 dark:shadow-black/20" aria-hidden="true">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="h-5 w-5 rounded-md bg-muted" />
              <div className="flex-1 space-y-3">
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="flex gap-2">
                  <div className="h-5 w-20 rounded-full bg-muted" />
                  <div className="h-5 w-24 rounded-full bg-muted" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Total Assigned', value: counts.total, icon: ListChecks, color: 'text-foreground' },
          { label: 'Pending', value: counts.pending, icon: Clock, color: 'text-warning' },
          { label: 'Overdue', value: counts.overdue, icon: AlertTriangle, color: 'text-destructive' },
          { label: 'Completed', value: counts.completed, icon: CheckCircle2, color: 'text-success' },
        ].map((stat) => (
          <DashboardThemeFrame key={stat.label} variant="card" className="p-3 shadow-lg shadow-sm dark:shadow-black/5 dark:shadow-black/20">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70 dark:border-white/10 dark:bg-background/45">
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{stat.value}</p>
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </DashboardThemeFrame>
        ))}
      </div>

      {/* Filters */}
      <DashboardThemeFrame variant="toolbar" className="flex-col gap-2 border-primary/10 bg-card/55 p-2 dark:bg-background/35 sm:flex-row">
        <SearchField
          wrapperClassName="flex-1"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search assigned tasks"
          className="h-10 rounded-xl bg-background/70 focus-visible:ring-primary/35"
        />
        <Select value={statusFilter} onValueChange={(v: StatusFilter) => setStatusFilter(v)}>
          <SelectTrigger className="h-10 w-full rounded-xl bg-background/70 focus:ring-primary/35 sm:w-[150px]" aria-label="Filter assigned tasks by status">
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(v: SourceFilter) => setSourceFilter(v)}>
          <SelectTrigger className="h-10 w-full rounded-xl bg-background/70 focus:ring-primary/35 sm:w-[150px]" aria-label="Filter assigned tasks by source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="game_plan">Game Plans</SelectItem>
            <SelectItem value="reminder">Reminders</SelectItem>
          </SelectContent>
        </Select>
      </DashboardThemeFrame>

      {/* Task List */}
      {filtered.length === 0 ? (
        <Card className="border-dashed border-primary/20 bg-card/60 shadow-lg shadow-sm dark:shadow-black/5 dark:bg-background/35 dark:shadow-black/20" role="status">
          <CardContent className="flex flex-col items-center justify-center space-y-3 py-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-inner shadow-primary/10">
              <ListChecks className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-1 text-center">
              <h3 className="font-semibold text-foreground">No assigned tasks</h3>
              <p className="text-sm text-muted-foreground">
                {tasks.length > 0
                  ? 'No tasks match your current filters.'
                  : 'Tasks assigned to you from Game Plans and Reminders will appear here.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5" role="list" aria-label="Assigned tasks">
          {filtered.map((task) => {
            const statusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            const sourceCfg = SOURCE_CONFIG[task.source];
            const StatusIcon = statusCfg.icon;
            const SourceIcon = sourceCfg.icon;
            const isToggling = togglingIds.has(task.id);
            const dueDateLabel = formatDueDate(task.dueDate);

            return (
              <Card
                key={task.id}
                role="listitem"
                className={cn(
                  'group overflow-hidden border-border/60 bg-[linear-gradient(145deg,hsl(var(--card)/0.94),hsl(var(--muted)/0.14))] shadow-md shadow-sm dark:shadow-black/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-xl hover:shadow-primary/10 focus-within:border-primary/25 focus-within:shadow-xl focus-within:shadow-primary/10 motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:border-white/10 dark:bg-background/55 dark:shadow-black/20',
                  task.status === 'overdue' && 'border-destructive/30 bg-destructive/5',
                  task.status === 'completed' && 'opacity-70'
                )}
              >
                <CardContent className="relative flex items-start gap-3 p-3 sm:p-4">
                  <div className={cn('absolute inset-y-3 left-0 w-1 rounded-r-full bg-primary/30 opacity-0 transition-opacity group-hover:opacity-100', task.status === 'overdue' && 'bg-destructive/60 opacity-100')} />

                  {/* Completion toggle */}
                  <div className="pt-1">
                    {isToggling ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Checkbox
                        checked={task.status === 'completed'}
                        onCheckedChange={() => handleToggleComplete(task)}
                        aria-label={`${task.status === 'completed' ? 'Reopen' : 'Complete'} task ${task.title}`}
                        className="h-5 w-5 rounded-md border-primary/30 focus-visible:ring-primary/35"
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={cn(
                          'text-sm font-semibold leading-snug text-foreground',
                          task.status === 'completed' && 'line-through text-muted-foreground'
                        )}
                      >
                        {task.title}
                      </p>
                      <Badge variant="outline" className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', statusCfg.badgeClass)}>
                        <StatusIcon className={`mr-1 h-3 w-3 ${statusCfg.color}`} />
                        {statusCfg.label}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={`h-5 px-1.5 py-0 text-[10px] ${sourceCfg.color}`}>
                        <SourceIcon className="mr-1 h-3 w-3" />
                        {sourceCfg.label}
                      </Badge>
                      {task.priority && (
                        <Badge variant="outline" className={`h-5 px-1.5 py-0 text-[10px] ${PRIORITY_COLORS[task.priority] || ''}`}>
                          {task.priority}
                        </Badge>
                      )}
                      {task.sourceContext && (
                        <span className="max-w-full truncate break-words rounded-full bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground sm:max-w-[320px]">
                          {task.sourceContext}
                        </span>
                      )}
                    </div>

                    {dueDateLabel && (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        <span
                          className={cn(
                            'text-[11px] text-muted-foreground',
                            task.status === 'overdue' && 'font-semibold text-destructive'
                          )}
                        >
                          {dueDateLabel}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
