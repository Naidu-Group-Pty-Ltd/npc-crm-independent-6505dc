import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getPortalSessionToken } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


function getSessionToken(): string | null {
  // In-memory only: `client-portal-verify` repopulates it from the HttpOnly
  // cookie on load. It used to come from localStorage. See src/lib/portalSession.ts.
  return getPortalSessionToken();
}

export interface PortalNotification {
  id: string;
  client_id: string;
  title: string;
  message: string | null;
  type: 'info' | 'success' | 'warning' | 'action';
  category: 'deal' | 'document' | 'message' | 'property' | 'general' | 'appointment' | 'account';
  is_read: boolean;
  read_at: string | null;
  action_url: string | null;
  created_at: string;
}

interface PortalNotificationContextValue {
  notifications: PortalNotification[];
  unreadCount: number;
  isLoading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refetch: () => void;
}

const PortalNotificationContext = createContext<PortalNotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  isLoading: true,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  refetch: () => {},
});

export function usePortalNotifications() {
  return useContext(PortalNotificationContext);
}

const POLL_INTERVAL = 30_000; // 30 seconds

export function PortalNotificationProvider({ children }: { children: ReactNode }) {
  const { user } = usePortalAuth();
  const queryClient = useQueryClient();
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const previousIdsRef = useRef<Set<string>>(new Set());
  const isFirstFetchRef = useRef(true);

  const fetchNotifications = useCallback(async () => {
    const sessionToken = getSessionToken();
    if (!sessionToken || !user?.client_id) return;

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/get-portal-client-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'x-portal-session-token': sessionToken,
        },
        credentials: 'omit',
        body: JSON.stringify({
          include: { notifications: true },
          portal_session_token: sessionToken,
          session_token: sessionToken,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) return;

      const fetched: PortalNotification[] = data.notifications || [];
      setNotifications(fetched);
      setIsLoading(false);

      // Toast for new notifications (skip initial load)
      if (!isFirstFetchRef.current) {
        const prevIds = previousIdsRef.current;
        const newNotifs = fetched.filter(n => !prevIds.has(n.id) && !n.is_read);
        newNotifs.forEach(n => {
          toast(n.title, {
            description: n.message || undefined,
            icon: <Bell className="h-4 w-4" />,
            duration: 5000,
          });
        });
      }
      isFirstFetchRef.current = false;
      previousIdsRef.current = new Set(fetched.map(n => n.id));
    } catch (err) {
      console.error('[PortalNotifications] fetch error:', err);
      setIsLoading(false);
    }
  }, [user?.client_id]);

  // Initial fetch + polling
  useEffect(() => {
    if (!user?.client_id) return;

    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL);

    // Realtime: refetch immediately on any insert/update for this client
    const channel = supabase
      .channel(`client-portal-notif-${user.client_id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_portal_notifications', filter: `client_id=eq.${user.client_id}` },
        () => { fetchNotifications(); }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [user?.client_id, fetchNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    const sessionToken = getSessionToken();
    if (!sessionToken) return;

    // Optimistic update
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)
    );

    try {
      await fetch(`${SUPABASE_URL}/functions/v1/manage-portal-client-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'x-portal-session-token': sessionToken,
        },
        credentials: 'omit',
        body: JSON.stringify({
          operation: 'update',
          table: 'client_portal_notifications',
          id,
          data: { is_read: true, read_at: new Date().toISOString() },
          portal_session_token: sessionToken,
          session_token: sessionToken,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['portal-client-data'] });
    } catch {
      // Revert optimistic update on failure
      fetchNotifications();
    }
  }, [queryClient, fetchNotifications]);

  const markAllAsRead = useCallback(async () => {
    const sessionToken = getSessionToken();
    if (!sessionToken) return;

    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;

    // Optimistic update
    setNotifications(prev =>
      prev.map(n => ({ ...n, is_read: true, read_at: n.read_at || new Date().toISOString() }))
    );

    try {
      await fetch(`${SUPABASE_URL}/functions/v1/manage-portal-client-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'x-portal-session-token': sessionToken,
        },
        credentials: 'omit',
        body: JSON.stringify({
          operation: 'bulk_mark_read',
          table: 'client_portal_notifications',
          data: { notification_ids: unreadIds },
          portal_session_token: sessionToken,
          session_token: sessionToken,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['portal-client-data'] });
    } catch {
      fetchNotifications();
    }
  }, [notifications, queryClient, fetchNotifications]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <PortalNotificationContext.Provider value={{
      notifications,
      unreadCount,
      isLoading,
      markAsRead,
      markAllAsRead,
      refetch: fetchNotifications,
    }}>
      {children}
    </PortalNotificationContext.Provider>
  );
}
