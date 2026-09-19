import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Activity, Clock, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  financeUserId?: string | null;
  title?: string;
}

interface LogEntry {
  id: string;
  finance_user_id: string | null;
  client_id: string | null;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: any;
  created_at: string;
}

const ACTION_LABELS: Record<string, { label: string; tone: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  invite_sent:                    { label: 'Invite Sent',           tone: 'secondary' },
  invite_resent:                  { label: 'Invite Resent',         tone: 'secondary' },
  access_revoked:                 { label: 'Access Revoked',        tone: 'destructive' },
  access_reinstated:              { label: 'Access Reinstated',     tone: 'default' },
  assignment_upserted:            { label: 'Assignment Updated',    tone: 'default' },
  assignment_removed:             { label: 'Assignment Removed',    tone: 'destructive' },
  bulk_auto_linked:               { label: 'Bulk Auto-Linked',      tone: 'secondary' },
  default_permissions_updated:    { label: 'Defaults Updated',      tone: 'outline' },
  login_success:                  { label: 'Login',                 tone: 'default' },
  login_failed:                   { label: 'Login Failed',          tone: 'destructive' },
  logout:                         { label: 'Logout',                tone: 'outline' },
  password_reset:                 { label: 'Password Reset',        tone: 'secondary' },
  invite_accepted:                { label: 'Invite Accepted',       tone: 'default' },
};

export function ActivityLogDialog({ open, onOpenChange, financeUserId, title }: Props) {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await invokeSecureFunction('finance-portal-admin', {
          operation: 'get_activity_log',
          finance_user_id: financeUserId || undefined,
          limit: 200,
        });
        if (error) throw new Error(error.message);
        setLogs(data?.records || []);
      } catch (e: any) {
        toast.error(e.message || 'Failed to load activity log');
      } finally {
        setLoading(false);
      }
    })();
  }, [open, financeUserId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden rounded-2xl border-border/70 bg-card/95 p-0 shadow-2xl shadow-black/15 backdrop-blur">
        <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-card/90 to-muted/25 p-5">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-xl tracking-tight">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Activity className="h-5 w-5" />
            </span>
            <span className="truncate">{title || 'Finance Portal Activity'}</span>
          </DialogTitle>
          <DialogDescription className="leading-6">
            {financeUserId ? 'Audit trail for this portal user.' : 'Recent activity across all finance portal users.'}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center rounded-b-2xl bg-muted/15 py-14">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="max-h-[62vh] bg-background/35">
            <div className="divide-y divide-border/60">
              {logs.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/30 text-muted-foreground">
                    <Activity className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-semibold text-foreground">No activity yet</div>
                  <div className="max-w-sm text-xs leading-5 text-muted-foreground">
                    Finance portal audit events will appear here once activity is recorded.
                  </div>
                </div>
              )}
              {logs.map(l => {
                const label = ACTION_LABELS[l.action] || { label: l.action, tone: 'outline' as const };
                return (
                  <div key={l.id} className="flex items-start gap-3 p-4 transition-colors hover:bg-primary/5">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={label.tone} className="max-w-full rounded-full text-[10px] font-semibold" title={label.label}>{label.label}</Badge>
                        <Badge variant="outline" className="rounded-full border-border/70 bg-background/70 text-[10px] capitalize text-muted-foreground" title={l.actor_type}>{l.actor_type}</Badge>
                      </div>
                      {(l.entity_type || l.entity_id) && (
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="max-w-[180px] truncate" title={l.entity_type || '—'}>{l.entity_type || '—'}</span>
                          {l.entity_id && (
                            <span className="max-w-[180px] truncate rounded-md bg-muted/50 px-1.5 py-0.5 font-mono" title={l.entity_id}>
                              {l.entity_id}
                            </span>
                          )}
                        </div>
                      )}
                      {l.metadata && Object.keys(l.metadata).length > 0 && (
                        <pre className="max-h-40 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px] leading-5 whitespace-pre-wrap break-words text-muted-foreground">
                          {JSON.stringify(l.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {format(new Date(l.created_at), 'MMM d, HH:mm')}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
