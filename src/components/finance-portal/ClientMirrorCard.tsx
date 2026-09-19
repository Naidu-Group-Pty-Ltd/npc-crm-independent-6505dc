import { useEffect, useState, useCallback } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, Eye, RefreshCw, Activity, MessageCircle, FolderOpen, LogIn } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  clientId: string;
}

const TIER_STYLE: Record<string, string> = {
  engaged: 'bg-success/15 text-success border-success/30',
  steady: 'bg-primary/15 text-primary border-primary/30',
  cooling: 'bg-brand-500/15 text-brand-500 border-brand-500/30',
  ghosting: 'bg-destructive/15 text-destructive border-destructive/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

function formatDays(days: number | null): string {
  if (days == null) return 'Never';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function formatMinutes(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

export function ClientMirrorCard({ clientId }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: res, error } = await invokeFinanceFunction('finance-portal-client-mirror', {
      operation: 'summary',
      client_id: clientId,
    });
    if (error) toast.error(error.message || 'Could not load client mirror');
    else setData(res);
    setLoading(false);
  }, [clientId, invokeFinanceFunction]);

  useEffect(() => { void load(); }, [load]);

  const openAsClient = useCallback(async () => {
    setOpening(true);
    const { data: res, error } = await invokeFinanceFunction('finance-portal-handoff-create', {
      client_id: clientId,
      readonly: true,
    });
    setOpening(false);
    if (error || !res?.token) {
      toast.error(error?.message || res?.error || 'Could not open as client');
      return;
    }
    window.open(`/client/handoff?token=${encodeURIComponent(res.token)}`, '_blank');
  }, [clientId, invokeFinanceFunction]);

  if (loading) {
    return (
      <Card className="border-border/60 bg-card/40">
        <CardContent className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading client view…
        </CardContent>
      </Card>
    );
  }

  if (!data?.portal_user) {
    return (
      <Card className="border-brand-500/30 bg-brand-500/5">
        <CardContent className="p-6 flex items-start gap-3">
          <Eye className="h-5 w-5 text-brand-500 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium">Client has no active portal account</p>
            <p className="text-xs text-muted-foreground mt-1">
              Invite them from the dashboard before you can mirror their portal view or send nudges.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const eng = data.engagement || {};
  const pu = data.portal_user;
  const docs = data.documents || {};
  const msgs = data.messages || {};

  return (
    <Card className="border-border/60 bg-card/40">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold flex items-center gap-2">
                Client view mirror
                <Badge variant="outline" className={TIER_STYLE[eng.tier || 'unknown']}>
                  {(eng.tier || 'unknown').toUpperCase()}
                  {typeof eng.score === 'number' && ` · ${eng.score}`}
                </Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                What {pu.email} currently sees in their portal
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={load} className="h-8">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={openAsClient} disabled={opening} className="h-8">
              {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
              Open as client (read-only)
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric icon={<LogIn className="h-4 w-4" />} label="Last login" value={formatDays(pu.days_since_login)} />
          <Metric icon={<MessageCircle className="h-4 w-4" />} label="Median reply" value={formatMinutes(msgs.median_client_response_minutes)} />
          <Metric icon={<FolderOpen className="h-4 w-4" />} label="Docs fulfilled" value={docs.fulfilment_pct != null ? `${docs.fulfilment_pct}%` : '—'} />
          <Metric icon={<MessageCircle className="h-4 w-4" />} label="Unread by client" value={String(msgs.unread_for_client ?? 0)} />
        </div>

        {docs.fulfilment_pct != null && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Documents</span>
              <span>{docs.uploaded || 0} of {docs.total || 0}</span>
            </div>
            <Progress value={docs.fulfilment_pct} className="h-1.5" />
          </div>
        )}

        {(docs.pending_items || []).length > 0 && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <p className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wide">
              Pending in their portal
            </p>
            <ul className="space-y-1 text-xs">
              {docs.pending_items.map((d: any) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{d.label}</span>
                  <Badge variant="outline" className="text-[10px]">{d.status}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase tracking-wide">
        {icon} {label}
      </div>
      <p className="text-base font-semibold mt-1">{value}</p>
    </div>
  );
}
