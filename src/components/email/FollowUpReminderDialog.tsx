import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Bell, CalendarIcon, Loader2 } from 'lucide-react';
import { addDays, addHours, format, set } from 'date-fns';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface FollowUpReminderDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultTitle?: string;
  defaultDescription?: string;
  clientId?: string | null;
}

export function FollowUpReminderDialog({
  open, onOpenChange, defaultTitle, defaultDescription, clientId,
}: FollowUpReminderDialogProps) {
  const [title, setTitle] = useState(defaultTitle || 'Follow up on email');
  const [description, setDescription] = useState(defaultDescription || '');
  const [date, setDate] = useState<Date>(addDays(new Date(), 2));
  const [time, setTime] = useState('09:00');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const submitPreset = (when: Date) => save(when);

  const save = async (whenOverride?: Date) => {
    let when = whenOverride;
    if (!when) {
      const [h, m] = time.split(':').map(Number);
      when = set(date, { hours: h || 9, minutes: m || 0, seconds: 0, milliseconds: 0 });
    }
    if (when.getTime() < Date.now()) { toast.error('Pick a future time'); return; }
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('email-copilot-extras', {
        action: 'create_followup_reminder',
        client_id: clientId || null,
        due_date: when.toISOString(),
        title: title.trim() || 'Follow up on email',
        description: description.trim() || null,
        priority,
      });
      if (error) throw error;
      toast.success(`Reminder set for ${format(when, 'PPp')}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Failed to create reminder: ' + (e?.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Remind me</DialogTitle>
          <DialogDescription>Create a follow-up reminder linked to this thread.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'In 3 hours', date: addHours(new Date(), 3) },
              { label: 'Tomorrow 9 AM', date: set(addDays(new Date(), 1), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }) },
              { label: 'In 2 days', date: set(addDays(new Date(), 2), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }) },
              { label: 'Next week', date: set(addDays(new Date(), 7), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }) },
            ].map(p => (
              <Button key={p.label} variant="outline" className="justify-start" onClick={() => submitPreset(p.date)} disabled={saving}>
                <CalendarIcon className="h-4 w-4 mr-2" />{p.label}
              </Button>
            ))}
          </div>

          <div className="border-t pt-3 space-y-2">
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Note (optional)</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Date</Label>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start font-normal">
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {format(date, 'PPP')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={(d) => { if (d) setDate(d); setPickerOpen(false); }}
                      disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))}
                      initialFocus
                      className={cn('p-3 pointer-events-auto')}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label className="text-xs">Time</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bell className="h-4 w-4 mr-2" />}
            Set reminder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
