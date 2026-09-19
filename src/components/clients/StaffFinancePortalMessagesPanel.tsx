/**
 * Staff-side panel for the FINANCE PORTAL messaging threads.
 *
 * Lists every thread the assigned finance partner has with this client
 * (command↔finance private, finance↔client+CC, command↔client allocated)
 * and renders the selected one. Falls back to auto-creating the standard
 * command↔finance thread if none exist yet.
 */
import { useEffect, useMemo, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, MessageSquare, RefreshCcw, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { FinanceMessagesThread } from '@/components/finance-portal/FinanceMessagesThread';

interface Props {
  clientId: string;
  className?: string;
}

interface ThreadRow {
  id: string;
  client_id: string;
  finance_user_id: string;
  subject: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count_staff: number;
  unread_count_partner: number;
  visibility_scope?: string | null;
  thread_type?: string | null;
  allocation_status?: string | null;
}

const THREAD_TYPE_LABEL: Record<string, string> = {
  command_finance: 'Command ↔ Finance (private)',
  finance_client: 'Finance ↔ Client (CC visible)',
  command_client_allocated: 'Command ↔ Client (Finance allocated)',
  internal_command: 'Internal',
};

// Mirror the finance portal: every assigned client should expose all three
// governed channels so Command Centre staff keep full oversight. Order here
// also dictates the sidebar rendering order.
const GOVERNED_THREAD_TYPES: { thread_type: string; visibility_scope: string }[] = [
  { thread_type: 'command_finance', visibility_scope: 'command_finance_private' },
  { thread_type: 'finance_client', visibility_scope: 'finance_client_with_command_visibility' },
  { thread_type: 'command_client_allocated', visibility_scope: 'command_client_with_finance_allocated' },
];

const THREAD_TYPE_ORDER: Record<string, number> = GOVERNED_THREAD_TYPES.reduce(
  (acc, g, idx) => ({ ...acc, [g.thread_type]: idx }),
  {} as Record<string, number>,
);

export function StaffFinancePortalMessagesPanel({ clientId, className }: Props) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = async (preserveSelection = false) => {
    setError(null);
    const { data, error } = await invokeSecureFunction('finance-portal-messages', {
      operation: 'list_threads',
      client_id: clientId,
    });
    if (error) {
      setError(error.message || 'Failed to load finance threads');
      setLoading(false);
      return;
    }
    let list = (data?.threads || []) as ThreadRow[];

    // Auto-seed any missing governed thread so all three channels are always
    // present on Command Centre, mirroring the finance portal.
    const missing = GOVERNED_THREAD_TYPES.filter(
      (g) => !list.some((t) => t.thread_type === g.thread_type),
    );
    if (missing.length > 0) {
      let seedError: string | null = null;
      for (const g of missing) {
        const { data: createdData, error: createErr } = await invokeSecureFunction(
          'finance-portal-messages',
          {
            operation: 'get_or_create_thread',
            client_id: clientId,
            visibility_scope: g.visibility_scope,
            thread_type: g.thread_type,
          },
        );
        if (createErr || !createdData?.thread) {
          seedError = createErr?.message || 'Unable to provision finance thread';
          continue;
        }
        list = [...list, createdData.thread as ThreadRow];
      }
      if (list.length === 0 && seedError) {
        setError(seedError);
        setLoading(false);
        return;
      }
    }

    setThreads(list);

    if (list.length > 0) {
      // Default to the most recently active thread.
      const sorted = [...list].sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return tb - ta;
      });
      setSelectedThreadId((currentThreadId) => {
        if (preserveSelection && currentThreadId && list.some((t) => t.id === currentThreadId)) {
          return currentThreadId;
        }
        return sorted[0].id;
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    loadThreads(false);
    const id = setInterval(() => loadThreads(true), 20000);
    return () => clearInterval(id);
  }, [clientId]);

  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => {
      // Keep the three governed channels in a stable order so staff always see
      // the same layout (Command↔Finance, Finance↔Client, Command↔Client).
      const oa = THREAD_TYPE_ORDER[a.thread_type || ''] ?? 99;
      const ob = THREAD_TYPE_ORDER[b.thread_type || ''] ?? 99;
      if (oa !== ob) return oa - ob;
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return tb - ta;
    }),
    [threads],
  );

  const selectedThread = sortedThreads.find((thread) => thread.id === selectedThreadId) || null;
  const selectedThreadLabel = selectedThread
    ? THREAD_TYPE_LABEL[selectedThread.thread_type || ''] || (selectedThread.thread_type || 'Thread')
    : 'Finance Portal thread';

  if (loading) {
    return (
      <div className={cn('mx-auto my-10 max-w-sm rounded-3xl border border-brand-300/15 bg-background dark:bg-black/25 px-6 py-8 text-center shadow-xl shadow-sm dark:shadow-black/20', className)}>
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-200/80" />
        <p className="mt-3 text-sm font-medium text-foreground">Loading finance threads…</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Preparing partner communication channels.</p>
      </div>
    );
  }

  if (error && threads.length === 0) {
    return (
      <Card className="rounded-3xl border-accent/15 bg-background dark:bg-black/25 shadow-xl shadow-sm dark:shadow-black/20">
        <CardContent className="py-12 text-center">
          <MessageSquare className="mx-auto mb-3 h-10 w-10 text-accent/55" />
          <p className="text-sm font-medium text-foreground">Finance messages could not load.</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn('grid min-h-0 gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]', className)}>
      {/* Thread list */}
      <div className="flex min-h-0 flex-col space-y-2 rounded-3xl border border-brand-300/15 bg-background dark:bg-black/25 p-2 shadow-xl shadow-sm dark:shadow-black/15">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-100">
            Threads ({sortedThreads.length})
          </span>
          <Button variant="ghost" size="icon" aria-label="Refresh finance portal threads" className="h-7 w-7 rounded-full text-brand-100 transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-300/10 hover:text-brand-50 hover:shadow-[0_10px_24px_rgba(0,0,0,0.2)] focus-visible:ring-brand-300/40" onClick={() => loadThreads(true)}>
            <RefreshCcw className="h-3 w-3" />
          </Button>
        </div>
        <ScrollArea className="h-[480px] min-h-0 pr-2 [scrollbar-color:rgba(245,158,11,0.38)_rgba(24,24,27,0.9)] lg:h-full">
          <div className="space-y-1.5">
            {sortedThreads.map((t) => {
              const isActive = t.id === selectedThreadId;
              const label = THREAD_TYPE_LABEL[t.thread_type || ''] || (t.thread_type || 'Thread');
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedThreadId(t.id)}
                  aria-pressed={isActive}
                  aria-label={`Open finance thread ${label}`}
                  className={cn(
                    'group relative w-full overflow-hidden rounded-2xl border px-3.5 py-3 text-left transition-all duration-200 before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-brand-300 before:opacity-0 before:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/45',
                    isActive
                      ? 'border-brand-300/45 bg-brand-300/12 shadow-[inset_3px_0_0_rgba(251,191,36,0.95),0_14px_32px_rgba(0,0,0,0.24)] before:opacity-100'
                      : 'border-border dark:border-white/5 bg-white/[0.025] hover:-translate-y-0.5 hover:border-brand-300/25 hover:bg-brand-300/10 hover:shadow-[0_14px_32px_rgba(0,0,0,0.24),0_0_0_1px_rgba(251,191,36,0.12)] hover:before:opacity-80',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">{label}</span>
                    {t.unread_count_staff > 0 && (
                      <Badge className="h-4 rounded-full border border-brand-200/50 bg-brand-300 px-1.5 text-[9px] text-black">
                        {t.unread_count_staff}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                    {t.last_message_preview || 'No messages yet'}
                  </p>
                  <p className="mt-1.5 inline-flex rounded-full border border-brand-300/15 bg-background dark:bg-black/25 px-2 py-0.5 text-[10px] text-muted-foreground/80">
                    {t.last_message_at
                      ? formatDistanceToNow(new Date(t.last_message_at), { addSuffix: true })
                      : '—'}
                  </p>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Selected thread */}
      <div className="min-h-[480px] overflow-hidden rounded-2xl border border-brand-300/15 bg-background dark:bg-background/90 shadow-xl shadow-sm dark:shadow-black/20 lg:min-h-0">
        {selectedThreadId ? (
          <div className="flex h-full min-h-[480px] flex-col lg:min-h-0">
            <div className="border-b border-brand-300/10 bg-gradient-to-r from-brand-300/10 via-info/[0.04] to-transparent px-4 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-300/10 text-brand-100">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{selectedThreadLabel}</p>
                    <Badge variant="outline" className="shrink-0 rounded-full border-info/25 bg-info/10 px-2 text-[10px] text-info">
                      Finance Portal
                    </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{selectedThread?.last_message_at ? formatDistanceToNow(new Date(selectedThread.last_message_at), { addSuffix: true }) : 'No activity yet'}</span>
                      {selectedThread?.unread_count_staff ? (
                        <Badge className="rounded-full border border-brand-200/50 bg-brand-300 px-2 text-[10px] font-bold text-black">
                          {selectedThread.unread_count_staff} unread
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <FinanceMessagesThread
              threadId={selectedThreadId}
              viewerSide="staff"
              invoke={(fn, body) => invokeSecureFunction(fn, body)}
              onMessageSent={() => loadThreads(true)}
              fillContainer
              className="h-full flex-1 rounded-none border-0 bg-transparent shadow-none"
            />
          </div>
        ) : (
          <Card className="rounded-3xl border-accent/15 bg-background dark:bg-black/25 shadow-xl shadow-sm dark:shadow-black/20">
            <CardContent className="py-12 text-center">
              <MessageSquare className="mx-auto mb-3 h-10 w-10 text-accent/55" />
              <p className="text-sm font-medium text-foreground">Select a thread to view messages</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose one of the governed finance channels from the thread list.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
