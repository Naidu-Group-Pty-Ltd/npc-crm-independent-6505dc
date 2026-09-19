/**
 * EnvelopeStatusDialog — DocuSign envelope status, signer progress, and audit trail.
 * Works for both agency_agreements and generated_documents.
 */
import { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, RefreshCw, CheckCircle2, Clock, Mail, Eye, XCircle, AlertTriangle, FileText, Download, UserRound, CalendarDays, FileCheck2, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { AgencyAgreement } from '@/hooks/useAgencyAgreements';

interface Signer {
  name: string; email: string; status: string; routingOrder: string;
  sentAt?: string; deliveredAt?: string; signedAt?: string; declinedReason?: string;
}
interface AuditEvent { action: string; description: string; user: string; email: string; timestamp: string; }
interface Envelope {
  envelopeId: string; status: string; emailSubject?: string;
  sentDateTime?: string; statusChangedDateTime?: string; completedDateTime?: string;
  voidedDateTime?: string; voidedReason?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: 'agreement' | 'document';
  recordId: string;
  title?: string;
  agreement?: AgencyAgreement;
  onStatusRefreshed?: (mappedStatus: string) => void;
}

const STATUS_TONE: Record<string, { tone: string; icon: any; label: string }> = {
  sent: { tone: 'border-brand-300/70 bg-brand-500/14 text-brand-950 ring-1 ring-brand-300/25 dark:border-brand-200/40 dark:bg-brand-300/14 dark:text-brand-100 dark:ring-brand-200/10', icon: Mail, label: 'Sent' },
  delivered: { tone: 'border-brand-300/70 bg-brand-500/14 text-brand-950 ring-1 ring-brand-300/25 dark:border-brand-200/40 dark:bg-brand-300/14 dark:text-brand-100 dark:ring-brand-200/10', icon: Eye, label: 'Delivered' },
  completed: { tone: 'border-success/70 bg-success/14 text-success ring-1 ring-success/25 dark:border-success/40 dark:bg-success/14 dark:text-success dark:ring-success/10', icon: CheckCircle2, label: 'Completed' },
  signed: { tone: 'border-success/70 bg-success/14 text-success ring-1 ring-success/25 dark:border-success/40 dark:bg-success/14 dark:text-success dark:ring-success/10', icon: CheckCircle2, label: 'Signed' },
  declined: { tone: 'border-destructive/55 bg-destructive/10 text-destructive dark:border-destructive/30 dark:bg-destructive/10 dark:text-destructive', icon: XCircle, label: 'Declined' },
  voided: { tone: 'border-destructive/55 bg-destructive/10 text-destructive dark:border-destructive/30 dark:bg-destructive/10 dark:text-destructive', icon: AlertTriangle, label: 'Voided' },
  expired: { tone: 'border-destructive/55 bg-destructive/10 text-destructive dark:border-destructive/30 dark:bg-destructive/10 dark:text-destructive', icon: Clock, label: 'Expired' },
  created: { tone: 'border-border/70 bg-muted/80 text-foreground dark:border-border/70 dark:bg-background/70 dark:text-foreground', icon: Clock, label: 'Created' },
  generated: { tone: 'border-border/70 bg-muted/80 text-foreground dark:border-border/70 dark:bg-background/70 dark:text-foreground', icon: FileText, label: 'Generated' },
  draft: { tone: 'border-border/70 bg-muted/80 text-foreground dark:border-border/70 dark:bg-background/70 dark:text-foreground', icon: FileText, label: 'Draft' },
  autoresponded: { tone: 'border-brand-300/55 bg-brand-500/14 text-brand-900 dark:border-brand-200/35 dark:bg-brand-300/14 dark:text-brand-100', icon: AlertTriangle, label: 'Bounced' },
};

/**
 * The label this badge would draw for a status, without drawing it.
 *
 * Exported so the agreements ledger can ask whether the envelope badge would
 * merely repeat the agreement's own — see `envelopeBadgeIsRedundant`. The
 * comparison has to be on the label rather than the code, and the label lives
 * here, so this is the one place that knows it.
 */
export function docuSignStatusLabel(status?: string | null): string | null {
  if (!status) return null;
  return STATUS_TONE[status.toLowerCase()]?.label ?? status;
}

export function DocuSignStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const key = status.toLowerCase();
  const cfg = STATUS_TONE[key] || {
    tone: 'border-border/70 bg-muted/80 text-foreground dark:border-border/70 dark:bg-background/70 dark:text-foreground',
    icon: Clock,
    label: status,
  };
  const Icon = cfg.icon;
  return (
    <Badge
      className={`max-w-full justify-start gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-bold uppercase leading-4 tracking-[0.075em] shadow-sm backdrop-blur ${cfg.tone}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">{cfg.label}</span>
    </Badge>
  );
}
const StatusBadge = DocuSignStatusBadge;

function fmt(ts?: string | null) { return ts ? format(new Date(ts), 'dd MMM yy HH:mm') : '—'; }
function fmtDate(ts?: string | null) { return ts ? format(new Date(ts), 'dd MMM yyyy') : '—'; }

function DetailRow({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-background/80 p-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.45),0_8px_22px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-background/45 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <dt className="text-[0.66rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words text-sm font-medium text-foreground ${mono ? 'font-mono text-xs leading-5' : ''}`}>
        {value || '—'}
      </dd>
    </div>
  );
}

function CaseFileSection({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.52),0_16px_42px_rgba(15,23,42,0.07)] ring-1 ring-border dark:ring-white/50 dark:border-white/10 dark:bg-background/55 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_20px_48px_rgba(0,0,0,0.30)] dark:ring-white/10">
      <div className="flex items-center gap-2 border-b border-border/65 bg-muted/40 px-4 py-3 backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.045]">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <Icon className="h-4 w-4" />
        </span>
        <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-foreground">{title}</h4>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EnvelopeStatusDialog({ open, onOpenChange, scope, recordId, title, agreement, onStatusRefreshed }: Props) {
  const [loading, setLoading] = useState(false);
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [signers, setSigners] = useState<Signer[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const downloadSigned = useCallback(async () => {
    setDownloading(true);
    try {
      const fn = scope === 'agreement' ? 'manage-agency-agreements' : 'manage-generated-documents';
      const payload = scope === 'agreement'
        ? { action: 'download_signed', agreement_id: recordId }
        : { action: 'download_signed', id: recordId };
      const { data, error: invErr } = await invokeSecureFunction<any>(fn, payload);
      if (invErr) throw new Error(invErr.message);
      if (!data?.success) throw new Error(data?.error || 'Download failed');
      const bin = atob(data.pdf_base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = data.filename || 'signed.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Signed PDF downloaded');
    } catch (e: any) {
      toast.error(e.message);
    } finally { setDownloading(false); }
  }, [scope, recordId]);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const fn = scope === 'agreement' ? 'manage-agency-agreements' : 'manage-generated-documents';
      const payload = scope === 'agreement'
        ? { action: 'envelope_details', agreement_id: recordId }
        : { action: 'envelope_details', id: recordId };
      const { data, error: invErr } = await invokeSecureFunction<any>(fn, payload);
      if (invErr) throw new Error(invErr.message);
      if (!data?.success && data?.error) throw new Error(data.error);
      setEnvelope(data.envelope);
      setSigners(data.signers || []);
      setEvents(data.events || []);
      if (data.mapped_status) onStatusRefreshed?.(data.mapped_status);
    } catch (e: any) {
      setError(e.message); toast.error(e.message);
    } finally { setLoading(false); }
  }, [scope, recordId, onStatusRefreshed]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,58rem)] w-[calc(100vw-1.5rem)] max-w-5xl flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(180deg,hsl(var(--card)),hsl(var(--background)/0.96))] p-0 text-card-foreground shadow-[0_34px_110px_rgba(15,23,42,0.30)] ring-1 ring-border dark:ring-white/70 backdrop-blur supports-[backdrop-filter]:bg-card/90 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.96))] dark:shadow-black/45 dark:ring-white/10 sm:w-full">
        <DialogHeader className="border-b border-border/70 bg-[radial-gradient(circle_at_top_left,hsl(43_84%_52%/0.18),transparent_34%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--muted)/0.38))] px-5 py-5 dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,hsl(43_84%_52%/0.16),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.92),rgba(2,6,23,0.86))] sm:px-6">
          <DialogTitle className="flex min-w-0 flex-col gap-4 pr-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-300/35 bg-brand-500/10 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-brand-700 shadow-sm dark:border-brand-200/25 dark:text-brand-100">
                <ShieldCheck className="h-3.5 w-3.5" />
                Agreement case file
              </div>
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-brand-300/35 bg-[linear-gradient(135deg,hsl(48_96%_89%),hsl(43_84%_52%)_52%,hsl(38_92%_50%))] text-foreground shadow-lg shadow-brand-500/20">
                  <FileText className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <span className="block break-words text-xl font-bold leading-tight text-foreground sm:text-2xl">
                    {agreement?.buyer_names || title || 'Envelope Status'}
                  </span>
                  {agreement?.buyer_email && (
                    <span className="mt-1 block break-all text-sm font-medium text-muted-foreground">{agreement.buyer_email}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {agreement?.status && <StatusBadge status={agreement.status} />}
                <StatusBadge status={envelope?.status || agreement?.docusign_status} />
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {envelope?.status === 'completed' && (
                <>
                  <Button size="sm" variant="default" onClick={downloadSigned} disabled={downloading} className="h-10 rounded-xl gap-2 shadow-md shadow-primary/15">
                    {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download Signed PDF
                  </Button>
                  <FlattenPdfIconButton
                    getPdfBlob={async () => {
                      const fn = scope === 'agreement' ? 'manage-agency-agreements' : 'manage-generated-documents';
                      const payload = scope === 'agreement'
                        ? { action: 'download_signed', agreement_id: recordId }
                        : { action: 'download_signed', id: recordId };
                      const { data, error: invErr } = await invokeSecureFunction<any>(fn, payload);
                      if (invErr) throw new Error(invErr.message);
                      if (!data?.success) throw new Error(data?.error || 'Download failed');
                      const bin = atob(data.pdf_base64);
                      const bytes = new Uint8Array(bin.length);
                      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                      return new Blob([bytes], { type: 'application/pdf' });
                    }}
                    filename={title ? `${title.replace(/\s+/g, '_')}-signed.pdf` : 'signed.pdf'}
                    disabled={downloading}
                  />
                </>
              )}
              <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="h-10 rounded-xl border-border/70 bg-background/80 gap-2 shadow-sm hover:bg-primary/10 hover:text-primary dark:bg-background/55">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4 sm:p-6">
            {error && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/8 p-4 text-sm font-medium text-destructive shadow-sm">
                {error}
              </div>
            )}

            {agreement && (
              <CaseFileSection title="Buyer details" icon={UserRound}>
                <div className="grid gap-3 md:grid-cols-2">
                  <DetailRow label="Primary buyer" value={agreement.buyer_names} />
                  <DetailRow label="Secondary buyer" value={agreement.secondary_buyer_name} />
                  <DetailRow label="Buyer email" value={agreement.buyer_email} />
                  <DetailRow label="Buyer phone" value={agreement.buyer_phone} />
                  <div className="md:col-span-2"><DetailRow label="Buyer address" value={agreement.buyer_address} /></div>
                </div>
              </CaseFileSection>
            )}

            <CaseFileSection title="Agreement status" icon={FileCheck2}>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-border/55 bg-background/70 p-3 shadow-sm dark:bg-background/35">
                  <dt className="text-[0.66rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">Agreement status</dt>
                  <dd className="mt-2"><StatusBadge status={agreement?.status || envelope?.status} /></dd>
                </div>
                <DetailRow label="Sent via" value={agreement?.sent_via} />
                <DetailRow label="Record ID" value={agreement?.id || recordId} mono />
                {agreement?.notes && <div className="md:col-span-3"><DetailRow label="Notes" value={agreement.notes} /></div>}
              </div>
            </CaseFileSection>

            <CaseFileSection title="DocuSign tracking" icon={Mail}>
              {envelope && (
                <div className="mb-3 rounded-2xl border border-primary/15 bg-primary/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground">{envelope.emailSubject || 'DocuSign envelope'}</p>
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{envelope.envelopeId}</p>
                    </div>
                    <StatusBadge status={envelope.status} />
                  </div>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <DetailRow label="Envelope ID" value={envelope?.envelopeId || agreement?.docusign_envelope_id} mono />
                <DetailRow label="DocuSign status" value={envelope?.status || agreement?.docusign_status} />
                <DetailRow label="Sent" value={fmt(envelope?.sentDateTime || agreement?.docusign_sent_at)} />
                <DetailRow label="Completed / signed" value={fmt(envelope?.completedDateTime || agreement?.docusign_signed_at)} />
                {envelope?.voidedDateTime && <DetailRow label="Voided" value={fmt(envelope.voidedDateTime)} />}
                {envelope?.voidedReason && <div className="lg:col-span-3"><DetailRow label="Void reason" value={envelope.voidedReason} /></div>}
              </div>
            </CaseFileSection>

            <CaseFileSection title={`Signers (${signers.length})`} icon={UserRound}>
              {signers.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/70 bg-muted/25 p-4 text-sm text-muted-foreground">No signers found.</p>
              ) : (
                <div className="space-y-3">
                  {signers.map((s, i) => (
                    <div key={i} className="rounded-2xl border border-border/65 bg-background/75 p-4 text-sm shadow-sm dark:bg-background/35">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="break-words font-bold text-foreground">{s.name}</div>
                          <div className="mt-1 break-all text-xs font-medium text-muted-foreground">{s.email}</div>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">Order {s.routingOrder}</span>
                          <StatusBadge status={s.status} />
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                        <span>Sent: {fmt(s.sentAt)}</span>
                        <span>Delivered: {fmt(s.deliveredAt)}</span>
                        <span>Signed: {fmt(s.signedAt)}</span>
                      </div>
                      {s.declinedReason && <p className="mt-2 break-words text-sm font-medium text-destructive">Declined: {s.declinedReason}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CaseFileSection>

            {agreement && (
              <CaseFileSection title="Dates and audit trail" icon={CalendarDays}>
                <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <DetailRow label="Agreement date" value={fmtDate(agreement.agreement_date)} />
                  <DetailRow label="Created" value={fmt(agreement.created_at)} />
                  <DetailRow label="Updated" value={fmt(agreement.updated_at)} />
                  <DetailRow label="Status changed" value={fmt(envelope?.statusChangedDateTime)} />
                </div>
                {events.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border/70 bg-muted/25 p-4 text-sm text-muted-foreground">No events recorded yet.</p>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-border/65 bg-background/70 dark:bg-background/35">
                    {events.slice().reverse().map((ev, i) => (
                      <div key={i} className="grid gap-2 border-b border-border/45 p-3 text-xs last:border-0 sm:grid-cols-[9rem_1fr]">
                        <span className="font-semibold text-muted-foreground">{fmt(ev.timestamp)}</span>
                        <div className="min-w-0">
                          <span className="break-words font-bold text-foreground">{ev.action}</span>
                          {ev.description && ev.description !== ev.action && <span className="break-words text-muted-foreground"> — {ev.description}</span>}
                          {(ev.user || ev.email) && <div className="mt-1 break-all text-muted-foreground">{ev.user}{ev.email ? ` <${ev.email}>` : ''}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CaseFileSection>
            )}

            {agreement && (
              <CaseFileSection title="Template used" icon={FileText}>
                <div className="grid gap-3 md:grid-cols-2">
                  <DetailRow label="PDF storage path" value={agreement.pdf_storage_path} mono />
                  <DetailRow label="Signed PDF storage path" value={agreement.signed_pdf_storage_path} mono />
                </div>
              </CaseFileSection>
            )}

            <CaseFileSection title="Actions" icon={Download}>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="rounded-xl gap-2">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh DocuSign status
                </Button>
                {envelope?.status === 'completed' && (
                  <Button size="sm" onClick={downloadSigned} disabled={downloading} className="rounded-xl gap-2">
                    {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download signed PDF
                  </Button>
                )}
              </div>
            </CaseFileSection>

            {loading && !envelope && (
              <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 py-12 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
