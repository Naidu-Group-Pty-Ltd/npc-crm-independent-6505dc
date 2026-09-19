import { FinanceMessagesThread, type InvokeFn } from './FinanceMessagesThread';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { MessageSquare, Lock, Unlock } from 'lucide-react';
import { smartCapitalize } from '@/lib/nameUtils';

interface ThreadMeta {
  id: string;
  client_id: string;
  subject: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count_partner: number;
  is_archived: boolean;
  visibility_scope?: string | null;
  thread_type?: string | null;
  allocation_status?: string | null;
  finance_allocated?: boolean | null;
  clients?: { id: string; primary_contact_name: string; secondary_contact_name: string | null };
}

interface FinanceMessagesThreadPanelProps {
  thread: ThreadMeta;
  invoke: InvokeFn;
  onMessageSent?: () => void;
  className?: string;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  return name.split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function getAvatarColor(name?: string): string {
  if (!name) return 'hsl(var(--primary))';
  const hash = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const hues = [25, 45, 200, 260, 330, 150, 10, 280];
  return `hsl(${hues[hash % hues.length]}, 55%, 50%)`;
}

export function FinanceMessagesThreadPanel({ thread, invoke, onMessageSent, className }: FinanceMessagesThreadPanelProps) {
  const name = smartCapitalize(thread.clients?.primary_contact_name) || 'Client';
  const secondary = smartCapitalize(thread.clients?.secondary_contact_name);
  const avatarBg = getAvatarColor(name);
  const unread = thread.unread_count_partner || 0;

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)}>
      <div className="border-b border-border bg-card/80 px-4 py-4 backdrop-blur-sm sm:px-5">
        <div className="flex items-start gap-3">
          <Avatar className="h-12 w-12 border-2 border-border/40">
            <AvatarFallback className="font-semibold text-sm text-primary-foreground" style={{ backgroundColor: avatarBg }}>
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-foreground sm:text-lg">{name}</h2>
              {secondary && <span className="truncate text-xs text-muted-foreground sm:text-sm">& {secondary}</span>}
              {thread.visibility_scope === 'finance_client_with_command_visibility' && (
                <Badge variant="outline" className="h-5 border-success/30 bg-success/10 px-2 text-[10px] font-semibold text-success">
                  Client + CC visible
                </Badge>
              )}
              {thread.finance_allocated && (
                <Badge variant="outline" className="h-5 border-brand-500/30 bg-brand-500/10 px-2 text-[10px] font-semibold text-brand-700">
                  {String(thread.allocation_status || 'Finance allocated').replace(/_/g, ' ')}
                </Badge>
              )}
              {unread > 0 && (
                <Badge className="h-5 bg-primary/15 px-2 text-[10px] font-semibold text-primary">
                  {unread} unread
                </Badge>
              )}
              <Badge variant="outline" className="h-5 gap-1 border-primary/20 text-[10px] text-muted-foreground">
                {thread.is_archived ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3 text-primary" />}
                {thread.is_archived ? 'Archived' : 'Active'}
              </Badge>
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {thread.last_message_preview || 'Reply to this conversation without leaving the inbox.'}
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-0 sm:p-4">
        <FinanceMessagesThread
          threadId={thread.id}
          viewerSide="partner"
          invoke={invoke}
          onMessageSent={onMessageSent}
          className="h-full rounded-none border-0 bg-background sm:rounded-lg sm:border sm:border-border"
        />
      </div>
    </div>
  );
}

export function FinanceMessagesThreadPanelEmpty() {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 px-6 text-center">
      <div className="max-w-sm space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm shadow-primary/10">
          <MessageSquare className="h-8 w-8" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-foreground">Open a conversation</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Select a thread to read updates and send replies from the same page.
          </p>
        </div>
      </div>
    </div>
  );
}