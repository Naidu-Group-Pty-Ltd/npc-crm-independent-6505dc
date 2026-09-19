import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { smartCapitalize } from '@/lib/nameUtils';

interface NotificationItem {
  id: string;
  notification_type: string;
  title: string;
  body: string | null;
  link_path: string | null;
  is_read: boolean;
  created_at: string;
  client_id: string | null;
  clients?: { id: string; primary_first_name: string; primary_surname: string } | null;
}

const POLL_INTERVAL = 60_000; // 60s

export function FinancePortalNotificationBell({
  /**
   * An opaque value that changes when something the portal already knows about
   * has moved — today, the agreement sync cursor's stamp. The badge re-reads
   * immediately rather than waiting out the rest of its minute, which is what
   * stops an agreement appearing in the list before the bell admits it exists.
   * Optional: without it the bell behaves exactly as it did.
   */
  refreshSignal,
}: { refreshSignal?: string } = {}) {
  const { invokeFinanceFunction, user } = useFinancePortalAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    const { data, error } = await invokeFinanceFunction('finance-portal-notifications', {
      operation: 'unread_count',
    });
    if (!error && typeof data?.count === 'number') {
      setUnreadCount(data.count);
    }
  }, [invokeFinanceFunction, user]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-notifications', {
      operation: 'list',
      limit: 25,
    });
    if (!error) {
      setItems(data?.notifications || []);
    }
    setLoading(false);
  }, [invokeFinanceFunction]);

  // Initial + polling for unread count through the finance-session-authenticated API.
  useEffect(() => {
    if (!user) return;
    void fetchUnreadCount();
    const id = setInterval(fetchUnreadCount, POLL_INTERVAL);

    return () => {
      clearInterval(id);
    };
  }, [user, fetchUnreadCount]);

  // Fetch list when opened
  useEffect(() => {
    if (open) void fetchList();
  }, [open, fetchList]);

  // …and again the moment the agreement cursor reports a change. Skipped on
  // the first render — `refreshSignal` arriving is not a change, and the mount
  // effect above has already read the count.
  const lastSignal = useRef<string | undefined>(refreshSignal);
  useEffect(() => {
    if (!user || refreshSignal === undefined) return;
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    void fetchUnreadCount();
    if (open) void fetchList();
  }, [refreshSignal, user, open, fetchUnreadCount, fetchList]);

  const handleClick = async (item: NotificationItem) => {
    if (!item.is_read) {
      await invokeFinanceFunction('finance-portal-notifications', {
        operation: 'mark_read',
        notification_id: item.id,
      });
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_read: true } : i));
      setUnreadCount(c => Math.max(0, c - 1));
    }
    setOpen(false);
    if (item.link_path) navigate(item.link_path);
    else if (item.client_id) navigate(`/finance/clients/${item.client_id}`);
  };

  const handleMarkAllRead = async () => {
    setMarking(true);
    await invokeFinanceFunction('finance-portal-notifications', {
      operation: 'mark_all_read',
    });
    setItems(prev => prev.map(i => ({ ...i, is_read: true })));
    setUnreadCount(0);
    setMarking(false);
  };

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center rounded-full"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Notifications</div>
            <div className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up'}
            </div>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={handleMarkAllRead}
              disabled={marking}
            >
              {marking ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3 mr-1" />}
              Mark all read
            </Button>
          )}
        </div>

        <ScrollArea className="h-[420px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Bell className="h-8 w-8 text-muted-foreground mb-3" />
              <div className="text-sm font-medium">No notifications yet</div>
              <div className="text-xs text-muted-foreground mt-1">
                You will see updates about your clients here.
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {items.map(item => {
                const clientName = item.clients
                  ? `${smartCapitalize(item.clients.primary_first_name)} ${smartCapitalize(item.clients.primary_surname)}`.trim()
                  : null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleClick(item)}
                    className={cn(
                      'w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors',
                      !item.is_read && 'bg-primary/5'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'mt-1.5 h-2 w-2 rounded-full shrink-0',
                        item.is_read ? 'bg-transparent' : 'bg-primary'
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium leading-tight">{item.title}</div>
                        {item.body && (
                          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {item.body}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          {clientName && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                              {clientName}
                            </Badge>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
