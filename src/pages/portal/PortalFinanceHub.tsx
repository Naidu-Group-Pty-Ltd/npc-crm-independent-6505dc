import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Banknote, Calendar, MapPin, Landmark, Clock, ListChecks,
  TrendingUp, AlertCircle, CheckCircle2, ArrowRight, Briefcase, PieChart,
  FileText, MessageSquare, Mail, Phone,
} from 'lucide-react';

import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ClientOnboardingCard } from '@/components/portal/ClientOnboardingCard';
import { ClientBookingCard } from '@/components/portal/ClientBookingCard';
import { getPortalSessionToken } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


type Tone = 'neutral'|'progress'|'positive'|'caution'|'critical';

const TONE_CLASS: Record<Tone, string> = {
  neutral:  'bg-muted text-muted-foreground border-border',
  progress: 'bg-info/15 text-info border-info/30',
  positive: 'bg-success/15 text-success border-success/30',
  caution:  'bg-brand-500/15 text-brand-500 border-brand-500/30',
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
};

type FileRow = {
  id: string;
  title: string;
  purchase_type: string;
  property_address: string | null;
  purchase_price: number | null;
  lender: string | null;
  settlement_date: string | null;
  finance_clause_date: string | null;
  last_partner_action_at: string | null;
  status: { key: string; label: string; tone: Tone };
  latest_decision: {
    outcome: string;
    outcome_label: string;
    decided_at: string | null;
    decision_expiry_date: string | null;
    max_comfortable_price: number | null;
    proposed_loan_amount: number | null;
    lvr: number | null;
    lmi_applicable: boolean | null;
  } | null;
  open_task_count: number;
  next_task_due: string | null;
  next_critical_date: { kind: string; due_date: string } | null;
};

type Portfolio = {
  total_files: number;
  active_files: number;
  settled_files: number;
  at_risk_files: number;
  total_purchase_value: number;
  total_proposed_loans: number;
  total_open_tasks: number;
  avg_lvr: number | null;
  status_breakdown: Record<string, { label: string; tone: Tone; count: number }>;
  next_milestones: Array<{ purchase_file_id: string; title: string; kind: string; due_date: string; days: number }>;
};


function getSessionToken(): string | null {
  // In-memory only: `client-portal-verify` repopulates it from the HttpOnly
  // cookie on load. It used to come from localStorage. See src/lib/portalSession.ts.
  return getPortalSessionToken();
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-AU')}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

type DocRequest = {
  id: string;
  purchase_file_id: string;
  purchase_file_title: string | null;
  label: string;
  category: string;
  status: string;
  requested_at: string | null;
  expiry_date: string | null;
  request_message: string | null;
};

type OutboundMessage = {
  id: string;
  channel: string;
  subject: string | null;
  body: string | null;
  status: string;
  created_at: string;
  read_at: string | null;
  delivered_at: string | null;
};

export default function PortalFinanceHub() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [docRequests, setDocRequests] = useState<DocRequest[]>([]);
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerId, setPartnerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const token = getSessionToken();
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/client-portal-finance-hub`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          ...(token ? { 'x-portal-session-token': token } : {}),
        },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setFiles((json.purchase_files || []) as FileRow[]);
      setPortfolio((json.portfolio || null) as Portfolio | null);
      setDocRequests((json.open_document_requests || []) as DocRequest[]);
      setMessages((json.recent_messages || []) as OutboundMessage[]);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load finance hub');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const token = getSessionToken(); if (!token) return;
    fetch(`${SUPABASE_URL}/functions/v1/client-portal-batch6`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'x-portal-session-token': token },
      body: JSON.stringify({ operation: 'assigned_partner' }),
    }).then(r => r.json()).then(j => setPartnerId(j?.partner?.id ?? null)).catch(() => {});
  }, []);

  const totalOpenTasks = portfolio?.total_open_tasks ?? files.reduce((acc, f) => acc + f.open_task_count, 0);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-md p-2 bg-primary/15 text-primary"><Banknote className="h-5 w-5" /></div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Finance Hub</h1>
          <p className="text-sm text-muted-foreground">
            Live view of every property finance file your broker is working on. Open tasks: {totalOpenTasks}
          </p>
        </div>
        {totalOpenTasks > 0 && (
          <Button asChild size="sm" variant="default">
            <Link to="/client/action-items"><ListChecks className="h-4 w-4 mr-2" />Open action items</Link>
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : files.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No active finance files yet. Your broker will set one up when your application begins.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {portfolio && portfolio.total_files > 1 && <PortfolioSummary portfolio={portfolio} />}
          {docRequests.length > 0 && <DocumentRequestsCard requests={docRequests} />}
          {messages.length > 0 && <RecentMessagesCard messages={messages} />}
          <ClientBookingCard financeUserId={partnerId} />
          <ClientOnboardingCard />
          {files.map(f => <FileCard key={f.id} file={f} />)}
        </div>
      )}
    </div>
  );
}

function DocumentRequestsCard({ requests }: { requests: DocRequest[] }) {
  const outstanding = requests.filter(r => r.status === 'required' || r.status === 'requested');
  const rejected = requests.filter(r => r.status === 'rejected');
  return (
    <Card className="border-brand-500/30 bg-brand-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />Documents requested
          <Badge variant="outline" className="ml-1">{requests.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rejected.length > 0 && (
          <p className="text-xs text-destructive">
            {rejected.length} document{rejected.length === 1 ? '' : 's'} need to be re-supplied — your broker flagged an issue with the previous upload.
          </p>
        )}
        <ul className="divide-y divide-border/60">
          {requests.slice(0, 10).map(r => (
            <li key={r.id} className="py-2 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.label}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {r.category.replace(/_/g, ' ')}
                  {r.purchase_file_title ? ` · ${r.purchase_file_title}` : ''}
                  {r.requested_at ? ` · requested ${fmtDate(r.requested_at)}` : ''}
                </p>
                {r.request_message && (
                  <p className="text-xs text-muted-foreground mt-1 italic">"{r.request_message}"</p>
                )}
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'border whitespace-nowrap',
                  r.status === 'rejected' ? TONE_CLASS.critical
                    : r.status === 'requested' ? TONE_CLASS.caution
                    : TONE_CLASS.progress,
                )}
              >
                {r.status === 'required' ? 'Pending' : r.status === 'requested' ? 'Awaiting upload' : 'Re-upload needed'}
              </Badge>
            </li>
          ))}
        </ul>
        <div className="pt-2">
          <Button asChild size="sm" variant="default">
            <Link to="/client/documents">Upload documents <ArrowRight className="h-4 w-4 ml-1" /></Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function channelIcon(channel: string) {
  if (channel === 'sms' || channel === 'whatsapp') return Phone;
  if (channel === 'email') return Mail;
  return MessageSquare;
}

function RecentMessagesCard({ messages }: { messages: OutboundMessage[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />Recent messages from your broker
          <Badge variant="outline" className="ml-1">{messages.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60">
          {messages.slice(0, 6).map(m => {
            const Icon = channelIcon(m.channel);
            const preview = (m.body || '').replace(/<[^>]+>/g, '').slice(0, 180);
            return (
              <li key={m.id} className="py-2 flex items-start gap-3">
                <div className="rounded-md p-1.5 bg-muted text-muted-foreground"><Icon className="h-3.5 w-3.5" /></div>
                <div className="flex-1 min-w-0">
                  {m.subject && <p className="text-sm font-medium truncate">{m.subject}</p>}
                  <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{preview || '(no preview)'}</p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
                    {m.channel} · {new Date(m.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    {m.read_at ? ' · read' : m.delivered_at ? ' · delivered' : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function PortfolioSummary({ portfolio }: { portfolio: Portfolio }) {
  const breakdownEntries = Object.entries(portfolio.status_breakdown).sort((a, b) => b[1].count - a[1].count);
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="h-4 w-4" />Portfolio overview
          <Badge variant="outline" className="ml-1">{portfolio.total_files} files</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Active" value={String(portfolio.active_files)} icon={TrendingUp} />
          <Stat label="Settled" value={String(portfolio.settled_files)} icon={CheckCircle2} />
          <Stat
            label="Needs attention"
            value={String(portfolio.at_risk_files)}
            tone={portfolio.at_risk_files > 0 ? 'caution' : 'neutral'}
            icon={AlertCircle}
          />
          <Stat label="Avg LVR" value={portfolio.avg_lvr != null ? `${portfolio.avg_lvr}%` : '—'} icon={PieChart} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <div className="rounded-md border border-border p-3 md:col-span-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total purchase value</p>
            <p className="text-lg font-semibold mt-0.5">{fmtMoney(portfolio.total_purchase_value)}</p>
            <p className="text-xs text-muted-foreground mt-2">Proposed loans</p>
            <p className="text-sm font-medium">{fmtMoney(portfolio.total_proposed_loans)}</p>
          </div>
          <div className="rounded-md border border-border p-3 md:col-span-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Status mix</p>
            <div className="flex flex-wrap gap-2">
              {breakdownEntries.map(([key, b]) => (
                <Badge key={key} variant="outline" className={cn('border', TONE_CLASS[b.tone])}>
                  {b.label} · {b.count}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        {portfolio.next_milestones.length > 0 && (
          <div className="rounded-md border border-border p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Clock className="h-3 w-3" />Soonest milestones
            </p>
            <ul className="space-y-1.5">
              {portfolio.next_milestones.map((m, i) => (
                <li key={`${m.purchase_file_id}-${m.kind}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    <span className="font-medium">{m.title}</span>
                    <span className="text-muted-foreground"> · {m.kind.replace(/_/g, ' ')}</span>
                  </span>
                  <span className={cn(
                    'whitespace-nowrap',
                    m.days <= 3 ? 'text-destructive' : m.days <= 7 ? 'text-brand-500' : 'text-muted-foreground',
                  )}>
                    {new Date(m.due_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} · {m.days}d
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FileCard({ file }: { file: FileRow }) {
  const settleIn = daysUntil(file.settlement_date);
  const financeIn = daysUntil(file.finance_clause_date);
  const decisionExpiresIn = daysUntil(file.latest_decision?.decision_expiry_date);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-lg truncate">{file.title}</CardTitle>
            {file.property_address && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <MapPin className="h-3 w-3" />{file.property_address}
              </p>
            )}
          </div>
          <Badge variant="outline" className={cn('border', TONE_CLASS[file.status.tone])}>
            {file.status.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Purchase price" value={fmtMoney(file.purchase_price)} icon={Banknote} />
          <Stat label="Lender" value={file.lender || 'TBC'} icon={Landmark} />
          <Stat
            label="Finance clause"
            value={fmtDate(file.finance_clause_date) || '—'}
            sub={financeIn != null && financeIn >= 0 ? `${financeIn}d` : undefined}
            tone={financeIn != null && financeIn >= 0 && financeIn <= 5 ? 'caution' : 'neutral'}
            icon={Calendar}
          />
          <Stat
            label="Settlement"
            value={fmtDate(file.settlement_date) || '—'}
            sub={settleIn != null && settleIn >= 0 ? `${settleIn}d` : undefined}
            tone={settleIn != null && settleIn >= 0 && settleIn <= 7 ? 'caution' : 'neutral'}
            icon={Calendar}
          />
        </div>

        {/* Latest decision */}
        {file.latest_decision && (
          <div className={cn('rounded-lg border p-3', TONE_CLASS[
            file.latest_decision.outcome === 'green_light' ? 'positive'
            : file.latest_decision.outcome === 'not_suitable' ? 'critical'
            : file.latest_decision.outcome === 'proceed_with_caution' ? 'caution'
            : 'progress'
          ])}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm font-medium">{file.latest_decision.outcome_label}</span>
              </div>
              {file.latest_decision.decision_expiry_date && (
                <span className="text-xs">
                  Valid until {fmtDate(file.latest_decision.decision_expiry_date)}
                  {decisionExpiresIn != null && decisionExpiresIn >= 0 && ` · ${decisionExpiresIn}d`}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
              {file.latest_decision.proposed_loan_amount != null && (
                <span>Loan {fmtMoney(file.latest_decision.proposed_loan_amount)}</span>
              )}
              {file.latest_decision.max_comfortable_price != null && (
                <span>Max comfortable {fmtMoney(file.latest_decision.max_comfortable_price)}</span>
              )}
              {file.latest_decision.lvr != null && (
                <span>LVR {Number(file.latest_decision.lvr).toFixed(1)}%</span>
              )}
              {file.latest_decision.lmi_applicable && <span>LMI applicable</span>}
            </div>
          </div>
        )}

        {/* Next steps */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Open action items</p>
            <div className="flex items-center justify-between mt-1">
              <p className="text-2xl font-semibold">{file.open_task_count}</p>
              {file.open_task_count > 0 ? (
                <Button asChild size="sm" variant="ghost">
                  <Link to="/client/action-items">Open <ArrowRight className="h-4 w-4 ml-1" /></Link>
                </Button>
              ) : (
                <span className="text-success flex items-center gap-1 text-sm"><CheckCircle2 className="h-4 w-4" />Clear</span>
              )}
            </div>
            {file.next_task_due && (
              <p className="text-xs text-muted-foreground mt-1">
                <Clock className="h-3 w-3 inline mr-1" />Next due {fmtDate(file.next_task_due)}
              </p>
            )}
          </div>

          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Next milestone</p>
            {file.next_critical_date ? (
              <>
                <p className="text-sm font-medium capitalize mt-1">
                  {file.next_critical_date.kind.replace(/_/g, ' ')}
                </p>
                <p className="text-xs text-muted-foreground">{fmtDate(file.next_critical_date.due_date)}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">No upcoming dates</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label, value, sub, tone = 'neutral', icon: Icon,
}: { label: string; value: string; sub?: string; tone?: Tone; icon: any }) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Icon className="h-3 w-3" />{label}
      </p>
      <div className="flex items-baseline gap-1 mt-0.5">
        <p className="text-sm font-medium truncate">{value}</p>
        {sub && (
          <span className={cn('text-[10px]', tone === 'caution' ? 'text-brand-500' : 'text-muted-foreground')}>
            · {sub}
          </span>
        )}
      </div>
    </div>
  );
}
