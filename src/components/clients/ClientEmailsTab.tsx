import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { 
  Mail, 
  ExternalLink, 
  Loader2, 
  Inbox,
  Sparkles,
  MessageSquare,
  Reply,
  X,
  ChevronRight,
  Users,
  Send
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface LinkedEmail {
  id: string;
  sender: string;
  subject: string;
  body: string;
  received_at: string;
  status: string;
  urgency_level: string | null;
  summary: any | null;
  draft_reply: string | null;
  folder: 'inbox' | 'sent';
  conversation_id: string | null;
  to_recipients: string[] | null;
}

interface EmailThread {
  conversationId: string;
  subject: string;
  emails: LinkedEmail[];
  latestDate: string;
  participants: string[];
  hasUnread: boolean;
  highestUrgency: string | null;
}

interface ClientEmailsTabProps {
  clientId: string;
  clientName: string;
}

function normalizeSubject(subject: string): string {
  return subject.replace(/^(Re:\s*|Fwd?:\s*|FW:\s*|RE:\s*)+/gi, '').trim();
}

function extractSenderName(sender: string): string {
  const match = sender.match(/^([^<]+)</);
  if (match) return match[1].trim();
  const emailMatch = sender.match(/^([^@]+)@/);
  if (emailMatch) {
    return emailMatch[1]
      .split(/[._-]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }
  return sender;
}

function getUniqueParticipants(emails: LinkedEmail[]): string[] {
  const participants = new Set<string>();
  emails.forEach(e => {
    participants.add(e.sender);
    e.to_recipients?.forEach(r => participants.add(r));
  });
  return Array.from(participants).slice(0, 5);
}

export function ClientEmailsTab({ clientId, clientName }: ClientEmailsTabProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  const { data: emails = [], isLoading, refetch } = useQuery({
    queryKey: ['client-emails', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { emails: true },
      });
      if (error) throw error;
      return (data?.emails || []) as LinkedEmail[];
    },
  });

  const handleUnlink = async (emailId: string) => {
    try {
      const { error } = await invokeSecureFunction('email-copilot', {
        action: 'assign_client',
        emailId,
        clientId: null,
      });
      if (error) throw error;
      toast.success('Email unlinked from client');
      refetch();
    } catch (err) {
      toast.error('Failed to unlink email');
    }
  };

  const handleViewInCopilot = (emailId: string) => {
    navigate(`/email-copilot?emailId=${emailId}`);
  };

  const toggleThread = (conversationId: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  };

  // Group emails into threads
  const threads = useMemo(() => {
    const filtered = emails.filter(email => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        email.subject?.toLowerCase().includes(query) ||
        email.sender?.toLowerCase().includes(query) ||
        email.body?.toLowerCase().includes(query)
      );
    });

    const threadMap = new Map<string, LinkedEmail[]>();
    filtered.forEach(email => {
      const key = email.conversation_id || `solo_${email.id}`;
      if (!threadMap.has(key)) threadMap.set(key, []);
      threadMap.get(key)!.push(email);
    });

    const result: EmailThread[] = [];
    threadMap.forEach((threadEmails, conversationId) => {
      // Sort emails within thread chronologically (newest first)
      threadEmails.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
      
      const latestEmail = threadEmails[0];
      const participants = getUniqueParticipants(threadEmails);
      const hasUnread = threadEmails.some(e => e.status === 'unread');
      
      // Get highest urgency
      let highestUrgency: string | null = null;
      if (threadEmails.some(e => e.urgency_level === 'high')) highestUrgency = 'high';
      else if (threadEmails.some(e => e.urgency_level === 'medium')) highestUrgency = 'medium';

      result.push({
        conversationId,
        subject: normalizeSubject(latestEmail.subject),
        emails: threadEmails,
        latestDate: latestEmail.received_at,
        participants,
        hasUnread,
        highestUrgency,
      });
    });

    // Sort threads by latest email date (newest first)
    result.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
    return result;
  }, [emails, searchQuery]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'unread':
        return <Badge variant="default" className="text-[10px]">Unread</Badge>;
      case 'summarized':
        return (
          <Badge variant="outline" className="text-[10px] text-success border-success/30">
            <Sparkles className="h-2.5 w-2.5 mr-0.5" /> Summarized
          </Badge>
        );
      case 'drafted':
        return (
          <Badge variant="outline" className="text-[10px] text-accent border-accent/30">
            <MessageSquare className="h-2.5 w-2.5 mr-0.5" /> Drafted
          </Badge>
        );
      case 'replied':
      case 'sent':
        return (
          <Badge variant="outline" className="text-[10px] text-info border-info/30">
            <Reply className="h-2.5 w-2.5 mr-0.5" /> {status === 'sent' ? 'Sent' : 'Replied'}
          </Badge>
        );
      default:
        return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
    }
  };

  const getUrgencyBadge = (level: string | null) => {
    if (!level || level === 'low') return null;
    return (
      <Badge 
        variant="outline" 
        className={`text-[10px] ${
          level === 'high' ? 'text-destructive border-destructive/30' : 'text-warning border-warning/30'
        }`}
      >
        {level === 'high' ? '🔴' : '🟡'} {level}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Inbox className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-2">No Linked Emails</h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            No emails have been linked to {clientName} yet. 
            You can assign emails from the Email Copilot.
          </p>
          <Button 
            variant="outline" 
            className="mt-4"
            onClick={() => navigate('/email-copilot')}
          >
            <Mail className="h-4 w-4 mr-2" />
            Go to Email Copilot
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3 w-full min-w-0">
      {/* Search */}
      <SearchInput
        value={searchQuery}
        onValueChange={setSearchQuery}
        placeholder="Search emails..."
        containerClassName="max-w-sm"
      />

      {/* Threaded Email List */}
      <div className="space-y-1 w-full min-w-0">
        {threads.map((thread) => {
          const isExpanded = expandedThreads.has(thread.conversationId);
          const isSingleEmail = thread.emails.length === 1;
          const latestEmail = thread.emails[0];

          if (isSingleEmail) {
            // Single email — render as flat row
            const email = thread.emails[0];
            return (
              <SingleEmailRow
                key={email.id}
                email={email}
                getStatusBadge={getStatusBadge}
                getUrgencyBadge={getUrgencyBadge}
                onView={handleViewInCopilot}
                onUnlink={handleUnlink}
              />
            );
          }

          // Multi-email thread — collapsible accordion
          return (
            <Collapsible
              key={thread.conversationId}
              open={isExpanded}
              onOpenChange={() => toggleThread(thread.conversationId)}
            >
              <CollapsibleTrigger asChild>
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors group w-full min-w-0">
                  <ChevronRight className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  
                  {/* Stacked participant avatars */}
                  <div className="flex -space-x-2 flex-shrink-0">
                    {thread.participants.slice(0, 3).map((p, i) => (
                      <div
                        key={i}
                        className="w-7 h-7 rounded-full bg-primary/10 border-2 border-card flex items-center justify-center"
                        title={p}
                      >
                        <span className="text-[9px] font-semibold text-primary">
                          {extractSenderName(p).slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                    ))}
                    {thread.participants.length > 3 && (
                      <div className="w-7 h-7 rounded-full bg-muted border-2 border-card flex items-center justify-center">
                        <span className="text-[9px] text-muted-foreground">+{thread.participants.length - 3}</span>
                      </div>
                    )}
                  </div>

                  {/* Thread subject & preview */}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <p className={`text-sm truncate ${thread.hasUnread ? 'font-semibold' : 'font-medium'}`}>
                      {thread.subject || '(No Subject)'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {extractSenderName(latestEmail.sender)}: {latestEmail.body?.slice(0, 50).replace(/\n/g, ' ')}…
                    </p>
                  </div>

                  {/* Thread metadata */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {getUrgencyBadge(thread.highestUrgency)}
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Users className="h-2.5 w-2.5" />
                      {thread.emails.length}
                    </Badge>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(thread.latestDate), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="ml-6 border-l-2 border-muted pl-2 space-y-0.5 py-1 min-w-0">
                  {thread.emails.map((email) => (
                    <SingleEmailRow
                      key={email.id}
                      email={email}
                      getStatusBadge={getStatusBadge}
                      getUrgencyBadge={getUrgencyBadge}
                      onView={handleViewInCopilot}
                      onUnlink={handleUnlink}
                      compact
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>

      {/* Summary */}
      <p className="text-xs text-muted-foreground text-center pt-2">
        {threads.length} thread{threads.length !== 1 ? 's' : ''} · {emails.length} email{emails.length !== 1 ? 's' : ''} linked to this client
      </p>
    </div>
  );
}

// Extracted single email row component
function SingleEmailRow({
  email,
  getStatusBadge,
  getUrgencyBadge,
  onView,
  onUnlink,
  compact = false,
}: {
  email: LinkedEmail;
  getStatusBadge: (status: string) => React.ReactNode;
  getUrgencyBadge: (level: string | null) => React.ReactNode;
  onView: (id: string) => void;
  onUnlink: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`relative rounded-lg hover:bg-muted/50 transition-colors group w-full min-w-0 ${compact ? 'py-1.5' : 'py-2.5 border bg-card'}`}>
      <div className="flex items-center gap-2 px-3 min-w-0">
        {/* Sender avatar */}
        <div className={`rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 ${compact ? 'w-6 h-6' : 'w-8 h-8'}`}>
          {email.folder === 'sent' ? (
            <Send className={`text-primary ${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'}`} />
          ) : (
            <span className={`font-semibold text-primary ${compact ? 'text-[8px]' : 'text-xs'}`}>
              {extractSenderName(email.sender).slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        {/* Email details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`truncate flex-shrink-0 ${compact ? 'text-xs max-w-[120px]' : 'text-sm font-medium max-w-[180px]'}`}>
              {email.folder === 'sent' ? `To: ${email.to_recipients?.[0] ? extractSenderName(email.to_recipients[0]) : 'Unknown'}` : extractSenderName(email.sender)}
            </span>
            {!compact && <span className="text-xs text-muted-foreground">·</span>}
            <p className={`truncate flex-1 min-w-0 ${compact ? 'text-xs text-muted-foreground' : 'text-sm'}`}>
              {compact ? (email.body?.slice(0, 40).replace(/\n/g, ' ') + '…') : (email.subject || '(No Subject)')}
            </p>
          </div>
          {!compact && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {email.body?.slice(0, 60).replace(/\n/g, ' ')}…
            </p>
          )}
        </div>

        {/* Status & date */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {getStatusBadge(email.status)}
          {getUrgencyBadge(email.urgency_level)}
          <span className={`text-muted-foreground whitespace-nowrap ${compact ? 'text-[11px]' : 'text-xs'}`}>
            {format(new Date(email.received_at), compact ? 'MMM d' : 'MMM d, yyyy')}
          </span>
        </div>
      </div>

      {/* Hover overlay actions - outside the overflow-hidden container */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-background/95 backdrop-blur-sm border rounded-md shadow-sm px-1 py-0.5 z-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => { e.stopPropagation(); onView(email.id); }}
          title="View in Email Copilot"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onUnlink(email.id); }}
          title="Unlink from client"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
