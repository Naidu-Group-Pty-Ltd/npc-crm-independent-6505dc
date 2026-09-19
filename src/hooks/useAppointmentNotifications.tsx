import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNotificationsOptional } from '@/contexts/NotificationsContext';

/**
 * Realtime listener for appointment-related activity logs.
 * Catches appointments created from GHL webhooks, Outlook, dashboard, or any external source
 * by watching the activity_logs table for appointment_created / appointment_rescheduled / appointment_deleted events.
 * 
 * Note: Dashboard-originated appointments already fire notifications via useGHLCalendar hook.
 * This hook catches ones that come through webhooks or external systems by watching activity_logs.
 */
export function useAppointmentNotifications() {
  const notifications = useNotificationsOptional();
  const addNotification = notifications?.addNotification;
  const processedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!addNotification) return;
    console.log('[AppointmentNotifications] Setting up realtime subscription');

    // Listen to the ghl_appointment_events table if it exists, 
    // otherwise listen to activity_logs for appointment actions
    const channel = supabase
      .channel('appointment-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_logs',
          filter: 'action_type=in.(appointment_created,appointment_rescheduled,appointment_deleted)'
        },
        async (payload) => {
          const log = payload.new as any;
          
          if (processedIds.current.has(log.id)) return;
          processedIds.current.add(log.id);

          const entityName = log.entity_name || 'Appointment';

          switch (log.action_type) {
            case 'appointment_created':
              await addNotification?.({
                type: 'appointment_created',
                title: 'New Appointment',
                message: `"${entityName}" has been scheduled`,
                entityId: log.entity_id
              });
              break;
            case 'appointment_rescheduled':
              await addNotification?.({
                type: 'appointment_rescheduled',
                title: 'Appointment Rescheduled',
                message: `"${entityName}" has been rescheduled`,
                entityId: log.entity_id
              });
              break;
            case 'appointment_deleted':
              await addNotification?.({
                type: 'appointment_cancelled',
                title: 'Appointment Cancelled',
                message: `"${entityName}" has been cancelled`,
                entityId: log.entity_id
              });
              break;
          }
        }
      )
      .subscribe((status) => {
        console.log('[AppointmentNotifications] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [addNotification]);
}
