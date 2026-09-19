/**
 * Finance Portal — Inbox page (partner side). Lists all threads across all clients.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';
import { PortalEmptyState } from '@/components/finance-portal/PortalEmptyState';
import { FinanceMessagesThreadPanel, FinanceMessagesThreadPanelEmpty } from '@/components/finance-portal/FinanceMessagesThreadPanel';
import {
  MessageSquare, ChevronRight, MessageCircle, Send, Inbox
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useBrand } from '@/branding/useBrand';
import { toast } from 'sonner';
import { smartCapitalize } from '@/lib/nameUtils';

interface ThreadRow {
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

function getInitials(name?: string): string {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function getAvatarColor(name?: string): string {
  if (!name) return 'hsl(var(--primary))';
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hues = [25, 45, 200, 260, 330, 150, 10, 280];
  return `hsl(${hues[hash % hues.length]}, 55%, 50%)`;
}

function ThreadSkeleton() {
  return (
    <div className="flex items-center gap-3 p-4 border border-border/50 rounded-xl">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export default function FinancePortalMessages() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const { settings: brandSettings } = useBrand();
  const brandName = brandSettings.companyName || 'the team';
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedThread, setSelectedThread] = useState<ThreadRow | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await invokeFinanceFunction('finance-portal-messages', { operation: 'list_threads' });
    if (error) {
      const msg = error.message || data?.error || 'Failed to load messages';
      setLoadError(msg);
      setThreads([]);
      toast.error(`Messages failed to load: ${msg}`);
    } else {
      setLoadError(null);
      setThreads(data?.threads || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalUnread = threads.reduce((sum, t) => sum + (t.unread_count_partner || 0), 0);

  useEffect(() => {
    if (!threads.length) {
      setSelectedThread(null);
      setThreadOpen(false);
      return;
    }

    setSelectedThread((current) => current ? threads.find((t) => t.id === current.id) || threads[0] : current);
  }, [threads]);

  const openThread = (thread: ThreadRow) => {
    setSelectedThread(thread);
    setThreadOpen(true);
  };

  const threadPanel = selectedThread ? (
    <FinanceMessagesThreadPanel
      thread={selectedThread}
      invoke={(fn, body) => invokeFinanceFunction(fn, body)}
      onMessageSent={load}
    />
  ) : <FinanceMessagesThreadPanelEmpty />;

  return (
    <motion.div
      className="p-4 md:p-6 max-w-4xl mx-auto space-y-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5 text-foreground">
            <div className="p-2 rounded-xl bg-primary/10">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            Messages
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 ml-[42px]">
            Conversations with {brandName} for each client
          </p>
        </div>
        {totalUnread > 0 && (
          <Badge variant="default" className="bg-primary text-primary-foreground tabular-nums">
            {totalUnread} unread
          </Badge>
        )}
      </div>

      {/* Thread List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <ThreadSkeleton key={i} />
          ))}
        </div>
      ) : loadError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-10 text-center space-y-3">
            <MessageCircle className="h-8 w-8 mx-auto text-destructive" />
            <div>
              <p className="font-medium text-destructive">Unable to load messages</p>
              <p className="text-sm text-muted-foreground mt-1 break-words">{loadError}</p>
            </div>
            <Button variant="outline" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      ) : threads.length === 0 ? (
        <PortalEmptyState
          icon={<Inbox className="h-8 w-8" />}
          title="No conversations yet"
          description={`Open a client profile and use the Messages tab to start a conversation with ${brandName}.`}
          actionLabel="Go to clients"
          onAction={() => navigate('/finance/clients')}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
          <div className="space-y-2">
            <AnimatePresence initial={false}>
            {threads.map((t, idx) => {
              const name = smartCapitalize(t.clients?.primary_contact_name) || 'Client';
              const hasUnread = t.unread_count_partner > 0;
              const avatarBg = getAvatarColor(name);

              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: idx * 0.03 }}
                >
                  <button
                    onClick={() => openThread(t)}
                    className="w-full text-left group"
                  >
                    <div
                      className={cn(
                        'flex items-center gap-3 p-4 rounded-xl border transition-all duration-200 touch-manipulation',
                        hasUnread
                          ? 'border-l-[3px] border-l-primary border-t-border/50 border-r-border/50 border-b-border/50 bg-primary/[0.02]'
                          : 'border-border/50',
                        'hover:border-primary/20 hover:bg-primary/[0.03] hover:shadow-md hover:shadow-primary/5'
                      )}
                    >
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <Avatar className="h-10 w-10 border-2 border-border/30">
                          <AvatarFallback
                            className="font-semibold text-xs text-foreground dark:text-white"
                            style={{ backgroundColor: avatarBg }}
                          >
                            {getInitials(name)}
                          </AvatarFallback>
                        </Avatar>
                        {hasUnread && (
                          <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary border-2 border-card animate-pulse" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-sm truncate',
                            hasUnread ? 'font-bold text-foreground' : 'font-medium text-foreground'
                          )}>
                            {name}
                          </span>
                          {t.clients?.secondary_contact_name && (
                            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                              & {smartCapitalize(t.clients.secondary_contact_name)}
                            </span>
                          )}
                          {t.visibility_scope === 'finance_client_with_command_visibility' && (
                            <Badge variant="outline" className="border-success/30 bg-success/10 text-[10px] text-success h-[18px] px-1.5 shrink-0">
                              Client + CC visible
                            </Badge>
                          )}
                          {t.finance_allocated && (
                            <Badge variant="outline" className="border-brand-500/30 bg-brand-500/10 text-[10px] text-brand-700 h-[18px] px-1.5 shrink-0">
                              {String(t.allocation_status || 'Allocated').replace(/_/g, ' ')}
                            </Badge>
                          )}
                          {hasUnread && (
                            <Badge
                              variant="default"
                              className="bg-primary text-primary-foreground text-[10px] h-[18px] px-1.5 animate-pulse shrink-0"
                            >
                              {t.unread_count_partner}
                            </Badge>
                          )}
                        </div>
                        <p className={cn(
                          'text-xs mt-0.5 truncate',
                          hasUnread ? 'text-foreground/70 font-medium' : 'text-muted-foreground'
                        )}>
                          {t.last_message_preview || 'No messages yet'}
                        </p>
                      </div>

                      {/* Timestamp + Chevron */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden sm:inline">
                          {t.last_message_at
                            ? formatDistanceToNow(new Date(t.last_message_at), { addSuffix: true })
                            : '\u2014'}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                      </div>
                    </div>
                  </button>
                </motion.div>
              );
            })}
            </AnimatePresence>
          </div>

          <div className="hidden lg:block lg:min-h-[640px]">
            {threadPanel}
          </div>
        </div>
      )}

      {isMobile ? (
        <Drawer open={threadOpen} onOpenChange={setThreadOpen}>
          <DrawerContent className="max-h-[92vh] border-border bg-background">
            <div className="min-h-0">{threadPanel}</div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open={threadOpen && !!selectedThread} onOpenChange={setThreadOpen}>
          <SheetContent side="right" className="w-full border-border bg-background p-0 sm:max-w-2xl">
            {threadPanel}
          </SheetContent>
        </Sheet>
      )}
    </motion.div>
  );
}
