import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNotificationsOptional } from '@/contexts/NotificationsContext';

/**
 * Hook that monitors call alert history.
 * Triggers notifications for call alert rules that have been triggered.
 * 
 * Note: Missed call notifications are now handled server-side via a DB trigger
 * on vapi_call_logs (the table's RLS blocks client-side realtime for anon users).
 */
export function useCallAlertNotifications() {
  const notifications = useNotificationsOptional();
  const addNotification = notifications?.addNotification;
  const processedAlertIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!addNotification) return;
    console.log('[CallAlertNotifications] Setting up realtime subscription');

    // Subscribe to call_alert_history for triggered alerts (has open public SELECT)
    const alertChannel = supabase
      .channel('call-alert-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_alert_history'
        },
        async (payload) => {
          console.log('[CallAlertNotifications] Alert triggered:', payload);
          const alert = payload.new as any;

          if (processedAlertIds.current.has(alert.id)) return;
          processedAlertIds.current.add(alert.id);

          await addNotification?.({
            type: 'call_alert_triggered',
            title: `Alert: ${alert.rule_name}`,
            message: alert.message || 'A call alert rule was triggered',
            entityId: alert.call_id
          });
        }
      )
      .subscribe((status) => {
        console.log('[CallAlertNotifications] Alert subscription status:', status);
      });

    return () => {
      console.log('[CallAlertNotifications] Cleaning up subscription');
      supabase.removeChannel(alertChannel);
    };
  }, [addNotification]);
}
