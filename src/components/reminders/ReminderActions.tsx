import { useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Check,
  X,
  Pencil,
  Clock,
  AlarmClock,
  Loader2,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { MultiTeamUserSelect } from '@/components/ui/MultiTeamUserSelect';
import { useUpdateReminder, useSnoozeReminder, type SnoozeDuration } from '@/hooks/useUpdateReminder';
import { useCompleteTeamReminder, useDeleteTeamReminder } from '@/hooks/useTeamReminders';
import { toast } from 'sonner';

interface ReminderActionsProps {
  reminderId: string;
  rawId: string;
  title: string;
  description?: string | null;
  dueDate: string;
  priority: string;
  assignedTo?: string[] | null;
  source: string;
  canEdit: boolean;
  canDelete: boolean;
}

export function ReminderActions({
  reminderId,
  rawId,
  title,
  description,
  dueDate,
  priority,
  assignedTo,
  source,
  canEdit,
  canDelete,
}: ReminderActionsProps) {
  const [showEdit, setShowEdit] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [editDescription, setEditDescription] = useState(description || '');
  const [editPriority, setEditPriority] = useState(priority);
  const [editAssigned, setEditAssigned] = useState<string[]>(assignedTo || []);
  const [editDueDate, setEditDueDate] = useState<Date | undefined>(dueDate ? new Date(dueDate) : undefined);
  const [editDueTime, setEditDueTime] = useState<string>(
    dueDate ? format(new Date(dueDate), 'HH:mm') : '09:00'
  );
  const initialDueIso = dueDate ? new Date(dueDate).toISOString() : '';
  const currentDueIso = (() => {
    if (!editDueDate) return '';
    const [hh, mm] = (editDueTime || '09:00').split(':').map(Number);
    const d = new Date(editDueDate);
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d.toISOString();
  })();
  const isDirty =
    editTitle !== title ||
    editDescription !== (description || '') ||
    editPriority !== priority ||
    JSON.stringify(editAssigned) !== JSON.stringify(assignedTo || []) ||
    currentDueIso !== initialDueIso;

  const requestCloseEdit = () => {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return;
    setShowEdit(false);
  };
  const [customSnoozeDate, setCustomSnoozeDate] = useState<Date | undefined>();

  const updateMutation = useUpdateReminder();
  const snoozeMutation = useSnoozeReminder();
  const completeMutation = useCompleteTeamReminder();
  const deleteMutation = useDeleteTeamReminder();

  const handleComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    completeMutation.mutate(rawId, {
      onSuccess: () => toast.success('Reminder completed'),
      onError: (err: any) => toast.error(err.message),
    });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteMutation.mutate(rawId, {
      onSuccess: () => toast.success('Reminder deleted'),
      onError: (err: any) => toast.error(err.message),
    });
  };

  const handleSnooze = (duration: SnoozeDuration, customDate?: Date) => {
    snoozeMutation.mutate(
      { id: rawId, duration, customDate },
      {
        onSuccess: () => {
          const labels: Record<string, string> = {
            '1h': '1 hour',
            '1d': 'tomorrow',
            '3d': '3 days',
            '1w': '1 week',
            custom: customDate ? format(customDate, 'MMM d') : 'custom date',
          };
          toast.success(`Snoozed until ${labels[duration]}`);
          setShowSnooze(false);
          setCustomSnoozeDate(undefined);
        },
        onError: (err: any) => toast.error(err.message),
      },
    );
  };

  const handleSaveEdit = () => {
    let combinedDueDate = dueDate;
    if (editDueDate) {
      const [hh, mm] = (editDueTime || '09:00').split(':').map(Number);
      const d = new Date(editDueDate);
      d.setHours(hh || 0, mm || 0, 0, 0);
      combinedDueDate = d.toISOString();
    }
    updateMutation.mutate(
      {
        id: rawId,
        title: editTitle,
        description: editDescription,
        priority: editPriority,
        assigned_to: editAssigned,
        due_date: combinedDueDate,
      },
      {
        onSuccess: () => {
          toast.success('Reminder updated');
          setShowEdit(false);
        },
        onError: (err: any) => toast.error(err.message),
      },
    );
  };

  // Only show actions for client_reminders source (not follow_ups or deal milestones)
  const isEditable = source === 'client_reminder';

  const editDialog = isEditable && canEdit ? (
    <Dialog open={showEdit} onOpenChange={(o) => { if (!o) requestCloseEdit(); else setShowEdit(true); }}>
      <DialogContent
        className="max-h-[90vh] max-w-md overflow-y-auto overflow-x-hidden rounded-2xl border-brand-300/20 bg-background/95 dark:bg-background/95 text-foreground dark:text-foreground shadow-[0_28px_90px_rgba(0,0,0,0.48),0_0_42px_rgba(245,158,11,0.10)] backdrop-blur scrollbar-thin scrollbar-track-slate-950 scrollbar-thumb-amber-500/30"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground dark:text-white">
            <Pencil className="h-4 w-4 text-brand-200" />
            Edit reminder
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">Title</label>
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Reminder title"
              className="rounded-xl border-brand-300/15 bg-background/40 dark:bg-black/40 text-foreground dark:text-foreground placeholder:text-muted-foreground shadow-inner hover:border-brand-300/35 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">Description</label>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="min-h-[90px] rounded-xl border-brand-300/15 bg-background/40 dark:bg-black/40 text-foreground dark:text-foreground placeholder:text-muted-foreground shadow-inner hover:border-brand-300/35 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              placeholder="Add notes..."
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">Due date & time</label>
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="flex-1 justify-start gap-2 rounded-xl border-brand-300/15 bg-background/35 dark:bg-black/35 text-foreground dark:text-foreground hover:border-brand-300/35 hover:bg-brand-400/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black">
                    <CalendarIcon className="h-4 w-4" />
                    {editDueDate ? format(editDueDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto rounded-xl border-brand-300/20 bg-background/95 dark:bg-background/95 p-0 text-foreground dark:text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur" align="start" sideOffset={8}>
                  <Calendar
                    mode="single"
                    selected={editDueDate}
                    onSelect={setEditDueDate}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <Input
                type="time"
                value={editDueTime}
                onChange={(e) => setEditDueTime(e.target.value)}
                className="w-28 rounded-xl border-brand-300/15 bg-background/40 dark:bg-black/40 text-foreground dark:text-foreground shadow-inner hover:border-brand-300/35 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">Priority</label>
              <Select value={editPriority} onValueChange={setEditPriority}>
                <SelectTrigger className="rounded-xl border-brand-300/15 bg-background/40 dark:bg-black/40 text-foreground dark:text-foreground shadow-inner hover:border-brand-300/35 focus:ring-2 focus:ring-brand-300/70 focus:ring-offset-2 focus:ring-offset-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-brand-300/20 bg-background/95 dark:bg-background/95 p-1 text-foreground dark:text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur">
                  <SelectItem value="low" className="rounded-lg focus:bg-success/15 focus:text-success">Low</SelectItem>
                  <SelectItem value="medium" className="rounded-lg focus:bg-brand-400/15 focus:text-brand-100">Medium</SelectItem>
                  <SelectItem value="high" className="rounded-lg focus:bg-destructive/15 focus:text-destructive">High</SelectItem>
                  <SelectItem value="urgent" className="rounded-lg focus:bg-destructive/15 focus:text-destructive">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">Assigned to</label>
              <MultiTeamUserSelect
                value={editAssigned}
                onValueChange={setEditAssigned}
                placeholder="Assign..."
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={requestCloseEdit} className="rounded-xl border-border/70 bg-background/25 dark:bg-black/25 text-foreground dark:text-foreground hover:border-brand-300/35 hover:bg-brand-400/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black">Cancel</Button>
          <Button
            onClick={handleSaveEdit}
            disabled={!editTitle.trim() || updateMutation.isPending}
            className="rounded-xl border border-brand-200/35 bg-[linear-gradient(135deg,#fbbf24,#d97706)] font-semibold text-black shadow-[0_0_26px_rgba(245,158,11,0.24)] hover:shadow-[0_0_36px_rgba(245,158,11,0.34)] focus-visible:ring-2 focus-visible:ring-brand-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-60"
          >
            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  if (showSnooze && isEditable && canEdit) {
    return (
      <div
        className="mt-2 w-full space-y-2 rounded-2xl border border-brand-300/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(2,6,23,0.94))] p-3 shadow-[0_18px_42px_rgba(0,0,0,0.34),0_0_24px_rgba(245,158,11,0.10)] sm:min-w-[260px]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-brand-100">
          <AlarmClock className="h-3.5 w-3.5 text-brand-200" />
          Snooze until...
        </p>
        <div className="grid grid-cols-2 gap-1.5 pt-2">
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
              className="h-8 rounded-xl border-brand-300/20 bg-background/30 dark:bg-black/30 text-xs font-semibold text-foreground dark:text-foreground hover:border-brand-300/45 hover:bg-brand-400/12 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              disabled={snoozeMutation.isPending}
              onClick={() => handleSnooze(d)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 flex-1 justify-start gap-1.5 rounded-xl border-brand-300/20 bg-background/30 dark:bg-black/30 text-xs font-semibold text-foreground dark:text-foreground hover:border-brand-300/45 hover:bg-brand-400/12 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black">
                <CalendarIcon className="h-3 w-3" />
                {customSnoozeDate ? format(customSnoozeDate, 'MMM d, yyyy') : 'Custom date...'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto rounded-xl border-brand-300/20 bg-background/95 dark:bg-background/95 p-0 text-foreground dark:text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur" align="start" sideOffset={8}>
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
              className="h-8 rounded-xl border border-brand-200/35 bg-[linear-gradient(135deg,#fbbf24,#d97706)] text-xs font-semibold text-black shadow-[0_0_20px_rgba(245,158,11,0.20)] hover:shadow-[0_0_28px_rgba(245,158,11,0.30)] focus-visible:ring-2 focus-visible:ring-brand-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              disabled={snoozeMutation.isPending}
              onClick={() => handleSnooze('custom', customSnoozeDate)}
            >
              {snoozeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Set'}
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full rounded-xl text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          onClick={() => { setShowSnooze(false); setCustomSnoozeDate(undefined); }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <>
    {editDialog}
    <div className="flex shrink-0 gap-1 rounded-full border border-border dark:border-white/10 bg-background/30 dark:bg-black/30 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" onClick={(e) => e.stopPropagation()}>
      {isEditable && canEdit && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-brand-200 hover:bg-brand-400/15 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            title="Snooze"
            onClick={() => setShowSnooze(true)}
          >
            <AlarmClock className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground dark:text-foreground hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            title="Edit"
            onClick={() => setShowEdit(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
      {isEditable && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full text-success hover:bg-success/15 hover:text-success focus-visible:ring-2 focus-visible:ring-success/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-60"
          title="Complete"
          disabled={completeMutation.isPending}
          onClick={handleComplete}
        >
          {completeMutation.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Check className="h-3.5 w-3.5" />
          }
        </Button>
      )}
      {isEditable && canDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full text-destructive hover:bg-destructive/15 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-60"
          title="Delete"
          disabled={deleteMutation.isPending}
          onClick={handleDelete}
        >
          {deleteMutation.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <X className="h-3.5 w-3.5" />
          }
        </Button>
      )}
    </div>
    </>
  );
}
