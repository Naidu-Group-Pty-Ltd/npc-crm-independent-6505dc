import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { History, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface LogRow {
  id: string;
  solicitor_user_id: string | null;
  solicitor_name: string | null;
  actor_type: string;
  action: string;
  entity_type: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: { id: string; name: string } | null;
}

const ACTOR_LABEL: Record<string, string> = {
  staff: 'Command Centre',
  solicitor_user: 'Solicitor',
  system: 'System',
};

export function SolicitorActivityLogDialog({ open, onOpenChange, user }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await invokeSecureFunction('solicitor-portal-admin', {
          operation: 'get_activity_log',
          solicitor_user_id: user?.id,
          limit: 200,
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        setRows(data?.records || []);
      } catch (e: any) {
        toast.error(e.message || 'Failed to load activity');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Solicitor Portal Activity
          </DialogTitle>
          <DialogDescription>
            {user ? <>Audit trail for <span className="font-medium text-foreground">{user.name}</span>.</> : 'Most recent Solicitor Portal events across every practice.'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No activity recorded yet.
          </div>
        ) : (
          <ScrollArea className="flex-1 pr-3">
            <ul className="space-y-2 pb-2">
              {rows.map(r => (
                <li key={r.id} className="rounded-lg border border-border bg-card/50 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-xs">{ACTOR_LABEL[r.actor_type] || r.actor_type}</Badge>
                    <span className="text-sm font-medium">{r.action.replace(/_/g, ' ')}</span>
                    {r.solicitor_name && (
                      <span className="text-xs text-muted-foreground">· {r.solicitor_name}</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {format(new Date(r.created_at), 'd MMM yyyy, h:mm a')}
                    </span>
                  </div>
                  {(r.entity_type || r.ip_address) && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.entity_type ? r.entity_type.replace(/_/g, ' ') : ''}
                      {r.entity_type && r.ip_address ? ' · ' : ''}
                      {r.ip_address || ''}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
