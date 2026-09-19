/**
 * Finance Portal — Messages tab on a client profile (partner side).
 * Lets the partner choose the governed thread they are working in:
 *  - Command Centre finance-private thread
 *  - Direct Finance ↔ Client thread with Command Centre visibility
 */
import { useEffect, useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessageSquare, ShieldCheck, Users, ClipboardCheck } from 'lucide-react';
import { FinanceMessagesThread } from './FinanceMessagesThread';
import { cn } from '@/lib/utils';

interface Props {
  clientId: string;
}

type FinanceThreadMode = 'command' | 'allocated' | 'client';

const MODE_CONFIG: Record<FinanceThreadMode, {
  label: string;
  description: string;
  visibility_scope: string;
  thread_type: string;
  icon: typeof ShieldCheck;
}> = {
  command: {
    label: 'Command Centre',
    description: 'Private finance thread. Client Portal is blocked.',
    visibility_scope: 'command_finance_private',
    thread_type: 'command_finance',
    icon: ShieldCheck,
  },
  allocated: {
    label: 'Allocated by Command Centre',
    description: 'Client-facing advisory thread allocated to Finance. Action only within this thread.',
    visibility_scope: 'command_client_with_finance_allocated',
    thread_type: 'command_client_allocated',
    icon: ClipboardCheck,
  },
  client: {
    label: 'Client thread',
    description: 'Direct Finance ↔ Client thread. Command Centre is visible and notified.',
    visibility_scope: 'finance_client_with_command_visibility',
    thread_type: 'finance_client',
    icon: Users,
  },
};

export function FinancePortalMessagesPanel({ clientId }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [mode, setMode] = useState<FinanceThreadMode>('command');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [allocationStatus, setAllocationStatus] = useState<string | null>(null);
  const [hasAllocatedThread, setHasAllocatedThread] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setThreadId(null);
      setAllocationStatus(null);
      const cfg = MODE_CONFIG[mode];

      if (mode === 'allocated') {
        const { data, error } = await invokeFinanceFunction('finance-portal-messages', { operation: 'list_threads' });
        if (cancelled) return;
        const allocated = (data?.threads || []).find((thread: any) =>
          thread.client_id === clientId && thread.visibility_scope === 'command_client_with_finance_allocated'
        );
        setHasAllocatedThread(Boolean(allocated));
        if (error || !allocated) {
          setError(error?.message || 'No Command Centre allocation is currently available for this client.');
        } else {
          setThreadId(allocated.id);
          setAllocationStatus(allocated.allocation_status || null);
        }
        setLoading(false);
        return;
      }

      const { data, error } = await invokeFinanceFunction('finance-portal-messages', {
        operation: 'get_or_create_thread',
        client_id: clientId,
        visibility_scope: cfg.visibility_scope,
        thread_type: cfg.thread_type,
        finance_allocated: false,
        allocation_status: 'none',
      });
      if (cancelled) return;
      if (error || !data?.thread) {
        setError(error?.message || 'Could not open conversation');
      } else {
        setThreadId(data.thread.id);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clientId, invokeFinanceFunction, mode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await invokeFinanceFunction('finance-portal-messages', { operation: 'list_threads' });
      if (cancelled) return;
      setHasAllocatedThread((data?.threads || []).some((thread: any) =>
        thread.client_id === clientId && thread.visibility_scope === 'command_client_with_finance_allocated'
      ));
    })();
    return () => { cancelled = true; };
  }, [clientId, invokeFinanceFunction]);

  const activeCfg = MODE_CONFIG[mode];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-2">
        {(Object.keys(MODE_CONFIG) as FinanceThreadMode[]).map((key) => {
          const cfg = MODE_CONFIG[key];
          const Icon = cfg.icon;
          const active = key === mode;
          return (
            <Button
              key={key}
              type="button"
              variant={active ? 'default' : 'outline'}
              size="sm"
              className="h-auto flex-1 justify-start gap-2 py-2 text-left sm:flex-none"
              onClick={() => setMode(key)}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-xs font-semibold">
                  {cfg.label}
                  {key === 'allocated' && hasAllocatedThread && <Badge className="h-4 px-1 text-[9px]">Allocated</Badge>}
                </span>
                <span className={cn('block text-[10px] font-normal', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                  {cfg.description}
                </span>
              </span>
            </Button>
          );
        })}
      </div>

      {mode === 'allocated' && allocationStatus && (
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-xs text-brand-800">
          Command Centre allocated this thread as <strong>{allocationStatus.replace(/_/g, ' ')}</strong>. Reply/action only within this permitted thread.
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : error || !threadId ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground opacity-50 mb-3" />
            <p className="text-sm font-medium">Conversation unavailable</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              {error || `We couldn't load the ${activeCfg.label.toLowerCase()} conversation. Try again in a moment.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <FinanceMessagesThread
          threadId={threadId}
          viewerSide="partner"
          invoke={(fn, body) => invokeFinanceFunction(fn, body)}
        />
      )}
    </div>
  );
}
