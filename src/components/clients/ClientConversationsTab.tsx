import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useBrand } from '@/branding/useBrand';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SearchInput } from '@/components/ui/search-input';
import { cn } from '@/lib/utils';
import {
  MessageSquare,
  Loader2,
  Send,
  ArrowLeft,
  Phone,
  Mail,
  MessageCircle,
  Camera,
  ThumbsUp,
  Globe,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  User,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { toast } from 'sonner';
import { isCorrespondence, summariseWithheldEntries, withheldEntriesSentence } from '@/lib/ghl/conversationEntry';

// Normalize GHL channel types
function normalizeChannel(ch: string | undefined): string {
  if (!ch) return 'sms';
  const lower = ch.toLowerCase();
  const map: Record<string, string> = {
    type_phone: 'sms', phone: 'sms', sms: 'sms', type_sms: 'sms', type_sms_reaction: 'sms',
    type_email: 'email', email: 'email',
    type_whatsapp: 'whatsapp', whatsapp: 'whatsapp',
    type_instagram: 'instagram', instagram: 'instagram',
    type_facebook: 'facebook', facebook: 'facebook',
    type_live_chat: 'live_chat', live_chat: 'live_chat', livechat: 'live_chat',
    type_call: 'sms', type_activity_contact: 'activity', type_activity_opportunity: 'activity',
    type_activity_appointment: 'activity',
  };
  return map[lower] || lower;
}

// Channel icon mapping
const channelIcons: Record<string, any> = {
  sms: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  instagram: Camera,
  facebook: ThumbsUp,
  live_chat: Globe,
};

const channelColors: Record<string, string> = {
  sms: 'bg-success/15 text-success border-success/30',
  email: 'bg-info/15 text-info border-info/30',
  whatsapp: 'bg-success/15 text-success border-success/30',
  instagram: 'bg-accent/15 text-accent border-accent/30',
  facebook: 'bg-accent/15 text-accent border-accent/30',
  live_chat: 'bg-accent/15 text-accent border-accent/30',
};

interface Conversation {
  id: string;
  ghl_conversation_id: string;
  channel_type: string;
  last_message_body: string | null;
  last_message_date: string | null;
  last_message_direction: string | null;
  unread_count: number;
}

interface Message {
  id: string;
  ghl_message_id: string;
  direction: string;
  channel_type: string | null;
  body: string | null;
  message_status: string | null;
  ghl_date_added: string | null;
  attachment_urls: string[] | null;
}

interface ClientConversationsTabProps {
  clientId: string;
  clientName: string;
  clientEmail?: string | null;
  ghlContactId?: string | null;
}

export function ClientConversationsTab({ clientId, clientName, clientEmail, ghlContactId }: ClientConversationsTabProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { settings: brandSettings } = useBrand();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyChannel, setReplyChannel] = useState<string>('sms');
  const [emailSubject, setEmailSubject] = useState('');
  const [selectedMailbox, setSelectedMailbox] = useState<string>('admin');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch available mailboxes for email sending
  const { data: mailboxes = [] } = useQuery({
    queryKey: ['mailboxes-for-conversations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('custom_users')
        .select('id, email, personal_mailbox')
        .not('personal_mailbox', 'is', null);
      if (error) throw error;
      return data.filter(u => u.personal_mailbox) || [];
    },
    enabled: replyChannel === 'email',
  });

  // Set default mailbox when mailboxes load
  useEffect(() => {
    if (mailboxes.length > 0 && selectedMailbox === 'admin') {
      const userMailbox = mailboxes.find(m => m.id === user?.id);
      if (userMailbox) setSelectedMailbox('personal');
    }
  }, [mailboxes, user?.id]);

  // Fetch conversations for this client
  const { data: conversations = [], isLoading: loadingConversations, refetch: refetchConversations } = useQuery({
    queryKey: ['ghl-conversations', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        listMode: true,
        listOptions: {
          table: 'ghl_conversations',
          filters: { client_id: clientId },
          orderBy: 'last_message_date',
          order_asc: false,
        },
      });
      if (error) throw new Error(error.message);
      return (data?.records || []) as Conversation[];
    },
    enabled: !!clientId,
  });

  // Fetch messages for selected conversation
  const { data: messages = [], isLoading: loadingMessages } = useQuery({
    queryKey: ['ghl-messages', selectedConversation?.id],
    queryFn: async () => {
      if (!selectedConversation) return [];
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        listMode: true,
        listOptions: {
          table: 'ghl_conversation_messages',
          filters: { conversation_id: selectedConversation.id },
          orderBy: 'ghl_date_added',
          order_asc: true,
        },
      });
      if (error) throw new Error(error.message);
      return (data?.records || []) as Message[];
    },
    enabled: !!selectedConversation?.id,
  });

  // Correspondence only — GHL interleaves its own activity records (opportunity,
  // appointment, contact, call) among a thread's entries, and they are not
  // messages. `isCorrespondence` is the shared decision; see
  // `_shared/ghlConversationMap.pure.ts`. Nothing is deleted.
  //
  // Declared HERE, under the query it derives from, because the scroll effect
  // below names it in a dependency array — an expression evaluated during
  // render — so declaring it later reads it inside its temporal dead zone and
  // throws during every render.
  const correspondence = useMemo(
    () => messages.filter((msg) => isCorrespondence(msg.channel_type)),
    [messages],
  );
  const withheldNotice = useMemo(
    () => withheldEntriesSentence(
      summariseWithheldEntries(messages.map((msg) => msg.channel_type)),
    ),
    [messages],
  );

  // Trigger sync
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!ghlContactId) throw new Error('No GHL contact linked');
      const { data, error } = await invokeSecureFunction('sync-ghl-conversations', {
        mode: 'contact',
        ghlContactId,
        clientId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      toast.success('Conversations synced');
      refetchConversations();
      if (selectedConversation) {
        queryClient.invalidateQueries({ queryKey: ['ghl-messages', selectedConversation.id] });
      }
    },
    onError: (err: any) => toast.error('Sync failed: ' + err.message),
  });

  // Send reply - routes email through Email Copilot, SMS/WhatsApp through GHL
  const sendMutation = useMutation({
    mutationFn: async ({ conversationId, message, type, subject }: { conversationId: string; message: string; type: string; subject?: string }) => {
      // Email channel: route through send-email-reply (Email Copilot) for signature support
      if (type === 'Email') {
        if (!clientEmail) throw new Error('Client does not have an email address');
        const { data, error } = await invokeSecureFunction('send-email-reply', {
          to: clientEmail,
          subject: subject || `Message from ${brandSettings.companyName || 'Dashboard'}`,
          body: message,
          mailboxSource: selectedMailbox,
          senderMailboxId: selectedMailbox === 'personal' ? user?.id : undefined,
          ghlConversationId: selectedConversation?.id || undefined,
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        return data;
      }
      
      // SMS/WhatsApp: route through GHL
      const { data, error } = await invokeSecureFunction('send-ghl-message', {
        conversationId,
        message,
        type,
        ...(subject ? { subject } : {}),
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_data, variables) => {
      setReplyText('');
      setEmailSubject('');
      toast.success('Message sent');
      // Optimistically add the sent message so it appears immediately
      if (selectedConversation) {
        queryClient.setQueryData(['ghl-messages', selectedConversation.id], (old: Message[] | undefined) => {
          if (!old) return old;
          const optimisticMsg: Message = {
            id: `optimistic-${Date.now()}`,
            ghl_message_id: `opt-${Date.now()}`,
            body: variables.message,
            direction: 'outbound',
            channel_type: replyChannel,
            ghl_date_added: new Date().toISOString(),
            message_status: 'sent',
            attachment_urls: null,
          };
          return [...old, optimisticMsg];
        });
        // Also refetch to get real server data
        queryClient.invalidateQueries({ queryKey: ['ghl-messages', selectedConversation.id] });
      }
      refetchConversations();
    },
    onError: (err: any) => toast.error('Failed to send: ' + err.message),
  });

  // When conversation changes, default the reply channel to match
  useEffect(() => {
    if (selectedConversation) {
      const ch = normalizeChannel(selectedConversation.channel_type);
      // Only default to channels we support sending on
      if (['sms', 'email', 'whatsapp'].includes(ch)) {
        setReplyChannel(ch);
      } else {
        setReplyChannel('sms');
      }
      setEmailSubject('');
      setReplyText('');
    }
  }, [selectedConversation?.id]);

  // Scroll to bottom when messages load
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [correspondence]);

  // Filter conversations
  const filteredConversations = useMemo(() => {
    if (!searchTerm) return conversations;
    const term = searchTerm.toLowerCase();
    // `contact_name` was a third clause here and `ghl_conversations` has no
    // such column, so that term matched nothing on any row — and this tab is
    // already scoped to ONE named client, where searching by contact name
    // would match everything or nothing anyway.
    return conversations.filter(
      (c) =>
        c.last_message_body?.toLowerCase().includes(term) ||
        c.channel_type?.toLowerCase().includes(term)
    );
  }, [conversations, searchTerm]);

  // Map internal channel to GHL API type
  const channelToGhlType = (ch: string): string => {
    switch (ch) {
      case 'email': return 'Email';
      case 'whatsapp': return 'WhatsApp';
      case 'sms':
      default: return 'SMS';
    }
  };

  const handleSendReply = () => {
    if (!replyText.trim() || !selectedConversation) return;
    if (replyChannel === 'email' && !emailSubject.trim()) {
      toast.error('Please enter an email subject');
      return;
    }
    sendMutation.mutate({
      conversationId: selectedConversation.ghl_conversation_id,
      message: replyText.trim(),
      type: channelToGhlType(replyChannel),
      ...(replyChannel === 'email' && emailSubject.trim() ? { subject: emailSubject.trim() } : {}),
    });
  };

  const formatMessageDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isToday(d)) return format(d, 'h:mm a');
    if (isYesterday(d)) return 'Yesterday ' + format(d, 'h:mm a');
    return format(d, 'dd MMM yyyy, h:mm a');
  };

  const formatConversationDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isToday(d)) return format(d, 'h:mm a');
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'dd/MM/yy');
  };

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups: { label: string; messages: Message[] }[] = [];
    let currentLabel = '';
    correspondence.forEach((msg) => {
      const d = msg.ghl_date_added ? new Date(msg.ghl_date_added) : new Date();
      let label: string;
      if (isToday(d)) label = 'Today';
      else if (isYesterday(d)) label = 'Yesterday';
      else label = format(d, 'EEEE, dd MMMM yyyy');
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });
    return groups;
  }, [correspondence]);

  // ===== CONVERSATION LIST VIEW =====
  if (!selectedConversation) {
    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Conversations
            {conversations.length > 0 && (
              <Badge variant="secondary" className="text-xs">{conversations.length}</Badge>
            )}
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !ghlContactId}
            title={!ghlContactId ? 'Client not linked to GHL' : 'Sync conversations from GHL'}
          >
            {syncMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Sync
          </Button>
        </div>

        {/* Search */}
        {conversations.length > 3 && (
          <SearchInput
            value={searchTerm}
            onValueChange={setSearchTerm}
            placeholder="Search conversations..."
            className="h-8 text-sm"
            iconClassName="h-3.5 w-3.5"
          />
        )}

        {/* Loading */}
        {loadingConversations && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty state */}
        {!loadingConversations && conversations.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">No conversations yet</p>
              <p className="text-xs mt-1">
                {ghlContactId
                  ? 'Click Sync to pull conversations from GoHighLevel'
                  : 'This client is not linked to a GHL contact'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Conversation list */}
        {filteredConversations.map((conv) => {
          const normalized = normalizeChannel(conv.channel_type);
          const ChannelIcon = channelIcons[normalized] || MessageSquare;
          const colorClass = channelColors[normalized] || 'bg-muted text-muted-foreground';

          return (
            <Card
              key={conv.id}
              className={cn(
                'cursor-pointer transition-all hover:shadow-md hover:border-primary/30',
                conv.unread_count > 0 && 'border-primary/50 bg-primary/[0.02]'
              )}
              onClick={() => setSelectedConversation(conv)}
            >
              <CardContent className="p-3 flex items-center gap-3">
                {/* Channel icon */}
                <div className={cn('h-9 w-9 rounded-full flex items-center justify-center shrink-0 border', colorClass)}>
                  <ChannelIcon className="h-4 w-4" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('text-sm truncate', conv.unread_count > 0 ? 'font-semibold' : 'font-medium')}>
                      {clientName}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatConversationDate(conv.last_message_date)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className={cn('text-xs truncate', conv.unread_count > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                      {conv.last_message_direction === 'outbound' && (
                        <span className="text-muted-foreground">You: </span>
                      )}
                      {conv.last_message_body || 'No messages'}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {conv.unread_count > 0 && (
                        <Badge className="h-5 min-w-[20px] rounded-full text-[10px] px-1.5 bg-primary">
                          {conv.unread_count}
                        </Badge>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  // ===== MESSAGE THREAD VIEW =====
  const normalizedSelectedChannel = normalizeChannel(selectedConversation.channel_type);
  const ChannelIcon = channelIcons[normalizedSelectedChannel] || MessageSquare;

  return (
    <div className="flex flex-col" style={{ height: '60vh' }}>
      {/* Thread header */}
      <div className="flex items-center gap-2 pb-2 border-b shrink-0">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setSelectedConversation(null)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className={cn('h-7 w-7 rounded-full flex items-center justify-center border', channelColors[normalizedSelectedChannel] || 'bg-muted')}>
          <ChannelIcon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{clientName}</p>
          <p className="text-[10px] text-muted-foreground capitalize">{normalizedSelectedChannel.replace('_', ' ')}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => {
            syncMutation.mutate();
            queryClient.invalidateQueries({ queryKey: ['ghl-messages', selectedConversation.id] });
          }}
          disabled={syncMutation.isPending}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', syncMutation.isPending && 'animate-spin')} />
        </Button>
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1 min-h-0 py-2" style={{ overflow: 'auto' }}>
        {loadingMessages ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : correspondence.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-40" />
            <p className="text-xs">No messages in this conversation</p>
            {withheldNotice && (
              <p className="mt-2 text-[11px] leading-5 px-6">{withheldNotice}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4 px-1">
            {groupedMessages.map((group) => (
              <div key={group.label}>
                {/* Date separator */}
                <div className="flex items-center gap-2 my-3">
                  <Separator className="flex-1" />
                  <span className="text-[10px] text-muted-foreground font-medium px-2">{group.label}</span>
                  <Separator className="flex-1" />
                </div>

                {/* Messages */}
                <div className="space-y-2">
                  {group.messages.map((msg) => {
                    const isOutbound = msg.direction === 'outbound';
                    const msgChannel = normalizeChannel(msg.channel_type || selectedConversation?.channel_type || '');
                    
                    const getOutboundBubbleClass = () => {
                      switch (msgChannel) {
                        case 'sms': return 'bg-info/15 dark:bg-info/40 text-foreground rounded-br-md';
                        case 'whatsapp': return 'bg-success/15 dark:bg-success/40 text-foreground rounded-br-md';
                        case 'email': return 'bg-brand-100 dark:bg-brand-900/40 text-foreground rounded-br-md';
                        default: return 'bg-info/15 dark:bg-info/40 text-foreground rounded-br-md';
                      }
                    };
                    
                    const getTimestampClass = () => {
                      if (!isOutbound) return 'text-muted-foreground';
                      switch (msgChannel) {
                        case 'sms': return 'text-info dark:text-info';
                        case 'whatsapp': return 'text-success dark:text-success';
                        case 'email': return 'text-brand-600 dark:text-brand-400';
                        default: return 'text-info dark:text-info';
                      }
                    };

                    return (
                      <div key={msg.id} className={cn('flex', isOutbound ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                          'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                          isOutbound
                            ? getOutboundBubbleClass()
                            : 'bg-muted rounded-bl-md'
                        )}>
                          {msg.body && (
                            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{msg.body}</p>
                          )}
                          {msg.attachment_urls && msg.attachment_urls.length > 0 && (
                            <div className="mt-1.5 space-y-1">
                              {msg.attachment_urls.map((url, i) => (
                                <a
                                  key={i}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs underline block truncate"
                                >
                                  Attachment {i + 1}
                                </a>
                              ))}
                            </div>
                          )}
                          <p className={cn('text-[10px] mt-1', getTimestampClass())}>
                            {msg.ghl_date_added && format(new Date(msg.ghl_date_added), 'h:mm a')}
                            {msg.message_status && msg.message_status !== 'delivered' && (
                              <span className="ml-1.5">· {msg.message_status}</span>
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Reply composer */}
      <div className="border-t pt-2 shrink-0 space-y-2">
        {/* Channel selector row */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">Send via:</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs px-2.5">
                {(() => {
                  const Icon = channelIcons[replyChannel] || MessageSquare;
                  return <Icon className="h-3 w-3" />;
                })()}
                <span className="capitalize">{replyChannel === 'sms' ? 'SMS' : replyChannel === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[140px]">
              <DropdownMenuItem onClick={() => setReplyChannel('sms')} className="gap-2 text-xs">
                <Phone className="h-3.5 w-3.5" /> SMS
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setReplyChannel('email')} className="gap-2 text-xs">
                <Mail className="h-3.5 w-3.5" /> Email
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setReplyChannel('whatsapp')} className="gap-2 text-xs">
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Email-specific: mailbox selector + subject */}
        {replyChannel === 'email' && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">Mailbox:</span>
              <Select value={selectedMailbox} onValueChange={setSelectedMailbox}>
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin" className="text-xs">Admin Mailbox</SelectItem>
                  {mailboxes.map((mb) => (
                    <SelectItem key={mb.id} value="personal" className="text-xs">
                      Personal — {mb.personal_mailbox}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="Email subject..."
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="h-8 text-sm"
            />
          </>
        )}

        {/* Message + send */}
        <div className="flex items-end gap-2">
          <Textarea
            placeholder={`Type your ${replyChannel === 'sms' ? 'SMS' : replyChannel === 'whatsapp' ? 'WhatsApp' : 'email'} message...`}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={replyChannel === 'email' ? 3 : 1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && replyChannel !== 'email') {
                e.preventDefault();
                handleSendReply();
              }
            }}
          />
          <Button
            size="sm"
            className="h-9 w-9 p-0 shrink-0"
            onClick={handleSendReply}
            disabled={!replyText.trim() || sendMutation.isPending || (replyChannel === 'email' && !emailSubject.trim())}
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
