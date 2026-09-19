/**
 * Dialog: toggle escalating auto-reminders per document requirement instance,
 * set a due date, and reset escalation state.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Loader2, RotateCcw, BellRing } from 'lucide-react';
import { toast } from 'sonner';

type Req = {
  id: string; label: string; status: string;
  auto_reminder_enabled?: boolean; due_date?: string | null;
  escalation_level?: 'gentle' | 'firm' | 'broker_notified'; reminder_count?: number;
  last_reminder_sent_at?: string | null;
};

const LEVEL_TONE: Record<string, string> = {
  gentle: 'bg-info/15 text-info',
  firm: 'bg-brand-500/15 text-brand-500',
  broker_notified: 'bg-destructive/15 text-destructive',
};

export function AutoRemindersDialog({
  open, onOpenChange, requirements, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; requirements: Req[]; onSaved: () => void }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [rows, setRows] = useState<Req[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => { if (open) setRows(requirements.filter(r => r.status === 'requested' || r.status === 'pending')); }, [open, requirements]);

  const save = async (r: Req, patch: Partial<Req> & { reset_escalation?: boolean }) => {
    setSaving(r.id);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-batch6', {
        operation: 'reminders_configure',
        instance_id: r.id,
        ...patch,
      });
      if (error) throw new Error(error);
      setRows(prev => prev.map(x => x.id === r.id ? { ...x, ...(data?.instance || patch) } : x));
      onSaved();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BellRing className="h-4 w-4 text-primary" />Escalating auto-reminders</DialogTitle>
          <p className="text-xs text-muted-foreground">Cadence: gentle nudge → firm reminder → broker notified. Cron runs hourly with a 48h gap between sends.</p>
        </DialogHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          {!rows.length ? <p className="text-sm text-muted-foreground py-8 text-center">No outstanding requests to manage.</p> :
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.id} className="border border-border/60 rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.label}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {r.escalation_level && <Badge variant="outline" className={`text-xs capitalize ${LEVEL_TONE[r.escalation_level]}`}>{r.escalation_level.replace(/_/g, ' ')}</Badge>}
                        {r.reminder_count != null && r.reminder_count > 0 && <span className="text-xs text-muted-foreground">{r.reminder_count} sent</span>}
                        {r.last_reminder_sent_at && <span className="text-xs text-muted-foreground">Last {new Date(r.last_reminder_sent_at).toLocaleDateString('en-AU')}</span>}
                      </div>
                    </div>
                    <Switch checked={!!r.auto_reminder_enabled} disabled={saving === r.id} onCheckedChange={(v) => save(r, { auto_reminder_enabled: v })} />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input type="date" className="w-40" value={r.due_date || ''} disabled={saving === r.id} onChange={(e) => save(r, { due_date: e.target.value || null })} />
                    <span className="text-xs text-muted-foreground">Due date</span>
                    {r.reminder_count != null && r.reminder_count > 0 && (
                      <Button size="sm" variant="ghost" disabled={saving === r.id} onClick={() => save(r, { reset_escalation: true })}>
                        <RotateCcw className="h-3 w-3 mr-1" />Reset
                      </Button>
                    )}
                    {saving === r.id && <Loader2 className="h-3 w-3 animate-spin" />}
                  </div>
                </div>
              ))}
            </div>
          }
        </ScrollArea>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
