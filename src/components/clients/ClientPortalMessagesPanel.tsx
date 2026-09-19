/**
 * Staff-side panel for reading and replying to CLIENT PORTAL messages
 * for a specific client. Mounts inside the client profile modal.
 *
 * Uses the `staff-client-portal-messages` edge function and subscribes to
 * `client_portal_messages` realtime channel for live updates.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Send, Headphones, User as UserIcon, MessageCircle, Lock, ShieldCheck } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ClientPortalMessage {
  id: string;
  client_id: string;
  sender_type: 'client' | 'advisor';
  sender_name: string | null;
  message: string;
  is_read: boolean;
  is_internal?: boolean;
  visibility_scope?: string | null;
  thread_type?: string | null;
  allocation_status?: string | null;
  finance_allocated?: boolean | null;
  notification_status?: Record<string, string> | null;
  created_at: string;
}

/**
 * Audit item 47 — `finance_only` is gone from here.
 *
 * It opened a `command_finance_private` thread through
 * `finance-portal-messages`: a Command Centre ↔ Finance conversation the
 * client cannot see. That is precisely the Finance Messages tab, two tabs
 * along, and the duplication showed: this panel renders only
 * `command_client_private`, `command_client_with_finance_allocated` and
 * `internal_command_only`, so a message sent from here landed somewhere this
 * screen could not display it. You sent it and it vanished.
 *
 * Nothing is deleted on the way out. Every such message already lives in
 * `finance-portal-messages` and is still read, written and replied to on the
 * Finance Messages tab; only this second door onto it has closed.
 *
 * `client_finance` stays, and is a different act: it messages the CLIENT and
 * allocates that client-facing thread to Finance. `internal` also stays —
 * the audit offered to retire it in favour of the client card's notes, but
 * an offer is not an instruction and a staff-only note in the conversation
 * it belongs to is not the same thing as a note on the record.
 */
type MessageRoute = 'client_only' | 'client_finance' | 'internal';
type FinanceAllocationStatus = 'finance_action_required' | 'finance_review_required' | 'finance_input_required' | 'allocate_to_finance';

const ROUTING_PRESETS: { value: MessageRoute; label: string; description: string }[] = [
  { value: 'client_only', label: 'Send to Client only', description: 'Client Portal + Command Centre only. Finance is blocked.' },
  { value: 'client_finance', label: 'Send to Client + allocate Finance', description: 'Client sees the advisory message; Finance gets access only to the allocated thread.' },
  { value: 'internal', label: 'Internal note', description: 'Command Centre staff-only note. Client and Finance are blocked.' },
];

const FINANCE_ALLOCATION_LABELS: Record<FinanceAllocationStatus, string> = {
  finance_action_required: 'Finance Action Required',
  finance_review_required: 'Finance Review Required',
  finance_input_required: 'Finance Input Required',
  allocate_to_finance: 'Allocate to Finance',
};

const formatStamp = (iso: string) => {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
  return format(d, 'd MMM, h:mm a');
};


const MESSAGE_SCOPE_LABELS: Record<string, string> = {
  command_client_private: 'Client only',
  command_client_with_finance_allocated: 'Finance allocated',
  internal_command_only: 'Internal',
};

const notificationSummary = (status?: Record<string, string> | null) => {
  if (!status) return null;
  if (Object.values(status).includes('failed')) return 'Notification failed';
  if (status.finance_portal === 'no_assigned_finance_user') return 'No finance assignment';
  return null;
};

const getInitials = (name?: string | null) => {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
};

interface Props {
  clientId: string;
  clientName?: string | null;
  className?: string;
  fillContainer?: boolean;
}

export function ClientPortalMessagesPanel({ clientId, clientName, className, fillContainer = false }: Props) {
  const [messages, setMessages] = useState<ClientPortalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [route, setRoute] = useState<MessageRoute>('client_only');
  const [financeAllocationStatus, setFinanceAllocationStatus] = useState<FinanceAllocationStatus>('finance_action_required');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastCountRef = useRef(0);

  const load = useCallback(async (markRead = false) => {
    const { data, error } = await invokeSecureFunction('staff-client-portal-messages', {
      operation: 'list_messages',
      client_id: clientId,
    });
    if (error) {
      console.error('[ClientPortalMessagesPanel] load error', error);
      setLoading(false);
      return;
    }
    setMessages((data?.messages || []) as ClientPortalMessage[]);
    setLoading(false);
    if (markRead) {
      invokeSecureFunction('staff-client-portal-messages', {
        operation: 'mark_thread_read',
        client_id: clientId,
      }).catch(() => {});
    }
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    load(true);

    // Realtime subscription (drops 30s polling pattern in favor of push)
    const channel = supabase
      .channel(`client-portal-messages-${clientId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'client_portal_messages', filter: `client_id=eq.${clientId}` },
        () => load(true),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId, load]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    if (messages.length !== lastCountRef.current) {
      lastCountRef.current = messages.length;
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }, 50);
    }
  }, [messages.length]);

  const send = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const financeAllocated = route === 'client_finance';
      const { error } = await invokeSecureFunction('staff-client-portal-messages', {
        operation: 'send_reply',
        client_id: clientId,
        message: trimmed,
        is_internal: route === 'internal',
        visibility_scope: financeAllocated ? 'command_client_with_finance_allocated' : undefined,
        allocation_status: financeAllocated ? financeAllocationStatus : undefined,
      });
      if (error) throw new Error(error.message || 'Send failed');
      toast.success(
        route === 'client_finance'
          ? 'Sent to Client Portal and allocated to Finance'
          : route === 'internal'
            ? 'Internal note saved'
            : 'Sent to Client Portal only',
      );
      setDraft('');
      await load(false);
    } catch (e: any) {
      console.error('[ClientPortalMessagesPanel] send failed', e);
      toast.error(e.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const selectedPreset = ROUTING_PRESETS.find((preset) => preset.value === route) || ROUTING_PRESETS[0];
  const financeAllocatedToClient = route === 'client_finance';
  const displayName = clientName || 'Client Portal';


  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-brand-300/15 bg-background dark:bg-background/90 shadow-xl shadow-sm dark:shadow-black/25', fillContainer ? 'h-full' : 'h-[600px]', className)}>
      <div className="border-b border-brand-300/10 bg-gradient-to-r from-brand-300/10 via-success/[0.04] to-transparent px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-10 w-10 shrink-0 border border-brand-300/25 bg-brand-300/10">
              <AvatarFallback className="bg-brand-300/10 text-xs font-semibold text-brand-100">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                <Badge variant="outline" className="shrink-0 rounded-full border-success/25 bg-success/10 px-2 text-[10px] text-success">
                  Client Portal
                </Badge>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <MessageCircle className="h-3.5 w-3.5 text-brand-200/80" />
                <span>{messages.length} message{messages.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
          <Badge variant="outline" className="rounded-full border-border dark:border-white/10 bg-background dark:bg-black/25 px-2.5 text-[10px] text-muted-foreground">
            Command Centre visible
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.05),transparent_34%)] p-4 [scrollbar-color:rgba(245,158,11,0.35)_rgba(24,24,27,0.9)]" ref={scrollRef as any}>
        {loading ? (
          <div className="mx-auto my-12 max-w-sm rounded-3xl border border-brand-300/15 bg-background dark:bg-black/25 px-6 py-8 text-center text-sm text-muted-foreground shadow-xl shadow-sm dark:shadow-black/20">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-200/80" />
            <p className="mt-3 font-medium text-foreground">Loading client messages…</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Preparing the latest client portal conversation.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto my-12 max-w-sm rounded-3xl border border-brand-300/15 bg-background dark:bg-black/25 px-6 py-8 text-center text-sm text-muted-foreground shadow-xl shadow-sm dark:shadow-black/20">
            <MessageCircle className="mx-auto mb-3 h-9 w-9 text-brand-200/65" />
            <p className="font-medium text-foreground">No messages yet. Send a message to start the conversation.</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">This thread is ready when the client conversation begins.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(m => {
              const mine = m.sender_type === 'advisor';
              return (
                <div key={m.id} className={cn('flex items-end gap-3', mine ? 'flex-row-reverse' : 'flex-row')}>
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className={cn(
                      'text-[10px] font-semibold',
                      mine ? 'bg-brand-300/10 text-brand-100' : 'bg-success/10 text-success',
                    )}>
                      {mine ? <Headphones className="h-3.5 w-3.5" /> : getInitials(m.sender_name || clientName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className={cn('flex max-w-[92%] flex-col sm:max-w-[82%]', mine ? 'items-end' : 'items-start')}>
                    <div className={cn(
                      'rounded-2xl border px-3.5 py-2.5 text-sm leading-6 whitespace-pre-wrap break-words shadow-lg shadow-sm dark:shadow-black/15 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,0,0,0.22)]',
                      m.is_internal
                        ? 'border-dashed border-brand-300/45 bg-brand-300/10 text-foreground rounded-br-md'
                        : mine
                          ? 'border-brand-300/30 bg-gradient-to-br from-brand-300 to-brand-600 text-black rounded-br-md'
                          : 'border-success/20 bg-card dark:bg-background/95 text-foreground rounded-bl-md',
                    )}>
                      {!mine && (
                        <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">
                          <UserIcon className="h-2.5 w-2.5" />
                          {m.sender_name || clientName || 'Client'}
                        </div>
                      )}
                      {m.message}
                    </div>
                    <span className="mt-1.5 flex items-center gap-1 px-1 text-[10px] text-muted-foreground/85">
                      {(m.is_internal || m.visibility_scope) && (
                        <Badge variant="outline" className={cn(
                          'text-[9px] px-1 py-0 h-3.5 gap-0.5',
                          m.is_internal || m.visibility_scope === 'internal_command_only'
                            ? 'border-brand-500/40 text-brand-600'
                            : m.visibility_scope === 'command_client_with_finance_allocated'
                              ? 'border-primary/30 text-primary'
                              : 'border-border text-muted-foreground',
                        )}>
                          {(m.is_internal || m.visibility_scope === 'internal_command_only') && <Lock className="h-2 w-2" />}
                          {MESSAGE_SCOPE_LABELS[m.visibility_scope || ''] || 'Governed'}
                        </Badge>
                      )}
                      {notificationSummary(m.notification_status) && (
                        <Badge variant="outline" className="h-3.5 border-destructive/40 px-1 py-0 text-[9px] text-destructive">
                          {notificationSummary(m.notification_status)}
                        </Badge>
                      )}
                      {formatStamp(m.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="shrink-0 border-t border-brand-300/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(9,9,11,0.98))] p-3 shadow-[0_-18px_45px_rgba(0,0,0,0.22)]">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Route:</span>
          {ROUTING_PRESETS.map(preset => {
            const active = preset.value === route;
            return (
              <Button
                key={preset.value}
                type="button"
                size="sm"
                variant={active ? 'default' : 'outline'}
                className={cn('h-auto min-h-7 rounded-full px-3 py-1 text-xs transition-all duration-200 focus-visible:ring-brand-300', active ? 'bg-brand-300 text-black shadow-sm shadow-brand-950/20 hover:-translate-y-0.5 hover:bg-brand-200 hover:shadow-[0_10px_26px_rgba(245,158,11,0.18)]' : 'border-border dark:border-white/10 bg-background dark:bg-black/20 text-muted-foreground hover:-translate-y-0.5 hover:border-brand-300/30 hover:bg-brand-300/10 hover:text-brand-100 hover:shadow-[0_10px_24px_rgba(0,0,0,0.2)]')}
                onClick={() => setRoute(preset.value)}
                title={preset.description}
              >
                {preset.label}
              </Button>
            );
          })}
        </div>
        <div className="mb-2 flex items-start gap-2 rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-black/25 p-2.5 text-[11px] leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-200/80" />
          <span>{selectedPreset.description}</span>
        </div>

        {financeAllocatedToClient && (
          <div className="mb-2 rounded-2xl border border-brand-300/15 bg-brand-300/5 p-2.5">
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Finance action allocation</label>
            <Select value={financeAllocationStatus} onValueChange={(value) => setFinanceAllocationStatus(value as FinanceAllocationStatus)}>
              <SelectTrigger className="h-9 rounded-xl border-border dark:border-white/10 bg-background dark:bg-black/30 text-xs transition-all hover:border-brand-300/30 focus:ring-brand-300/40">
                <SelectValue placeholder="Choose finance action" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FINANCE_ALLOCATION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-muted-foreground">Finance receives access only to this allocated client-facing thread.</p>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-black/30 p-2 shadow-inner shadow-sm dark:shadow-black/20">
          <Textarea
            ref={textareaRef}
            aria-label="Compose Client Portal message"
            placeholder={
              route === 'client_finance' ? 'Message the client and allocate this thread to Finance...'
              : route === 'internal' ? 'Add an internal staff-only note...'
              : 'Reply to the client...'
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
            disabled={sending}
            className="max-h-32 min-h-[72px] flex-1 resize-none rounded-xl border-0 bg-transparent text-sm leading-6 transition-all placeholder:text-muted-foreground/65 focus-visible:ring-2 focus-visible:ring-brand-300/30 disabled:cursor-not-allowed disabled:opacity-60"
            maxLength={5000}
          />
          <Button type="button" size="icon" aria-label="Send Client Portal message" onClick={send} disabled={sending || !draft.trim()} className="h-10 w-10 shrink-0 rounded-xl bg-brand-300 text-black shadow-lg shadow-brand-950/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-200 hover:shadow-[0_14px_32px_rgba(245,158,11,0.22)] focus-visible:ring-brand-300 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground/80">
          Press ⌘/Ctrl+Enter to send · Command Centre controls route, visibility, allocation and governance logging.
        </p>
      </div>
    </div>
  );
}
