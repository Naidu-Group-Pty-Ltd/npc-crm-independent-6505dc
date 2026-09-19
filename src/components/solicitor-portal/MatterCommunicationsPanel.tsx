import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Lock, MessagesSquare, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  SCOPE_META,
  SCOPE_ORDER,
  senderLabel,
  solicitorComms,
  type LegalMatterMessage,
  type LegalMatterThread,
  type LegalThreadScope,
} from '@/lib/solicitorComms';

interface MatterCommunicationsPanelProps {
  matterId: string;
  canEdit: boolean;
  onError?: (message: string) => void;
}

function timestamp(value: string): string {
  try {
    return new Date(value).toLocaleString('en-AU', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return value;
  }
}

/**
 * Matter conversation workspace (Solicitor Portal — Phase 6).
 *
 * One canonical participant-based conversation per counterparty. Firm-internal
 * messages never leave the practice.
 */
export function MatterCommunicationsPanel({ matterId, canEdit, onError }: MatterCommunicationsPanelProps) {
  const [scope, setScope] = useState<LegalThreadScope>('solicitor_npc');
  const [threads, setThreads] = useState<Record<string, LegalMatterThread>>({});
  const [messages, setMessages] = useState<LegalMatterMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const activeThread = threads[scope] ?? null;

  const loadThread = useCallback(async (next: LegalThreadScope) => {
    setLoading(true);
    const { data, error } = await solicitorComms.getThread(matterId, { scope: next });
    if (error) {
      onError?.(error);
      setMessages([]);
    } else {
      const thread = (data as any)?.thread as LegalMatterThread | undefined;
      if (thread) setThreads((prev) => ({ ...prev, [next]: thread }));
      setMessages(((data as any)?.messages || []) as LegalMatterMessage[]);
      if (thread && thread.unread_count_solicitor > 0) {
        void solicitorComms.markThreadRead(matterId, thread.id);
        setThreads((prev) => ({ ...prev, [next]: { ...thread, unread_count_solicitor: 0 } }));
      }
    }
    setLoading(false);
  }, [matterId, onError]);

  useEffect(() => {
    void loadThread(scope);
  }, [loadThread, scope]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const unreadByScope = useMemo(() => {
    const out: Partial<Record<LegalThreadScope, number>> = {};
    Object.values(threads).forEach((t) => {
      out[t.scope] = t.unread_count_solicitor;
    });
    return out;
  }, [threads]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const { data, error } = await solicitorComms.postMessage(matterId, scope, text);
    if (error) {
      onError?.(error);
    } else {
      const message = (data as any)?.message as LegalMatterMessage | undefined;
      if (message) setMessages((prev) => [...prev, message]);
      setDraft('');
    }
    setSending(false);
  };

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessagesSquare className="h-4 w-4 text-primary" aria-hidden /> Matter communications
        </CardTitle>
        <CardDescription>{SCOPE_META[scope].description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs value={scope} onValueChange={(v) => setScope(v as LegalThreadScope)}>
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            {SCOPE_ORDER.map((key) => (
              <TabsTrigger key={key} value={key} className="gap-1.5 text-xs">
                {key === 'firm_internal' ? <Lock className="h-3 w-3" aria-hidden /> : null}
                {SCOPE_META[key].label}
                {unreadByScope[key] ? (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {unreadByScope[key]}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <ScrollArea className="h-[380px] rounded-md border border-border/60 bg-muted/20 p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
              <MessagesSquare className="h-5 w-5" aria-hidden />
              <p>No messages yet in this conversation.</p>
              <p className="text-xs">{SCOPE_META[scope].description}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => {
                const mine = message.sender_type === 'solicitor_user';
                return (
                  <div key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
                        mine
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-border bg-card',
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">{senderLabel(message)}</span>
                        <span>{timestamp(message.created_at)}</span>
                        {message.is_internal ? (
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">Internal</Badge>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

        {canEdit ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Message ${SCOPE_META[scope].label.toLowerCase()}…`}
              rows={3}
              maxLength={8000}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send();
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {scope === 'firm_internal'
                  ? 'Private note — stays inside your practice.'
                  : 'Saved once and immediately visible to authorised conversation participants.'}
              </p>
              <Button size="sm" onClick={() => void send()} disabled={sending || !draft.trim()}>
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />}
                Send
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            You have read-only access to this matter’s conversations.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default MatterCommunicationsPanel;
