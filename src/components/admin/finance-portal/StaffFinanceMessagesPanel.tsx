/**
 * Internal staff-side Finance Portal Messages panel.
 * Renders all threads for a given client across all assigned partners; pick a thread to chat.
 */
import { useEffect, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, MessageSquare, Archive, ArchiveRestore } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { FinanceMessagesThread } from '@/components/finance-portal/FinanceMessagesThread';
import { toast } from 'sonner';

interface Props {
  clientId: string;
}

interface ThreadRow {
  id: string;
  finance_user_id: string;
  subject: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count_staff: number;
  is_archived: boolean;
  visibility_scope?: string | null;
  thread_type?: string | null;
  allocation_status?: string | null;
  finance_allocated?: boolean | null;
  finance_portal_users?: { id: string; email: string; full_name: string | null };
}

export function StaffFinanceMessagesPanel({ clientId }: Props) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => {
    const { data, error } = await invokeSecureFunction('finance-portal-messages', {
      operation: 'list_threads',
      client_id: clientId,
    });
    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }
    const list = (data?.threads || []) as ThreadRow[];
    setThreads(list);
    if (!activeThreadId && list.length > 0) {
      setActiveThreadId(list[0].id);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const toggleArchive = async (t: ThreadRow) => {
    const { error } = await invokeSecureFunction('finance-portal-messages', {
      operation: 'archive_thread',
      thread_id: t.id,
      archived: !t.is_archived,
    });
    if (error) toast.error(error.message);
    else { toast.success(t.is_archived ? 'Restored' : 'Archived'); load(); }
  };

  const filtered = threads.filter(t => showArchived ? true : !t.is_archived);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (filtered.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground opacity-50 mb-3" />
          <p className="text-sm text-muted-foreground">
            No conversations yet for this client. A thread is created automatically when an assigned finance partner opens the Messages tab.
          </p>
        </CardContent>
      </Card>
    );
  }

  const active = filtered.find(t => t.id === activeThreadId) || filtered[0];

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm">Conversations</CardTitle>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowArchived(s => !s)}>
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Button>
        </CardHeader>
        <CardContent className="p-0 max-h-[600px] overflow-auto">
          <div className="divide-y divide-border">
            {filtered.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveThreadId(t.id)}
                className={cn(
                  'w-full text-left p-3 hover:bg-muted/40 transition-colors',
                  active?.id === t.id && 'bg-muted/60'
                )}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate flex-1">
                    {t.finance_portal_users?.full_name || t.finance_portal_users?.email || 'Partner'}
                  </p>
                  {t.unread_count_staff > 0 && (
                    <Badge variant="default" className="text-[10px] h-4 px-1.5">{t.unread_count_staff}</Badge>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.visibility_scope === 'command_finance_private' && (
                    <Badge variant="outline" className="h-4 px-1 text-[9px]">Finance private</Badge>
                  )}
                  {t.visibility_scope === 'finance_client_with_command_visibility' && (
                    <Badge variant="outline" className="h-4 border-success/30 bg-success/10 px-1 text-[9px] text-success">Client + CC visible</Badge>
                  )}
                  {t.finance_allocated && (
                    <Badge variant="outline" className="h-4 border-brand-500/30 bg-brand-500/10 px-1 text-[9px] text-brand-700">
                      {String(t.allocation_status || 'Allocated').replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {t.last_message_preview || 'No messages yet'}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground">
                    {t.last_message_at ? formatDistanceToNow(new Date(t.last_message_at), { addSuffix: true }) : '—'}
                  </span>
                  {t.is_archived && <span className="text-[10px] text-muted-foreground">archived</span>}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div>
        {active && (
          <>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium">
                  {active.finance_portal_users?.full_name || active.finance_portal_users?.email}
                </p>
                <p className="text-xs text-muted-foreground">{active.finance_portal_users?.email}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{String(active.thread_type || 'thread').replace(/_/g, ' ')}</Badge>
                  {active.visibility_scope === 'finance_client_with_command_visibility' && (
                    <Badge variant="outline" className="h-5 border-success/30 bg-success/10 px-1.5 text-[10px] text-success">Client + CC visible</Badge>
                  )}
                  {active.finance_allocated && (
                    <Badge variant="outline" className="h-5 border-brand-500/30 bg-brand-500/10 px-1.5 text-[10px] text-brand-700">
                      {String(active.allocation_status || 'Allocated').replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => toggleArchive(active)} className="gap-1.5">
                {active.is_archived ? <><ArchiveRestore className="h-3.5 w-3.5" /> Restore</> : <><Archive className="h-3.5 w-3.5" /> Archive</>}
              </Button>
            </div>
            <FinanceMessagesThread
              threadId={active.id}
              viewerSide="staff"
              invoke={(fn, body) => invokeSecureFunction(fn, body)}
              onMessageSent={load}
            />
          </>
        )}
      </div>
    </div>
  );
}
