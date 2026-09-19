import { useMemo, useState } from 'react';
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Lightbulb, Plus, Trash2, Loader2, ShieldCheck, CheckCircle2, AlertTriangle,
  Wallet, ThumbsUp, ThumbsDown, AlertCircle, HelpCircle, Coins, CircleDot,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const fn = 'finance-portal-deal-trackers';

/* ─────────────────────── Finance Decisions ─────────────────────── */

const DECISION_META: Record<string, { label: string; tone: string; icon: any }> = {
  green_light:               { label: 'Green light',                tone: 'bg-success/15 text-success border-success/30', icon: ThumbsUp },
  proceed_with_caution:      { label: 'Proceed with caution',       tone: 'bg-brand-500/15 text-brand-500 border-brand-500/30',     icon: AlertTriangle },
  not_suitable:              { label: 'Not suitable',               tone: 'bg-destructive/15 text-destructive border-destructive/30', icon: ThumbsDown },
  need_more_info:            { label: 'More information required',  tone: 'bg-info/15 text-info border-info/30',           icon: HelpCircle },
  subject_to_valuation:      { label: 'Subject to valuation',       tone: 'bg-muted text-muted-foreground border-border',           icon: Wallet },
  subject_to_lender_review:  { label: 'Subject to lender review',   tone: 'bg-muted text-muted-foreground border-border',           icon: ShieldCheck },
  subject_to_equity:         { label: 'Subject to equity release',  tone: 'bg-muted text-muted-foreground border-border',           icon: Coins },
  subject_to_deposit:        { label: 'Subject to deposit',         tone: 'bg-muted text-muted-foreground border-border',           icon: Coins },
  subject_to_lmi_approval:   { label: 'Subject to LMI approval',    tone: 'bg-muted text-muted-foreground border-border',           icon: ShieldCheck },
};

export function FinanceDecisionsTab({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: decisions, isLoading } = useQuery({
    queryKey: ['pf-decisions', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(fn, { operation: 'list_decisions', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.decisions || []) as any[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['pf-decisions', fileId] });

  const latest = decisions?.[0];
  const remove = async (id: string) => {
    const { error } = await invokeFinanceFunction(fn, { operation: 'delete_decision', decision_id: id });
    if (error) return toast.error(error.message);
    toast.success('Removed');
    refresh();
  };

  return (
    <div className="space-y-4">
      {latest ? (
        <Card className={cn('border-2', DECISION_META[latest.outcome]?.tone.replace('bg-', 'border-').replace('/15', '/40'))}>
          <CardContent className="py-5">
            <div className="flex items-start gap-4">
              <div className={cn('rounded-full p-3', DECISION_META[latest.outcome]?.tone)}>
                {(() => { const I = DECISION_META[latest.outcome]?.icon || Lightbulb; return <I className="h-6 w-6" />; })()}
              </div>
              <div className="flex-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Current finance position</p>
                <p className="text-xl font-bold">{DECISION_META[latest.outcome]?.label || latest.outcome}</p>
                {(latest.broker_notes || latest.rationale) && (
                  <p className="text-sm mt-2 text-muted-foreground">{latest.broker_notes || latest.rationale}</p>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-xs text-muted-foreground">
                  {latest.max_comfortable_price != null && <span>Max comfortable ${Number(latest.max_comfortable_price).toLocaleString('en-AU')}</span>}
                  {latest.proposed_loan_amount != null && <span>· Loan ${Number(latest.proposed_loan_amount).toLocaleString('en-AU')}</span>}
                  {latest.lvr != null && <span>· LVR {Number(latest.lvr).toFixed(1)}%</span>}
                  {latest.lmi_applicable && <span>· LMI {latest.lmi_amount ? `$${Number(latest.lmi_amount).toLocaleString('en-AU')}` : 'applicable'}</span>}
                  {latest.preferred_lender_pathway && <span>· {latest.preferred_lender_pathway}</span>}
                  {latest.snapshot_purchase_price != null && !latest.max_comfortable_price && <span>Price ${Number(latest.snapshot_purchase_price).toLocaleString('en-AU')}</span>}
                  <span>· {new Date(latest.decided_at).toLocaleString('en-AU')}</span>
                </div>
                {latest.decision_expiry_date && (() => {
                  const days = Math.ceil((new Date(latest.decision_expiry_date).getTime() - Date.now()) / 86400000);
                  const tone = days < 0 ? 'text-destructive' : days <= 3 ? 'text-destructive' : days <= 7 ? 'text-brand-500' : 'text-muted-foreground';
                  return (
                    <p className={cn('text-xs mt-1.5 font-medium', tone)}>
                      Decision expiry: {new Date(latest.decision_expiry_date).toLocaleDateString('en-AU')}
                      {days < 0 ? ` · overdue by ${-days}d` : ` · in ${days}d`}
                    </p>
                  );
                })()}
              </div>
              <Button onClick={() => setOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> New decision</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Lightbulb className="h-8 w-8 mx-auto text-primary" />
            <div>
              <p className="font-medium">No finance decisions yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Record the broker's call on whether this purchase is suitable to proceed.
              </p>
            </div>
            <Button onClick={() => setOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Record decision</Button>
          </CardContent>
        </Card>
      )}

      {decisions && decisions.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Decision history</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {decisions.slice(1).map(d => {
              const meta = DECISION_META[d.outcome];
              const I = meta?.icon || Lightbulb;
              return (
                <div key={d.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className={cn('rounded-full p-2', meta?.tone)}><I className="h-4 w-4" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{meta?.label || d.outcome}</p>
                    {d.rationale && <p className="text-xs text-muted-foreground mt-0.5">{d.rationale}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{new Date(d.decided_at).toLocaleString('en-AU')}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(d.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <DecisionDialog open={open} onOpenChange={setOpen} fileId={fileId} onAdded={refresh} />
      {isLoading && <p className="text-xs text-muted-foreground text-center">Loading…</p>}
    </div>
  );
}

function DecisionDialog({ open, onOpenChange, fileId, onAdded }: { open: boolean; onOpenChange: (v: boolean) => void; fileId: string; onAdded: () => void }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [outcome, setOutcome] = useState('green_light');
  const [form, setForm] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);

  const setF = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));
  const num = (v: any) => v === '' || v == null ? null : Number(v);

  const reset = () => { setForm({}); setOutcome('green_light'); };

  const submit = async () => {
    setBusy(true);
    try {
      const payload: Record<string, any> = {
        outcome,
        broker_notes: form.broker_notes?.trim() || null,
        rationale: form.broker_notes?.trim() || null, // mirror to legacy field for back-compat
        decision_expiry_date: form.decision_expiry_date || null,
        max_comfortable_price: num(form.max_comfortable_price),
        estimated_borrowing_cap: num(form.estimated_borrowing_cap),
        proposed_loan_amount: num(form.proposed_loan_amount),
        deposit_required: num(form.deposit_required),
        shortfall_required: num(form.shortfall_required),
        lvr: num(form.lvr),
        lmi_applicable: !!form.lmi_applicable,
        lmi_amount: form.lmi_applicable ? num(form.lmi_amount) : null,
        preferred_lender_pathway: form.preferred_lender_pathway?.trim() || null,
      };
      const { error } = await invokeFinanceFunction(fn, {
        operation: 'add_decision', purchase_file_id: fileId, payload,
      });
      if (error) throw new Error(error.message);
      toast.success('Decision recorded');
      reset();
      onOpenChange(false);
      onAdded();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record finance decision</DialogTitle>
          <DialogDescription>Broker's call on whether this purchase can proceed. Caution / Not suitable will auto-raise a finance risk.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Decision</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DECISION_META).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumField label="Max comfortable purchase price ($)" value={form.max_comfortable_price} onChange={(v) => setF('max_comfortable_price', v)} />
            <NumField label="Estimated borrowing capacity ($)" value={form.estimated_borrowing_cap} onChange={(v) => setF('estimated_borrowing_cap', v)} />
            <NumField label="Proposed loan amount ($)" value={form.proposed_loan_amount} onChange={(v) => setF('proposed_loan_amount', v)} />
            <NumField label="Estimated client contribution ($)" value={form.deposit_required} onChange={(v) => setF('deposit_required', v)} />
            <NumField label="Shortfall required ($)" value={form.shortfall_required} onChange={(v) => setF('shortfall_required', v)} />
            <NumField label="LVR (%)" value={form.lvr} onChange={(v) => setF('lvr', v)} step="0.1" />
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Preferred lender pathway</Label>
              <Input value={form.preferred_lender_pathway || ''} onChange={(e) => setF('preferred_lender_pathway', e.target.value)} placeholder="e.g. Macquarie 80% LVR" />
            </div>
            <div className="space-y-1.5">
              <Label>Decision expiry date</Label>
              <Input type="date" value={form.decision_expiry_date || ''} onChange={(e) => setF('decision_expiry_date', e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.lmi_applicable} onChange={(e) => setF('lmi_applicable', e.target.checked)} />
              <span className="text-sm font-medium">LMI applicable</span>
            </label>
            {form.lmi_applicable && (
              <NumField label="Estimated LMI ($)" value={form.lmi_amount} onChange={(v) => setF('lmi_amount', v)} />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Broker notes</Label>
            <Textarea rows={4} value={form.broker_notes || ''} onChange={(e) => setF('broker_notes', e.target.value)} placeholder="Reasoning, lender feedback, next steps, conditions, risks…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Record decision'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: any; onChange: (v: string) => void; step?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step || '1'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ─────────────────────── Conditions ─────────────────────── */

const CONDITION_STATUS: Record<string, { label: string; tone: string }> = {
  pending:     { label: 'Pending',     tone: 'bg-muted text-muted-foreground' },
  in_progress: { label: 'In progress', tone: 'bg-brand-500/15 text-brand-500' },
  uploaded:    { label: 'Uploaded',    tone: 'bg-info/15 text-info' },
  satisfied:   { label: 'Satisfied',   tone: 'bg-success/15 text-success' },
  waived:      { label: 'Waived',      tone: 'bg-muted text-muted-foreground' },
};
const CONDITION_OWNER: Record<string, string> = {
  client: 'Client', npc_team: 'NPC team', finance_partner: 'Finance partner', legal: 'Legal', other: 'Other',
};

export function ConditionsTab({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: conditions, isLoading } = useQuery({
    queryKey: ['pf-conditions', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(fn, { operation: 'list_conditions', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.conditions || []) as any[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['pf-conditions', fileId] });

  const stats = useMemo(() => {
    const list = conditions || [];
    return {
      total: list.length,
      satisfied: list.filter(c => c.status === 'satisfied').length,
      outstanding: list.filter(c => !['satisfied', 'waived'].includes(c.status)).length,
    };
  }, [conditions]);

  const update = async (id: string, payload: any) => {
    const { error } = await invokeFinanceFunction(fn, { operation: 'update_condition', condition_id: id, payload });
    if (error) return toast.error(error.message);
    refresh();
  };
  const remove = async (id: string) => {
    const { error } = await invokeFinanceFunction(fn, { operation: 'delete_condition', condition_id: id });
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-5 text-sm">
            <Stat label="Total" value={stats.total} />
            <Stat label="Outstanding" value={stats.outstanding} tone="text-brand-500" />
            <Stat label="Satisfied" value={stats.satisfied} tone="text-success" />
          </div>
          <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Add condition</Button>
        </CardContent>
      </Card>

      {(conditions || []).length === 0 && !isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No conditions yet. Set the file's finance status to "Conditional Approval" and a default checklist will be auto-seeded.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-2 pt-4">
            {(conditions || []).map(c => {
              const meta = CONDITION_STATUS[c.status];
              const done = c.status === 'satisfied' || c.status === 'waived';
              return (
                <div key={c.id} className={cn('rounded-lg border p-3 flex items-start gap-3', done && 'opacity-70')}>
                  <button
                    onClick={() => update(c.id, { status: done ? 'pending' : 'satisfied' })}
                    className="mt-0.5 shrink-0"
                  >
                    {done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <CircleDot className="h-5 w-5 text-muted-foreground" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className={cn('font-medium text-sm leading-tight', done && 'line-through')}>
                          {c.title}
                          {c.is_auto_generated && <Badge variant="outline" className="ml-2 text-[10px]">Auto</Badge>}
                        </p>
                        {c.description && <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs">
                          <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded', meta?.tone)}>{meta?.label}</span>
                          <span className="text-muted-foreground">· {CONDITION_OWNER[c.owner] || c.owner}</span>
                          {c.due_date && <span className="text-muted-foreground">· Due {new Date(c.due_date).toLocaleDateString('en-AU')}</span>}
                          {c.finance_portal_documents && (
                            <span className="text-muted-foreground">· 📎 {c.finance_portal_documents.original_filename}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Select value={c.status} onValueChange={(v) => update(c.id, { status: v })}>
                          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(CONDITION_STATUS).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => remove(c.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <AddConditionDialog open={open} onOpenChange={setOpen} fileId={fileId} onAdded={refresh} />
    </div>
  );
}

function AddConditionDialog({ open, onOpenChange, fileId, onAdded }: { open: boolean; onOpenChange: (v: boolean) => void; fileId: string; onAdded: () => void }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState('client');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim()) return toast.error('Title required');
    setBusy(true);
    try {
      const { error } = await invokeFinanceFunction(fn, {
        operation: 'add_condition', purchase_file_id: fileId,
        payload: { title: title.trim(), description: description.trim() || null, owner, due_date: dueDate || null, sort_order: 999 },
      });
      if (error) throw new Error(error.message);
      toast.success('Added');
      setTitle(''); setDescription(''); setOwner('client'); setDueDate('');
      onOpenChange(false); onAdded();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add condition</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Final loan offer signed" /></div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Owner</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CONDITION_OWNER).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Due date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────── Valuations ─────────────────────── */

const VAL_STATUS: Record<string, { label: string; tone: string }> = {
  ordered:        { label: 'Ordered',        tone: 'bg-muted text-muted-foreground' },
  access_pending: { label: 'Access pending', tone: 'bg-brand-500/15 text-brand-500' },
  inspected:      { label: 'Inspected',      tone: 'bg-info/15 text-info' },
  returned:       { label: 'Returned',       tone: 'bg-success/15 text-success' },
  disputed:       { label: 'Disputed',       tone: 'bg-destructive/15 text-destructive' },
  cancelled:      { label: 'Cancelled',      tone: 'bg-muted text-muted-foreground' },
};
const VAL_RESULT: Record<string, { label: string; tone: string }> = {
  pending:        { label: 'Pending',         tone: 'text-muted-foreground' },
  on_contract:    { label: 'On contract',     tone: 'text-success' },
  above_contract: { label: 'Above contract',  tone: 'text-success' },
  short:          { label: 'Short',           tone: 'text-destructive' },
};

export function ValuationsTab({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: valuations, isLoading } = useQuery({
    queryKey: ['pf-valuations', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(fn, { operation: 'list_valuations', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.valuations || []) as any[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['pf-valuations', fileId] });

  const remove = async (id: string) => {
    const { error } = await invokeFinanceFunction(fn, { operation: 'delete_valuation', valuation_id: id });
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setOpen(true); }} className="gap-1.5"><Plus className="h-4 w-4" /> Order valuation</Button>
      </div>

      {(valuations || []).length === 0 && !isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Wallet className="h-8 w-8 mx-auto text-primary mb-3" />
            No valuations yet. Track each valuation from order through to returned result.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {(valuations || []).map(v => {
            const sMeta = VAL_STATUS[v.status];
            const rMeta = VAL_RESULT[v.result];
            const short = Number(v.shortfall || 0) > 0;
            return (
              <Card key={v.id} className={cn(short && 'border-destructive/30')}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-semibold">{v.valuer || 'Unnamed valuer'}</p>
                      <p className="text-xs text-muted-foreground">
                        Ordered {v.ordered_date ? new Date(v.ordered_date).toLocaleDateString('en-AU') : '—'}
                        {v.returned_date && ` · Returned ${new Date(v.returned_date).toLocaleDateString('en-AU')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-xs px-2 py-0.5 rounded', sMeta?.tone)}>{sMeta?.label}</span>
                      <span className={cn('text-xs font-semibold', rMeta?.tone)}>{rMeta?.label}</span>
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(v); setOpen(true); }}>Edit</Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => remove(v.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <Field label="Contract" value={v.contract_price != null ? `$${Number(v.contract_price).toLocaleString('en-AU')}` : '—'} />
                    <Field label="Valuation" value={v.valuation_amount != null ? `$${Number(v.valuation_amount).toLocaleString('en-AU')}` : '—'} />
                    <Field label="Shortfall" value={short ? `$${Number(v.shortfall).toLocaleString('en-AU')}` : '—'} tone={short ? 'text-destructive' : undefined} />
                    <Field label="Risk" value={(v.risk_level || 'low').toUpperCase()} tone={v.risk_level === 'high' ? 'text-destructive' : v.risk_level === 'medium' ? 'text-brand-500' : 'text-success'} />
                  </div>
                  {(v.access_required || v.agent_contact || v.next_action || v.notes) && (
                    <div className="text-xs text-muted-foreground space-y-1 border-t pt-2">
                      {v.access_required && <p><strong className="text-foreground">Access:</strong> {v.access_required}</p>}
                      {v.agent_contact   && <p><strong className="text-foreground">Agent:</strong> {v.agent_contact}</p>}
                      {v.next_action     && <p><strong className="text-foreground">Next action:</strong> {v.next_action}</p>}
                      {v.notes           && <p>{v.notes}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ValuationDialog open={open} onOpenChange={setOpen} fileId={fileId} existing={editing} onSaved={refresh} />
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('font-medium', tone)}>{value}</p>
    </div>
  );
}

function ValuationDialog({
  open, onOpenChange, fileId, existing, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; fileId: string; existing: any; onSaved: () => void }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);

  // Reset form when dialog opens
  useMemo(() => { if (open) setForm(existing || { status: 'ordered', result: 'pending', risk_level: 'low' }); }, [open, existing]);

  const setField = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      const payload: any = { ...form };
      ['contract_price','valuation_amount'].forEach(k => { if (payload[k] === '' || payload[k] == null) delete payload[k]; else payload[k] = Number(payload[k]); });
      ['ordered_date','inspected_date','returned_date'].forEach(k => { if (!payload[k]) delete payload[k]; });

      if (existing?.id) {
        const { error } = await invokeFinanceFunction(fn, { operation: 'update_valuation', valuation_id: existing.id, payload });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await invokeFinanceFunction(fn, { operation: 'add_valuation', purchase_file_id: fileId, payload });
        if (error) throw new Error(error.message);
      }
      toast.success('Saved');
      onOpenChange(false);
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{existing?.id ? 'Edit valuation' : 'New valuation'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5 col-span-2"><Label>Valuer</Label><Input value={form.valuer || ''} onChange={(e) => setField('valuer', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Agent contact</Label><Input value={form.agent_contact || ''} onChange={(e) => setField('agent_contact', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Access required</Label><Input value={form.access_required || ''} onChange={(e) => setField('access_required', e.target.value)} placeholder="Lockbox / agent meet on site" /></div>
          <div className="space-y-1.5"><Label>Ordered</Label><Input type="date" value={form.ordered_date || ''} onChange={(e) => setField('ordered_date', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Inspected</Label><Input type="date" value={form.inspected_date || ''} onChange={(e) => setField('inspected_date', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Returned</Label><Input type="date" value={form.returned_date || ''} onChange={(e) => setField('returned_date', e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status || 'ordered'} onValueChange={(v) => setField('status', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(VAL_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Contract price</Label><Input type="number" value={form.contract_price ?? ''} onChange={(e) => setField('contract_price', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Valuation amount</Label><Input type="number" value={form.valuation_amount ?? ''} onChange={(e) => setField('valuation_amount', e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Result</Label>
            <Select value={form.result || 'pending'} onValueChange={(v) => setField('result', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(VAL_RESULT).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Risk level</Label>
            <Select value={form.risk_level || 'low'} onValueChange={(v) => setField('risk_level', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2"><Label>Next action</Label><Input value={form.next_action || ''} onChange={(e) => setField('next_action', e.target.value)} placeholder="e.g. Request second valuation" /></div>
          <div className="space-y-1.5 col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-lg font-semibold leading-none', tone)}>{value}</span>
    </div>
  );
}
