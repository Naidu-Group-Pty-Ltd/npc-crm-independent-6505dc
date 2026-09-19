/**
 * Unified Client Communications Inbox (Batch 3 #13/#14/#15/#16/#17/#18).
 * Aggregates SMS / WhatsApp / Email / Portal messages for one client into a single
 * threaded timeline. Composer lets the broker reply on any channel, with templates,
 * inline translation, and email read-receipt indicators.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tabs, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Send, MessageSquare, Mail, Phone, Globe, Check, CheckCheck, Loader2,
  Languages, Sparkles, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import { TemplatesPicker } from './TemplatesPicker';

const FN = 'finance-portal-client-comms';

type UnifiedMessage = {
  id: string;
  kind: 'portal' | 'ghl' | 'outbound';
  source_id: string;
  channel: 'sms' | 'whatsapp' | 'email' | 'portal' | string;
  direction: 'inbound' | 'outbound';
  sender_name?: string;
  body: string;
  subject?: string | null;
  created_at: string;
  is_read?: boolean;
  read_at?: string | null;
  delivered_at?: string | null;
  status?: string;
  tracking_token?: string | null;
};

const CHANNEL_META: Record<string, { label: string; icon: any; tone: string }> = {
  sms:      { label: 'SMS',      icon: Phone,         tone: 'bg-info/15 text-info border-info/30' },
  whatsapp: { label: 'WhatsApp', icon: MessageSquare, tone: 'bg-success/15 text-success border-success/30' },
  email:    { label: 'Email',    icon: Mail,          tone: 'bg-accent/15 text-accent border-accent/30' },
  portal:   { label: 'Portal',   icon: Globe,         tone: 'bg-primary/15 text-primary border-primary/30' },
};

const LANG_OPTIONS = [
  { value: 'English',  label: 'English' },
  { value: 'Mandarin', label: 'Mandarin (简体)' },
  { value: 'Cantonese',label: 'Cantonese (繁體)' },
  { value: 'Arabic',   label: 'Arabic (العربية)' },
  { value: 'Vietnamese', label: 'Vietnamese (Tiếng Việt)' },
  { value: 'Hindi',    label: 'Hindi (हिन्दी)' },
  { value: 'Spanish',  label: 'Spanish (Español)' },
  { value: 'Tagalog',  label: 'Tagalog' },
];

export function ClientCommsInboxTab({
  clientId,
  purchaseFileId,
}: {
  clientId: string;
  purchaseFileId?: string;
}) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [composeChannel, setComposeChannel] = useState<'sms' | 'whatsapp' | 'email' | 'portal'>('portal');
  const [composeBody, setComposeBody] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [translations, setTranslations] = useState<Record<string, { lang: string; text: string }>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [defaultLang, setDefaultLang] = useState('English');

  const queryKey = ['client-comms', clientId, channelFilter];

  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, {
        action: 'list',
        client_id: clientId,
        purchase_file_id: purchaseFileId,
        channels: channelFilter === 'all' ? null : [channelFilter],
        limit: 200,
      });
      if (error) throw new Error(error.message);
      return (data?.messages || []) as UnifiedMessage[];
    },
    refetchInterval: 30_000,
  });

  const messages = useMemo(() => (data || []).slice().reverse(), [data]);

  const send = async () => {
    if (!composeBody.trim()) return;
    if (composeChannel === 'email' && !composeSubject.trim()) {
      toast.error('Subject is required for email');
      return;
    }
    setSending(true);
    const { error } = await invokeFinanceFunction(FN, {
      action: 'send',
      client_id: clientId,
      purchase_file_id: purchaseFileId,
      channel: composeChannel,
      body: composeBody,
      subject: composeChannel === 'email' ? composeSubject : undefined,
    });
    setSending(false);
    if (error) {
      toast.error(error.message || 'Send failed');
      return;
    }
    toast.success(`${CHANNEL_META[composeChannel]?.label} sent`);
    setComposeBody('');
    setComposeSubject('');
    qc.invalidateQueries({ queryKey: ['client-comms', clientId] });
    setTimeout(refetch, 800);
  };

  const [drafting, setDrafting] = useState(false);
  const aiDraft = async () => {
    const lastInbound = [...messages].reverse().find(m => m.direction === 'inbound');
    if (!lastInbound) { toast.info('No inbound message to reply to'); return; }
    setDrafting(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-ai-copilot', {
      action: 'draft_reply',
      purchase_file_id: purchaseFileId ?? null,
      client_id: clientId,
      last_message: lastInbound.body,
    });
    setDrafting(false);
    if (error) return toast.error(error.message || 'Draft failed');
    setComposeBody(data?.draft ?? '');
    toast.success('Draft inserted — review before sending');
  };

  const translate = async (m: UnifiedMessage, lang: string) => {
    setTranslatingId(m.id);
    const { data, error } = await invokeFinanceFunction(FN, {
      action: 'translate',
      source_kind: m.kind === 'outbound' ? 'finance_thread' : m.kind,
      source_id: m.source_id,
      text: m.body,
      target_lang: lang,
    });
    setTranslatingId(null);
    if (error) return toast.error(error.message || 'Translation failed');
    setTranslations(prev => ({ ...prev, [m.id]: { lang, text: data.translated_text } }));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquare className="h-5 w-5 text-primary" />
          Unified Inbox
          <Badge variant="outline" className="ml-auto font-normal">
            All channels in one timeline
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Tabs value={channelFilter} onValueChange={setChannelFilter}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="portal">Portal</TabsTrigger>
              <TabsTrigger value="sms">SMS</TabsTrigger>
              <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
              <TabsTrigger value="email">Email</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-2">
            <Languages className="h-4 w-4 text-muted-foreground" />
            <Select value={defaultLang} onValueChange={setDefaultLang}>
              <SelectTrigger className="w-[170px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANG_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ScrollArea className="h-[420px] rounded-md border border-border/60 bg-card/40 p-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading conversation…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
              <AlertCircle className="h-5 w-5" />
              No messages yet on this client. Send the first one below.
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => {
                const meta = CHANNEL_META[m.channel] ?? CHANNEL_META.portal;
                const Icon = meta.icon;
                const outbound = m.direction === 'outbound';
                const trans = translations[m.id];
                return (
                  <div key={m.id} className={cn('flex flex-col', outbound ? 'items-end' : 'items-start')}>
                    <div className={cn(
                      'max-w-[78%] rounded-2xl px-3.5 py-2.5 border text-sm shadow-sm',
                      outbound
                        ? 'bg-primary/10 border-primary/20 text-foreground'
                        : 'bg-card border-border/60 text-foreground',
                    )}>
                      <div className="flex items-center gap-2 mb-1 text-xs">
                        <Badge variant="outline" className={cn('h-5 px-1.5 gap-1', meta.tone)}>
                          <Icon className="h-3 w-3" /> {meta.label}
                        </Badge>
                        {m.subject && <span className="font-medium truncate">{m.subject}</span>}
                        <span className="text-muted-foreground ml-auto" title={format(new Date(m.created_at), 'PPpp')}>
                          {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      {trans && (
                        <div className="mt-2 border-t border-border/50 pt-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1 mb-0.5">
                            <Sparkles className="h-3 w-3" /> {trans.lang}
                          </div>
                          <div className="whitespace-pre-wrap text-foreground/80">{trans.text}</div>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                        {m.sender_name && <span>{m.sender_name}</span>}
                        {outbound && m.channel === 'email' && (
                          m.read_at
                            ? <span className="flex items-center gap-0.5 text-primary"><CheckCheck className="h-3 w-3" /> opened</span>
                            : <span className="flex items-center gap-0.5"><Check className="h-3 w-3" /> sent</span>
                        )}
                        {outbound && m.kind === 'outbound' && m.status === 'failed' && (
                          <span className="text-destructive flex items-center gap-0.5"><AlertCircle className="h-3 w-3" /> failed</span>
                        )}
                        <button
                          className="ml-auto inline-flex items-center gap-0.5 hover:text-primary disabled:opacity-50"
                          onClick={() => translate(m, defaultLang)}
                          disabled={translatingId === m.id}
                          title={`Translate to ${defaultLang}`}
                        >
                          {translatingId === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
                          translate
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Composer */}
        <div className="rounded-xl border border-border/60 bg-card/60 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Select value={composeChannel} onValueChange={(v: any) => setComposeChannel(v)}>
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['portal','sms','whatsapp','email'] as const).map(ch => {
                  const m = CHANNEL_META[ch]; const Icon = m.icon;
                  return (
                    <SelectItem key={ch} value={ch}>
                      <span className="inline-flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {m.label}</span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <div className="ml-auto">
              <TemplatesPicker
                kind={composeChannel === 'portal' ? 'message' : composeChannel === 'sms' || composeChannel === 'whatsapp' ? 'sms' : 'message'}
                onPick={(rendered) => {
                  setComposeBody(rendered.body || '');
                  if (rendered.title && composeChannel === 'email') setComposeSubject(rendered.title);
                }}
                vars={{ client_id: clientId, purchase_file_id: purchaseFileId || '' }}
              />
            </div>
          </div>
          {composeChannel === 'email' && (
            <Input
              placeholder="Subject"
              value={composeSubject}
              onChange={e => setComposeSubject(e.target.value)}
              className="h-9"
            />
          )}
          <Textarea
            placeholder={`Write a ${CHANNEL_META[composeChannel].label} message…`}
            value={composeBody}
            onChange={e => setComposeBody(e.target.value)}
            rows={3}
            className="resize-none"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {composeChannel === 'email' && 'Email opens are tracked via embedded pixel.'}
              {composeChannel === 'sms' && 'SMS sent through GoHighLevel.'}
              {composeChannel === 'whatsapp' && 'WhatsApp sent through GoHighLevel.'}
              {composeChannel === 'portal' && 'Posts to the client portal inbox.'}
            </span>
            <div className="flex items-center gap-2">
              <Button onClick={aiDraft} disabled={drafting} size="sm" variant="outline">
                {drafting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                AI Draft
              </Button>
              <Button onClick={send} disabled={sending || !composeBody.trim()} size="sm">
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
                Send
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
