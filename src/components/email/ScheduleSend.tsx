import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Clock, CalendarIcon, Send, Loader2, X } from 'lucide-react';
import { format, addDays, addHours, isAfter, set, nextMonday } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
// Audit item 46 — a scheduled time needs to say what clock it is on.
import {
  availableTimeZones,
  currentTimeZone,
  describeInstantIn,
  describeTimeZone,
  zonedWallClockToInstant,
} from '@/lib/email/scheduleTimezone.pure';

interface ScheduleSendButtonProps {
  disabled?: boolean;
  buildPayload: () => Promise<{
    recipient: string;
    cc_recipients?: string[];
    bcc_recipients?: string[];
    subject: string;
    body: string;
    attachments?: { name: string; contentType: string; contentBytes: string }[];
    mailbox_source: 'admin' | 'personal';
    original_email_id?: string;
  } | null>;
  onScheduled?: () => void;
}

function presetTimes(): { label: string; date: Date }[] {
  const now = new Date();
  const tomorrow9 = set(addDays(now, 1), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 });
  const monday8 = set(nextMonday(now), { hours: 8, minutes: 0, seconds: 0, milliseconds: 0 });
  const inOneHour = addHours(now, 1);
  const tonight6 = set(now, { hours: 18, minutes: 0, seconds: 0, milliseconds: 0 });
  const list = [
    { label: 'In 1 hour', date: inOneHour },
    isAfter(tonight6, now) ? { label: 'Tonight 6:00 PM', date: tonight6 } : null,
    { label: 'Tomorrow 9:00 AM', date: tomorrow9 },
    { label: 'Monday 8:00 AM', date: monday8 },
  ].filter(Boolean) as { label: string; date: Date }[];
  return list;
}

export function ScheduleSendButton({ disabled, buildPayload, onScheduled }: ScheduleSendButtonProps) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(addDays(new Date(), 1));
  const [time, setTime] = useState('09:00');
  /**
   * Audit item 46 — the custom time is read in THIS zone.
   *
   * It used to be built with `set(date, { hours })`, which is the browser's
   * own zone, and nothing on screen said so: "9:00 AM" was an assumption
   * rather than a statement, and there was no way to schedule around a
   * recipient's clock. Defaulting to the reader's zone keeps the existing
   * behaviour for anyone who does not touch it.
   */
  const [timeZone, setTimeZone] = useState(() => currentTimeZone());
  const [zoneQuery, setZoneQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [hourPart, minutePart] = time.split(':').map(Number);
  /** The instant the typed wall clock names in the chosen zone. */
  const customInstant = date
    ? zonedWallClockToInstant(
        {
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          day: date.getDate(),
          hour: Number.isFinite(hourPart) ? hourPart : 9,
          minute: Number.isFinite(minutePart) ? minutePart : 0,
        },
        timeZone,
      )
    : null;

  const submit = async (when: Date) => {
    if (when.getTime() < Date.now() + 30_000) {
      toast.error('Pick a time at least 30 seconds in the future');
      return;
    }
    setSubmitting(true);
    try {
      const payload = await buildPayload();
      if (!payload) { toast.error('Nothing to schedule'); return; }
      if (!payload.recipient) { toast.error('Recipient is required'); return; }
      const { error } = await invokeSecureFunction('email-copilot-extras', {
        action: 'schedule_send',
        ...payload,
        scheduled_for: when.toISOString(),
      });
      if (error) throw error;
      toast.success(`Scheduled for ${format(when, 'PPp')}`);
      setOpen(false);
      onScheduled?.();
    } catch (e: any) {
      toast.error('Schedule failed: ' + (e?.message || 'unknown'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitCustom = () => {
    if (!customInstant) return;
    submit(customInstant);
  };

  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)} className="gap-1">
        <Clock className="h-4 w-4" /> Schedule
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Schedule send</DialogTitle>
            <DialogDescription>Pick a quick option or choose a custom date and time.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-2">
              {presetTimes().map(p => (
                <Button key={p.label} variant="outline" className="justify-start" onClick={() => submit(p.date)} disabled={submitting}>
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  <span className="truncate">{p.label}</span>
                </Button>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs">Custom date & time</Label>
              <div className="flex gap-2">
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('flex-1 justify-start font-normal', !date && 'text-muted-foreground')}>
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {date ? format(date, 'PPP') : 'Pick date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={(d) => { setDate(d); setPickerOpen(false); }}
                      disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))}
                      initialFocus
                      className={cn('p-3 pointer-events-auto')}
                    />
                  </PopoverContent>
                </Popover>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="schedule-timezone">Timezone</Label>
                <Input
                  value={zoneQuery}
                  onChange={(e) => setZoneQuery(e.target.value)}
                  placeholder="Filter timezones…"
                  aria-label="Filter timezones"
                  className="h-8 text-xs"
                />
                <select
                  id="schedule-timezone"
                  value={timeZone}
                  onChange={(e) => setTimeZone(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {availableTimeZones()
                    .filter((zone) => !zoneQuery || zone.toLowerCase().includes(zoneQuery.toLowerCase()))
                    .slice(0, 200)
                    .map((zone) => (
                      <option key={zone} value={zone}>{describeTimeZone(zone)}</option>
                    ))}
                </select>
                {customInstant && (
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    Sends {describeInstantIn(customInstant, timeZone)} in {timeZone}
                    {timeZone !== currentTimeZone() && (
                      <> — {describeInstantIn(customInstant, currentTimeZone())} your time</>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submitCustom} disabled={submitting || !date}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface ScheduledSend {
  id: string;
  recipient: string;
  subject: string;
  scheduled_for: string;
  status: string;
  error?: string | null;
  mailbox_source: string;
}

export function useScheduledSends() {
  const [items, setItems] = useState<ScheduledSend[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeSecureFunction('email-copilot-extras', { action: 'list_scheduled' });
      if (error) throw error;
      setItems((data as any)?.scheduled || []);
    } catch (e) {
      console.error('[scheduled] load failed', e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); const t = setInterval(refresh, 60000); return () => clearInterval(t); }, []);
  return { items, loading, refresh };
}

export function ScheduledSendsDialog({
  open, onOpenChange, items, onChanged,
}: { open: boolean; onOpenChange: (v: boolean) => void; items: ScheduledSend[]; onChanged: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const cancel = async (id: string) => {
    const { error } = await invokeSecureFunction('email-copilot-extras', { action: 'cancel_scheduled', id });
    if (error) toast.error('Cancel failed'); else { toast.success('Cancelled'); onChanged(); }
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Scheduled sends</DialogTitle>
            <DialogDescription>Pending emails waiting to be sent. Edit or cancel anytime before delivery.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {items.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No scheduled emails.</p>}
            {items.map(s => (
              <div key={s.id} className="border rounded-md p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{s.subject || '(No subject)'}</p>
                  <Badge variant={s.status === 'failed' ? 'destructive' : 'secondary'}>{s.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">To: {s.recipient}</p>
                <p className="text-xs text-muted-foreground">When: {format(new Date(s.scheduled_for), 'PPp')}</p>
                {s.error && <p className="text-xs text-destructive">Error: {s.error}</p>}
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEditingId(s.id)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => cancel(s.id)}>
                    <X className="h-4 w-4 mr-1" />Cancel
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <EditScheduledSendDialog
        id={editingId}
        onClose={() => setEditingId(null)}
        onSaved={() => { setEditingId(null); onChanged(); }}
      />
    </>
  );
}

interface FullScheduled {
  id: string;
  recipient: string;
  cc_recipients: string[] | null;
  bcc_recipients: string[] | null;
  subject: string;
  body: string;
  attachments: unknown[] | null;
  scheduled_for: string;
  mailbox_source: string;
}

function EditScheduledSendDialog({
  id, onClose, onSaved,
}: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<FullScheduled | null>(null);
  const [recipient, setRecipient] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState('09:00');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!id) { setRecord(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await invokeSecureFunction('email-copilot-extras', { action: 'get_scheduled', id });
        if (error) throw error;
        if (cancelled) return;
        const s = (data as any)?.scheduled as FullScheduled | undefined;
        if (!s) { toast.error('Could not load scheduled email'); onClose(); return; }
        setRecord(s);
        setRecipient(s.recipient || '');
        setCc((s.cc_recipients || []).join(', '));
        setBcc((s.bcc_recipients || []).join(', '));
        setSubject(s.subject || '');
        setBody(s.body || '');
        const when = new Date(s.scheduled_for);
        setDate(when);
        setTime(format(when, 'HH:mm'));
      } catch (e: any) {
        toast.error('Load failed: ' + (e?.message || 'unknown'));
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const save = async () => {
    if (!id || !date) return;
    const [h, m] = time.split(':').map(Number);
    const when = set(date, { hours: h || 9, minutes: m || 0, seconds: 0, milliseconds: 0 });
    if (when.getTime() < Date.now() + 30_000) {
      toast.error('Pick a time at least 30 seconds in the future');
      return;
    }
    if (!recipient.trim()) { toast.error('Recipient is required'); return; }
    const splitAddrs = (v: string) => v.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('email-copilot-extras', {
        action: 'update_scheduled',
        id,
        recipient: recipient.trim(),
        cc_recipients: splitAddrs(cc),
        bcc_recipients: splitAddrs(bcc),
        subject,
        body,
        scheduled_for: when.toISOString(),
      });
      if (error) throw error;
      toast.success(`Updated — sending ${format(when, 'PPp')}`);
      onSaved();
    } catch (e: any) {
      toast.error('Save failed: ' + (e?.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!id} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Edit scheduled send</DialogTitle>
          <DialogDescription>Update recipients, subject, body, or when this email will be sent.</DialogDescription>
        </DialogHeader>
        {loading || !record ? (
          <div className="py-8 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">To</Label>
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="recipient@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Cc</Label>
                <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="comma separated" />
              </div>
              <div>
                <Label className="text-xs">Bcc</Label>
                <Input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="comma separated" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Message</Label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Send date</Label>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('w-full justify-start font-normal', !date && 'text-muted-foreground')}>
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {date ? format(date, 'PPP') : 'Pick date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={(d) => { setDate(d); setPickerOpen(false); }}
                      disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))}
                      initialFocus
                      className={cn('p-3 pointer-events-auto')}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label className="text-xs">Send time</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            {(record.attachments && record.attachments.length > 0) && (
              <p className="text-xs text-muted-foreground">
                {record.attachments.length} attachment{record.attachments.length === 1 ? '' : 's'} preserved. Remove or replace attachments from the composer if needed.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading || !date}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
