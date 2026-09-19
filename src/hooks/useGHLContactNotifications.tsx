import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNotifications } from '@/contexts/NotificationsContext';

/**
 * Realtime listener for new clients created via GHL webhook.
 * Detects new rows in clients table where ghl_contact_id is set,
 * indicating a new contact synced from GoHighLevel.
 */
export function useGHLContactNotifications() {
  const { addNotification } = useNotifications();
  const processedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    console.log('[GHLContactNotifications] Setting up realtime subscription');

    const channel = supabase
      .channel('ghl-contact-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'clients'
        },
        async (payload) => {
          const client = payload.new as any;

          // Only notify for GHL-sourced contacts
          if (!client.ghl_contact_id) return;

          if (processedIds.current.has(client.id)) return;
          processedIds.current.add(client.id);

          const name = [client.primary_first_name, client.primary_surname]
            .filter(Boolean).join(' ') || 'Unknown';

          console.log('[GHLContactNotifications] New GHL contact:', client.id);
          await addNotification({
            type: 'new_ghl_contact',
            title: 'New GHL Contact',
            message: `${name} has been synced from GoHighLevel`,
            entityId: client.id
          });
        }
      )
      .subscribe((status) => {
        console.log('[GHLContactNotifications] Subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [addNotification]);
}
