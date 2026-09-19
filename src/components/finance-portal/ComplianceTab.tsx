/**
 * Compliance Tab (Batch 7 — Documents & Compliance Power)
 *
 * Combines: doc OCR/anti-tamper, VOI, bank statements, credit checks,
 * discovery eSignatures, and the NCCP compliance bundle on a single tab.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  ShieldCheck, ShieldAlert, FileSearch, FileSignature, Banknote, Gauge,
  PackageCheck, Loader2, Plus, Send, CheckCircle2, AlertTriangle, RefreshCw,
  ExternalLink, Eye,
} from 'lucide-react';
import { format } from 'date-fns';

const FN = 'finance-portal-batch7';

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground border-border',
  sent: 'bg-info/15 text-info border-info/30',
  in_progress: 'bg-info/15 text-info border-info/30',
  consent_sent: 'bg-info/15 text-info border-info/30',
  connected: 'bg-info/15 text-info border-info/30',
  signed: 'bg-success/15 text-success border-success/30',
  passed: 'bg-success/15 text-success border-success/30',
  complete: 'bg-success/15 text-success border-success/30',
  received: 'bg-success/15 text-success border-success/30',
  ready: 'bg-success/15 text-success border-success/30',
  warning: 'bg-brand-500/15 text-brand-500 border-brand-500/30',
  draft: 'bg-brand-500/15 text-brand-500 border-brand-500/30',
  expired: 'bg-brand-500/15 text-brand-500 border-brand-500/30',
  failed: 'bg-destructive/15 text-destructive border-destructive/30',
  error: 'bg-destructive/15 text-destructive border-destructive/30',
  declined: 'bg-destructive/15 text-destructive border-destructive/30',
  voided: 'bg-destructive/15 text-destructive border-destructive/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
  archived: 'bg-muted text-muted-foreground border-border',
};
const tone = (s: string) => STATUS_TONE[s] || 'bg-muted text-muted-foreground border-border';

export function ComplianceTab({ fileId, clientId }: { fileId: string; clientId?: string | null }) {
  return (
    <div className="space-y-4">
      <DocComplianceCard fileId={fileId} />
      <VoiCard fileId={fileId} clientId={clientId} />
      <BankStatementsCard fileId={fileId} clientId={clientId} />
      <CreditChecksCard fileId={fileId} clientId={clientId} />
      <DiscoverySignaturesCard fileId={fileId} clientId={clientId} />
      <NccpBundleCard fileId={fileId} />
    </div>
  );
}

/* ============================================================ */
/* #38 Doc OCR + Anti-Tamper                                    */
/* ============================================================ */
function DocComplianceCard({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [running, setRunning] = useState(false);

  const { data: checks } = useQuery({
    queryKey: ['compliance-checks', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, { operation: 'compliance_list', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.checks || []) as any[];
    },
  });

  const runCheck = async () => {
    if (!url.trim()) return toast.error('Document URL required');
    setRunning(true);
    const { data, error } = await invokeFinanceFunction(FN, {
      operation: 'compliance_run_check',
      purchase_file_id: fileId,
      label: label || 'document',
      document_url: url.trim(),
    });
    setRunning(false);
    if (error) return toast.error(error.message);
    toast.success(`Check ${data?.check?.status ?? 'complete'}`);
    qc.invalidateQueries({ queryKey: ['compliance-checks', fileId] });
    setOpen(false); setLabel(''); setUrl('');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2"><FileSearch className="h-5 w-5 text-primary" />Document OCR &amp; anti-tamper</CardTitle>
          <CardDescription>OCR each upload, extract identity/dates, flag editing or expiry.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Run check</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!checks?.length && <p className="text-sm text-muted-foreground">No checks yet.</p>}
        {(checks || []).map(c => (
          <div key={c.id} className="border border-border rounded-md p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={tone(c.status)}>{c.status}</Badge>
                <span className="text-sm font-medium">{c.detected_doc_type || c.check_type}</span>
                {c.tamper_score != null && (
                  <span className="text-xs text-muted-foreground">tamper {Math.round(c.tamper_score * 100)}%</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">{format(new Date(c.ran_at), 'd MMM HH:mm')}</span>
            </div>
            {c.ai_summary && <p className="text-xs text-muted-foreground">{c.ai_summary}</p>}
            {Array.isArray(c.findings) && c.findings.length > 0 && (
              <ul className="text-xs space-y-0.5">
                {c.findings.slice(0, 4).map((f: any, i: number) => (
                  <li key={i} className={
                    f.severity === 'fail' ? 'text-destructive' :
                    f.severity === 'warn' ? 'text-brand-500' :
                    'text-muted-foreground'
                  }>• {f.message}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Run compliance check</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Document label</Label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Payslip — June" />
            </div>
            <div>
              <Label>Document URL (PDF or image)</Label>
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
              <p className="text-xs text-muted-foreground mt-1">Must be a public/signed URL the AI can fetch.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={runCheck} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSearch className="h-4 w-4 mr-1" />}
              Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ============================================================ */
/* #39 VOI                                                      */
/* ============================================================ */
function VoiCard({ fileId, clientId }: { fileId: string; clientId?: string | null }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [provider, setProvider] = useState('stub');
  const [sending, setSending] = useState(false);

  const { data: verifications } = useQuery({
    queryKey: ['voi-list', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, { operation: 'voi_list', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.verifications || []) as any[];
    },
  });

  const send = async () => {
    setSending(true);
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'voi_create', purchase_file_id: fileId, client_id: clientId ?? null, provider,
    });
    setSending(false);
    if (error) return toast.error(error.message);
    toast.success('VOI invite sent');
    qc.invalidateQueries({ queryKey: ['voi-list', fileId] });
  };
  const mark = async (id: string, status: string) => {
    const { error } = await invokeFinanceFunction(FN, { operation: 'voi_update_status', id, status });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ['voi-list', fileId] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Verification of Identity (VOI)</CardTitle>
          <CardDescription>Digital ID + selfie match via Frankie / IDVerse. Stub provider available.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="stub">Stub</SelectItem>
              <SelectItem value="frankie">Frankie</SelectItem>
              <SelectItem value="idverse">IDVerse</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={send} disabled={sending}><Send className="h-4 w-4 mr-1" />Send invite</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!verifications?.length && <p className="text-sm text-muted-foreground">No VOI requests yet.</p>}
        {(verifications || []).map(v => (
          <div key={v.id} className="border border-border rounded-md p-3 flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={tone(v.status)}>{v.status}</Badge>
                <span className="text-sm font-medium">{v.provider}</span>
              </div>
              {v.verification_url && (
                <a className="text-xs text-primary inline-flex items-center gap-1" href={v.verification_url} target="_blank" rel="noreferrer">
                  Verification link <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <div className="text-xs text-muted-foreground">Created {format(new Date(v.created_at), 'd MMM')}</div>
            </div>
            {v.status !== 'passed' && v.status !== 'failed' && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => mark(v.id, 'passed')}><CheckCircle2 className="h-4 w-4 mr-1" />Pass</Button>
                <Button size="sm" variant="outline" onClick={() => mark(v.id, 'failed')}><AlertTriangle className="h-4 w-4 mr-1" />Fail</Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/* #40 Bank Statement Connector                                 */
/* ============================================================ */
function BankStatementsCard({ fileId, clientId }: { fileId: string; clientId?: string | null }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [provider, setProvider] = useState('illion');
  const [periodDays, setPeriodDays] = useState(90);
  const [sending, setSending] = useState(false);

  const { data: requests } = useQuery({
    queryKey: ['bank-stmts', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, { operation: 'bank_stmts_list', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.requests || []) as any[];
    },
  });

  const send = async () => {
    setSending(true);
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'bank_stmts_request', purchase_file_id: fileId, client_id: clientId ?? null, provider, period_days: periodDays,
    });
    setSending(false);
    if (error) return toast.error(error.message);
    toast.success('Consent link issued');
    qc.invalidateQueries({ queryKey: ['bank-stmts', fileId] });
  };

  const mark = async (id: string, status: string) => {
    const { error } = await invokeFinanceFunction(FN, { operation: 'bank_stmts_update_status', id, status });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ['bank-stmts', fileId] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2"><Banknote className="h-5 w-5 text-primary" />Bank statement connector</CardTitle>
          <CardDescription>Pull 90-day statements via Illion or BankStatements.com.au.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="illion">Illion</SelectItem>
              <SelectItem value="bankstatements">BankStatements</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="stub">Stub</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" className="w-20" value={periodDays} onChange={e => setPeriodDays(Number(e.target.value) || 90)} />
          <Button size="sm" onClick={send} disabled={sending}><Send className="h-4 w-4 mr-1" />Request</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!requests?.length && <p className="text-sm text-muted-foreground">No requests yet.</p>}
        {(requests || []).map(r => (
          <div key={r.id} className="border border-border rounded-md p-3 flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={tone(r.status)}>{r.status}</Badge>
                <span className="text-sm font-medium">{r.provider}</span>
                <span className="text-xs text-muted-foreground">{r.period_days}d</span>
                {r.account_count != null && <span className="text-xs text-muted-foreground">{r.account_count} accts</span>}
              </div>
              {r.consent_url && (
                <a className="text-xs text-primary inline-flex items-center gap-1" href={r.consent_url} target="_blank" rel="noreferrer">
                  Consent link <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            {r.status !== 'received' && r.status !== 'cancelled' && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => mark(r.id, 'received')}><CheckCircle2 className="h-4 w-4 mr-1" />Mark received</Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/* #41 Credit Checks                                            */
/* ============================================================ */
function CreditChecksCard({ fileId, clientId }: { fileId: string; clientId?: string | null }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('equifax');
  const [consent, setConsent] = useState(false);
  const [resultOpen, setResultOpen] = useState<any | null>(null);
  const [score, setScore] = useState('');
  const [band, setBand] = useState('');
  const [reportUrl, setReportUrl] = useState('');

  const { data: checks } = useQuery({
    queryKey: ['credit-checks', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, { operation: 'credit_list', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.checks || []) as any[];
    },
  });

  const create = async () => {
    if (!consent) return toast.error('Client consent required');
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'credit_create', purchase_file_id: fileId, client_id: clientId ?? null, provider, consent_given: true,
    });
    if (error) return toast.error(error.message);
    toast.success('Credit check requested');
    qc.invalidateQueries({ queryKey: ['credit-checks', fileId] });
    setOpen(false); setConsent(false);
  };

  const record = async () => {
    if (!resultOpen) return;
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'credit_record_result',
      id: resultOpen.id,
      status: 'complete',
      score: score ? Number(score) : undefined,
      band: band || undefined,
      report_url: reportUrl || undefined,
    });
    if (error) return toast.error(error.message);
    toast.success('Result recorded');
    qc.invalidateQueries({ queryKey: ['credit-checks', fileId] });
    setResultOpen(null); setScore(''); setBand(''); setReportUrl('');
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2"><Gauge className="h-5 w-5 text-primary" />Credit check</CardTitle>
          <CardDescription>One-click Equifax / Experian with consent capture.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />New check</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!checks?.length && <p className="text-sm text-muted-foreground">No credit checks yet.</p>}
        {(checks || []).map(c => (
          <div key={c.id} className="border border-border rounded-md p-3 flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={tone(c.status)}>{c.status}</Badge>
                <span className="text-sm font-medium">{c.provider}</span>
                {c.score != null && <span className="text-sm">score <strong>{c.score}</strong></span>}
                {c.band && <span className="text-xs text-muted-foreground">{c.band}</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {c.consent_given_at ? `Consent ${format(new Date(c.consent_given_at), 'd MMM')}` : 'No consent'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {c.report_url && (
                <a className="text-xs text-primary inline-flex items-center gap-1" href={c.report_url} target="_blank" rel="noreferrer">
                  Report <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {c.status !== 'complete' && (
                <Button size="sm" variant="outline" onClick={() => setResultOpen(c)}>Record result</Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New credit check</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="equifax">Equifax</SelectItem>
                  <SelectItem value="experian">Experian</SelectItem>
                  <SelectItem value="illion">Illion</SelectItem>
                  <SelectItem value="stub">Stub</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="text-sm">
                <div className="font-medium">Client consent obtained</div>
                <div className="text-xs text-muted-foreground">Tick to confirm written/verbal consent under the Privacy Act.</div>
              </div>
              <Switch checked={consent} onCheckedChange={setConsent} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={!consent}>Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resultOpen} onOpenChange={v => !v && setResultOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record credit result</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Score</Label>
                <Input value={score} onChange={e => setScore(e.target.value)} placeholder="e.g. 720" />
              </div>
              <div>
                <Label>Band</Label>
                <Input value={band} onChange={e => setBand(e.target.value)} placeholder="Excellent" />
              </div>
            </div>
            <div>
              <Label>Report URL</Label>
              <Input value={reportUrl} onChange={e => setReportUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResultOpen(null)}>Cancel</Button>
            <Button onClick={record}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ============================================================ */
/* #42 Discovery Signatures                                     */
/* ============================================================ */
const DISCOVERY_TYPES = [
  { value: 'privacy_consent',    label: 'Privacy Act Consent' },
  { value: 'credit_guide',       label: 'Credit Guide Acknowledgement' },
  { value: 'fact_find_ack',      label: 'Fact Find Acknowledgement' },
  { value: 'best_interest_duty', label: 'Best Interest Duty Record' },
  { value: 'credit_proposal',    label: 'Credit Proposal Disclosure' },
  { value: 'fee_disclosure',     label: 'Fee Disclosure' },
];

function DiscoverySignaturesCard({ fileId, clientId }: { fileId: string; clientId?: string | null }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState('privacy_consent');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');

  const { data: sigs } = useQuery({
    queryKey: ['discovery-sigs', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, { operation: 'discovery_list', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.signatures || []) as any[];
    },
  });

  const send = async () => {
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'discovery_send',
      purchase_file_id: fileId,
      client_id: clientId ?? null,
      doc_type: docType,
      doc_label: DISCOVERY_TYPES.find(t => t.value === docType)?.label,
      recipient_email: recipientEmail || null,
      recipient_name: recipientName || null,
    });
    if (error) return toast.error(error.message);
    toast.success('Envelope created');
    qc.invalidateQueries({ queryKey: ['discovery-sigs', fileId] });
    setOpen(false); setRecipientEmail(''); setRecipientName('');
  };

  const mark = async (id: string, status: string) => {
    const { error } = await invokeFinanceFunction(FN, { operation: 'discovery_update_status', id, status });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ['discovery-sigs', fileId] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2"><FileSignature className="h-5 w-5 text-primary" />Discovery eSignatures</CardTitle>
          <CardDescription>Privacy Act, Credit Guide, Fact Find &amp; more via DocuSign.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Send for signature</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!sigs?.length && <p className="text-sm text-muted-foreground">No envelopes yet.</p>}
        {(sigs || []).map(s => (
          <div key={s.id} className="border border-border rounded-md p-3 flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={tone(s.status)}>{s.status}</Badge>
                <span className="text-sm font-medium">{s.doc_label || s.doc_type}</span>
                <span className="text-xs text-muted-foreground">{s.provider}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {s.recipient_name || s.recipient_email || '—'}
                {s.sent_at && ` · sent ${format(new Date(s.sent_at), 'd MMM')}`}
                {s.signed_at && ` · signed ${format(new Date(s.signed_at), 'd MMM')}`}
              </div>
            </div>
            {s.status !== 'signed' && s.status !== 'voided' && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => mark(s.id, 'signed')}><CheckCircle2 className="h-4 w-4 mr-1" />Mark signed</Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send for signature</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Document type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DISCOVERY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Recipient name</Label>
                <Input value={recipientName} onChange={e => setRecipientName(e.target.value)} />
              </div>
              <div>
                <Label>Recipient email</Label>
                <Input value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={send}><Send className="h-4 w-4 mr-1" />Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ============================================================ */
/* #43 NCCP Compliance Bundle                                   */
/* ============================================================ */
function NccpBundleCard({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [building, setBuilding] = useState(false);

  const { data: bundles } = useQuery({
    queryKey: ['nccp-bundles', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, { operation: 'nccp_list', purchase_file_id: fileId });
      if (error) throw new Error(error.message);
      return (data?.bundles || []) as any[];
    },
  });
  const latest = bundles?.[0];

  const build = async () => {
    setBuilding(true);
    const { error } = await invokeFinanceFunction(FN, { operation: 'nccp_build', purchase_file_id: fileId });
    setBuilding(false);
    if (error) return toast.error(error.message);
    toast.success('NCCP bundle generated');
    qc.invalidateQueries({ queryKey: ['nccp-bundles', fileId] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-primary" />NCCP compliance vault</CardTitle>
          <CardDescription>Auto-bundles all required broker compliance docs for audit.</CardDescription>
        </div>
        <Button size="sm" onClick={build} disabled={building}>
          {building ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {latest ? 'Rebuild' : 'Build bundle'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!latest && <p className="text-sm text-muted-foreground">No bundle generated yet.</p>}
        {latest && (
          <>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className={tone(latest.status)}>{latest.status}</Badge>
              <span className="text-xs text-muted-foreground">
                Generated {format(new Date(latest.generated_at), 'd MMM HH:mm')}
              </span>
              <div className="flex-1 max-w-xs">
                <Progress value={Number(latest.completeness_pct || 0)} />
              </div>
              <span className="text-sm font-medium">{Math.round(Number(latest.completeness_pct || 0))}%</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(latest.manifest || []).map((m: any) => (
                <div key={m.key} className="flex items-center justify-between border border-border rounded-md p-2">
                  <div>
                    <div className="text-sm font-medium">{m.label}</div>
                    <div className="text-xs text-muted-foreground">{m.category}</div>
                  </div>
                  {m.present
                    ? <Badge variant="outline" className="bg-success/15 text-success border-success/30"><CheckCircle2 className="h-3 w-3 mr-1" />Present</Badge>
                    : <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30"><AlertTriangle className="h-3 w-3 mr-1" />Missing</Badge>
                  }
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
