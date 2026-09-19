import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Bell, 
  ChevronRight, 
  AlertTriangle,
  Clock,
  User,
  Building2,
  Flag
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow, isWithinInterval, addDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useAllReminders } from '@/hooks/useAllReminders';

const sourceIcons: Record<string, typeof Bell> = {
  client_reminder: Bell,
  follow_up: User,
  deal_milestone: Building2,
};

const priorityConfig: Record<string, { color: string; label: string }> = {
  high: { color: 'text-destructive', label: 'High' },
  medium: { color: 'text-brand-500', label: 'Medium' },
  low: { color: 'text-muted-foreground', label: 'Low' },
};

function getDueBadge(dueDate: string) {
  const d = new Date(dueDate);
  const badgeClassName = "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-sm";
  if (isPast(d) && !isToday(d)) return <Badge variant="destructive" className={badgeClassName}>Overdue</Badge>;
  if (isToday(d)) return <Badge className={`${badgeClassName} bg-brand-500 text-foreground dark:text-white hover:bg-brand-500`}>Today</Badge>;
  if (isTomorrow(d)) return <Badge variant="secondary" className={`${badgeClassName} bg-info/10 text-info hover:bg-info/15 dark:text-info`}>Tomorrow</Badge>;
  if (isWithinInterval(d, { start: new Date(), end: addDays(new Date(), 7) }))
    return <Badge variant="secondary" className={`${badgeClassName} bg-primary/10 text-primary hover:bg-primary/15`}>This Week</Badge>;
  return <Badge variant="outline" className={`${badgeClassName} border-border/80 bg-background/70 text-muted-foreground`}>Upcoming</Badge>;
}

export function UpcomingRemindersWidget() {
  const navigate = useNavigate();
  const { data: reminders = [], isLoading } = useAllReminders();

  // Show top 8 pending reminders
  const visible = reminders.filter(r => r.status !== 'completed').slice(0, 8);
  const overdueCount = visible.filter(r => isPast(new Date(r.due_date)) && !isToday(new Date(r.due_date))).length;
  const todayCount = visible.filter(r => isToday(new Date(r.due_date))).length;

  if (isLoading) {
    return (
      <Card className="overflow-hidden border-border/70 bg-gradient-to-br from-card via-card to-muted/30 shadow-sm">
        <CardHeader className="border-b border-border/60 bg-muted/20 pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bell className="h-4 w-4" />
            </span>
            Upcoming Reminders
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-border/70 bg-gradient-to-br from-card via-card to-muted/30 shadow-sm ring-1 ring-black/[0.02] dark:ring-white/[0.04]">
      <CardHeader className="border-b border-border/60 bg-muted/20 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary shadow-inner">
              <Bell className="h-4 w-4" />
            </span>
            <span>Upcoming Reminders</span>
          </CardTitle>
          <div className="flex shrink-0 gap-2">
            {overdueCount > 0 && (
              <Badge variant="destructive" className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-sm">
                {overdueCount} Overdue
              </Badge>
            )}
            {todayCount > 0 && (
              <Badge className="rounded-full bg-brand-500 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground dark:text-white shadow-sm hover:bg-brand-500">
                {todayCount} Today
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 bg-background/60 px-4 py-8 text-center text-muted-foreground">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted/70">
              <Clock className="h-5 w-5 opacity-70" />
            </div>
            <p className="text-sm font-medium text-foreground">No upcoming reminders</p>
            <p className="mt-1 text-xs">When follow-ups are due, they will appear here for quick triage.</p>
          </div>
        ) : (
          <ScrollArea className="h-[228px] pr-1">
            <div className="space-y-3">
              {visible.map(reminder => {
                const isOverdue = isPast(new Date(reminder.due_date)) && !isToday(new Date(reminder.due_date));
                const SourceIcon = sourceIcons[reminder.source] || Bell;
                const priority = priorityConfig[reminder.priority] || priorityConfig.medium;

                const openReminder = () => {
                  if (reminder.client_id && reminder.source !== 'deal_milestone') {
                    navigate(`/clients?clientId=${reminder.client_id}`);
                  } else {
                    navigate('/reminders');
                  }
                };

                return (
                  <div
                    key={reminder.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open reminder ${reminder.title}`}
                    className="group flex min-h-16 cursor-pointer items-center justify-between rounded-2xl border border-border/70 bg-background/75 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-primary/[0.03] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
                    onClick={openReminder}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openReminder();
                      }
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className={`shrink-0 rounded-xl p-2.5 shadow-inner transition-colors ${isOverdue ? 'bg-destructive/10' : 'bg-muted/70 group-hover:bg-primary/10'}`}>
                        {isOverdue ? (
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        ) : (
                          <SourceIcon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-semibold leading-5 text-foreground">{reminder.title}</p>
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <span className="truncate">{reminder.client_name !== 'Unknown' ? reminder.client_name : reminder.source_label}</span>
                          {reminder.priority === 'high' && (
                            <>
                              <span className="text-border">•</span>
                              <span className={`${priority.color} inline-flex items-center gap-1`}><Flag className="h-3 w-3" /> {priority.label}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-3">
                      <div className="min-w-[94px] text-right">
                        {getDueBadge(reminder.due_date)}
                        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                          {format(new Date(reminder.due_date), 'dd MMM yyyy')}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
        <Button 
          variant="ghost"
          className="dashboard-luxury-primary-cta mt-4 min-h-10 w-full justify-center rounded-xl text-sm font-semibold transition-all duration-200 active:translate-y-0"
          size="sm"
          onClick={() => navigate('/reminders')}
        >
          View All Reminders
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
