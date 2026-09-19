import { useState } from 'react';
import {
  Plus,
  Loader2,
  Bell,
  Users as UsersIcon,
  CalendarClock,
  FileText,
  Sparkles,
} from 'lucide-react';
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
import { MultiTeamUserSelect } from '@/components/ui/MultiTeamUserSelect';
import { ClientSearchSelect } from '@/components/ui/ClientSearchSelect';
import { VoiceToTextButton } from '@/components/ui/VoiceToTextButton';
import { useCreateClientReminder } from '@/hooks/useCreateClientReminder';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

const REMINDER_TYPES = [
  { value: 'task', label: 'Task' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'settlement', label: 'Settlement' },
  { value: 'finance', label: 'Finance' },
  { value: 'admin', label: 'Admin' },
  { value: 'other', label: 'Other' },
];

export function CreateReminderForm({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const createMutation = useCreateClientReminder();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('medium');
  const [reminderType, setReminderType] = useState('task');
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');

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
        client_id: clientId,
        reminder_scope: clientId ? 'client' : 'team',
      },
      {
        onSuccess: () => {
          const msg = clientId
            ? `Reminder created for ${clientName}`
            : 'Team reminder created';
          toast.success(msg);
          onClose();
        },
        onError: (err: any) => toast.error('Failed: ' + err.message),
      },
    );
  };

  return (
    <Card className="relative max-h-[min(86vh,760px)] max-w-full overflow-hidden rounded-[1.5rem] border border-brand-300/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),rgba(2,6,23,0.98)_30%,rgba(0,0,0,0.90))] text-foreground dark:text-foreground shadow-[0_28px_90px_rgba(0,0,0,0.46),0_0_42px_rgba(245,158,11,0.10)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/70 to-transparent" />
      <div className="pointer-events-none absolute -right-14 -top-20 h-40 w-40 rounded-full bg-brand-300/10 blur-3xl" />
      <div className="pointer-events-none absolute -left-16 bottom-0 h-36 w-36 rounded-full bg-success/5 blur-3xl" />
      <CardHeader className="relative border-b border-brand-300/10 px-4 pb-4 pt-4 sm:px-5">
        <CardTitle className="flex items-start gap-3 text-sm font-semibold text-foreground dark:text-white">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-brand-300/30 bg-brand-400/12 text-brand-100 shadow-[0_0_28px_rgba(245,158,11,0.18)] ring-1 ring-border dark:ring-white/5">
            <Bell className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-bold tracking-tight">Create New Reminder</span>
            <span className="mt-1 block text-xs font-medium leading-5 text-muted-foreground dark:text-muted-foreground">
              Schedule a client follow-up, team action, or operational milestone without leaving the hub.
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="relative max-h-[calc(min(86vh,760px)-96px)] min-w-0 space-y-4 overflow-y-auto overflow-x-hidden p-4 scrollbar-thin scrollbar-track-slate-950 scrollbar-thumb-amber-500/30 sm:p-5">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Reminder Title</label>
          <Input
            placeholder="Reminder title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11 rounded-xl border-brand-300/15 bg-background dark:bg-black/40 text-foreground dark:text-foreground placeholder:text-muted-foreground shadow-inner transition-all duration-200 hover:border-brand-300/35 focus-visible:border-brand-300/60 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          />
          <p className="text-[11px] text-muted-foreground">Use a clear action phrase so the reminder is easy to scan later.</p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">
            <FileText className="h-3.5 w-3.5 text-brand-200/80" />
            Description
          </label>
          <VoiceToTextButton
            size="sm"
            onTranscript={(text) => setDescription(prev => prev ? `${prev} ${text}` : text)}
          />
        </div>
        <Textarea
          placeholder="Description (optional)..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="min-h-[88px] resize-y rounded-xl border-brand-300/15 bg-background dark:bg-black/40 text-foreground dark:text-foreground placeholder:text-muted-foreground shadow-inner transition-all duration-200 hover:border-brand-300/35 focus-visible:border-brand-300/60 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        />

        {/* Client link */}
        <div className="rounded-2xl border border-brand-300/10 bg-white/[0.025] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Link to Client</label>
            <ClientSearchSelect
              value={clientId}
              onValueChange={(id, name) => { setClientId(id); setClientName(name || ''); }}
              placeholder="Search and select a client..."
              allowNone
            />
            <p className="text-[11px] text-muted-foreground">Leave empty for a team reminder, or link a client for client-specific follow-up.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5 text-brand-200/80" />
              Due Date
            </label>
            <Input
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-11 rounded-xl border-brand-300/15 bg-background dark:bg-black/40 text-foreground dark:text-foreground shadow-inner transition-all duration-200 hover:border-brand-300/35 focus-visible:border-brand-300/60 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Type</label>
            <Select value={reminderType} onValueChange={setReminderType}>
              <SelectTrigger className="h-11 rounded-xl border-brand-300/15 bg-background dark:bg-black/40 text-foreground dark:text-foreground shadow-inner transition-all duration-200 hover:border-brand-300/35 focus:border-brand-300/60 focus:ring-2 focus:ring-brand-300/70 focus:ring-offset-2 focus:ring-offset-black">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-w-[min(92vw,360px)] rounded-xl border-brand-300/20 bg-background dark:bg-background/95 p-1 text-foreground dark:text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur">
                {REMINDER_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value} className="truncate rounded-lg focus:bg-brand-400/15 focus:text-brand-100">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-brand-200/80" />
            Priority
          </label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-11 rounded-xl border-brand-300/15 bg-background dark:bg-black/40 text-foreground dark:text-foreground shadow-inner transition-all duration-200 hover:border-brand-300/35 focus:border-brand-300/60 focus:ring-2 focus:ring-brand-300/70 focus:ring-offset-2 focus:ring-offset-black">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[min(92vw,360px)] rounded-xl border-brand-300/20 bg-background dark:bg-background/95 p-1 text-foreground dark:text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur">
              <SelectItem value="low" className="rounded-lg focus:bg-success/15 focus:text-success">Low</SelectItem>
              <SelectItem value="medium" className="rounded-lg focus:bg-brand-400/15 focus:text-brand-100">Medium</SelectItem>
              <SelectItem value="high" className="rounded-lg focus:bg-destructive/15 focus:text-destructive">High</SelectItem>
              <SelectItem value="urgent" className="rounded-lg focus:bg-destructive/15 focus:text-destructive">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-2xl border border-brand-300/10 bg-white/[0.025] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">
              <UsersIcon className="h-3.5 w-3.5 text-brand-200/80" />
              Assign To
            </label>
            <MultiTeamUserSelect
              value={assignedTo}
              onValueChange={setAssignedTo}
              placeholder="Select team members..."
            />
            <p className="text-[11px] text-muted-foreground">Assign one or more team members while preserving the existing team reminder workflow.</p>
          </div>
        </div>

        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col-reverse gap-2 border-t border-brand-300/10 bg-background dark:bg-background/95 p-4 backdrop-blur sm:-mx-5 sm:-mb-5 sm:flex-row sm:items-center sm:justify-end sm:p-5">
          <Button
            variant="outline"
            onClick={onClose}
            className="h-11 rounded-xl border-border/70 bg-background dark:bg-black/25 px-5 font-semibold text-foreground dark:text-foreground transition-all duration-200 hover:border-brand-300/35 hover:bg-brand-400/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!title.trim() || !dueDate || createMutation.isPending}
            className="h-11 rounded-xl border border-brand-200/40 bg-[linear-gradient(135deg,#fbbf24,#d97706)] px-5 font-semibold text-black shadow-[0_0_30px_rgba(245,158,11,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_42px_rgba(245,158,11,0.36)] focus-visible:ring-2 focus-visible:ring-brand-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:translate-y-0 disabled:opacity-60 sm:min-w-[190px]"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create Reminder
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
