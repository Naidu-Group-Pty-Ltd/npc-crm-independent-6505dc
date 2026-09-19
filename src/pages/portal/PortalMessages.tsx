import { useState, useRef, useEffect, useMemo } from 'react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { usePortalUnifiedInbox, usePortalUpdateData, usePortalSendFinanceReply, usePortalSendLegalReply } from '@/hooks/usePortalData';
import { smartCapitalize } from '@/lib/nameUtils';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  MessageSquare, Send, Loader2, Headphones,
  MessageCircle, Phone, Mail, Building2, Landmark, Scale,
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { toast } from 'sonner';

function formatMessageDate(date: Date): string {
  if (isToday(date)) return format(date, 'h:mm a');
  if (isYesterday(date)) return 'Yesterday ' + format(date, 'h:mm a');
  return format(date, 'dd MMM yyyy, h:mm a');
}

function getInitials(name?: string): string {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

const CHANNEL_LABELS: Record<string, string> = {
  portal: 'Portal', sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email',
};

function channelBadge(channel: string) {
  const label = CHANNEL_LABELS[channel] || channel;
  if (channel === 'portal') return null;
  const Icon = channel === 'email' ? Mail : channel === 'whatsapp' ? MessageCircle : Phone;
  return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 gap-1">
      <Icon className="h-2.5 w-2.5" /> {label}
    </Badge>
  );
}

type ChannelKey = 'command' | 'finance' | 'legal';

interface ChannelThreadProps {
  channel: ChannelKey;
  messages: any[];
  displayName: string;
  onSend: (text: string) => Promise<void>;
  sending: boolean;
  disabledReason?: string;
  emptyHint: string;
}

function ChannelThread({ channel, messages, displayName, onSend, sending, disabledReason, emptyHint }: ChannelThreadProps) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    await onSend(t);
    setText('');
    inputRef.current?.focus();
  };

  return (
    <Card className="client-portal-soft-panel flex flex-col overflow-hidden border-primary/15 bg-gradient-to-b from-card/95 to-background/95 shadow-2xl shadow-primary/5" style={{ height: 'calc(100vh - 340px)', minHeight: '400px' }}>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.06),transparent_34%)] p-5 [scrollbar-color:hsl(var(--primary)/0.4)_transparent]">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="mb-4 rounded-full border border-primary/10 bg-primary/5 p-4 shadow-lg shadow-primary/5">
              {channel === 'finance' ? <Landmark className="h-10 w-10 text-primary/40" />
                : channel === 'legal' ? <Scale className="h-10 w-10 text-primary/40" />
                : <Building2 className="h-10 w-10 text-primary/40" />}
            </div>
            <p className="text-muted-foreground font-medium">No messages yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">{emptyHint}</p>
          </div>
        ) : (
          messages.map((msg: any) => {
            const isClient = msg.direction === 'outbound';
            return (
              <div key={msg.id} className={`flex items-end gap-2 ${isClient ? 'flex-row-reverse' : 'flex-row'}`}>
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className={`text-xs font-semibold ${
                    isClient ? 'bg-primary/10 text-primary' : 'bg-card text-primary border border-primary/10'
                  }`}>
                    {isClient ? getInitials(displayName) : <Headphones className="h-3.5 w-3.5" />}
                  </AvatarFallback>
                </Avatar>
                <div className={`flex min-w-0 max-w-[min(78%,42rem)] flex-col ${isClient ? 'items-end' : 'items-start'}`}>
                  <div className={`w-fit max-w-full rounded-2xl border px-4 py-3 text-sm leading-6 shadow-lg shadow-sm dark:shadow-black/10 whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                    isClient
                      ? 'rounded-br-md border-primary/40 bg-gradient-to-br from-primary to-brand-500 text-primary-foreground'
                      : 'rounded-bl-md border-border/60 bg-card/95 text-foreground shadow-primary/5'
                  }`}>
                    {msg.subject && <p className="mb-1 font-semibold break-words [overflow-wrap:anywhere]">{msg.subject}</p>}
                    <p className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.body}</p>
                  </div>
                  <div className={`flex items-center gap-1.5 mt-1 ${isClient ? 'flex-row-reverse' : 'flex-row'}`}>
                    <p className="text-[10px] font-medium text-muted-foreground/75">{formatMessageDate(new Date(msg.created_at))}</p>
                    {channelBadge(msg.channel)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-primary/10 bg-card/95 p-4 shadow-[0_-18px_45px_rgba(0,0,0,0.08)] backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={disabledReason || `Message your ${channel === 'finance' ? 'finance broker' : channel === 'legal' ? 'legal team' : 'advisor'}...`}
            className="flex-1 border-border/60"
            disabled={sending || !!disabledReason}
          />
          <Button
            size="icon"
            onClick={send}
            disabled={!text.trim() || sending || !!disabledReason}
            className="shrink-0 h-10 w-10 rounded-xl"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-2 text-center">
          {channel === 'finance' ? 'Replies sync to your finance broker and remain visible to Command Centre.'
            : channel === 'legal' ? 'Replies stay in the same private conversation with your authorised legal team.'
            : 'Messages go to your Command Centre advisory team.'}
        </p>
      </div>
    </Card>
  );
}

export default function PortalMessages() {
  const { user } = usePortalAuth();
  const { data, isLoading } = usePortalUnifiedInbox();
  const updateMutation = usePortalUpdateData();
  const financeReplyMutation = usePortalSendFinanceReply();
  const legalReplyMutation = usePortalSendLegalReply();
  const [sending, setSending] = useState(false);
  const [localMessages, setLocalMessages] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<ChannelKey>('command');

  const displayName = smartCapitalize(user?.name);
  const serverMessages = data?.messages || [];
  const latestFinanceThreadId = useMemo(() => {
    const msg = serverMessages.find((m: any) => m.kind === 'finance' && m.thread_id);
    return msg?.thread_id as string | undefined;
  }, [serverMessages]);
  const latestLegalConversationId = useMemo(() => serverMessages.find((m:any)=>m.kind==='legal')?.conversation_id as string|undefined,[serverMessages]);

  useEffect(() => {
    if (localMessages.length === 0) return;
    const serverIds = new Set(serverMessages.map((m: any) => m.id));
    setLocalMessages((cur) => {
      const next = cur.filter((m) => !serverIds.has(m.id));
      return next.length === cur.length ? cur : next;
    });
  }, [serverMessages, localMessages.length]);

  const allMessages = useMemo(() => {
    const byId = new Map<string, any>();
    for (const m of [...serverMessages, ...localMessages]) byId.set(m.id, m);
    return Array.from(byId.values())
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [serverMessages, localMessages]);

  const commandMessages = useMemo(
    () => allMessages.filter((m) => m.kind === 'portal' || m.kind === 'ghl' || m.kind === 'outbound'),
    [allMessages]
  );
  const financeMessages = useMemo(
    () => allMessages.filter((m) => m.kind === 'finance'),
    [allMessages]
  );
  const legalMessages = useMemo(() => allMessages.filter((m)=>m.kind==='legal'),[allMessages]);

  const commandUnread = commandMessages.filter((m) => m.direction === 'inbound' && m.is_read === false).length;
  const financeUnread = financeMessages.filter((m) => m.direction === 'inbound' && m.is_read === false).length;
  const legalUnread = legalMessages.filter((m) => m.direction === 'inbound' && m.is_read === false).length;

  const sendCommand = async (text: string) => {
    setSending(true);
    try {
      const response = await updateMutation.mutateAsync({
        operation: 'insert',
        table: 'client_portal_messages',
        data: {
          sender_type: 'client',
          sender_name: displayName || user?.email || 'Client',
          message: text,
        },
      });
      const saved = response?.data || response?.message;
      if (saved?.id) {
        setLocalMessages((cur) => [...cur, {
          id: `portal:${saved.id}`,
          kind: 'portal', channel: 'portal', direction: 'outbound',
          sender_name: saved.sender_name, body: saved.message || text,
          subject: null, created_at: saved.created_at || new Date().toISOString(), is_read: false,
        }]);
      }
    } catch {
      toast.error('Failed to send message. Please try again.');
    } finally { setSending(false); }
  };

  const sendFinance = async (text: string) => {
    if (!latestFinanceThreadId) return;
    setSending(true);
    try {
      const response = await financeReplyMutation.mutateAsync({ thread_id: latestFinanceThreadId, message: text });
      const saved = response?.data || response?.message;
      if (saved?.id) {
        setLocalMessages((cur) => [...cur, {
          id: `finance:${saved.id}`,
          kind: 'finance', channel: 'portal', direction: 'outbound',
          sender_name: saved.sender_name, body: saved.body || text,
          subject: null, created_at: saved.created_at || new Date().toISOString(), is_read: true,
          thread_id: latestFinanceThreadId,
        }]);
      }
    } catch {
      toast.error('Failed to send finance reply. Please try again.');
    } finally { setSending(false); }
  };
  const sendLegal = async (text:string) => {
    if(!latestLegalConversationId)return; setSending(true);
    try { const response=await legalReplyMutation.mutateAsync({conversation_id:latestLegalConversationId,message:text,idempotency_key:crypto.randomUUID()}); const saved=response?.message||response?.data; if(saved?.id)setLocalMessages(cur=>[...cur,{id:saved.id,kind:'legal',channel:'legal',conversation_id:latestLegalConversationId,direction:'outbound',sender_name:saved.sender_name,body:saved.body||text,created_at:saved.created_at||new Date().toISOString(),is_read:true}]); }
    catch { toast.error('Failed to send legal reply. Please try again.'); } finally { setSending(false); }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading messages...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="client-portal-page-header">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <MessageSquare className="h-6 w-6 text-primary" />
          Messages
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Separate governed channels for your Command Centre advisor, legal team, and finance broker.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ChannelKey)} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 md:w-[680px]">
          <TabsTrigger value="command" className="gap-2">
            <Building2 className="h-4 w-4" />
            Command Centre
            {commandUnread > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{commandUnread}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="legal" className="gap-2">
            <Scale className="h-4 w-4" /> Legal
            {legalUnread > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{legalUnread}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="finance" className="gap-2">
            <Landmark className="h-4 w-4" />
            Finance Portal
            {financeUnread > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{financeUnread}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="command" className="m-0">
          <ChannelThread
            channel="command"
            messages={commandMessages}
            displayName={displayName || ''}
            onSend={sendCommand}
            sending={sending}
            emptyHint="Send a message to your advisor. They'll respond as soon as possible."
          />
        </TabsContent>

        <TabsContent value="finance" className="m-0">
          <ChannelThread
            channel="finance"
            messages={financeMessages}
            displayName={displayName || ''}
            onSend={sendFinance}
            sending={sending}
            disabledReason={!latestFinanceThreadId ? 'Your finance broker will start this conversation when ready.' : undefined}
            emptyHint="Once your finance broker reaches out, your conversation will appear here."
          />
        </TabsContent>
        <TabsContent value="legal" className="m-0">
          <ChannelThread channel="legal" messages={legalMessages} displayName={displayName||''} onSend={sendLegal} sending={sending} disabledReason={!latestLegalConversationId?'Your legal team will open this channel when your matter is ready.':undefined} emptyHint="Your authorised legal team will use this channel for matter updates and replies." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
