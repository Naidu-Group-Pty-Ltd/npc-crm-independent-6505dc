/**
 * Audit Trail Tab (Chunk 8) — Compliance & Audit Hardening
 *
 * Unified, tamper-evident timeline merging:
 *  - PF status history (data mutations)
 *  - Audit events (sensitive access, decisions, exports)
 *  - Auth log (finance partner sign-ins scoped to this client)
 *
 * Includes hash-chain verification for tamper detection.
 */
import { useEffect, useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Loader2, ShieldCheck, ShieldAlert, Eye, Lock, FileText, Database,
  LogIn, Activity, AlertTriangle, CheckCircle2, Link2,
} from 'lucide-react';
import { format } from 'date-fns';

interface TimelineEvent {
  source: 'audit' | 'status' | 'auth';
  id: string;
  ts: string;
  severity: 'info' | 'notice' | 'warn' | 'critical';
  category: string;
  action: string;
  actor_type: string;
  actor_label: string;
  target_type?: string | null;
  target_id?: string | null;
  fields_accessed?: string[] | null;
  description?: string | null;
  metadata?: any;
  ip_address?: string | null;
  row_hash?: string | null;
  prev_hash?: string | null;
  from_value?: string | null;
  to_value?: string | null;
}

const CATEGORY_ICONS: Record<string, any> = {
  sensitive_access: Eye,
  security: Lock,
  document: FileText,
  decision: ShieldCheck,
  data_change: Database,
  system: Activity,
  export: FileText,
  consent: ShieldCheck,
};

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-muted text-muted-foreground',
  notice: 'bg-primary/10 text-primary border-primary/30',
  warn: 'bg-warning/15 text-warning border-warning/30',
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
};

const AUTH_ICON: Record<string, any> = {
  login: LogIn, logout: LogIn, invite_accepted: LogIn,
  password_reset_requested: Lock, password_reset_completed: Lock,
};

export function AuditTrailTab({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [counts, setCounts] = useState<{ audit: number; status: number; auth: number }>({ audit: 0, status: 0, auth: 0 });
  const [filter, setFilter] = useState<string>('all');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; total: number; broken_at?: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-audit-timeline', {
        operation: 'timeline',
        purchase_file_id: fileId,
        limit: 300,
      });
      if (error) throw new Error(error.message);
      setEvents(data?.events || []);
      setCounts(data?.counts || { audit: 0, status: 0, auth: 0 });
    } catch (e: any) {
      toast.error(e.message || 'Failed to load audit trail');
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-audit-timeline', {
        operation: 'verify',
        purchase_file_id: fileId,
      });
      if (error) throw new Error(error.message);
      setVerifyResult({ ok: !!data?.ok, total: data?.total || 0, broken_at: data?.broken_at });
      if (data?.ok) {
        toast.success(`Chain verified — ${data.total} events intact`);
      } else {
        toast.error('Audit chain integrity check FAILED');
      }
      // Reload to show the verification event itself
      void load();
    } catch (e: any) {
      toast.error(e.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => { void load(); }, [fileId]);

  const filtered = filter === 'all' ? events : events.filter(e => e.source === filter || e.category === filter || e.severity === filter);

  return (
    <Card>
      <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Audit Trail
          </CardTitle>
          <CardDescription>
            Tamper-evident log of every status change, sensitive-data access, and auth event tied to this purchase file.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">Mutations: {counts.status}</Badge>
          <Badge variant="outline" className="text-[10px]">Access: {counts.audit}</Badge>
          <Badge variant="outline" className="text-[10px]">Auth: {counts.auth}</Badge>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              <SelectItem value="status">Data changes</SelectItem>
              <SelectItem value="audit">Sensitive access</SelectItem>
              <SelectItem value="auth">Auth events</SelectItem>
              <SelectItem value="warn">Warnings only</SelectItem>
              <SelectItem value="critical">Critical only</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={verify} disabled={verifying} className="gap-2">
            {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Verify chain
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {verifyResult && (
          <div className={`mb-3 rounded-md border px-3 py-2 text-sm flex items-center gap-2 ${
            verifyResult.ok
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-destructive/10 border-destructive/30 text-destructive'
          }`}>
            {verifyResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {verifyResult.ok
              ? `Hash chain verified — all ${verifyResult.total} events intact and unmodified.`
              : `Hash chain broken at event ${verifyResult.broken_at}. Investigate immediately.`}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading audit trail…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">No audit events yet.</div>
        ) : (
          <ScrollArea className="h-[60vh] pr-3">
            <ol className="relative border-l border-border/60 ml-2">
              {filtered.map((e) => {
                const Icon = e.source === 'auth'
                  ? (AUTH_ICON[e.action] || LogIn)
                  : (CATEGORY_ICONS[e.category] || Activity);
                return (
                  <li key={`${e.source}-${e.id}`} className="ml-4 mb-4">
                    <span className={`absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-background ${
                      e.severity === 'critical' ? 'bg-destructive' :
                      e.severity === 'warn' ? 'bg-warning' :
                      e.severity === 'notice' ? 'bg-primary' : 'bg-muted-foreground/50'
                    }`} />
                    <div className="flex items-start gap-3">
                      <div className="rounded-md bg-muted/40 p-1.5"><Icon className="h-3.5 w-3.5 text-muted-foreground" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{e.action.replace(/_/g, ' ')}</span>
                          <Badge variant="outline" className={`text-[10px] ${SEVERITY_STYLES[e.severity]}`}>{e.severity}</Badge>
                          <Badge variant="outline" className="text-[10px] capitalize">{e.source === 'status' ? 'mutation' : e.source === 'audit' ? e.category.replace(/_/g, ' ') : 'auth'}</Badge>
                          <span className="text-[11px] text-muted-foreground">{format(new Date(e.ts), 'MMM d, yyyy HH:mm:ss')}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          <span className="font-medium text-foreground/80">{e.actor_label}</span>
                          {e.target_type && <> · <span>{e.target_type}{e.target_id && <code className="ml-1 text-[10px]">{e.target_id.slice(0, 8)}</code>}</span></>}
                          {e.ip_address && <> · <code className="text-[10px]">{e.ip_address}</code></>}
                        </div>
                        {e.description && <div className="text-xs mt-1 text-foreground/90">{e.description}</div>}
                        {e.fields_accessed && e.fields_accessed.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {e.fields_accessed.map(f => <Badge key={f} variant="secondary" className="text-[10px]">{f}</Badge>)}
                          </div>
                        )}
                        {(e.from_value || e.to_value) && (
                          <div className="text-xs mt-1 text-muted-foreground">
                            {e.from_value && <code className="px-1 py-0.5 rounded bg-muted text-[10px]">{e.from_value}</code>}
                            {e.from_value && e.to_value && <span className="mx-1">→</span>}
                            {e.to_value && <code className="px-1 py-0.5 rounded bg-primary/10 text-primary text-[10px]">{e.to_value}</code>}
                          </div>
                        )}
                        {e.row_hash && (
                          <div className="text-[10px] text-muted-foreground/60 mt-1 font-mono truncate">
                            #{e.row_hash.slice(0, 16)}…
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
