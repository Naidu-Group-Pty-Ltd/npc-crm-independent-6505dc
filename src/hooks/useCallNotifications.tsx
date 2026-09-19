import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Global realtime listener for call log changes (vapi_call_logs).
 * 
 * Bell notifications are created SERVER-SIDE by the `notify_call_completed`
 * PostgreSQL trigger which inserts into the `notifications` table.
 * The NotificationsContext realtime subscription on the `notifications` table
 * picks them up automatically for the bell icon.
 * 
 * This hook only handles batched toast notifications for UX feedback
 * when calls complete while the app is open.
 * 
 * Note: We listen to the `notifications` table (filtered by type) rather than
 * `vapi_call_logs` directly, because RLS on vapi_call_logs blocks realtime
 * for the custom session-token auth system (auth.uid() is null).
 */
export function useCallNotifications() {
  const batchRef = useRef<any[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBatch = useCallback(() => {
    const batch = batchRef.current;
    batchRef.current = [];
    batchTimerRef.current = null;

    if (batch.length === 0) return;

    if (batch.length === 1) {
      const n = batch[0];
      toast.info(n.title, {
        description: n.message,
        duration: 4000
      });
    } else {
      toast.info(`${batch.length} new calls completed`, {
        description: 'Check Call Logs for details',
        duration: 5000
      });
    }
  }, []);

  useEffect(() => {
    console.log('[CallNotifications] Setting up realtime subscription on notifications table');

    const channel = supabase
      .channel('call-notifications-via-bell')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: 'type=eq.call_completed'
        },
        (payload) => {
          const notification = payload.new as any;
          console.log('[CallNotifications] New call notification:', notification.id);

          // Add to batch
          batchRef.current.push(notification);

          // Reset debounce timer — flush after 3 seconds of no new calls
          if (batchTimerRef.current) {
            clearTimeout(batchTimerRef.current);
          }
          batchTimerRef.current = setTimeout(flushBatch, 3000);
        }
      )
      .subscribe((status) => {
        console.log('[CallNotifications] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
    };
  }, [flushBatch]);
}
