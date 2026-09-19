/**
 * Phase 5 — Risk register tab for a purchase file.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AlertOctagon, Plus, ShieldAlert, Trash2, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const fn = 'finance-portal-deal-trackers';

const CATEGORIES = ['finance','valuation','documents','client','legal','property','timing','market','other'];
const OWNERS     = ['finance','client','npc','legal','broker','other'];
const STATUSES   = ['open','in_progress','mitigated','resolved','accepted'];
const SEVERITIES = ['low','medium','high','critical'];

const SEV_TONE: Record<string, string> = {
  low:      'bg-muted text-muted-foreground border-border',
  medium:   'bg-info/15 text-info border-info/30',
  high:     'bg-brand-500/15 text-brand-500 border-brand-500/30',
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
};
const STATUS_TONE: Record<string, string> = {
  open:        'bg-destructive/15 text-destructive border-destructive/30',
  in_progress: 'bg-brand-500/15 text-brand-500 border-brand-500/30',
  mitigated:   'bg-info/15 text-info border-info/30',
  resolved:    'bg-success/15 text-success border-success/30',
  accepted:    'bg-muted text-muted-foreground border-border',
};

export function RiskRegisterTab({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { data: risks, isLoading } = useQuery({
    queryKey: ['pf-risks', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(fn, { operation: 'list_risks', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.risks || []) as any[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['pf-risks', fileId] });

  const remove = async (id: string) => {
    if (!confirm('Delete this risk?')) return;
    const { error } = await invokeFinanceFunction(fn, { operation: 'delete_risk', risk_id: id });
    if (error) return toast.error(error.message);
    toast.success('Removed'); refresh();
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await invokeFinanceFunction(fn, { operation: 'update_risk', risk_id: id, payload: { status } });
    if (error) return toast.error(error.message);
    refresh();
  };

  const open_ = (risks || []).filter(r => r.status === 'open' || r.status === 'in_progress').length;
  const critical = (risks || []).filter(r => r.severity === 'critical' && r.status !== 'resolved').length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-brand-500" />Risk register</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{open_} open · {critical} critical</p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" />New risk
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !risks?.length && <p className="text-sm text-muted-foreground">No risks logged.</p>}
        {(risks || []).map(r => (
          <div key={r.id} className="border border-border rounded-lg p-3 flex items-start gap-3">
            <AlertOctagon className={cn('h-5 w-5 mt-0.5', r.severity === 'critical' ? 'text-destructive' : 'text-brand-500')} />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{r.title}</p>
                <Badge variant="outline" className={cn(SEV_TONE[r.severity])}>{r.severity}</Badge>
                <Badge variant="outline" className={cn(STATUS_TONE[r.status])}>{r.status.replace(/_/g, ' ')}</Badge>
                <Badge variant="outline">{r.category}</Badge>
                <Badge variant="outline">{r.owner}</Badge>
                {r.due_date && <Badge variant="outline">Due {r.due_date}</Badge>}
              </div>
              {r.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{r.description}</p>}
              {r.resolution_note && <p className="text-xs text-success mt-1 flex items-start gap-1"><CheckCircle2 className="h-3 w-3 mt-0.5" />{r.resolution_note}</p>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <Select value={r.status} onValueChange={(v) => setStatus(r.id, v)}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }} className="h-7 w-7">✎</Button>
              <Button size="icon" variant="ghost" onClick={() => remove(r.id)} className="h-7 w-7"><Trash2 className="h-3 w-3" /></Button>
            </div>
          </div>
        ))}
      </CardContent>
      <RiskDialog open={open} onOpenChange={setOpen} fileId={fileId} initial={editing} onSaved={refresh} />
    </Card>
  );
}

function RiskDialog({ open, onOpenChange, fileId, initial, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; fileId: string; initial: any | null; onSaved: () => void;
}) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [form, setForm] = useState<any>(() => initial || { severity: 'medium', owner: 'finance', category: 'finance', status: 'open' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setForm(initial || { severity: 'medium', owner: 'finance', category: 'finance', status: 'open' });
  }, [open, initial]);
  const setField = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.title || !form.category) return toast.error('Title and category required');
    setBusy(true);
    const op = initial?.id ? 'update_risk' : 'add_risk';
    const args: any = { operation: op, purchase_file_id: fileId, payload: form };
    if (initial?.id) args.risk_id = initial.id;
    const { error } = await invokeFinanceFunction(fn, args);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Saved');
    onOpenChange(false); onSaved();
    setForm({ severity: 'medium', owner: 'finance', category: 'finance', status: 'open' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial?.id ? 'Edit risk' : 'New risk'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Title</Label>
            <Input value={form.title || ''} onChange={(e) => setField('title', e.target.value)} placeholder="e.g. Bank may require new payslips" />
          </div>
          <div className="space-y-1.5"><Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setField('category', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Severity</Label>
            <Select value={form.severity} onValueChange={(v) => setField('severity', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Owner</Label>
            <Select value={form.owner} onValueChange={(v) => setField('owner', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{OWNERS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Due date</Label>
            <Input type="date" value={form.due_date || ''} onChange={(e) => setField('due_date', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5"><Label>Description</Label>
            <Textarea rows={3} value={form.description || ''} onChange={(e) => setField('description', e.target.value)} />
          </div>
          {initial?.id && (
            <div className="col-span-2 space-y-1.5"><Label>Resolution note</Label>
              <Textarea rows={2} value={form.resolution_note || ''} onChange={(e) => setField('resolution_note', e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
