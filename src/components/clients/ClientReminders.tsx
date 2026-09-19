import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { 
  Bell, 
  BellRing,
  Plus, 
  Check, 
  Clock, 
  Calendar as CalendarIcon,
  Phone,
  Users,
  FileText,
  MoreHorizontal,
  Loader2,
  X,
  Pin,
  UserCircle,
  Pencil
} from 'lucide-react';
import { format, formatDistanceToNow, isPast, isToday } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { VoiceToTextButton } from '@/components/ui/VoiceToTextButton';
import { MultiTeamUserSelect } from '@/components/ui/MultiTeamUserSelect';
import { useTeamUsers } from '@/hooks/useTeamUsers';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useAuth } from '@/hooks/useAuth';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';

interface ClientRemindersProps {
  clientId: string;
  followUpDate?: string | null;
}

const reminderTypes = [
  { value: 'follow_up', label: 'Follow Up', icon: Bell },
  { value: 'review', label: PORTFOLIO_REPORT_LABEL, icon: FileText },
  { value: 'call', label: 'Phone Call', icon: Phone },
  { value: 'meeting', label: 'Meeting', icon: Users },
  { value: 'document', label: 'Document', icon: FileText },
  { value: 'other', label: 'Other', icon: MoreHorizontal },
];

const priorityColors = {
  low: 'bg-info/10 text-info border-info/20',
  medium: 'bg-brand-500/10 text-brand-600 border-brand-500/20',
  high: 'bg-warning/10 text-warning border-warning/20',
  urgent: 'bg-destructive/10 text-destructive border-destructive/20',
};

function FollowUpBanner({ clientId, followUpDate }: { clientId: string; followUpDate: string | null | undefined }) {
  const [calOpen, setCalOpen] = useState(false);
  const queryClient = useQueryClient();
  const parsedDate = followUpDate ? new Date(followUpDate) : undefined;
  const isOverdue = parsedDate && isPast(parsedDate) && !isToday(parsedDate);
  const isDueToday = parsedDate && isToday(parsedDate);

  const mutation = useMutation({
    mutationFn: async (newDate: string | null) => {
      try {
        const { data, error } = await invokeSecureFunction('manage-client-data', {
          operation: 'update',
          table: 'clients',
          clientId,
          data: { follow_up_date: newDate },
        });
        if (!error && data?.success) return;
      } catch {
        // fallback
      }
      const { error } = await supabase
        .from('clients')
        .update({ follow_up_date: newDate })
        .eq('id', clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      // The card an operator has open reads `secure-client-data`, which this
      // list never named — so the write landed, the toast said so, and the
      // banner kept reading "No follow-up date set" until the card was closed
      // and reopened. One list now, in `lib/clients/invalidateClientQueries`.
      invalidateClientQueries(queryClient, clientId);
      setCalOpen(false);
    },
    onError: (error: any) => {
      toast.error('Failed to update follow-up: ' + error.message);
    },
  });

  const statusConfig = isOverdue
    ? { bg: 'bg-destructive/5 border-destructive/30', icon: 'text-destructive', label: 'Overdue', labelClass: 'text-destructive font-semibold' }
    : isDueToday
    ? { bg: 'bg-warning/5 border-warning/30', icon: 'text-warning', label: 'Due Today', labelClass: 'text-warning font-semibold' }
    : parsedDate
    ? { bg: 'bg-brand-500/5 border-brand-500/30', icon: 'text-brand-500', label: formatDistanceToNow(parsedDate, { addSuffix: true }), labelClass: 'text-muted-foreground' }
    : { bg: 'border-dashed border-muted-foreground/30', icon: 'text-muted-foreground', label: '', labelClass: '' };

  return (
    <Card className={cn('transition-all', statusConfig.bg)}>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className={cn('rounded-full p-2', parsedDate ? (isOverdue ? 'bg-destructive/10' : 'bg-brand-500/10') : 'bg-muted')}>
            {parsedDate ? (
              <BellRing className={cn('h-4 w-4', statusConfig.icon)} />
            ) : (
              <Bell className="h-4 w-4 text-muted-foreground" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Pin className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium">Follow-Up Reminder</span>
              {isOverdue && <Badge variant="destructive" className="text-[10px] h-5">Overdue</Badge>}
              {isDueToday && <Badge className="text-[10px] h-5 bg-warning/10 text-warning border-warning/20">Today</Badge>}
            </div>
            {parsedDate ? (
              <p className={cn('text-xs mt-0.5', statusConfig.labelClass)}>
                {format(parsedDate, 'EEEE, MMM d, yyyy')} · {statusConfig.label}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">No follow-up date set — click to schedule</p>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                  <CalendarIcon className="h-3 w-3" />
                  {parsedDate ? 'Change' : 'Set Date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={parsedDate}
                  onSelect={(date) => {
                    if (!date) return;
                    mutation.mutate(format(date, 'yyyy-MM-dd'));
                    toast.success(`Follow-up set for ${format(date, 'MMM d, yyyy')}`);
                  }}
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            {parsedDate && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => {
                  mutation.mutate(null);
                  toast.success('Follow-up cleared');
                }}
                disabled={mutation.isPending}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ClientReminders({ clientId, followUpDate }: ClientRemindersProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [reminderType, setReminderType] = useState('follow_up');
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editPriority, setEditPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [editReminderType, setEditReminderType] = useState('follow_up');
  const [editAssignedTo, setEditAssignedTo] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { data: teamUsers = [] } = useTeamUsers();
  const { addNotification } = useNotifications();
  const { user } = useAuth();

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ['client-reminders', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { reminders: true },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch reminders');
      return data.reminders || [];
    }
  });

  const addReminderMutation = useMutation({
    mutationFn: async () => {
      const assignedUserIds = assignedTo.length > 0 ? assignedTo : null;
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_reminders',
        clientId,
        data: {
          client_id: clientId,
          title,
          description,
          due_date: new Date(dueDate).toISOString(),
          priority,
          reminder_type: reminderType,
          assigned_to: assignedUserIds,
          reminder_scope: 'client',
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to create reminder');
      return assignedUserIds;
    },
    onSuccess: (assignedUserIds) => {
      queryClient.invalidateQueries({ queryKey: ['client-reminders', clientId] });
      queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
      toast.success('Reminder created');

      // Send notification to assigned users (if not self)
      if (assignedUserIds) {
        for (const userId of assignedUserIds) {
          if (userId !== user?.id) {
            addNotification({
              type: 'reminder_assigned',
              title: `Reminder Assigned: ${title}`,
              message: `You have been assigned a ${priority} priority reminder: "${title}"`,
              entityId: clientId,
              targetUserId: userId,
            });
          }
        }
      }

      resetForm();
    },
    onError: (error: any) => {
      toast.error('Failed to create reminder: ' + error.message);
    }
  });

  const completeReminderMutation = useMutation({
    mutationFn: async (reminderId: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'client_reminders',
        clientId,
        recordId: reminderId,
        data: { 
          status: 'completed',
          completed_at: new Date().toISOString()
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to complete reminder');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-reminders', clientId] });
      toast.success('Reminder completed');
    },
    onError: (error: any) => {
      toast.error('Failed to complete reminder: ' + error.message);
    }
  });

  const deleteReminderMutation = useMutation({
    mutationFn: async (reminderId: string) => {
      // Try edge function first
      try {
        const { data, error } = await invokeSecureFunction('manage-client-data', {
          operation: 'delete',
          table: 'client_reminders',
          clientId,
          recordId: reminderId,
        });
        if (!error && data?.success) return;
        console.warn('[ClientReminders] Edge function delete failed:', error?.message || data?.error);
      } catch (e) {
        console.warn('[ClientReminders] Edge function delete threw:', e);
      }

      // Fallback to direct Supabase delete
      const { error: directError } = await supabase
        .from('client_reminders')
        .delete()
        .eq('id', reminderId);
      if (directError) throw directError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-reminders', clientId] });
      queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
      toast.success('Reminder deleted');
    },
    onError: (error: any) => {
      console.error('[ClientReminders] Delete failed completely:', error);
      toast.error('Failed to delete reminder: ' + error.message);
    }
  });

  const editReminderMutation = useMutation({
    mutationFn: async (reminderId: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'client_reminders',
        clientId,
        recordId: reminderId,
        data: {
          title: editTitle,
          description: editDescription,
          due_date: new Date(editDueDate).toISOString(),
          priority: editPriority,
          reminder_type: editReminderType,
          assigned_to: editAssignedTo.length > 0 ? editAssignedTo : null,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to update reminder');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-reminders', clientId] });
      queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
      setEditingId(null);
      toast.success('Reminder updated');
    },
    onError: (error: any) => {
      toast.error('Failed to update reminder: ' + error.message);
    },
  });

  const startEditing = (reminder: any) => {
    setEditingId(reminder.id);
    setEditTitle(reminder.title);
    setEditDescription(reminder.description || '');
    setEditDueDate(format(new Date(reminder.due_date), "yyyy-MM-dd'T'HH:mm"));
    setEditPriority(reminder.priority);
    setEditReminderType(reminder.reminder_type);
    setEditAssignedTo(Array.isArray(reminder.assigned_to) ? reminder.assigned_to : reminder.assigned_to ? [reminder.assigned_to] : []);
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDueDate('');
    setPriority('medium');
    setReminderType('follow_up');
    setAssignedTo([]);
    setShowAdd(false);
  };

  const pendingReminders = reminders.filter(r => r.status === 'pending');
  const completedReminders = reminders.filter(r => r.status === 'completed');

  const getReminderIcon = (type: string) => {
    const found = reminderTypes.find(t => t.value === type);
    return found ? found.icon : Bell;
  };

  const getDueStatus = (dueDate: string) => {
    const date = new Date(dueDate);
    if (isPast(date) && !isToday(date)) {
      return { label: 'Overdue', className: 'text-destructive' };
    }
    if (isToday(date)) {
      return { label: 'Today', className: 'text-warning' };
    }
    return { label: formatDistanceToNow(date, { addSuffix: true }), className: 'text-muted-foreground' };
  };

  return (
    <div className="space-y-4">
      {/* Pinned Follow-Up Banner */}
      <FollowUpBanner clientId={clientId} followUpDate={followUpDate} />

      {/* Add Reminder */}
      {showAdd ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">New Reminder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Reminder title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted-foreground font-medium">Description</label>
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
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Due Date</label>
                <Input
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Type</label>
                <Select value={reminderType} onValueChange={setReminderType}>
                  <SelectTrigger>
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
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
                <SelectTrigger>
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
              <label className="text-xs text-muted-foreground">Assign To</label>
              <MultiTeamUserSelect
                value={assignedTo}
                onValueChange={setAssignedTo}
                placeholder="Assign to team members..."
              />
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={() => addReminderMutation.mutate()}
                disabled={!title.trim() || !dueDate || addReminderMutation.isPending}
                className="flex-1"
              >
                {addReminderMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Reminder
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setShowAdd(true)} variant="outline" className="w-full gap-2">
          <Plus className="h-4 w-4" />
          Add Reminder
        </Button>
      )}

      {/* Pending Reminders */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : pendingReminders.length === 0 && completedReminders.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">
            <Bell className="h-7 w-7 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No additional reminders set</p>
            <p className="text-xs mt-1">Use the button above to add task-specific reminders</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {pendingReminders.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Pending ({pendingReminders.length})
              </h4>
              {pendingReminders.map((reminder) => {
                const Icon = getReminderIcon(reminder.reminder_type);
                const dueStatus = getDueStatus(reminder.due_date);
                const isEditing = editingId === reminder.id;
                
                if (isEditing) {
                  return (
                    <Card key={reminder.id} className="ring-1 ring-primary">
                      <CardContent className="py-3 space-y-3">
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Reminder title..."
                        />
                        <Textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description (optional)..."
                          rows={2}
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Due Date</label>
                            <Input
                              type="datetime-local"
                              value={editDueDate}
                              onChange={(e) => setEditDueDate(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Type</label>
                            <Select value={editReminderType} onValueChange={setEditReminderType}>
                              <SelectTrigger>
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
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Priority</label>
                            <Select value={editPriority} onValueChange={(v) => setEditPriority(v as any)}>
                              <SelectTrigger>
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
                            <label className="text-xs text-muted-foreground">Assign To</label>
                            <MultiTeamUserSelect
                              value={editAssignedTo}
                              onValueChange={setEditAssignedTo}
                              placeholder="Assign to..."
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => editReminderMutation.mutate(reminder.id)}
                            disabled={!editTitle.trim() || !editDueDate || editReminderMutation.isPending}
                          >
                            {editReminderMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : null}
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                }

                return (
                  <Card key={reminder.id} className="group">
                    <CardContent className="py-3 flex items-start gap-3">
                      <div className="mt-0.5">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-sm">{reminder.title}</p>
                            {reminder.description && (
                              <p className="text-xs text-muted-foreground mt-1">{reminder.description}</p>
                            )}
                          </div>
                          <Badge className={priorityColors[reminder.priority as keyof typeof priorityColors]}>
                            {reminder.priority}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <div className="flex items-center gap-1">
                            <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                            <span className={`text-xs ${dueStatus.className}`}>
                              {format(new Date(reminder.due_date), 'MMM d, yyyy h:mm a')} · {dueStatus.label}
                            </span>
                          </div>
                          {reminder.assigned_to && Array.isArray(reminder.assigned_to) && reminder.assigned_to.length > 0 && (() => {
                            const names = reminder.assigned_to
                              .map((id: string) => teamUsers.find(u => u.id === id)?.username)
                              .filter(Boolean);
                            return names.length > 0 ? (
                              <div className="flex items-center gap-1">
                                <UserCircle className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">{names.join(', ')}</span>
                              </div>
                            ) : null;
                          })()}
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7"
                          onClick={() => startEditing(reminder)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7"
                          onClick={() => completeReminderMutation.mutate(reminder.id)}
                        >
                          <Check className="h-4 w-4 text-success" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7"
                          onClick={() => deleteReminderMutation.mutate(reminder.id)}
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Completed Reminders */}
          {completedReminders.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                <Check className="h-4 w-4" />
                Completed ({completedReminders.length})
              </h4>
              {completedReminders.slice(0, 3).map((reminder) => {
                const Icon = getReminderIcon(reminder.reminder_type);
                
                return (
                  <Card key={reminder.id} className="opacity-60">
                    <CardContent className="py-2 flex items-center gap-3">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm line-through">{reminder.title}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {format(new Date(reminder.completed_at!), 'MMM d')}
                      </span>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
