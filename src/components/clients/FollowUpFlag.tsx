import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Bell, BellRing, X, Loader2, Plus, Phone, Users, FileText, MoreHorizontal } from 'lucide-react';
import { VoiceToTextButton } from '@/components/ui/VoiceToTextButton';
import { format, isPast, isToday } from 'date-fns';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';

interface FollowUpFlagProps {
  clientId: string;
  followUpDate: string | null | undefined;
  /** Extra query keys to invalidate on change */
  invalidateKeys?: string[][];
  size?: 'sm' | 'default';
}

const reminderTypes = [
  { value: 'follow_up', label: 'Follow Up', icon: Bell },
  { value: 'review', label: PORTFOLIO_REPORT_LABEL, icon: FileText },
  { value: 'call', label: 'Phone Call', icon: Phone },
  { value: 'meeting', label: 'Meeting', icon: Users },
  { value: 'document', label: 'Document', icon: FileText },
  { value: 'other', label: 'Other', icon: MoreHorizontal },
];

export function FollowUpFlag({ clientId, followUpDate, invalidateKeys = [], size = 'default' }: FollowUpFlagProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState('09:00');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [reminderType, setReminderType] = useState('follow_up');

  const parsedDate = followUpDate ? new Date(followUpDate) : undefined;
  const isFlagged = !!followUpDate;
  const isOverdue = parsedDate && isPast(parsedDate) && !isToday(parsedDate);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setSelectedDate(undefined);
    setTime('09:00');
    setPriority('medium');
    setReminderType('follow_up');
  };

  // The open client card reads `secure-client-data`; this list never named it,
  // so a follow-up set from here was invisible until the card was reopened.
  const invalidateAll = () => {
    invalidateClientQueries(queryClient, clientId, { also: invalidateKeys });
  };

  // Create reminder + set follow_up_date
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDate) throw new Error('Date is required');

      const [hours, minutes] = time.split(':').map(Number);
      const dueDate = new Date(selectedDate);
      dueDate.setHours(hours, minutes, 0, 0);
      const dueDateISO = dueDate.toISOString();
      const followUpDateStr = format(selectedDate, 'yyyy-MM-dd');

      // Create the reminder record
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_reminders',
        clientId,
        data: {
          title: title.trim() || 'Follow Up',
          description: description.trim() || null,
          due_date: dueDateISO,
          priority,
          reminder_type: reminderType,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to create reminder');

      // Also set follow_up_date on the client
      try {
        await invokeSecureFunction('manage-client-data', {
          operation: 'update',
          table: 'clients',
          clientId,
          data: { follow_up_date: followUpDateStr },
        });
      } catch {
        await supabase
          .from('clients')
          .update({ follow_up_date: followUpDateStr })
          .eq('id', clientId);
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success('Follow-up reminder created');
      resetForm();
      setOpen(false);
    },
    onError: (error: any) => {
      toast.error('Failed to create reminder: ' + error.message);
    },
  });

  // Clear follow_up_date
  const clearMutation = useMutation({
    mutationFn: async () => {
      try {
        const { data, error } = await invokeSecureFunction('manage-client-data', {
          operation: 'update',
          table: 'clients',
          clientId,
          data: { follow_up_date: null },
        });
        if (!error && data?.success) return;
      } catch {
        // fallback
      }
      const { error } = await supabase
        .from('clients')
        .update({ follow_up_date: null })
        .eq('id', clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      setOpen(false);
      toast.success('Follow-up cleared');
    },
    onError: (error: any) => {
      toast.error('Failed to clear follow-up: ' + error.message);
    },
  });

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearMutation.mutate();
  };

  const isPending = createMutation.isPending || clearMutation.isPending;

  const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const btnSize = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(btnSize, 'shrink-0 relative')}
          disabled={isPending}
        >
          {isFlagged ? (
            <BellRing
              className={cn(
                iconSize,
                'transition-colors',
                isOverdue
                  ? 'fill-destructive/20 text-destructive'
                  : 'fill-brand-400/20 text-brand-500'
              )}
            />
          ) : (
            <Bell className={cn(iconSize, 'text-muted-foreground hover:text-brand-500 transition-colors')} />
          )}
          {isOverdue && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start" side="bottom">
        <div className="p-3 pb-2 flex items-center justify-between gap-4 border-b">
          <span className="text-sm font-medium">
            {isFlagged ? 'Follow-up active' : 'Create Follow-up Reminder'}
          </span>
          {isFlagged && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-destructive hover:text-destructive"
              onClick={handleClear}
              disabled={isPending}
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {/* Current status banner */}
        {isFlagged && parsedDate && (
          <div className={cn(
            'mx-3 mt-2 px-2 py-1.5 rounded text-xs text-center',
            isOverdue ? 'bg-destructive/10 text-destructive' : 'bg-brand-500/10 text-brand-600'
          )}>
            {isOverdue ? 'Overdue: ' : 'Scheduled: '}
            {format(parsedDate, 'EEEE, MMM d, yyyy')}
          </div>
        )}

        {/* Reminder form */}
        <div className="p-3 space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Title</label>
            <Input
              placeholder="Follow up with client..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground font-medium">Description</label>
              <VoiceToTextButton
                size="sm"
                onTranscript={(text) => setDescription(prev => prev ? `${prev} ${text}` : text)}
                disabled={isPending}
              />
            </div>
            <Textarea
              placeholder="Notes (optional)..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Type</label>
              <Select value={reminderType} onValueChange={setReminderType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reminderTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <span className="flex items-center gap-2">
                        <type.icon className="h-3 w-3" />
                        {type.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
                <SelectTrigger className="h-8 text-xs">
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
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Time</label>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Date</label>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              className="p-2 pointer-events-auto rounded-md border"
            />
          </div>

          <Button
            onClick={() => createMutation.mutate()}
            disabled={!selectedDate || isPending}
            className="w-full h-8 text-sm gap-2"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                {isFlagged ? 'Update Follow-up' : 'Create Follow-up'}
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
