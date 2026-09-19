/**
 * Phase 5 — Executed clawback register (Doc 2 §6).
 *
 * Recovery is hard-capped at the commission actually paid on the loan (§6.3);
 * the cap is computed server-side and echoed here so staff can see when an
 * amount has been trimmed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Paperclip, Plus, ShieldAlert, Undo2 } from 'lucide-react';
import { format } from 'date-fns';

const fmt = (n: any) =>
  `$${(Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  issued: 'destructive',
  acknowledged: 'secondary',
  partially_recovered: 'secondary',
  recovered: 'default',
  waived: 'outline',
  disputed: 'destructive',
  void: 'outline',
};

const REASONS = [
  { value: 'early_discharge', label: 'Early discharge' },
  { value: 'refinance_away', label: 'Refinanced away' },
  { value: 'loan_reduced', label: 'Loan reduced' },
  { value: 'lender_clawback', label: 'Lender clawback' },
  { value: 'fraud_or_misconduct', label: 'Fraud or misconduct' },
  { value: 'other', label: 'Other' },
];

const label = (s: any) => String(s ?? '').replace(/_/g, ' ');

interface Props {
  partners: { id: string; name: string; company: string | null }[];
  commissions: any[];
  onChanged?: () => void;
}

export function ClawbackRegisterPanel({ partners, commissions, onChanged }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPartner, setFilterPartner] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', { operation: 'list_clawbacks' });
    if (error) toast.error(error.message);
    setRows(data?.clawbacks || []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter(r =>
    (filterStatus === 'all' || r.status === filterStatus) &&
    (filterPartner === 'all' || r.finance_contact_id === filterPartner)
  ), [rows, filterStatus, filterPartner]);

  const totals = useMemo(() => {
    const open = rows.filter(r => ['issued', 'acknowledged', 'partially_recovered', 'disputed'].includes(r.status));
    return {
      openCount: open.length,
      outstanding: open.reduce((s, r) => s + (Number(r.clawback_amount || 0) - Number(r.amount_recovered || 0)), 0),
      recovered: rows.reduce((s, r) => s + Number(r.amount_recovered || 0), 0),
      cappedCount: rows.filter(r => r.capped).length,
    };
  }, [rows]);

  const act = async (payload: Record<string, any>, successMsg: string) => {
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', payload);
    if (error) { toast.error(error.message); return false; }
    if ((data as any)?.error) { toast.error((data as any).error); return false; }
    toast.success(successMsg);
    await load();
    onChanged?.();
    return true;
  };

  const onEvidencePicked = async (file: File) => {
    if (!uploadTarget) return;
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await act({
      operation: 'upload_clawback_evidence',
      id: uploadTarget,
      filename: file.name,
      content_type: file.type,
      content_base64: base64,
    }, 'Evidence attached');
    setUploadTarget(null);
  };

  return (
    <Card className="border-0 bg-transparent shadow-none">
      <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-destructive" />Clawback register
          </CardTitle>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={filterPartner} onValueChange={setFilterPartner}>
              <SelectTrigger aria-label="Filter clawbacks by partner" className="h-9 w-[200px] rounded-xl"><SelectValue placeholder="Partner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All partners</SelectItem>
                {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger aria-label="Filter clawbacks by status" className="h-9 w-[170px] rounded-xl"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {['draft', 'issued', 'acknowledged', 'partially_recovered', 'recovered', 'waived', 'disputed'].map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{label(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="rounded-xl" onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />Raise clawback
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {[
            { label: 'Open clawbacks', value: String(totals.openCount) },
            { label: 'Outstanding', value: fmt(totals.outstanding) },
            { label: 'Recovered', value: fmt(totals.recovered) },
            { label: 'Capped at §6.3', value: String(totals.cappedCount) },
          ].map(k => (
            <div key={k.label} className="rounded-xl border border-border/60 bg-background/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-lg font-semibold">{k.value}</p>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading clawbacks…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No clawbacks recorded. Raise one when a lender recovers commission on a settled loan.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Loan</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Cap (§6.3)</TableHead>
                  <TableHead className="text-right">Claimed</TableHead>
                  <TableHead className="text-right">Recovered</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => {
                  const outstanding = Number(r.clawback_amount || 0) - Number(r.amount_recovered || 0);
                  const overdue = r.repayment_due_date && outstanding > 0 && new Date(r.repayment_due_date) < new Date();
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.partner_name_snapshot || '—'}</div>
                        <div className="text-xs text-muted-foreground">{r.client_name_snapshot || '—'}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.loan_reference || '—'}
                        {r.lender_name && <div className="text-xs text-muted-foreground">{r.lender_name}</div>}
                      </TableCell>
                      <TableCell className="text-sm capitalize">{label(r.reason_category)}</TableCell>
                      <TableCell className="text-right text-sm">{fmt(r.cap_amount)}</TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {fmt(r.clawback_amount)}
                        {r.capped && (
                          <Badge variant="outline" className="ml-2 text-[10px] text-warning">capped</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm">{fmt(r.amount_recovered)}</TableCell>
                      <TableCell className="text-sm">
                        {r.repayment_due_date ? format(new Date(r.repayment_due_date), 'dd MMM yyyy') : '—'}
                        {overdue && <Badge variant="destructive" className="ml-2 text-[10px]">overdue</Badge>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[r.status] || 'outline'} className="capitalize">{label(r.status)}</Badge>
                        {!r.evidence_path && r.status === 'draft' && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-warning">
                            <AlertTriangle className="h-3 w-3" />evidence required
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => { setUploadTarget(r.id); fileRef.current?.click(); }}>
                            <Paperclip className="h-3.5 w-3.5" />
                          </Button>
                          {r.status === 'draft' && (
                            <Button size="sm" variant="outline" onClick={() => act({ operation: 'issue_clawback', id: r.id }, 'Clawback issued')}>Issue</Button>
                          )}
                          {['issued', 'acknowledged', 'partially_recovered'].includes(r.status) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const amt = window.prompt(`Amount recovered (outstanding ${fmt(outstanding)}):`, String(outstanding));
                                if (!amt) return;
                                void act({ operation: 'record_clawback_recovery', id: r.id, amount: Number(amt), method: 'direct_payment' }, 'Recovery recorded');
                              }}
                            >Record recovery</Button>
                          )}
                          {!['recovered', 'waived', 'void'].includes(r.status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                const reason = window.prompt('Reason for waiving this clawback:');
                                if (!reason) return;
                                void act({ operation: 'waive_clawback', id: r.id, reason }, 'Clawback waived');
                              }}
                            ><Undo2 className="h-3.5 w-3.5" /></Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        aria-label="Clawback evidence"
        onChange={e => { const f = e.target.files?.[0]; if (f) void onEvidencePicked(f); e.target.value = ''; }}
      />

      {showCreate && (
        <CreateClawbackDialog
          partners={partners}
          commissions={commissions}
          onClose={(changed) => { setShowCreate(false); if (changed) { void load(); onChanged?.(); } }}
        />
      )}
    </Card>
  );
}

function CreateClawbackDialog({ partners, commissions, onClose }: {
  partners: { id: string; name: string; company: string | null }[];
  commissions: any[];
  onClose: (changed: boolean) => void;
}) {
  const [partnerId, setPartnerId] = useState('');
  const [commissionId, setCommissionId] = useState('__none__');
  const [reasonCategory, setReasonCategory] = useState('early_discharge');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [loanRef, setLoanRef] = useState('');
  const [lender, setLender] = useState('');
  const [dischargeDate, setDischargeDate] = useState('');
  const [cap, setCap] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const paidCommissions = useMemo(
    () => commissions.filter(c => c.status === 'paid' && (!partnerId || c.finance_contact_id === partnerId)),
    [commissions, partnerId],
  );

  useEffect(() => {
    if (!partnerId) { setCap(null); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await invokeSecureFunction('finance-portal-commissions', {
        operation: 'clawback_preview_cap',
        finance_contact_id: partnerId,
        commission_id: commissionId === '__none__' ? null : commissionId,
      });
      if (!cancelled) setCap(data?.cap_amount ?? 0);
    })();
    return () => { cancelled = true; };
  }, [partnerId, commissionId]);

  const submit = async () => {
    if (!partnerId || !reason.trim()) { toast.error('Partner and reason are required'); return; }
    setSaving(true);
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'create_clawback',
      finance_contact_id: partnerId,
      commission_id: commissionId === '__none__' ? null : commissionId,
      reason_category: reasonCategory,
      reason: reason.trim(),
      clawback_amount: Number(amount || 0),
      loan_reference: loanRef || null,
      lender_name: lender || null,
      discharge_date: dischargeDate || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success((data as any)?.capped
      ? 'Clawback created — amount capped at commission actually paid (clause 6.3)'
      : 'Clawback created');
    onClose(true);
  };

  return (
    <Dialog open onOpenChange={() => onClose(false)}>
      <DialogContent className="flex h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Raise a clawback</DialogTitle>
          <DialogDescription>
            Recovery is capped at the commission actually paid to the partner for this loan (clause 6.3).
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3">
          <div className="space-y-4 pb-2">
            <div>
              <Label>Partner</Label>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select partner" /></SelectTrigger>
                <SelectContent>
                  {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.company ? ` · ${p.company}` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Paid commission line (optional)</Label>
              <Select value={commissionId} onValueChange={setCommissionId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="All paid lines for this partner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">All paid lines for this partner</SelectItem>
                  {paidCommissions.slice(0, 100).map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.client_name_snapshot || 'Client'} · {fmt(c.net_amount)} · {format(new Date(c.created_at), 'dd MMM yy')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {cap !== null && (
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
                Maximum recoverable: <span className="font-semibold text-primary">{fmt(cap)}</span>
                <span className="ml-2 text-xs text-muted-foreground">(total commission actually paid)</span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Reason category</Label>
                <Select value={reasonCategory} onValueChange={setReasonCategory}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="cb-amount">Amount claimed</Label>
                <Input id="cb-amount" className="mt-1" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="cb-loan">Loan reference</Label>
                <Input id="cb-loan" className="mt-1" value={loanRef} onChange={e => setLoanRef(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cb-lender">Lender</Label>
                <Input id="cb-lender" className="mt-1" value={lender} onChange={e => setLender(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cb-discharge">Discharge date</Label>
                <Input id="cb-discharge" className="mt-1" type="date" value={dischargeDate} onChange={e => setDischargeDate(e.target.value)} />
              </div>
            </div>

            <div>
              <Label htmlFor="cb-reason">Reason / evidence summary</Label>
              <Textarea id="cb-reason" className="mt-1" rows={4} value={reason} onChange={e => setReason(e.target.value)} placeholder="Lender recovered upfront commission following discharge within the clawback period…" />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create clawback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
