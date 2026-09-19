/**
 * Phase 5 — RCTI / partner tax invoice register (Doc 2 §7.3).
 *
 * The invoice mode is derived from the executed agreement's invoice process;
 * duplicate invoice numbers per partner are rejected server-side.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Loader2, Plus, Receipt, XCircle } from 'lucide-react';
import { format } from 'date-fns';

const fmt = (n: any) =>
  `$${(Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  partners: { id: string; name: string; company: string | null }[];
  statements: any[];
  onChanged?: () => void;
}

export function TaxInvoiceRegisterPanel({ partners, statements, onChanged }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filterPartner, setFilterPartner] = useState('all');

  const load = async () => {
    setLoading(true);
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', { operation: 'list_invoices' });
    if (error) toast.error(error.message);
    setRows(data?.invoices || []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(
    () => rows.filter(r => filterPartner === 'all' || r.finance_contact_id === filterPartner),
    [rows, filterPartner],
  );

  const cancel = async (id: string) => {
    const reason = window.prompt('Reason for cancelling this invoice:');
    if (!reason) return;
    const { error } = await invokeSecureFunction('finance-portal-commissions', { operation: 'cancel_invoice', id, reason });
    if (error) { toast.error(error.message); return; }
    toast.success('Invoice cancelled');
    await load();
    onChanged?.();
  };

  return (
    <Card className="border-0 bg-transparent shadow-none">
      <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4 text-primary" />Tax invoices &amp; RCTI
          </CardTitle>
          <div className="ml-auto flex items-center gap-2">
            <Select value={filterPartner} onValueChange={setFilterPartner}>
              <SelectTrigger aria-label="Filter invoices by partner" className="h-9 w-[200px] rounded-xl"><SelectValue placeholder="Partner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All partners</SelectItem>
                {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button className="rounded-xl" onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />Raise invoice
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Where the agreement nominates a recipient-created tax invoice, {`the`} statement is billed as an RCTI and the partner does not issue their own invoice.
        </p>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading invoices…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No invoices raised yet. Issue a statement, then raise its RCTI or record the partner's tax invoice.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                    <TableCell>
                      <Badge variant={r.invoice_mode === 'rcti' ? 'default' : 'secondary'}>
                        {r.invoice_mode === 'rcti' ? 'RCTI' : 'Tax invoice'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.supplier_name || '—'}
                      {r.supplier_abn && <div className="text-xs text-muted-foreground">ABN {r.supplier_abn}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{r.invoice_date ? format(new Date(r.invoice_date), 'dd MMM yyyy') : '—'}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(r.subtotal_amount)}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(r.gst_amount)}</TableCell>
                    <TableCell className="text-right text-sm font-semibold text-primary">{fmt(r.total_amount)}</TableCell>
                    <TableCell><Badge variant={r.status === 'cancelled' ? 'outline' : 'default'} className="capitalize">{r.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {r.status !== 'cancelled' && (
                        <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>
                          <XCircle className="mr-1 h-3.5 w-3.5" />Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {showCreate && (
        <CreateInvoiceDialog
          statements={statements}
          invoices={rows}
          onClose={(changed) => { setShowCreate(false); if (changed) { void load(); onChanged?.(); } }}
        />
      )}
    </Card>
  );
}

function CreateInvoiceDialog({ statements, invoices, onClose }: {
  statements: any[];
  invoices: any[];
  onClose: (changed: boolean) => void;
}) {
  const [statementId, setStatementId] = useState('');
  const [mode, setMode] = useState('rcti');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  const invoiced = useMemo(
    () => new Set(invoices.filter(i => i.status !== 'cancelled').map(i => i.statement_id)),
    [invoices],
  );
  const eligible = useMemo(
    () => statements.filter(s => s.status !== 'draft' && s.status !== 'void' && !invoiced.has(s.id)),
    [statements, invoiced],
  );

  const submit = async () => {
    if (!statementId) { toast.error('Select a statement'); return; }
    setSaving(true);
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'create_invoice',
      statement_id: statementId,
      invoice_mode: mode,
      invoice_number: invoiceNumber.trim() || undefined,
      due_date: dueDate || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success('Invoice raised');
    onClose(true);
  };

  return (
    <Dialog open onOpenChange={() => onClose(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise invoice</DialogTitle>
          <DialogDescription>
            Duplicate invoice numbers for the same partner are rejected, and each statement can carry only one live invoice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Statement</Label>
            <Select value={statementId} onValueChange={setStatementId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select an issued statement" /></SelectTrigger>
              <SelectContent>
                {eligible.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.partner_name_snapshot || 'Partner'} · {s.period_start} → {s.period_end} · {fmt(s.total_net)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {eligible.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">No issued statements are awaiting an invoice.</p>
            )}
          </div>

          <div>
            <Label>Invoice mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rcti">RCTI (recipient-created)</SelectItem>
                <SelectItem value="partner_tax_invoice">Partner tax invoice</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="inv-number">Invoice number</Label>
            <Input id="inv-number" className="mt-1" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="Auto-generated if left blank" />
          </div>

          <div>
            <Label htmlFor="inv-due">Due date</Label>
            <Input id="inv-due" className="mt-1" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Raise invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
