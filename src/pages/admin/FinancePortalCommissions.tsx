import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { fetchPdfBlob } from '@/lib/pdf/downloadPdf';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchInput } from '@/components/ui/search-input';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import {
  Loader2, Plus, RefreshCw, FileText, DollarSign, Download, ArrowLeft, AlertTriangle, ShieldCheck,
  ShieldAlert, Receipt, Landmark,
} from 'lucide-react';
import { ClawbackRegisterPanel } from '@/components/admin/finance-portal/ClawbackRegisterPanel';
import { TaxInvoiceRegisterPanel } from '@/components/admin/finance-portal/TaxInvoiceRegisterPanel';
import { PartnerBankingPanel } from '@/components/admin/finance-portal/PartnerBankingPanel';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface Commission {
  id: string;
  finance_contact_id: string;
  client_id: string | null;
  deal_id: string | null;
  partner_name_snapshot: string | null;
  partner_company_snapshot: string | null;
  client_name_snapshot: string | null;
  deal_type_snapshot: string | null;
  commission_basis: string;
  basis_amount: number;
  rate_pct: number;
  gross_amount: number;
  gst_amount: number;
  net_amount: number;
  trigger_event: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  statement_id: string | null;
  agreement_version: number | null;
  rate_source: string | null;
  qualifying_event: string | null;
  cleared_funds_required: boolean | null;
  cleared_funds_received_at: string | null;
}

interface Statement {
  id: string;
  finance_contact_id: string;
  partner_name_snapshot: string | null;
  partner_company_snapshot: string | null;
  period_start: string;
  period_end: string;
  total_gross: number;
  total_gst: number;
  total_net: number;
  line_count: number;
  status: string;
  pdf_storage_path: string | null;
  remittance_csv_path: string | null;
  issued_at: string | null;
  paid_at: string | null;
  agreement_version: number | null;
  dispute_window_days: number | null;
  dispute_deadline: string | null;
  dispute_status: string | null;
  open_dispute_count: number | null;
}

interface Dispute {
  id: string;
  statement_id: string;
  finance_contact_id: string;
  commission_id: string | null;
  raised_by_type: string;
  raised_by_name: string | null;
  raised_at: string;
  within_window: boolean;
  reason_category: string;
  reason: string;
  disputed_amount: number | null;
  status: string;
  resolution_outcome: string | null;
  resolution_notes: string | null;
  adjustment_amount: number | null;
  resolved_at: string | null;
}


const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  invoiced: 'default',
  paid: 'default',
  clawback: 'destructive',
  void: 'outline',
};

const fmt = (n: number) =>
  `$${(Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FinancePortalCommissions() {
  const [tab, setTab] = useState<'commissions' | 'statements' | 'disputes' | 'clawbacks' | 'invoices' | 'banking'>('commissions');
  const [loading, setLoading] = useState(true);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [partners, setPartners] = useState<{ id: string; name: string; company: string | null }[]>([]);
  const [filterPartner, setFilterPartner] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [cRes, sRes, dRes, pRes] = await Promise.all([
        invokeSecureFunction('finance-portal-commissions', { operation: 'list_commissions' }),
        invokeSecureFunction('finance-portal-commissions', { operation: 'list_statements' }),
        invokeSecureFunction('finance-portal-commissions', { operation: 'list_disputes' }),
        invokeSecureFunction('finance-portal-admin', { operation: 'list_users' }),
      ]);
      if (cRes.error) throw new Error(cRes.error.message);
      if (sRes.error) throw new Error(sRes.error.message);
      setCommissions(cRes.data?.commissions || []);
      setStatements(sRes.data?.statements || []);
      setDisputes(dRes.data?.disputes || []);
      const users = pRes.data?.users || [];
      setPartners(users.map((u: any) => ({ id: u.id, name: u.name, company: u.company })));

    } catch (e: any) {
      toast.error('Failed to load: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const filteredCommissions = useMemo(() => {
    return commissions.filter(c => {
      if (filterPartner !== 'all' && c.finance_contact_id !== filterPartner) return false;
      if (filterStatus !== 'all' && c.status !== filterStatus) return false;
      if (search) {
        const s = search.toLowerCase();
        const hit =
          (c.partner_name_snapshot || '').toLowerCase().includes(s) ||
          (c.client_name_snapshot || '').toLowerCase().includes(s) ||
          (c.notes || '').toLowerCase().includes(s);
        if (!hit) return false;
      }
      return true;
    });
  }, [commissions, filterPartner, filterStatus, search]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const bulkSetStatus = async (status: string) => {
    if (selected.size === 0) return;
    const { error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'set_status', ids: Array.from(selected), status,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Updated ${selected.size} commission${selected.size === 1 ? '' : 's'}`);
    setSelected(new Set());
    void refresh();
  };

  const bulkSetClearedFunds = async (received: boolean) => {
    if (selected.size === 0) return;
    const reference = received ? (window.prompt('Cleared funds reference (optional):') || null) : null;
    const { error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'set_cleared_funds', ids: Array.from(selected), received, reference,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(received ? 'Cleared funds recorded' : 'Cleared funds cleared');
    setSelected(new Set());
    void refresh();
  };

  const issueStatement = async (id: string) => {
    const { error } = await invokeSecureFunction('finance-portal-commissions', { operation: 'issue_statement', id });
    if (error) { toast.error(error.message); return; }
    toast.success('Statement issued');
    void refresh();
  };

  const markPaid = async (id: string) => {
    const openCount = disputes.filter(d => d.statement_id === id && ['open', 'under_review'].includes(d.status)).length;
    if (openCount > 0 && !window.confirm(`This statement has ${openCount} open dispute${openCount === 1 ? '' : 's'}. Pay anyway?`)) return;
    const ref = window.prompt('Payment reference (optional):') || null;
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'mark_statement_paid', id, paid_reference: ref,
      ...(openCount > 0 ? { override_dispute: true } : {}),
    });
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success('Statement marked paid');
    void refresh();
  };

  const resolveDispute = async (id: string, status: string) => {
    const notes = window.prompt('Resolution notes (optional):') || null;
    const { error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'resolve_dispute', id, status, resolution_notes: notes,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Dispute updated');
    void refresh();
  };

  const raiseDispute = async (statementId: string) => {
    const reason = window.prompt('Reason for the dispute:');
    if (!reason) return;
    const { error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'raise_dispute', statement_id: statementId, reason, reason_category: 'other',
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Dispute raised');
    void refresh();
  };


  const downloadStatement = async (path: string) => {
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'admin_get_signed_url', path,
    });
    if (error) { toast.error(error.message); return; }
    if (data?.url) window.open(data.url, '_blank', 'noopener');
  };

  return (
    <DashboardThemeFrame variant="page" className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="rounded-xl">
          <Link to="/admin/finance-portal"><ArrowLeft className="h-4 w-4 mr-1" />Finance Portal</Link>
        </Button>
      </div>

      <DashboardThemeFrame variant="hero" as="header" className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight sm:text-3xl">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm shadow-primary/10">
              <DollarSign className="h-5 w-5" />
            </span>
            Commissions & Payouts
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Track partner commissions, issue statements, and process remittance.</p>
        </div>
        <Button onClick={refresh} variant="outline" size="sm" disabled={loading} className="rounded-xl border-border/70 bg-card/70 hover:border-primary/40 hover:bg-primary/10 hover:text-primary">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </DashboardThemeFrame>

      <DashboardThemeFrame variant="toolbar" className="p-1.5">
        <button
          type="button"
          onClick={() => setTab('commissions')}
          aria-pressed={tab === 'commissions'}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${tab === 'commissions' ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}
        ><DollarSign className="inline h-4 w-4 mr-1" />Commissions ({commissions.length})</button>
        <button
          type="button"
          onClick={() => setTab('statements')}
          aria-pressed={tab === 'statements'}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${tab === 'statements' ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}
        ><FileText className="inline h-4 w-4 mr-1" />Statements ({statements.length})</button>
        <button
          type="button"
          onClick={() => setTab('disputes')}
          aria-pressed={tab === 'disputes'}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${tab === 'disputes' ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}
        ><AlertTriangle className="inline h-4 w-4 mr-1" />Disputes ({disputes.filter(d => ['open', 'under_review'].includes(d.status)).length})</button>
        <button
          type="button"
          onClick={() => setTab('clawbacks')}
          aria-pressed={tab === 'clawbacks'}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${tab === 'clawbacks' ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}
        ><ShieldAlert className="inline h-4 w-4 mr-1" />Clawbacks</button>
        <button
          type="button"
          onClick={() => setTab('invoices')}
          aria-pressed={tab === 'invoices'}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${tab === 'invoices' ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}
        ><Receipt className="inline h-4 w-4 mr-1" />Invoices</button>
        <button
          type="button"
          onClick={() => setTab('banking')}
          aria-pressed={tab === 'banking'}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${tab === 'banking' ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}
        ><Landmark className="inline h-4 w-4 mr-1" />Banking</button>
      </DashboardThemeFrame>

      {tab === 'clawbacks' && (
        <DashboardThemeFrame variant="section" className="p-0">
          <ClawbackRegisterPanel partners={partners} commissions={commissions} onChanged={refresh} />
        </DashboardThemeFrame>
      )}

      {tab === 'invoices' && (
        <DashboardThemeFrame variant="section" className="p-0">
          <TaxInvoiceRegisterPanel partners={partners} statements={statements} onChanged={refresh} />
        </DashboardThemeFrame>
      )}

      {tab === 'banking' && (
        <DashboardThemeFrame variant="section" className="p-0">
          <PartnerBankingPanel partners={partners} onChanged={refresh} />
        </DashboardThemeFrame>
      )}


      {tab === 'commissions' && (
        <DashboardThemeFrame variant="section" className="p-0">
        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
            <div className="flex flex-wrap gap-3 items-center">
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search partner, client, notes…"
                aria-label="Search commissions"
                containerClassName="flex-1 min-w-[220px]"
                className="h-10 rounded-xl border-border/70 bg-background/75 shadow-inner focus-visible:ring-primary/35"
              />
              <Select value={filterPartner} onValueChange={setFilterPartner}>
                <SelectTrigger aria-label="Filter commissions by partner" className="h-10 w-[220px] rounded-xl border-border/70 bg-background/75"><SelectValue placeholder="Partner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All partners</SelectItem>
                  {partners.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{p.company ? ` · ${p.company}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger aria-label="Filter commissions by status" className="h-10 w-[160px] rounded-xl border-border/70 bg-background/75"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="invoiced">Invoiced</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="clawback">Clawback</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
                </SelectContent>
              </Select>
              <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="rounded-xl"><FileText className="h-4 w-4 mr-2" />Generate statement</Button>
                </DialogTrigger>
                <GenerateStatementDialog partners={partners} onClose={() => { setShowGenerate(false); refresh(); }} />
              </Dialog>
              <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogTrigger asChild>
                  <Button className="rounded-xl"><Plus className="h-4 w-4 mr-2" />Manual commission</Button>
                </DialogTrigger>
                <ManualCommissionDialog partners={partners} onClose={() => { setShowCreate(false); refresh(); }} />
              </Dialog>
            </div>

            {selected.size > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/20 bg-primary/10 p-2">
                <span className="text-sm">{selected.size} selected</span>
                <Button size="sm" variant="outline" onClick={() => bulkSetStatus('invoiced')}>Mark invoiced</Button>
                <Button size="sm" variant="outline" onClick={() => bulkSetStatus('paid')}>Mark paid</Button>
                <Button size="sm" variant="outline" onClick={() => bulkSetStatus('void')}>Void</Button>
                <Button size="sm" variant="outline" onClick={() => bulkSetClearedFunds(true)}>
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" />Funds cleared
                </Button>
                <Button size="sm" variant="ghost" onClick={() => bulkSetClearedFunds(false)}>Undo funds cleared</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading commissions…
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/75 shadow-inner shadow-black/5 dark:bg-background/35">
              <Table className="min-w-[1050px]" aria-label="Finance portal commissions">
                <TableHeader className="bg-muted/35">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8" />
                    <TableHead>Partner</TableHead>
                    <TableHead>Client / Deal</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead className="text-right">Basis</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>Rate source</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Funds</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>

                </TableHeader>
                <TableBody>
                  {filteredCommissions.length === 0 && (
                    <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No commissions found</TableCell></TableRow>
                  )}
                  {filteredCommissions.map(c => (
                    <TableRow key={c.id} className="transition-colors hover:bg-primary/5">
                      <TableCell><Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} aria-label={`Select commission ${c.id}`} /></TableCell>
                      <TableCell>
                        <div className="font-medium">{c.partner_name_snapshot || '—'}</div>
                        <div className="text-xs text-muted-foreground">{c.partner_company_snapshot || ''}</div>
                      </TableCell>
                      <TableCell>
                        <div>{c.client_name_snapshot || '—'}</div>
                        <div className="text-xs text-muted-foreground">{c.deal_type_snapshot || ''}</div>
                      </TableCell>
                      <TableCell><span className="text-xs">{c.qualifying_event || c.trigger_event || '—'}</span></TableCell>
                      <TableCell className="text-right">{fmt(c.basis_amount)}</TableCell>
                      <TableCell className="text-right">{Number(c.rate_pct).toFixed(2)}%</TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {(c.rate_source || 'partner_default').replace(/_/g, ' ')}
                          {c.agreement_version ? ` · v${c.agreement_version}` : ''}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{fmt(c.net_amount)}</TableCell>
                      <TableCell>
                        {!c.cleared_funds_required ? (
                          <span className="text-xs text-muted-foreground">n/a</span>
                        ) : c.cleared_funds_received_at ? (
                          <Badge variant="default" className="text-xs">Cleared</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">Awaiting funds</Badge>
                        )}
                      </TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[c.status] || 'outline'}>{c.status}</Badge></TableCell>
                      <TableCell className="text-xs">{format(new Date(c.created_at), 'd MMM yyyy')}</TableCell>

                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
        </DashboardThemeFrame>
      )}

      {tab === 'statements' && (
        <DashboardThemeFrame variant="section" className="p-0">
        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5"><CardTitle className="text-base">Partner statements</CardTitle></CardHeader>
          <CardContent className="p-4 sm:p-5">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading…
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/75 shadow-inner shadow-black/5 dark:bg-background/35">
              <Table className="min-w-[880px]" aria-label="Finance portal commission statements">
                <TableHeader className="bg-muted/35">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Partner</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Dispute window</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statements.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No statements yet</TableCell></TableRow>
                  )}
                  {statements.map(s => {
                    const open = disputes.filter(d => d.statement_id === s.id && ['open', 'under_review'].includes(d.status)).length;
                    return (
                    <TableRow key={s.id} className="transition-colors hover:bg-primary/5">
                      <TableCell>
                        <div className="font-medium">{s.partner_name_snapshot}</div>
                        <div className="text-xs text-muted-foreground">{s.partner_company_snapshot}</div>
                      </TableCell>
                      <TableCell className="text-sm">{s.period_start} → {s.period_end}</TableCell>
                      <TableCell className="text-right">{s.line_count}</TableCell>
                      <TableCell className="text-right font-semibold">{fmt(s.total_net)}</TableCell>
                      <TableCell className="text-xs">
                        {s.dispute_deadline
                          ? <>Closes {s.dispute_deadline}{s.dispute_window_days ? ` (${s.dispute_window_days}d)` : ''}</>
                          : <span className="text-muted-foreground">—</span>}
                        {open > 0 && (
                          <Badge variant="destructive" className="ml-2 text-[10px]">{open} open</Badge>
                        )}
                      </TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[s.status] || 'outline'}>{s.status}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        {s.status === 'draft' && (
                          <Button size="sm" variant="outline" onClick={() => issueStatement(s.id)}>Issue</Button>
                        )}
                        {s.status === 'issued' && (
                          <Button size="sm" variant="outline" onClick={() => markPaid(s.id)}>Mark paid</Button>
                        )}
                        {s.status !== 'draft' && (
                          <Button size="sm" variant="ghost" onClick={() => raiseDispute(s.id)} aria-label={`Raise dispute on statement ${s.id}`}>
                            <AlertTriangle className="h-4 w-4" />
                          </Button>
                        )}

                        {s.pdf_storage_path && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => downloadStatement(s.pdf_storage_path!)} aria-label={`Download statement ${s.id}`}>
                              <Download className="h-4 w-4" />
                            </Button>
                            <FlattenPdfIconButton
                              getPdfBlob={async () => {
                                const { data, error } = await invokeSecureFunction('finance-portal-commissions', {
                                  operation: 'admin_get_signed_url', path: s.pdf_storage_path,
                                });
                                if (error || !data?.url) throw new Error(error?.message || 'No URL');
                                return fetchPdfBlob(data.url);
                              }}
                              filename={`commission-statement-${s.id}.pdf`}
                              variant="ghost"
                              size="sm"
                            />
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ); })}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
        </DashboardThemeFrame>
      )}

      {tab === 'disputes' && (
        <DashboardThemeFrame variant="section" className="p-0">
        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
            <CardTitle className="text-base">Statement disputes</CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading…
              </div>
            ) : disputes.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No disputes raised. Partners can raise a dispute from their earnings statement within the agreed window.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/75 shadow-inner shadow-black/5 dark:bg-background/35">
              <Table className="min-w-[900px]" aria-label="Commission statement disputes">
                <TableHeader className="bg-muted/35">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Raised</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Window</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {disputes.map(d => (
                    <TableRow key={d.id} className="transition-colors hover:bg-primary/5">
                      <TableCell className="text-xs">{format(new Date(d.raised_at), 'd MMM yyyy')}</TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">{d.raised_by_name || d.raised_by_type}</div>
                        <div className="text-muted-foreground">{d.raised_by_type}</div>
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{(d.reason_category || '').replace(/_/g, ' ')}</div>
                        <div className="text-sm">{d.reason}</div>
                        {d.resolution_notes && (
                          <div className="mt-1 text-xs text-muted-foreground">Resolution: {d.resolution_notes}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{d.disputed_amount != null ? fmt(d.disputed_amount) : '—'}</TableCell>
                      <TableCell>
                        <Badge variant={d.within_window ? 'secondary' : 'destructive'} className="text-xs">
                          {d.within_window ? 'In window' : 'Out of window'}
                        </Badge>
                      </TableCell>
                      <TableCell><Badge variant={['resolved'].includes(d.status) ? 'default' : d.status === 'rejected' ? 'destructive' : 'secondary'}>{d.status.replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        {['open', 'under_review'].includes(d.status) && (
                          <>
                            {d.status === 'open' && (
                              <Button size="sm" variant="ghost" onClick={() => resolveDispute(d.id, 'under_review')}>Review</Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => resolveDispute(d.id, 'resolved')}>Resolve</Button>
                            <Button size="sm" variant="ghost" onClick={() => resolveDispute(d.id, 'rejected')}>Reject</Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
        </DashboardThemeFrame>
      )}

    </DashboardThemeFrame>
  );
}

// ── Manual commission dialog ────────────────────────────────────────────────
function ManualCommissionDialog({ partners, onClose }: { partners: any[]; onClose: () => void }) {
  const [partnerId, setPartnerId] = useState('');
  const [basis, setBasis] = useState('');
  const [rate, setRate] = useState('0.55');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!partnerId) { toast.error('Select a partner'); return; }
    setSaving(true);
    const { error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'create_manual',
      finance_contact_id: partnerId,
      basis_amount: Number(basis) || 0,
      rate_pct: Number(rate) || 0,
      notes,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Commission created');
    onClose();
  };

  return (
    <DialogContent className="max-w-lg rounded-2xl border-border/70 bg-card/95 p-0 shadow-2xl shadow-black/15 backdrop-blur">
      <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-card/90 to-muted/25 p-5">
        <DialogTitle>Manual commission line</DialogTitle>
        <DialogDescription>Add an ad-hoc commission for a partner.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 p-5">
        <div>
          <Label>Partner</Label>
          <Select value={partnerId} onValueChange={setPartnerId}>
            <SelectTrigger aria-label="Select partner for manual commission"><SelectValue placeholder="Select partner" /></SelectTrigger>
            <SelectContent>
              {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.company ? ` · ${p.company}` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Basis amount ($)</Label><Input type="number" value={basis} onChange={e => setBasis(e.target.value)} aria-label="Manual commission basis amount" /></div>
          <div><Label>Rate (%)</Label><Input type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} aria-label="Manual commission rate percentage" /></div>
        </div>
        <div><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
      </div>
      <DialogFooter className="border-t border-border/60 bg-muted/20 p-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Create</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Generate statement dialog ───────────────────────────────────────────────
function GenerateStatementDialog({ partners, onClose }: { partners: any[]; onClose: () => void }) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [partnerId, setPartnerId] = useState('');
  const [start, setStart] = useState(firstOfMonth);
  const [end, setEnd] = useState(lastOfMonth);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!partnerId) { toast.error('Select a partner'); return; }
    setSaving(true);
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'generate_statement', partner_id: partnerId, period_start: start, period_end: end,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Statement created with ${data?.line_count || 0} line${data?.line_count === 1 ? '' : 's'}`);
    onClose();
  };

  return (
    <DialogContent className="max-w-lg rounded-2xl border-border/70 bg-card/95 p-0 shadow-2xl shadow-black/15 backdrop-blur">
      <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-card/90 to-muted/25 p-5">
        <DialogTitle>Generate statement</DialogTitle>
        <DialogDescription>Pulls all eligible (pending / invoiced) commissions in the period that aren't already on a statement.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 p-5">
        <div>
          <Label>Partner</Label>
          <Select value={partnerId} onValueChange={setPartnerId}>
            <SelectTrigger aria-label="Select partner for statement generation"><SelectValue placeholder="Select partner" /></SelectTrigger>
            <SelectContent>
              {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.company ? ` · ${p.company}` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Period start</Label><Input type="date" value={start} onChange={e => setStart(e.target.value)} aria-label="Statement period start date" /></div>
          <div><Label>Period end</Label><Input type="date" value={end} onChange={e => setEnd(e.target.value)} aria-label="Statement period end date" /></div>
        </div>
      </div>
      <DialogFooter className="border-t border-border/60 bg-muted/20 p-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Generate</Button>
      </DialogFooter>
    </DialogContent>
  );
}
